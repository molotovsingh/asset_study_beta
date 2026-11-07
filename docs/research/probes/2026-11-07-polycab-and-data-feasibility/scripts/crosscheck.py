import csv, io, json, sys, zipfile
from pathlib import Path
from datetime import datetime
data = Path(sys.argv[1])
yfd = json.load(open(data / "yf.json"))
rows = []
for z in sorted((data / "bhav").glob("cm*bhav.csv.zip")):
    with zipfile.ZipFile(z) as zf:
        name = zf.namelist()[0]
        for r in csv.DictReader(io.TextIOWrapper(zf.open(name), encoding="utf-8")):
            r = {k.strip(): (v or "").strip() for k, v in r.items()}
            if r["SYMBOL"] == "POLYCAB" and r["SERIES"] == "EQ":
                d = datetime.strptime(r["TIMESTAMP"], "%d-%b-%Y").strftime("%Y-%m-%d")
                rows.append((d, float(r["CLOSE"]), float(r["PREVCLOSE"]), float(r["LOW"]), int(r["TOTTRDQTY"])))
idx = {}
for f in sorted((data / "idx").glob("ind_close_all_*.csv")):
    for r in csv.DictReader(open(f, encoding="utf-8", errors="replace")):
        r = {k.strip(): (v or "").strip() for k, v in r.items()}
        if r.get("Index Name", "").upper() == "NIFTY 500":
            d = datetime.strptime(r["Index Date"], "%d-%m-%Y").strftime("%Y-%m-%d")
            idx[d] = float(r["Closing Index Value"])
print("date        nse_close  yf_close   diff%   | nse_n500   yf_n500    diff%  | day_ret%  low_vs_prev%")
for d, c, pc, lo, q in sorted(rows):
    yc = yfd["POLYCAB.NS"]["close"].get(d); yi = yfd["^CRSLDX"]["close"].get(d); ni = idx.get(d)
    f = lambda a, b: f"{(a/b-1)*100:+.3f}" if a and b else "  n/a "
    print(f"{d}  {c:9.2f}  {yc or 0:9.2f}  {f(yc,c):>7} | {ni or 0:9.2f}  {yi or 0:9.2f}  {f(yi,ni):>7} | {(c/pc-1)*100:+7.2f}  {(lo/pc-1)*100:+7.2f}")
