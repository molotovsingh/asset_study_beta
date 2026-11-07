import csv, io, sys, zipfile
from pathlib import Path
d = Path(sys.argv[1])
for z in sorted(d.glob("fo*bhav.csv.zip")):
    try:
        with zipfile.ZipFile(z) as zf:
            n = zf.namelist()[0]; rows = [r for r in csv.DictReader(io.TextIOWrapper(zf.open(n), encoding="utf-8")) if r["SYMBOL"].strip() == "POLYCAB"]
        fut = [r for r in rows if r["INSTRUMENT"].strip() == "FUTSTK"]
        print(z.name, "POLYCAB rows:", len(rows), "| stock futures:", [(r["EXPIRY_DT"].strip(), r["CLOSE"].strip(), r["OPEN_INT"].strip()) for r in fut][:3])
    except zipfile.BadZipFile:
        print(z.name, "not a zip")
for f in sorted(d.glob("fo_secban_*.csv")):
    t = open(f, encoding="utf-8", errors="replace").read()
    print(f.name, "| POLYCAB in ban list:", "POLYCAB" in t.upper(), "|", " ".join(t.split())[:160])
