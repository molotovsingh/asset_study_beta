import json, sys, yfinance as yf
out = sys.argv[1]
res = {}
for sym in ["POLYCAB.NS", "^CRSLDX"]:
    h = yf.Ticker(sym).history(start="2023-06-01", end="2024-06-30", auto_adjust=False, actions=True)
    res[sym] = {
        "close": {d.strftime("%Y-%m-%d"): float(c) for d, c in h["Close"].items()},
        "adjclose": {d.strftime("%Y-%m-%d"): float(c) for d, c in h["Adj Close"].items()},
        "volume": {d.strftime("%Y-%m-%d"): float(c) for d, c in h["Volume"].items()},
        "dividends": {d.strftime("%Y-%m-%d"): float(c) for d, c in h["Dividends"].items() if c},
        "splits": {d.strftime("%Y-%m-%d"): float(c) for d, c in h["Stock Splits"].items() if c},
    }
json.dump(res, open(out, "w"))
for s, r in res.items(): print(s, len(r["close"]), "div", r["dividends"], "splits", r["splits"])
