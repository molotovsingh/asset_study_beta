# Data Layout

This directory now has two distinct roles:

- `data/local-cache/`
  Machine-local runtime storage written by `scripts/dev_server.py` when the app
  fetches yfinance symbols on demand. This path is ignored by git.
- `data/snapshots/`
  Repo-tracked normalized snapshots produced by the bulk sync scripts for CI,
  inspection, or future provider work.

## Runtime Cache

The optional local backend flow uses `scripts/dev_server.py` and stores mutable
runtime state in:

- `data/local-cache/yfinance/index/cache.sqlite3`

The browser does not fetch Yahoo directly. For ad hoc symbols it talks to the
local backend, which fetches, normalizes, caches, and remembers symbols on this
machine.

If older JSON cache files or a local `manifest.json` already exist in this
folder, the dev server imports them into SQLite on startup.

## Bundled Snapshots

The main bundled study datasets are read directly from repo-tracked snapshots
like:

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

The study UI can read these bundled snapshots from a plain static file server.
The local backend is only needed when you want raw yfinance symbols or local
remembered symbols.

Each snapshot records both the requested series type and the actual return
basis. `returnBasis: "price"` means price-index history, `returnBasis:
"total_return"` means true total-return history, and `returnBasis: "proxy"`
means a total-return label is currently backed by price data. Current TRI-labeled
bootstrap datasets are proxies until a licensed true TRI source is wired in. The
open product decision is documented in
`docs/planned-features/true-total-return-sourcing.md`.
