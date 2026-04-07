# Index Study Lab

Minimal static scaffold for a study library.

## What it does

- Hosts studies in a registry instead of hardcoding everything into one page.
- Ships the first study: risk-adjusted return for an Indian index.
- Accepts official CSV downloads from NSE, BSE, and RBI.
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

- index selection by name or custom label
- date window selection
- index CSV upload
- constant annual risk-free rate or RBI yield CSV upload
- output for CAGR, annualized volatility, Sharpe ratio, Sortino ratio, total
  return, and max drawdown

## Data sources

- NSE historical and TRI data:
  `https://www.niftyindices.com/reports/historical-data`
- BSE index archive:
  `https://www.bseindia.com/indices/IndexArchiveData.html`
- RBI data:
  `https://data.rbi.org.in`

## Running locally

Use any static file server from the repo root. For example:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

## Adding another study

1. Create a new module under `app/studies/`.
2. Export an object with `id`, `title`, `description`, `inputSummary`, and
   `mount(root)`.
3. Add that object to `app/studies/registry.js`.

If a future study needs a different file shape or a different dataset, put that
adapter in `app/lib/` or a dedicated data folder, not inside another study's
UI logic.
