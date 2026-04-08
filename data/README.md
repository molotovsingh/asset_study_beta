# Synced Data

This directory stores normalized snapshots that the static app can fetch from
its own origin.

The bootstrap sync path writes files like:

- `data/snapshots/yfinance/index/nifty-50.json`
- `data/snapshots/yfinance/index/nifty-50-tri.json`
- `data/snapshots/yfinance/index/sensex.json`
- `data/snapshots/yfinance/index/sensex-tri.json`

Generate them with:

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements-sync.txt
./.venv/bin/python scripts/sync_yfinance.py
```

The frontend never talks to Yahoo directly. It only reads normalized local
snapshots so the source can be swapped later.
