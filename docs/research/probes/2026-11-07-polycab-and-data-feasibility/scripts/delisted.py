import csv, io, json, sys, zipfile
from pathlib import Path
from datetime import datetime
import yfinance as yf
d = Path(sys.argv[1]); names = ["HDIL", "RCOM", "HDFC"]
pres = {n: {} for n in names}; counts = {}
for z in sorted(d.glob("bhav/cm*bhav.csv.zip"), key=lambda p: datetime.strptime(p.name[2:11], "%d%b%Y")):
    with zipfile.ZipFile(z) as zf:
        rows = list(csv.DictReader(io.TextIOWrapper(zf.open(zf.namelist()[0]), encoding="utf-8")))
    day = datetime.strptime(z.name[2:11], "%d%b%Y").strftime("%Y-%m-%d"); counts[day] = len(rows)
    for r in rows:
        sym = r["SYMBOL"].strip()
        if sym in names: pres[sym].setdefault(day, []).append((r["SERIES"].strip(), r["CLOSE"].strip(), r["TOTTRDQTY"].strip()))
days = sorted(counts)
print("rows per bhavcopy:", counts)
for n in names:
    print(f"\n{n} in NSE bhavcopy:", {dd: pres[n].get(dd, "absent") for dd in days})
    h = yf.Ticker(n + ".NS").history(period="max", auto_adjust=False)
    if len(h) == 0: print(f"  Yahoo {n}.NS: no data"); continue
    idx = [t.strftime("%Y-%m-%d") for t in h.index]
    last_nse = max((dd for dd in days if dd in pres[n]), default=None)
    first_absent = min((dd for dd in days if dd not in pres[n] and last_nse and dd > last_nse), default=None)
    after = [i for i in idx if first_absent and i >= first_absent]
    zero_vol = int((h["Volume"] == 0).sum())
    print(f"  Yahoo {n}.NS: {len(idx)} rows {idx[0]} → {idx[-1]}; rows on/after first sampled NSE-absent date {first_absent}: {len(after)}; zero-volume rows: {zero_vol}")
    if after: print("   e.g.", [(i, round(float(h['Close'].iloc[idx.index(i)]),2), int(h['Volume'].iloc[idx.index(i)])) for i in after[:3]], "...", [(i, round(float(h['Close'].iloc[idx.index(i)]),2), int(h['Volume'].iloc[idx.index(i)])) for i in after[-2:]])
