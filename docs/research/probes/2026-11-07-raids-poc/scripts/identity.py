"""Issuer identity and tradability at t0 from NSE files. Usage: python -I identity.py <data_dir>"""
import csv, io, sys, time, urllib.request, zipfile
from datetime import date
from pathlib import Path
D = Path(sys.argv[1]); D.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Referer": "https://www.nseindia.com/"}
EV = [("C01","DIVISLAB",date(2019,2,15)),("C03","MANKIND",date(2023,5,11)),("C04","HEADSUP",date(2023,9,18)),
      ("C11","INTERARCH",date(2025,8,18)),("C14","ASHAPURMIN",date(2025,10,17)),("C16","REFEX",date(2025,12,10)),
      ("C17","BALUFORGE",date(2026,1,7)),("C18","TOUCHWOOD",date(2026,2,4)),("C21","RCOM",date(2026,3,27)),("C23","VEDL",date(2026,6,2))]
NEW = date(2024,7,8)
def get(url, name):
    p = D / name
    if not p.exists():
        try: p.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()); time.sleep(0.7)
        except Exception as e: return None, str(e)[:80]
    return p, None
def rows_zip(p):
    with zipfile.ZipFile(p) as z: return list(csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8")))
for cid, sym, d in EV:
    mon = d.strftime("%b").upper(); out = [cid, sym, d.isoformat()]
    if d < NEW:
        cm, e = get(f"https://archives.nseindia.com/content/historical/EQUITIES/{d.year}/{mon}/cm{d:%d}{mon}{d.year}bhav.csv.zip", f"cm_{d}.zip")
        fo, e2 = get(f"https://archives.nseindia.com/content/historical/DERIVATIVES/{d.year}/{mon}/fo{d:%d}{mon}{d.year}bhav.csv.zip", f"fo_{d}.zip")
        cmr = [r for r in rows_zip(cm) if r["SYMBOL"].strip()==sym] if cm else []
        eq = [(r["SERIES"].strip(), r.get("ISIN","").strip(), r["CLOSE"].strip(), r["TOTTRDQTY"].strip()) for r in cmr]
        fut = [r for r in rows_zip(fo) if r["SYMBOL"].strip()==sym and r["INSTRUMENT"].strip()=="FUTSTK"] if fo else []
    else:
        cm, e = get(f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip", f"cm_{d}.zip")
        fo, e2 = get(f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d:%Y%m%d}_F_0000.csv.zip", f"fo_{d}.zip")
        cmr = [r for r in rows_zip(cm) if r["TckrSymb"].strip()==sym] if cm else []
        eq = [(r["SctySrs"].strip(), r["ISIN"].strip(), r["ClsPric"].strip(), r["TtlTradgVol"].strip()) for r in cmr]
        fut = [r for r in rows_zip(fo) if r["TckrSymb"].strip()==sym and r["FinInstrmTp"].strip()=="STF"] if fo else []
    ban, e3 = get(f"https://archives.nseindia.com/archives/fo/sec_ban/fo_secban_{d:%d%m%Y}.csv", f"ban_{d}.csv")
    inban = (sym in ban.read_text(errors="replace").upper()) if ban else None
    print(f"{cid} {sym} t0={d} | CM rows: {eq or 'NONE ' + str(e)} | stock futures: {'yes' if fut else 'no'}{' (fo file missing: '+str(e2)+')' if not fo else ''} | in ban list: {inban if ban else 'file missing: '+str(e3)}")
