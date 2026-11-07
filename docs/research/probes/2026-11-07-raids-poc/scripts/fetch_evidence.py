"""Fetch candidate documents into a hash-named local evidence store and record a manifest.
Usage: python -I fetch_evidence.py <search_record.json> <evidence_dir> <manifest_out.json>"""
import hashlib, json, re, subprocess, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
rec = json.load(open(sys.argv[1])); ev = Path(sys.argv[2]); ev.mkdir(parents=True, exist_ok=True)
kw_agency = re.compile(r"income[- ]tax|enforcement directorate|\bcbi\b|central bureau of investigation", re.I)
kw_action = re.compile(r"\bsearch(es)?\b|\braid|seizure|section 132|visited|survey", re.I)
urls = []
for c in rec["calls"]:
    for r in c["results"]:
        if r["url"] and kw_agency.search(r["text"]) and kw_action.search(r["text"]): urls.append(r["url"])
for q in rec["pass0"]["queries"]:
    for r in q["results"]:
        if r["url"] and r["keywordFlag"]: urls.append(r["url"])
urls = list(dict.fromkeys(u for u in urls if u.lower().split("#")[0].endswith(".pdf") or "AnnPdfOpen" in u))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
manifest = []
for u in urls:
    url = u.split("#")[0]
    item = {"url": url, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    try:
        ref = "https://www.nseindia.com/" if "nseindia" in url else "https://www.bseindia.com/"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": ref})
        data = urllib.request.urlopen(req, timeout=30).read()
        if not data.startswith(b"%PDF"): raise ValueError(f"not a PDF ({data[:40]!r})")
        sha = hashlib.sha256(data).hexdigest(); p = ev / f"{sha}.pdf"
        if not p.exists(): p.write_bytes(data)
        txt = subprocess.run(["pdftotext", "-layout", "-l", "3", str(p), "-"], capture_output=True, text=True, timeout=60).stdout
        item.update({"sha256": sha, "bytes": len(data), "textChars": len(txt)})
        (ev / f"{sha}.txt").write_text(txt)
    except Exception as e:
        item["error"] = str(e)[:200]
    manifest.append(item); time.sleep(0.7)
json.dump(manifest, open(sys.argv[3], "w"), indent=1)
print("urls", len(urls), "ok", sum(1 for m in manifest if "sha256" in m), "errors", [(m["url"][-60:], m["error"]) for m in manifest if "error" in m])
