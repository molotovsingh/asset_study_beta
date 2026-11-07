"""Raids POC study run on the frozen event set (PLAN.md rules).
Usage: python -I raids_study.py <events.json> <data_dir> <out.json>"""
import csv, io, json, statistics, sys, time, urllib.request, zipfile
from datetime import date, timedelta
from pathlib import Path
import yfinance as yf
ev = json.load(open(sys.argv[1])); D = Path(sys.argv[2]); D.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Referer": "https://www.nseindia.com/"}
NEW = date(2024, 7, 8); H = [1, 5, 10, 20, 60]
def dl(url, name):
    p = D / name
    if not p.exists():
        try: p.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()); time.sleep(0.6)
        except Exception: return None
    return p
def nse_close(sym, d):
    mon = d.strftime("%b").upper()
    if d < NEW:
        p = dl(f"https://archives.nseindia.com/content/historical/EQUITIES/{d.year}/{mon}/cm{d:%d}{mon}{d.year}bhav.csv.zip", f"cm_{d}.zip"); key = ("SYMBOL", "SERIES", "CLOSE", "TOTTRDQTY")
    else:
        p = dl(f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip", f"cm_{d}.zip"); key = ("TckrSymb", "SctySrs", "ClsPric", "TtlTradgVol")
    if not p: return "nofile"
    try:
        with zipfile.ZipFile(p) as z: rows = csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8"))
        hit = [r for r in rows if r[key[0]].strip() == sym and r[key[1]].strip() in ("EQ", "BE", "BZ")]
    except zipfile.BadZipFile: return "nofile"
    return (float(hit[0][key[2]]), int(float(hit[0][key[3]])), hit[0][key[1]].strip()) if hit else None
def nse_index(d):
    p = dl(f"https://archives.nseindia.com/content/indices/ind_close_all_{d:%d%m%Y}.csv", f"idx_{d}.csv")
    if not p: return None
    for r in csv.DictReader(open(p, encoding="utf-8", errors="replace")):
        if r.get("Index Name", "").strip().upper() == "NIFTY 500": return float(r["Closing Index Value"])
    return None
def hist(sym, a, b):
    h = yf.Ticker(sym).history(start=a.isoformat(), end=b.isoformat(), auto_adjust=False, actions=True)
    return {t.date(): (float(c), float(v), float(s or 0)) for t, c, v, s in zip(h.index, h["Close"], h["Volume"], h["Stock Splits"])}
out = []
for e in ev["events"]:
    t0 = date.fromisoformat(e["t0"]); a, b = t0 - timedelta(days=15), t0 + timedelta(days=130)
    st, ix = hist(e["symbol"] + ".NS", a, b), hist("^CRSLDX", a, b)
    notes = []
    splits = [d.isoformat() for d, v in st.items() if v[2]]
    if splits: notes.append(f"stock split/bonus in window on {splits} (not adjusted: check)")
    traded = {d for d, v in st.items() if v[1] > 0}
    cal = sorted(set(ix) | traded)
    idx = {d: v[0] for d, v in ix.items()}
    for d in cal:
        if d not in idx:
            val = nse_index(d)
            if val: idx[d] = val; notes.append(f"index gap patched from NSE on {d}")
            else: notes.append(f"index missing on {d}, no NSE file")
    cal = [d for d in cal if d in idx]
    last = None; px = {}; stale = 0
    for d in cal:
        if d in traded: last = st[d][0]
        elif last is not None: stale += 1
        px[d] = last
    if stale: notes.append(f"{stale} calendar days with no trade: last traded price carried")
    if t0 not in cal: raise SystemExit(f"{e['id']}: t0 {t0} is not a trading day in the calendar")
    i0 = cal.index(t0); ent = i0 + 1
    check = {"t0-1": cal[i0 - 1], "t0": cal[i0], "entry": cal[ent], **{f"h{h}": cal[ent + h] for h in H if ent + h < len(cal)}}
    mism = []
    for lab, d in check.items():
        n = nse_close(e["symbol"], d); ni = nse_index(d)
        if n == "nofile": mism.append(f"{lab} {d}: NSE file unavailable"); continue
        if n is None: mism.append(f"{lab} {d}: no NSE trade (price carried)"); continue
        if px[d] is None or abs(px[d] / n[0] - 1) > 0.001: mism.append(f"{lab} {d}: Yahoo {px[d]} vs NSE {n[0]} -> NSE used"); px[d] = n[0]
        if ni and abs(idx[d] / ni - 1) > 0.0005: mism.append(f"{lab} {d}: index Yahoo {idx[d]:.2f} vs NSE {ni:.2f} -> NSE used"); idx[d] = ni
    pre = cal[i0 - 1]
    r = {"id": e["id"], "symbol": e["symbol"], "t0": e["t0"], "entry": cal[ent].isoformat(),
         "eventDay": round(((px[t0] / px[pre]) - (idx[t0] / idx[pre])) * 100, 2),
         "eventDayStock": round((px[t0] / px[pre] - 1) * 100, 2), "horizons": {}, "checks": len(check), "mismatches": mism, "notes": notes}
    for h in H:
        if ent + h < len(cal):
            d = cal[ent + h]; rs = px[d] / px[cal[ent]] - 1; ri = idx[d] / idx[cal[ent]] - 1
            r["horizons"][str(h)] = {"date": d.isoformat(), "stock": round(rs * 100, 2), "index": round(ri * 100, 2), "marketAdjusted": round((rs - ri) * 100, 2)}
    out.append(r); print(e["id"], e["symbol"], "event", r["eventDay"], {k: v["marketAdjusted"] for k, v in r["horizons"].items()}, "| mism:", len(mism), "| notes:", len(notes))
def agg(vals):
    return {"n": len(vals), "mean": round(statistics.mean(vals), 2), "median": round(statistics.median(vals), 2), "positive": sum(v > 0 for v in vals)} if vals else None
summary = {}
for key in ["event"] + [str(h) for h in H]:
    vals = [(o["id"], o["eventDay"] if key == "event" else o["horizons"].get(key, {}).get("marketAdjusted")) for o in out]
    vals = [(i, v) for i, v in vals if v is not None]
    top2 = {i for i, v in sorted(vals, key=lambda x: -abs(x[1]))[:2]}
    summary[key] = {"all": agg([v for _, v in vals]), "withoutTop2": agg([v for i, v in vals if i not in top2]), "top2Removed": sorted(top2)}
json.dump({"frozenEventSetSha256": ev["frozenEventSetSha256"], "events": out, "summary": summary}, open(sys.argv[3], "w"), indent=1)
print(json.dumps(summary, indent=1))
