# Data Layout

This directory now has two distinct roles:

- `data/local-cache/`
  Machine-local runtime cache written by `scripts/dev_server.py` when the app
  fetches yfinance symbols on demand. This path is ignored by git.
- `data/snapshots/`
  Repo-tracked normalized snapshots produced by the bulk sync scripts for CI,
  inspection, or future provider work.

## Runtime Cache

The live app flow uses the local backend and writes cached series like:

- `data/local-cache/yfinance/index/aapl-<hash>.json`
- `data/local-cache/yfinance/index/manifest.json`

The browser does not fetch Yahoo directly. It talks to the local backend, which
fetches, normalizes, caches, and remembers ad hoc symbols on this machine.

## Snapshot Tooling

The optional bootstrap sync path still writes files like:

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

The snapshot tooling keeps a normalized local format around so the data source
can be swapped later without rewriting study logic.
