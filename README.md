# Index Study Lab

Minimal static scaffold for a study library.

## What it does

- Hosts studies in a registry instead of hardcoding everything into one page.
- Ships the first study: risk-adjusted return for an Indian index.
- Uses a local backend to fetch and cache yfinance symbols on demand.
- Keeps index catalog metadata separate from study logic.

## Why this structure

You said this is only the first study and there may be hundreds later with
different data and different goals. The code is shaped around that:

- `app/studies/`
  One module per study. Each study mounts its own UI and owns its own
  validation, inputs, and output rendering.
- `app/catalog/`
  Shared metadata such as seeded index names and official source URLs.
- `app/lib/`
  Reusable CSV parsing, date filtering, formatting, and metrics.

This avoids a single giant "study page" that keeps growing conditionals forever.

## First study

`Risk-Adjusted Return` supports:

- built-in index names or any yfinance symbol
- date window selection
- local backend fetch and machine-local cache under `data/local-cache/...`
- optional synthetic demo data mode
- manual annual risk-free rate input
- output for CAGR, annualized volatility, Sharpe ratio, Sortino ratio, total
  return, and max drawdown

## Data sources

- NSE historical and TRI data:
  `https://www.niftyindices.com/reports/historical-data`
- BSE index archive:
  `https://www.bseindia.com/indices/IndexArchiveData.html`
- RBI data reference for the manual risk-free rate:
  `https://data.rbi.org.in`

## Running locally

1. Create a local virtual environment:

```bash
python3 -m venv .venv
```

2. Install sync and backend dependencies:

```bash
./.venv/bin/pip install -r requirements-sync.txt
```

3. Start the local app server:

```bash
./.venv/bin/python scripts/dev_server.py --port 8000
```

Then open `http://127.0.0.1:8000`.

The first study now depends on this local server because symbol lookup and
yfinance fetching happen through `/api/yfinance/...`, not through static JSON
files in the browser.

## Local Symbol Flow

Type a built-in name like `Nifty 50` or any yfinance symbol like `AAPL`,
`^NSEI`, or `ETH-USD` into the main input and run the study.

What happens:

- built-in names resolve to their mapped symbols in the browser
- raw symbols are sent straight to the local backend
- successful ad hoc symbols are remembered locally on that machine
- fetched series are cached under `data/local-cache/yfinance/index/`

The browser never talks to Yahoo directly.

## Optional Snapshot Tooling

The older snapshot scripts are still available for bulk refresh, CI, or future
provider work. They write normalized JSON snapshots into `data/snapshots/`.

Current bootstrap provider:

- `yfinance` for selected index histories

This keeps the study UI independent from Yahoo so the source can be replaced
later with official feeds or a paid provider.

Refresh snapshots and validate them with:

```bash
./scripts/refresh_yfinance.sh --period 5y
```

### Add a custom yfinance symbol

Register a symbol once:

```bash
./.venv/bin/python scripts/add_yfinance_symbol.py --symbol AAPL --label "Apple Inc" --refresh --period 5y
``` 

If this repo is hosted on GitHub, `.github/workflows/sync-yfinance.yml` can
refresh and commit snapshots automatically on weekdays or by manual dispatch.

The sync script now retries transient symbol failures and also writes
`data/snapshots/yfinance/index/manifest.json` so the repo has a compact index of
what was pulled, when it was generated, and which snapshot path each dataset
uses.

### Current limits

- The local backend currently uses `yfinance` directly.
- Built-in names only cover a small curated set of mapped symbols.
- `Nifty 50 TRI` and `S&P BSE Sensex TRI` currently use price index proxies from
  Yahoo Finance, not true TRI series.
- Risk-free rate is entered manually for now, typically using an RBI reference.

## Adding another study

1. Create a new module under `app/studies/`.
2. Export an object with `id`, `title`, `description`, `inputSummary`, and
   `mount(root)`.
3. Add that object to `app/studies/registry.js`.

If a future study needs a different file shape or a different dataset, put that
adapter in `app/lib/` or a dedicated data folder, not inside another study's
UI logic.
