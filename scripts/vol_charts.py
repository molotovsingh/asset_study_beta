#!/usr/bin/env python3
"""Volatility charts (term structure, skew, surface, VIX curve, GEX) for US tickers.

Data comes from the vendored global-stock-data CBOE delayed options chain.
SKILL.md interleaves live example calls between definitions, so only
definitions/constants are extracted and executed -- it is not importable as-is.

Requires numpy (SVI fitting, parity regression) and, for live runs, requests
(used by the vendor functions). The repo .venv has both.

Examples:
  .venv/bin/python scripts/vol_charts.py
  .venv/bin/python scripts/vol_charts.py --tickers SPY,QQQ --max-dte 90
  .venv/bin/python scripts/vol_charts.py --expiry-mode monthly --max-dte 60
  .venv/bin/python scripts/vol_charts.py --expiry-mode nearest --expiry-count 4 --min-oi 100
"""
import argparse, ast, csv, math, re
from pathlib import Path
from datetime import date
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "vendors" / "global-stock-data" / "SKILL.md"
COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706"]


def load_vendor():
    text = SKILL.read_text()
    blocks = re.findall(r"```python\n(.*?)```", text, re.S)
    tree = ast.parse("\n\n".join(blocks))
    safe_calls = {"re.compile", "dict", "list", "set", "tuple", "frozenset"}

    def call_name(v):
        if isinstance(v, ast.Name):
            return v.id
        if isinstance(v, ast.Attribute):
            base = call_name(v.value)
            return f"{base}.{v.attr}" if base else v.attr
        return ""

    keep_types = (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    kept = []
    for node in tree.body:
        if isinstance(node, keep_types):
            kept.append(node)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            value = node.value
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names = [t.id for t in targets if isinstance(t, ast.Name)]
            if not isinstance(value, ast.Call) or call_name(value.func) in safe_calls or (names and names[0].isupper()):
                kept.append(node)
    ns = {}
    exec(compile(ast.unparse(ast.Module(body=kept, type_ignores=[])), "vendor-defs", "exec"), ns)
    return ns


def interp(points, x):
    if not points or x < points[0][0] or x > points[-1][0]:
        return None
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def iv_at_delta(group, target, delta_min, delta_max):
    """IV at a target |delta|: median IV per 0.02 delta bucket, then interp.

    Median-per-bucket keeps one stale/junk low-delta quote from bending the
    skew (seen live on thin chains such as HPE, where a single 104% IV print
    at 10-delta sat next to 79% neighbours).
    """
    buckets = {}
    for c in group:
        d = abs(c["delta"])
        if delta_min < d < delta_max:
            buckets.setdefault(round(d * 50) / 50, []).append(c["iv"])
    pts = []
    for d, ivs in buckets.items():
        ivs = sorted(ivs)
        pts.append((d, ivs[len(ivs) // 2] if len(ivs) % 2 else (ivs[len(ivs) // 2 - 1] + ivs[len(ivs) // 2]) / 2))
    return interp(sorted(pts), target)


def svi_w(k, p):
    """Raw SVI total variance at log-moneyness k."""
    import numpy as np
    k = np.asarray(k, dtype=float)
    return p["a"] + p["b"] * (p["rho"] * (k - p["m"]) + np.sqrt((k - p["m"]) ** 2 + p["sigma"] ** 2))


def _nelder_mead(f, x0, step=0.35, max_iter=900):
    """Small Nelder-Mead minimiser (no scipy dependency)."""
    import numpy as np
    n = len(x0)
    simplex = [np.array(x0, dtype=float)]
    for i in range(n):
        x = np.array(x0, dtype=float); x[i] += step
        simplex.append(x)
    vals = [f(x) for x in simplex]
    for _ in range(max_iter):
        order = sorted(range(n + 1), key=lambda i: vals[i])
        simplex = [simplex[i] for i in order]; vals = [vals[i] for i in order]
        if max(abs(vals[i] - vals[0]) for i in range(1, n + 1)) < 1e-10:
            break
        centroid = sum(simplex[:-1]) / n
        xr = centroid + (centroid - simplex[-1]); fr = f(xr)
        if fr < vals[0]:
            xe = centroid + 2 * (centroid - simplex[-1]); fe = f(xe)
            simplex[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            simplex[-1], vals[-1] = xr, fr
        else:
            xc = centroid + 0.5 * (simplex[-1] - centroid); fc = f(xc)
            if fc < vals[-1]:
                simplex[-1], vals[-1] = xc, fc
            else:
                for i in range(1, n + 1):
                    simplex[i] = simplex[0] + 0.5 * (simplex[i] - simplex[0]); vals[i] = f(simplex[i])
    best = min(range(n + 1), key=lambda i: vals[i])
    return simplex[best], vals[best]


def fit_svi(ks, ivs, T):
    """Fit raw SVI to one expiry slice. Returns params + fit quality, or None.

    Fit in IV space so residuals read in vol points. Constraints via parameter
    transforms (b, sigma > 0; |rho| < 1) plus penalties for negative minimum
    variance and for the Gatheral butterfly bound b*(1+|rho|) <= 4.
    """
    import numpy as np
    ks = np.asarray(ks, dtype=float); ivs = np.asarray(ivs, dtype=float)
    if len(ks) < 10 or T <= 0:
        return None
    w = ivs ** 2 * T

    def unpack(x):
        return {"a": float(x[0]), "b": float(math.exp(max(-6.0, min(2.0, x[1])))),
                "rho": float(math.tanh(x[2])), "m": float(x[3]),
                "sigma": float(math.exp(max(-6.0, min(1.0, x[4]))))}

    def objective(x):
        p = unpack(x)
        model_w = svi_w(ks, p)
        model_iv = np.sqrt(np.maximum(model_w, 1e-8) / T)
        loss = float(np.mean((model_iv - ivs) ** 2))
        min_var = p["a"] + p["b"] * p["sigma"] * math.sqrt(max(1 - p["rho"] ** 2, 0.0))
        if min_var < 0:
            loss += 10.0 * min_var ** 2 + 1.0
        bound = p["b"] * (1 + abs(p["rho"]))
        if bound > 4:
            loss += (bound - 4) ** 2
        return loss

    x0 = np.array([max(float(np.min(w)) * 0.8, 1e-5), math.log(0.08), math.atanh(-0.4),
                   float(ks[np.argmin(ivs)]), math.log(0.08)])
    xbest, _ = _nelder_mead(objective, x0)
    p = unpack(xbest)
    model_iv = np.sqrt(np.maximum(svi_w(ks, p), 1e-8) / T)
    rmse = float(np.sqrt(np.mean((model_iv - ivs) ** 2)))
    if not math.isfinite(rmse) or rmse > 0.20:  # fit failed; caller falls back
        return None
    return {"params": p, "rmse": rmse,
            "butterfly_ok": bool(p["b"] * (1 + abs(p["rho"])) <= 4)}


def forward_from_parity(group, spot):
    """Forward from put-call parity: regress (call mid - put mid) on strike.

    C - P = D*(F - K): slope gives -D, intercept gives D*F. Falls back to spot
    when there are too few paired strikes or the result is implausible.
    """
    import numpy as np
    by_strike = {}
    for c in group:
        mid = None
        bid, ask = c.get("bid"), c.get("ask")
        if bid and ask and bid > 0 and ask >= bid:
            mid = (bid + ask) / 2
        elif c.get("last_trade_price"):
            mid = c["last_trade_price"]
        if mid is not None:
            by_strike.setdefault(c["strike"], {})[c["type"]] = mid
    pairs = [(k, v["call"], v["put"]) for k, v in by_strike.items()
             if "call" in v and "put" in v and abs(k / spot - 1) <= 0.10]
    if len(pairs) < 5:
        return spot
    ks = np.array([p[0] for p in pairs]); diffs = np.array([p[1] - p[2] for p in pairs])
    slope, intercept = np.polyfit(ks, diffs, 1)
    D = -slope
    if D <= 0.5 or D > 1.05:
        return spot
    F = intercept / D
    return float(F) if 0.8 * spot <= F <= 1.2 * spot else spot


def historical_vol(closes, window=30):
    """Annualised historical vol from daily closes: sample stdev of the last
    `window` log returns x sqrt(252). None when there is not enough history."""
    closes = [c for c in closes if c and c > 0]
    if len(closes) < 11:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))][-window:]
    if len(rets) < 10:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


def quote_is_tradable(c, max_spread_frac=0.5):
    """A quote usable for vol fitting: real two-sided market, sane spread."""
    bid, ask = c.get("bid"), c.get("ask")
    if not bid or not ask or bid <= 0 or ask < bid:
        return False
    mid = (bid + ask) / 2
    return mid > 0 and (ask - bid) / mid <= max_spread_frac


def is_monthly(d):
    """Standard monthly expiry: third Friday of the month."""
    return d.weekday() == 4 and 15 <= d.day <= 21


def select_expiries(expiries, asof_d, args):
    """expiries: sorted ISO strings. Returns filtered list per expiry params."""
    out = []
    for e in expiries:
        d = date.fromisoformat(e)
        dte = (d - asof_d).days
        if dte < args.min_dte:
            continue
        if args.max_dte is not None and dte > args.max_dte:
            continue
        if args.expiry_mode == "monthly" and not is_monthly(d):
            continue
        if args.expiry_mode == "weekly" and is_monthly(d):
            continue
        out.append(e)
    if args.expiry_mode == "nearest":
        out = out[: args.expiry_count]
    return out


def build(ns, ticker, args):
    chain = ns["options_chain_cboe"](ticker)
    contracts, spot = chain["contracts"], chain["spot"]
    asof = str(chain.get("timestamp") or "")[:10]
    asof_d = date.fromisoformat(asof) if asof else date.today()

    clean = [c for c in contracts
             if c.get("iv") and args.iv_min < c["iv"] < args.iv_max
             and c.get("delta") is not None
             and (c.get("open_interest") or 0) >= args.min_oi
             and (c.get("volume") or 0) >= args.min_volume
             and (args.allow_unquoted or quote_is_tradable(c, args.max_spread_pct / 100.0))]
    all_expiries = sorted({c["expiry"] for c in clean})
    chosen = set(select_expiries(all_expiries, asof_d, args))
    clean = [c for c in clean if c["expiry"] in chosen]

    by_expiry = defaultdict(lambda: {"call": [], "put": []})
    for c in clean:
        by_expiry[c["expiry"]][c["type"]].append(c)

    rows = []
    for expiry in sorted(by_expiry):
        g = by_expiry[expiry]
        ivs = {"10P": iv_at_delta(g["put"], 0.10, args.delta_min, args.delta_max),
               "15P": iv_at_delta(g["put"], 0.15, args.delta_min, args.delta_max),
               "25P": iv_at_delta(g["put"], 0.25, args.delta_min, args.delta_max),
               "35P": iv_at_delta(g["put"], 0.35, args.delta_min, args.delta_max),
               "35C": iv_at_delta(g["call"], 0.35, args.delta_min, args.delta_max),
               "25C": iv_at_delta(g["call"], 0.25, args.delta_min, args.delta_max),
               "15C": iv_at_delta(g["call"], 0.15, args.delta_min, args.delta_max),
               "10C": iv_at_delta(g["call"], 0.10, args.delta_min, args.delta_max)}
        c50 = iv_at_delta(g["call"], 0.50, args.delta_min, args.delta_max)
        p50 = iv_at_delta(g["put"], 0.50, args.delta_min, args.delta_max)
        ivs["ATM"] = (c50 + p50) / 2 if c50 and p50 else (c50 or p50)
        dte = (date.fromisoformat(expiry) - asof_d).days
        if dte < 0:
            continue
        rr = (ivs["25C"] - ivs["25P"]) if ivs["25C"] is not None and ivs["25P"] is not None else None
        bf = ((ivs["25C"] + ivs["25P"]) / 2 - ivs["ATM"]) if rr is not None and ivs["ATM"] is not None else None
        rows.append({"expiry": expiry, "dte": dte, **ivs, "RR25": rr, "BF25": bf,
                     "n": len(g["call"]) + len(g["put"])})

    gex = defaultdict(float)
    for c in clean:
        if c.get("gamma") is None or not c.get("open_interest"):
            continue
        v = c["gamma"] * c["open_interest"] * 100 * spot * spot * 0.01
        gex[c["strike"]] += v if c["type"] == "call" else -v

    # Dense surface for the 3D chart: SVI calibration per expiry.
    # Forward per expiry from put-call parity (C-P = D*(F-K) regression near
    # the money); OTM contracts only; smile fitted in total variance with raw
    # SVI; slices then interpolated in total variance to constant maturities.
    import numpy as np
    k_grid = [round(-0.20 + 0.02 * i, 4) for i in range(21)]
    by_exp = defaultdict(list)
    for c in clean:
        by_exp[c["expiry"]].append(c)
    per_expiry, raw_pts, slices, all_resid = [], [], [], []
    resid_slice = {"dte": None, "points": []}
    for expiry in sorted(by_exp):
        dte = (date.fromisoformat(expiry) - asof_d).days
        if dte < 3:  # SVI strains on 0-2 DTE slices; keep them out of the fit
            continue
        T = dte / 365.0
        group = by_exp[expiry]
        fwd = forward_from_parity(group, spot)
        pts = []
        for c in group:
            otm = (c["type"] == "put" and c["strike"] < fwd) or (c["type"] == "call" and c["strike"] >= fwd)
            if not otm:
                continue
            k = math.log(c["strike"] / fwd)
            if abs(k) <= 0.25:
                pts.append((k, c["iv"], c))
        if len(pts) < 10:
            continue
        fit = fit_svi([p[0] for p in pts], [p[1] for p in pts], T)
        if fit is None:  # fallback: quadratic smile in log-moneyness
            coef = np.polyfit([p[0] for p in pts], [p[1] for p in pts], 2)
            dense = np.clip(np.polyval(coef, k_grid), 0.03, 2.0).tolist()
            slices.append({"expiry": expiry, "dte": dte, "forward": fwd, "method": "quad",
                           "rmse": None, "n": len(pts), "butterfly_ok": None, "params": None})
        else:
            dense = [float(math.sqrt(max(svi_w(k, fit["params"]), 1e-8) / T)) for k in k_grid]
            slices.append({"expiry": expiry, "dte": dte, "forward": fwd, "method": "svi",
                           "rmse": fit["rmse"], "n": len(pts),
                           "butterfly_ok": fit["butterfly_ok"], "params": fit["params"]})
            for k, iv, c in pts:
                fitted = math.sqrt(max(svi_w(k, fit["params"]), 1e-8) / T)
                r = (iv - fitted) * 100  # residual in vol points
                all_resid.append({"expiry": expiry, "dte": dte, "symbol": c.get("symbol"),
                                  "type": c["type"], "strike": c["strike"], "k": round(k, 4),
                                  "market_iv": iv, "fitted_iv": fitted, "resid": r})
        per_expiry.append((dte, dense))
        step = max(1, len(pts) // 40)
        raw_pts.extend([[dte, round(float(k), 4), round(float(v), 4)] for k, v, _ in pts[::step]])
    if all_resid:
        best_dte = min({r["dte"] for r in all_resid}, key=lambda x: abs(x - 30))
        resid_slice = {"dte": best_dte,
                       "points": [[r["k"], round(r["resid"], 2)] for r in all_resid if r["dte"] == best_dte]}
    # Calendar-arbitrage check + repair: total variance must not decrease in T.
    calendar_violations = 0
    if len(per_expiry) >= 2:
        wmat = [[(iv ** 2) * (d / 365.0) for iv in dense] for d, dense in per_expiry]
        for i in range(1, len(wmat)):
            for j in range(len(wmat[0])):
                if wmat[i][j] < wmat[i - 1][j] - 1e-9:
                    calendar_violations += 1
                    wmat[i][j] = wmat[i - 1][j]
        per_expiry = [(per_expiry[i][0],
                       [math.sqrt(wmat[i][j] / (per_expiry[i][0] / 365.0)) for j in range(len(wmat[0]))])
                      for i in range(len(per_expiry))]
    target_dtes = [7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365]
    surf_dtes, surf_rows = [], []
    for td in target_dtes:
        if not per_expiry or td < per_expiry[0][0] or td > per_expiry[-1][0]:
            continue
        row = []
        for j in range(len(k_grid)):
            w = interp([(d, (iv[j] ** 2) * (d / 365.0)) for d, iv in per_expiry], td)
            row.append(round(float(math.sqrt(max(w, 0.0) / (td / 365.0))), 4) if w else None)
        surf_dtes.append(td)
        surf_rows.append(row)
    try:
        klines = ns["stock_kline_yahoo"](ticker, range_="6mo")
        hv30 = historical_vol([k.get("close") for k in klines], 30)
    except Exception:
        hv30 = None

    surface3d = {"k": k_grid, "dtes": surf_dtes, "iv": surf_rows, "raw": raw_pts[:300]}
    if all_resid:
        absr = sorted(abs(r["resid"]) for r in all_resid)
        residuals = {"n": len(all_resid),
                     "mae": round(sum(absr) / len(absr), 2),
                     "p95": round(absr[min(len(absr) - 1, int(0.95 * len(absr)))], 2),
                     "share_over_2": round(100 * sum(1 for x in absr if x > 2) / len(absr), 1),
                     "rich": sorted(all_resid, key=lambda r: -r["resid"])[:5],
                     "cheap": sorted(all_resid, key=lambda r: r["resid"])[:5]}
    else:
        residuals = {"n": 0, "mae": None, "p95": None, "share_over_2": None, "rich": [], "cheap": []}
    return {"ticker": ticker, "spot": spot, "asof": asof, "total": len(contracts),
            "clean": len(clean), "expiries_total": len(all_expiries), "rows": rows,
            "gex": dict(gex), "surface3d": surface3d, "slices": slices, "hv30": hv30,
            "residuals": residuals, "resid_slice": resid_slice,
            "calendar_violations": calendar_violations}


# ---------- SVG charts ----------
def line_chart(series, title, subtitle, w=880, h=300, x_label="DTE (days)", x_max=None):
    pts_all = [p for _, _, pts in series for p in pts if p[1] is not None]
    xs = [p[0] for p in pts_all]; ys = [p[1] for p in pts_all]
    x0, x1 = min(xs), (x_max if x_max is not None else max(xs))
    y0, y1 = min(ys) * 0.92, max(ys) * 1.06
    def X(x): return 56 + (x - x0) / max(x1 - x0, 1) * (w - 110)
    def Y(y): return h - 42 - (y - y0) / max(y1 - y0, 0.01) * (h - 95)
    p = [f'<svg viewBox="0 0 {w} {h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#fff">',
         f'<text x="56" y="24" font-size="16" font-weight="700" fill="#111827">{title}</text>',
         f'<text x="56" y="42" font-size="11.5" fill="#4b5563">{subtitle}</text>']
    for gy in [0, .25, .5, .75, 1]:
        yv = y0 + (y1 - y0) * gy
        p.append(f'<line x1="56" y1="{Y(yv):.0f}" x2="{w-54}" y2="{Y(yv):.0f}" stroke="#e5e7eb"/><text x="6" y="{Y(yv)+4:.0f}" font-size="11" fill="#374151">{yv*100:.0f}%</text>')
    for label, col, pts in series:
        valid = [(x, y) for x, y in pts if y is not None and x <= x1]
        if not valid:
            continue
        line = " ".join(f"{X(x):.0f},{Y(y):.0f}" for x, y in valid)
        p.append(f'<polyline fill="none" stroke="{col}" stroke-width="2.4" points="{line}"/>')
        p.append(f'<text x="{X(valid[-1][0])+6:.0f}" y="{Y(valid[-1][1])+4:.0f}" font-size="12" font-weight="700" fill="{col}">{label}</text>')
    p.append(f'<text x="{w-54}" y="{h-12}" font-size="11" fill="#4b5563" text-anchor="end">{x_label}</text></svg>')
    return "\n".join(p)


def nearest(rows, tgt):
    return min(rows, key=lambda r: abs(r["dte"] - tgt))


def skew_chart(d, w=560, h=300):
    labels = ["10P", "25P", "ATM", "25C", "10C"]
    cols = ["#111827", "#2563eb", "#059669", "#d97706"]
    targets = [5, 30, 90, 180]
    series = []
    for i, tgt in enumerate(targets):
        if not d["rows"]:
            break
        r = nearest(d["rows"], tgt)
        series.append((f'{r["dte"]}d', cols[i], [(j, r[k]) for j, k in enumerate(labels)]))
    return line_chart(series, f'{d["ticker"]} skew by expiry', 'IV at 10P / 25P / ATM / 25C / 10C', w=w, h=h, x_label="delta bucket", x_max=4)


def heatmap(d, max_rows=14, w=560, h=352):
    labels = ["10P", "25P", "ATM", "25C", "10C"]
    rows = d["rows"][:max_rows]
    vmin, vmax = 0.12, d.get("cmax", 0.65)
    def col(v):
        if v is None:
            return "#f3f4f6"
        t = max(0.0, min(1.0, (v - vmin) / (vmax - vmin)))
        stops = [(247, 251, 255), (37, 99, 235), (185, 28, 28)]
        a, b, u = (stops[0], stops[1], t * 2) if t < .5 else (stops[1], stops[2], (t - .5) * 2)
        r, g, bl = [round(a[i] + (b[i] - a[i]) * u) for i in range(3)]
        return f"rgb({r},{g},{bl})"
    cw, chh, x0, y0 = 62, 20, 118, 58
    p = [f'<svg viewBox="0 0 {w} {h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#fff">',
         f'<text x="8" y="24" font-size="16" font-weight="700" fill="#111827">{d["ticker"]} vol surface</text>',
         f'<text x="8" y="42" font-size="11.5" fill="#4b5563">IV % by expiry x delta. Shared 12-{d.get("cmax", 0.65)*100:.0f}% scale across tickers.</text>']
    for j, lab in enumerate(labels):
        p.append(f'<text x="{x0+j*cw+cw/2}" y="{y0-6}" font-size="11" text-anchor="middle" fill="#374151">{lab}</text>')
    for i, r in enumerate(rows):
        p.append(f'<text x="{x0-6}" y="{y0+i*chh+14}" font-size="10.5" text-anchor="end" fill="#374151">{r["expiry"][5:]} ({r["dte"]}d)</text>')
        for j, lab in enumerate(labels):
            v = r[lab]
            tc = "#fff" if v is not None and v > 0.30 else "#111827"
            p.append(f'<rect x="{x0+j*cw}" y="{y0+i*chh}" width="{cw-2}" height="{chh-2}" fill="{col(v)}"/>')
            if v is not None:
                p.append(f'<text x="{x0+j*cw+cw/2}" y="{y0+i*chh+14}" font-size="10.5" text-anchor="middle" fill="{tc}">{v*100:.0f}</text>')
    p.append("</svg>")
    return "\n".join(p)


SURFACE_KEYS = ["10P", "15P", "25P", "35P", "ATM", "35C", "25C", "15C", "10C"]

def surface_3d(d):
    """Interactive 3D vol surface v2: dense smoothed grid (quadratic smile in
    log-moneyness, total-variance time interpolation), viridis colour + colourbar,
    floor contour projection, hover readout, raw OTM points overlay, rotate/reset
    controls. Canvas renderer, no external dependencies."""
    import json
    s = d.get("surface3d") or {}
    ticker = d["ticker"]
    if len(s.get("dtes", [])) >= 3 and s.get("iv"):
        mode = "moneyness"
        xcoords = s["k"]
        xlabels = [f'{k*100:+.0f}%' for k in s["k"]]
        dtes = s["dtes"]
        grid = s["iv"]
        raw = s.get("raw", [])
    else:  # fallback: delta-bucket rows (e.g. very narrow expiry filters)
        rows = d["rows"][:16]
        mode = "delta"
        xcoords = list(range(len(SURFACE_KEYS)))
        xlabels = SURFACE_KEYS
        dtes = [r["dte"] for r in rows]
        grid = [[float(r[k]) if r.get(k) is not None else float(r["ATM"] or 0.2) for k in SURFACE_KEYS] for r in rows]
        raw = []
    cid = f'vol3d-{ticker}'
    payload = json.dumps({"mode": mode, "x": xcoords, "xlabels": xlabels, "dtes": dtes,
                          "grid": grid, "raw": raw, "ticker": ticker, "cmin": 0.10, "cmax": d.get("cmax", 0.70)})
    js = """
(function(){
  var data = __PAYLOAD__;
  var cv = document.getElementById('__CID__');
  if(!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var tip = document.getElementById('__CID__-tip');
  var az0 = -0.65, el0 = 0.52, az = az0, el = el0, zoom = 1.0;
  var dragging = false, lx = 0, ly = 0, rotating = true, hover = null, verts = [];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced) rotating = false;
  var STOPS = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
  function viridis(t){
    t = Math.max(0, Math.min(1, t));
    var seg = Math.min(3, Math.floor(t*4)), u = t*4 - seg;
    var a = STOPS[seg], b = STOPS[seg+1];
    return [Math.round(a[0]+(b[0]-a[0])*u), Math.round(a[1]+(b[1]-a[1])*u), Math.round(a[2]+(b[2]-a[2])*u)];
  }
  var vmin = data.cmin || 0.10, vmax = data.cmax || 0.70;  // shared IV scale across tickers in this report
  var xs = data.x, xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
  var lmin = Math.log(1 + Math.min.apply(null, data.dtes)), lmax = Math.log(1 + Math.max.apply(null, data.dtes));
  function nx(x){ return (x - xmin) / Math.max(xmax - xmin, 1e-9) * 2 - 1; }
  function ny(dte){ return (Math.log(1 + dte) - lmin) / Math.max(lmax - lmin, 1e-9) * 2 - 1; }
  function project(x, y, z){
    var ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    var x1 = x*ca - y*sa, y1 = x*sa + y*ca;
    var z2 = z*ce - y1*se, y2 = z*se + y1*ce;
    var f = 3.2, sc = f/(f + y2 + 1.6);
    return [cv.width/2 + x1*150*zoom*sc, cv.height*0.64 - z2*150*zoom*sc, y2];
  }
  function shade(rgb, f){
    return 'rgb(' + Math.round(rgb[0]*f) + ',' + Math.round(rgb[1]*f) + ',' + Math.round(rgb[2]*f) + ')';
  }
  function draw(){
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,cv.width,cv.height);
    var grid = data.grid, nyy = grid.length, nxx = grid[0].length;
    verts = [];
    var quads = [];
    for(var i=0;i<nyy;i++){
      verts.push([]);
      for(var j=0;j<nxx;j++){
        var iv = grid[i][j] === null ? vmin : grid[i][j];
        var z = Math.max(0, Math.min(1, (iv - (vmin - 0.02)) / ((vmax - vmin) + 0.04)));
        var X3 = nx(xs[j]), Y3 = ny(data.dtes[i]), Z3 = z*0.95;
        verts[i].push({p: project(X3, Y3, Z3), x3: X3, y3: Y3, z3: Z3, iv: iv, i: i, j: j});
      }
    }
    // floor contour projection (same colours, flat at z=0, drawn first)
    for(var i2=0;i2<nyy-1;i2++){
      for(var j2=0;j2<nxx-1;j2++){
        var idx = [[j2,i2],[j2+1,i2],[j2+1,i2+1],[j2,i2+1]], fp = [], av = 0;
        for(var c=0;c<4;c++){
          var jj = idx[c][0], ii = idx[c][1];
          av += (grid[ii][jj] === null ? vmin : grid[ii][jj]);
          fp.push(project(nx(xs[jj]), ny(data.dtes[ii]), 0));
        }
        ctx.beginPath(); ctx.moveTo(fp[0][0], fp[0][1]);
        for(var k=1;k<4;k++) ctx.lineTo(fp[k][0], fp[k][1]);
        ctx.closePath();
        var rgb = viridis((av/4 - vmin) / Math.max(vmax - vmin, 1e-9));
        ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.30)'; ctx.fill();
      }
    }
    for(var i3=0;i3<nyy-1;i3++){
      for(var j3=0;j3<nxx-1;j3++){
        var cs = [[j3,i3],[j3+1,i3],[j3+1,i3+1],[j3,i3+1]], pts = [], zs = 0, ivs = 0;
        for(var c2=0;c2<4;c2++){ var v = verts[cs[c2][1]][cs[c2][0]]; pts.push(v.p); zs += v.p[2]; ivs += v.iv; }
        var a3 = verts[cs[0][1]][cs[0][0]], b3 = verts[cs[1][1]][cs[1][0]], d3 = verts[cs[3][1]][cs[3][0]];
        var u1 = b3.x3-a3.x3, u2 = b3.y3-a3.y3, u3 = b3.z3-a3.z3;
        var w1 = d3.x3-a3.x3, w2 = d3.y3-a3.y3, w3 = d3.z3-a3.z3;
        var n1 = u2*w3-u3*w2, n2 = u3*w1-u1*w3, n3 = u1*w2-u2*w1;
        var nl = Math.sqrt(n1*n1+n2*n2+n3*n3) || 1;
        var bright = 0.74 + 0.40*Math.abs((n1*(-0.4)+n2*(-0.5)+n3*0.75)/nl);
        quads.push({pts: pts, depth: zs/4, iv: ivs/4, bright: bright});
      }
    }
    quads.sort(function(a,b){ return b.depth - a.depth; });
    for(var q=0;q<quads.length;q++){
      var quad = quads[q];
      ctx.beginPath(); ctx.moveTo(quad.pts[0][0], quad.pts[0][1]);
      for(var k2=1;k2<4;k2++) ctx.lineTo(quad.pts[k2][0], quad.pts[k2][1]);
      ctx.closePath();
      var base = viridis((quad.iv - vmin) / Math.max(vmax - vmin, 1e-9));
      ctx.fillStyle = shade(base, quad.bright || 0.88); ctx.fill();
      ctx.strokeStyle = 'rgba(17,24,39,0.25)'; ctx.lineWidth = 0.5; ctx.stroke();
    }
    var showRaw = document.getElementById('__CID__-raw');
    if(showRaw && showRaw.checked){
      ctx.fillStyle = 'rgba(17,24,39,0.75)';
      data.raw.forEach(function(r){
        var z = Math.max(0, Math.min(1, (r[2] - (vmin - 0.02)) / ((vmax - vmin) + 0.04)));
        var p = project(nx(r[1]), ny(r[0]), z*0.95);
        ctx.beginPath(); ctx.arc(p[0], p[1], 1.6, 0, 6.2832); ctx.fill();
      });
    }
    if(hover){
      ctx.beginPath(); ctx.arc(hover.p[0], hover.p[1], 5, 0, 6.2832);
      ctx.fillStyle = '#dc2626'; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#374151';
    var tickIdx = data.mode === 'moneyness' ? [0,5,10,15,20] : [0,2,4,6,8];
    tickIdx.forEach(function(j){
      if(j >= xs.length) return;
      var lp = project(nx(xs[j]), ny(data.dtes[0]), 0);
      var lab = data.mode === 'moneyness' ? (data.x[j]*100).toFixed(0) + '%' : data.xlabels[j];
      ctx.fillText(lab, lp[0]-8, lp[1]+14);
    });
    data.dtes.forEach(function(dt, i){
      if([0,3,5,7,data.dtes.length-1].indexOf(i) === -1) return;
      var lp2 = project(nx(xs[0]), ny(dt), 0);
      ctx.fillText(dt + 'd', Math.max(4, lp2[0]-30), lp2[1]+3);
    });
    // colourbar
    for(var b=0;b<60;b++){
      var rgb2 = viridis(b/59);
      ctx.fillStyle = 'rgb(' + rgb2[0] + ',' + rgb2[1] + ',' + rgb2[2] + ')';
      ctx.fillRect(cv.width - 118 + b*1.6, 16, 1.6, 10);
    }
    ctx.fillStyle = '#111827'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText(data.ticker + ' 3D vol surface (SVI)', 14, 22);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#374151';
    ctx.fillText((vmin*100).toFixed(0) + '%', cv.width - 122, 40);
    ctx.fillText((vmax*100).toFixed(0) + '% IV', cv.width - 44, 40);
    ctx.fillText(data.mode === 'moneyness' ? 'x: log-moneyness ln(K/S)   depth: constant maturity (log DTE)' : 'x: delta bucket   depth: expiry', 14, 40);
    ctx.fillText('front ' + data.dtes[0] + 'd  ->  back ' + data.dtes[data.dtes.length-1] + 'd', 14, cv.height - 12);
    ctx.fillText('drag rotate - scroll zoom - hover for values', cv.width - 252, cv.height - 12);
  }
  cv.addEventListener('pointerdown', function(e){ dragging = true; lx = e.clientX; ly = e.clientY; try{ cv.setPointerCapture(e.pointerId); }catch(_){} });
  cv.addEventListener('pointermove', function(e){
    var rect = cv.getBoundingClientRect();
    var mx = (e.clientX - rect.left) * cv.width / rect.width, my = (e.clientY - rect.top) * cv.height / rect.height;
    if(dragging){
      az += (e.clientX - lx) * 0.008; el += (e.clientY - ly) * 0.006;
      el = Math.max(0.12, Math.min(1.25, el)); lx = e.clientX; ly = e.clientY; draw(); return;
    }
    var best = null, bd = 400;
    verts.forEach(function(row){ row.forEach(function(v){
      var dx = v.p[0]-mx, dy = v.p[1]-my, dd = dx*dx + dy*dy;
      if(dd < bd){ bd = dd; best = v; }
    });});
    hover = bd < 320 ? best : null;
    if(tip){
      tip.textContent = hover ? (data.ticker + '  ' + data.dtes[hover.i] + 'd  ' +
        (data.mode === 'moneyness' ? 'ln(K/S) ' + data.x[hover.j].toFixed(2) : data.xlabels[hover.j]) +
        '  IV ' + (hover.iv*100).toFixed(1) + '%') : 'Hover the surface for values.';
    }
    draw();
  });
  cv.addEventListener('pointerup', function(){ dragging = false; });
  cv.addEventListener('wheel', function(e){ e.preventDefault(); zoom = Math.max(0.6, Math.min(1.8, zoom - e.deltaY*0.001)); draw(); }, {passive:false});
  var rotBtn = document.getElementById('__CID__-rot');
  if(rotBtn) rotBtn.addEventListener('click', function(){ rotating = !rotating; rotBtn.textContent = rotating ? 'Pause rotation' : 'Resume rotation'; });
  var rstBtn = document.getElementById('__CID__-reset');
  if(rstBtn) rstBtn.addEventListener('click', function(){ az = az0; el = el0; zoom = 1.0; draw(); });
  var rawBox = document.getElementById('__CID__-raw');
  if(rawBox) rawBox.addEventListener('change', draw);
  function tick(){ if(rotating && !dragging){ az += 0.0032; draw(); } requestAnimationFrame(tick); }
  draw();
  requestAnimationFrame(tick);
})();
"""
    js = js.replace("__PAYLOAD__", payload).replace("__CID__", cid)
    return (f'<div><canvas id="{cid}" width="540" height="360" role="img" aria-label="{ticker} 3D implied volatility surface" '
            f'style="width:100%;height:auto;display:block;touch-action:none;cursor:grab"></canvas>'
            f'<div style="display:flex;gap:8px;align-items:center;padding:6px 2px;font-size:12px;color:#374151">'
            f'<button id="{cid}-rot" type="button">Pause rotation</button>'
            f'<button id="{cid}-reset" type="button">Reset view</button>'
            f'<label><input id="{cid}-raw" type="checkbox"> raw OTM points</label>'
            f'<span id="{cid}-tip">Hover the surface for values.</span></div>'
            f'<script>{js}</script></div>')


def gex_chart(d, w=560, h=300):
    spot = d["spot"]
    items = sorted((k, v / 1e9) for k, v in d["gex"].items() if 0.72 * spot <= k <= 1.28 * spot)
    if not items:
        return f"<p>No GEX data for {d['ticker']} under current filters.</p>"
    ymax = max(max(v for _, v in items), abs(min(v for _, v in items))) or 1
    bw = (w - 110) / len(items)
    def Y(v): return (h - 52) / 2 + 30 - v / ymax * ((h - 110) / 2)
    zero = Y(0)
    cum, crossings = 0.0, []
    for k, v in sorted((k, v / 1e9) for k, v in d["gex"].items()):
        prev = cum; cum += v
        if prev <= 0 < cum or prev >= 0 > cum:
            crossings.append(k)
    flip = min(crossings, key=lambda k: abs(k - spot)) if crossings else None
    p = [f'<svg viewBox="0 0 {w} {h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#fff">',
         f'<text x="56" y="24" font-size="16" font-weight="700" fill="#111827">{d["ticker"]} gamma exposure by strike</text>',
         f'<text x="56" y="42" font-size="11.5" fill="#4b5563">Net $bn per 1% move, selected expiries. Calls +, puts -. Dashed = spot {spot:.0f}.</text>',
         f'<line x1="56" y1="{zero:.0f}" x2="{w-54}" y2="{zero:.0f}" stroke="#9ca3af"/>']
    for i, (k, v) in enumerate(items):
        x = 56 + i * bw
        p.append(f'<rect x="{x:.0f}" y="{min(zero, Y(v)):.0f}" width="{max(bw-1,1):.0f}" height="{abs(Y(v)-zero):.0f}" fill="{"#2563eb" if v >= 0 else "#dc2626"}"/>')
    sx = 56 + next(i for i, (k, v) in enumerate(items) if k >= spot) * bw
    p.append(f'<line x1="{sx:.0f}" y1="50" x2="{sx:.0f}" y2="{h-42}" stroke="#111827" stroke-dasharray="5 4"/>')
    flip_txt = f'near: {flip:.0f}' if flip is not None and items[0][0] <= flip <= items[-1][0] else (f'outside shown strikes ({flip:.0f})' if flip is not None else 'n/a')
    p.append(f'<text x="56" y="{h-12}" font-size="11" fill="#374151">strikes {items[0][0]:.0f} to {items[-1][0]:.0f}. Cumulative gamma flip {flip_txt}</text></svg>')
    return "\n".join(p)


def resid_chart(d, w=560, h=300):
    """SVI residuals (market IV - fitted IV, vol points) for the ~30d slice."""
    rs = d.get("resid_slice") or {}
    pts = rs.get("points") or []
    if not pts:
        return f'<p>No SVI residuals for {d["ticker"]} under current filters.</p>'
    ymax = max(4.0, max(abs(p[1]) for p in pts) * 1.15)
    def X(k): return 56 + (k + 0.25) / 0.50 * (w - 110)
    def Y(v): return (h - 52) / 2 + 30 - v / ymax * ((h - 110) / 2)
    zero = Y(0)
    p = [f'<svg viewBox="0 0 {w} {h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#fff">',
         f'<text x="56" y="24" font-size="16" font-weight="700" fill="#111827">{d["ticker"]} SVI residuals, {rs["dte"]}d slice</text>',
         '<text x="56" y="42" font-size="11.5" fill="#4b5563">Market IV minus fitted IV (vol points) vs log-moneyness. Above zero = rich vs fit.</text>',
         f'<line x1="56" y1="{zero:.0f}" x2="{w-54}" y2="{zero:.0f}" stroke="#9ca3af"/>',
         f'<text x="6" y="{Y(ymax)+4:.0f}" font-size="11" fill="#374151">+{ymax:.0f}</text>',
         f'<text x="6" y="{Y(-ymax)+4:.0f}" font-size="11" fill="#374151">-{ymax:.0f}</text>']
    for k, v in pts:
        col = "#dc2626" if v >= 0 else "#2563eb"
        p.append(f'<circle cx="{X(k):.0f}" cy="{Y(v):.0f}" r="2.4" fill="{col}" fill-opacity="0.75"/>')
    p.append(f'<text x="56" y="{h-12}" font-size="11" fill="#374151">ln(K/F) -0.25</text>')
    p.append(f'<text x="{w-54}" y="{h-12}" font-size="11" fill="#374151" text-anchor="end">+0.25</text></svg>')
    return "\n".join(p)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tickers", default="SPY,NVDA", help="comma-separated, side-by-side in this order")
    ap.add_argument("--expiry-mode", choices=["all", "monthly", "weekly", "nearest"], default="all",
                    help="monthly = third-Friday expiries; weekly = all except monthly; nearest = first N")
    ap.add_argument("--expiry-count", type=int, default=6, help="with --expiry-mode nearest")
    ap.add_argument("--min-dte", type=int, default=0)
    ap.add_argument("--max-dte", type=int, default=None, help="e.g. 60 for contracts expiring within 60 days")
    ap.add_argument("--max-spread-pct", type=float, default=50.0,
                    help="drop contracts whose bid-ask spread exceeds this %% of mid (quote-quality filter)")
    ap.add_argument("--allow-unquoted", action="store_true",
                    help="keep contracts with no bid or very wide spreads (not recommended for vol fitting)")
    ap.add_argument("--min-oi", type=int, default=0, help="drop contracts below this open interest")
    ap.add_argument("--min-volume", type=int, default=0, help="drop contracts below this volume")
    ap.add_argument("--delta-min", type=float, default=0.02)
    ap.add_argument("--delta-max", type=float, default=0.98)
    ap.add_argument("--iv-min", type=float, default=0.01)
    ap.add_argument("--iv-max", type=float, default=2.0)
    ap.add_argument("--outdir", default="output/vol-curves")
    ap.add_argument("--name", default=None, help="output HTML filename (default derived from params)")
    args = ap.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    ns = load_vendor()
    data = [build(ns, t, args) for t in tickers]
    for d in data:
        sel = ", ".join(f'{r["expiry"]} ({r["dte"]}d)' for r in d["rows"][:8])
        print(f'{d["ticker"]}: spot={d["spot"]} asof={d["asof"]} contracts={d["total"]} clean={d["clean"]} '
              f'expiries {len(d["rows"])}/{d["expiries_total"]} selected')
        print(f'  first selected: {sel}')

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for d in data:
        csv_path = outdir / f'{d["ticker"].lower()}_surface.csv'
        with open(csv_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["expiry", "dte", "10P", "15P", "25P", "35P", "ATM", "35C", "25C", "15C", "10C", "RR25", "BF25", "n"])
            w.writeheader(); w.writerows(d["rows"])
        print(f"wrote {csv_path}")

    term = line_chart(
        [(d["ticker"], COLORS[i % len(COLORS)], [(r["dte"], r["ATM"]) for r in d["rows"]]) for i, d in enumerate(data)],
        f'Term structure: {" vs ".join(tickers)}',
        f'ATM IV by days to expiry. Expiry mode: {args.expiry_mode}, DTE {args.min_dte}-{"no max" if args.max_dte is None else args.max_dte}.',
        x_max=args.max_dte)
    try:
        vix = ns["vix_term_structure"]()
        vix_svg = line_chart([("VIX curve", "#059669", [(p["days"], p["close"] / 100) for p in vix["points"]])],
                             f'VIX term structure ({vix.get("date")})', "VIX9D / VIX / VIX3M / VIX6M / VIX1Y closes.", x_max=365)
    except Exception as e:
        vix_svg = f"<p>VIX curve unavailable: {e}</p>"

    def stats_row(d):
        if not d["rows"]:
            return f'<tr><td><strong>{d["ticker"]}</strong></td><td colspan="8">no expiries under current filters</td></tr>'
        r0, r30, r90 = nearest(d["rows"], 0), nearest(d["rows"], 30), nearest(d["rows"], 90)
        def p(x): return f"{x*100:.1f}%" if x is not None else "-"
        hv = d.get("hv30")
        return (f'<tr><td><strong>{d["ticker"]}</strong></td><td>{d["spot"]:.2f}</td><td>{d["total"]:,}</td>'
                f'<td>{p(r0["ATM"])}</td><td>{p(r30["ATM"])}</td><td>{p(r90["ATM"])}</td>'
                f'<td>{p(r30["RR25"])}</td><td>{p(r30["10P"])}</td><td>{p(hv)}</td></tr>')

    def fit_row(d):
        svi = [s for s in d["slices"] if s["method"] == "svi"]
        quad = len(d["slices"]) - len(svi)
        avg_rmse = (sum(s["rmse"] for s in svi) / len(svi) * 100) if svi else None
        bfly_bad = sum(1 for s in svi if s["butterfly_ok"] is False)
        r = d["residuals"]
        def f(x, suffix=""): return f"{x}{suffix}" if x is not None else "-"
        return (f'<tr><td><strong>{d["ticker"]}</strong></td><td>{len(svi)} SVI / {quad} quad</td>'
                f'<td>{f(round(avg_rmse, 2) if avg_rmse is not None else None)}</td><td>{bfly_bad}</td>'
                f'<td>{d["calendar_violations"]}</td><td>{f(r["mae"])}</td><td>{f(r["p95"])}</td>'
                f'<td>{f(r["share_over_2"], "%")}</td></tr>')

    def rich_cheap_note(d):
        r = d["residuals"]
        if not r["rich"]:
            return ""
        rich = ", ".join(f'{x["symbol"] or x["strike"]} {x["resid"]:+.1f}' for x in r["rich"][:3])
        cheap = ", ".join(f'{x["symbol"] or x["strike"]} {x["resid"]:+.1f}' for x in r["cheap"][:3])
        return f'<p class="note"><strong>{d["ticker"]}</strong> richest vs fit: {rich}. Cheapest vs fit: {cheap}. Vol points, all fitted slices.</p>'

    fit_rows = "".join(fit_row(d) for d in data)
    resid_charts = "".join(f"<div>{resid_chart(d)}</div>" for d in data)
    rich_cheap = "".join(rich_cheap_note(d) for d in data)

    all_ivs = [r["ATM"] for d in data for r in d["rows"] if r["ATM"] is not None] + \
              [v for d in data for row in (d["surface3d"]["iv"] or []) for v in row if v is not None]
    cmax = max(0.70, math.ceil((max(all_ivs) if all_ivs else 0.70) * 10) / 10)
    for d in data:
        d["cmax"] = cmax

    skews = "".join(f"<div>{skew_chart(d)}</div>" for d in data)
    heats = "".join(f"<div>{heatmap(d)}</div>" for d in data)
    surfaces3d = "".join(surface_3d(d) for d in data)
    gexs = "".join(f"<div>{gex_chart(d)}</div>" for d in data)
    param_line = (f'expiry-mode={args.expiry_mode} (count={args.expiry_count}), DTE {args.min_dte}-'
                  f'{"no max" if args.max_dte is None else args.max_dte}, min-OI={args.min_oi}, '
                  f'min-volume={args.min_volume}, delta {args.delta_min}-{args.delta_max}, IV {args.iv_min}-{args.iv_max}, '
                  f'max-spread={args.max_spread_pct}% of mid{" (unquoted kept)" if args.allow_unquoted else ""}')
    title = f'{" vs ".join(tickers)} volatility charts'
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<style>
 body{{margin:0;background:#f3f4f6;color:#111827;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif}}
 main{{max-width:1180px;margin:0 auto;padding:28px 20px 40px}}
 h1{{font-size:26px;margin:0 0 6px}} .sub{{color:#4b5563;font-size:13.5px;margin-bottom:20px;line-height:1.55}}
 section{{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px 16px 8px;margin-bottom:18px}}
 .pair{{display:grid;grid-template-columns:1fr 1fr;gap:14px}} @media(max-width:820px){{.pair{{grid-template-columns:1fr}}}}
 table{{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 14px}} th,td{{border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right}} th:first-child,td:first-child{{text-align:left}}
 .note{{font-size:12.5px;color:#4b5563;line-height:1.55}}
</style></head><body><main>
<h1>{title}</h1>
<div class="sub">Source: vendored global-stock-data, CBOE delayed options chain ({data[0]["asof"]}). Delayed data, indicative levels only.<br>Parameters: {param_line}.</div>
<section><table>
<tr><th>Ticker</th><th>Spot</th><th>Contracts</th><th>ATM front</th><th>ATM ~30d</th><th>ATM ~90d</th><th>RR25 ~30d</th><th>10P IV ~30d</th><th>HV 30d</th></tr>
{"".join(stats_row(d) for d in data)}
</table></section>
<section>{term}</section>
<section><div class="pair">{skews}</div></section>
<section><div class="pair">{heats}</div></section>
<section><div class="pair">{surfaces3d}</div>
<p class="note">3D surface (SVI): raw SVI is fitted per expiry in total variance on out-of-the-money contracts (forwards from put-call parity; quadratic fallback only where a fit fails), calendar-repaired, then interpolated in total variance to constant maturities (7d-1y). Colour is viridis on a shared scale with the colourbar at top right; the flat projection on the floor is the same surface seen from above. Drag to rotate, scroll to zoom, hover for the exact IV, and tick raw OTM points to see the market quotes the fit came from.</p></section>
<section>{vix_svg}</section>
<section><table>
<tr><th>Ticker</th><th>Fitted slices</th><th>SVI RMSE (vol pts)</th><th>Butterfly violations</th><th>Calendar violations repaired</th><th>Residual MAE</th><th>Residual p95</th><th>Residuals over 2 pts</th></tr>
{fit_rows}
</table>
<p class="note">SVI is fitted per expiry in total variance on out-of-the-money contracts, forwards from put-call parity. Calendar violations are repaired by making total variance non-decreasing in expiry before interpolation. RMSE and residuals are in vol points.</p>
{rich_cheap}</section>
<section><div class="pair">{resid_charts}</div></section>
<section><div class="pair">{gexs}</div>
<p class="note">Gamma exposure is a proxy from vendor gamma and open interest under the selected expiries. Monthly means third-Friday expiries.</p></section>
</main></body></html>"""
    name = args.name or f'{"_vs_".join(t.lower() for t in tickers)}_{args.expiry_mode}{("_" + str(args.max_dte) + "d") if args.max_dte else ""}_charts.html'
    out = outdir / name
    out.write_text(html)
    print(f"wrote {out} ({len(html)} bytes, {html.count('<svg')} charts)")


if __name__ == "__main__":
    main()
