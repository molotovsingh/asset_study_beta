# Options Database Schema Design

## Context

Options data is currently transient — the monthly straddle study fetches live from yfinance and returns it without persisting. The existing SQLite schema covers price history, corporate actions, and instrument profiles, but nothing for options.

Options data is massive and time-sensitive. A single symbol can have 10+ expiry dates x 50+ strikes x 2 sides (call/put) = 1,000+ contracts. Storing the full chain daily for many symbols gets big fast. The schema needs to be deliberate about what to store.

## Schema: Three Layers

### Layer 1: Snapshots

One row per symbol per day. Anchors everything — every contract row points back here.

```sql
CREATE TABLE option_snapshots (
    snapshot_id   INTEGER PRIMARY KEY,
    symbol_id     INTEGER NOT NULL REFERENCES symbols(symbol_id),
    observed_date TEXT NOT NULL,
    spot_price    REAL NOT NULL,
    source        TEXT NOT NULL DEFAULT 'yfinance',
    fetched_at    TEXT NOT NULL,
    UNIQUE(symbol_id, observed_date)
);
```

### Layer 2: Contracts (raw chain data)

The big table. This is where individual contract-level data lives.

```sql
CREATE TABLE option_contracts (
    snapshot_id         INTEGER NOT NULL REFERENCES option_snapshots(snapshot_id),
    expiry_date         TEXT NOT NULL,
    strike              REAL NOT NULL,
    option_type         TEXT NOT NULL CHECK(option_type IN ('call', 'put')),
    bid                 REAL,
    ask                 REAL,
    last_price          REAL,
    volume              INTEGER,
    open_interest       INTEGER,
    implied_volatility  REAL,
    PRIMARY KEY (snapshot_id, expiry_date, strike, option_type)
);

CREATE INDEX idx_contracts_expiry ON option_contracts(snapshot_id, expiry_date);
```

Storage strategy options:
- **ATM band only**: store strikes within +/-15% of spot. Covers most studies, cuts storage ~60%.
- **Full chain, sparse schedule**: store full chain weekly, ATM-only daily.

### Layer 3: Derived Summaries

Compact aggregates that most studies actually query. One row per expiry per day.

```sql
CREATE TABLE iv_summary (
    symbol_id           INTEGER NOT NULL REFERENCES symbols(symbol_id),
    observed_date       TEXT NOT NULL,
    expiry_date         TEXT NOT NULL,
    dte                 INTEGER NOT NULL,
    expiry_type         TEXT,                    -- 'monthly', 'weekly', 'quarterly'

    -- ATM straddle
    atm_strike          REAL,
    atm_call_iv         REAL,
    atm_put_iv          REAL,
    straddle_mid_price  REAL,
    implied_move_pct    REAL,

    -- Skew (25-delta)
    put_25d_iv          REAL,
    call_25d_iv         REAL,
    skew_25d            REAL,                   -- put_25d - call_25d

    -- Flow
    total_call_oi       INTEGER,
    total_put_oi        INTEGER,
    total_call_volume   INTEGER,
    total_put_volume    INTEGER,
    pc_oi_ratio         REAL,                   -- put OI / call OI
    pc_volume_ratio     REAL,                   -- put vol / call vol

    PRIMARY KEY (symbol_id, observed_date, expiry_date)
);

CREATE INDEX idx_iv_summary_symbol_date ON iv_summary(symbol_id, observed_date);
```

### Sync State

Track what's been captured per symbol.

```sql
CREATE TABLE options_sync_state (
    symbol_id              INTEGER PRIMARY KEY REFERENCES symbols(symbol_id),
    last_snapshot_date     TEXT,
    last_fetched_at        TEXT,
    total_snapshots        INTEGER DEFAULT 0,
    storage_mode           TEXT DEFAULT 'atm_band',  -- 'full', 'atm_band', 'summary_only'
    band_pct               REAL DEFAULT 0.15
);
```

### Optional: Greeks

yfinance doesn't provide Greeks — you'd compute them (Black-Scholes or similar). Defer until a study actually needs them. The summary table with 25-delta IV already captures skew without per-contract Greeks.

```sql
CREATE TABLE option_greeks (
    snapshot_id    INTEGER NOT NULL REFERENCES option_snapshots(snapshot_id),
    expiry_date    TEXT NOT NULL,
    strike         REAL NOT NULL,
    option_type    TEXT NOT NULL,
    delta          REAL,
    gamma          REAL,
    theta          REAL,
    vega           REAL,
    rho            REAL,
    PRIMARY KEY (snapshot_id, expiry_date, strike, option_type)
);
```

## What Studies Each Table Serves

| Study                  | Primary Table    | What It Queries                                                        |
|------------------------|------------------|------------------------------------------------------------------------|
| IV Term Structure      | `iv_summary`     | `atm_call_iv` / `atm_put_iv` across `dte` for a given date            |
| IV History             | `iv_summary`     | `atm_call_iv` over `observed_date` for a fixed-DTE bucket             |
| IV Rank / Percentile   | `iv_summary`     | Current ATM IV vs historical range                                     |
| Skew Tracking          | `iv_summary`     | `skew_25d` over time                                                   |
| Put-Call Ratio         | `iv_summary`     | `pc_oi_ratio`, `pc_volume_ratio` over time                             |
| Earnings IV Crush      | `iv_summary`     | `straddle_mid_price` / `implied_move_pct` before vs after earnings     |
| Monthly Straddle       | `iv_summary`     | Already works live, but historical comparisons become possible         |
| Volatility Cone        | `iv_summary`     | `implied_move_pct` vs realized move (join with `daily_prices`)         |
| Strategy Backtesting   | `option_contracts`| Specific strikes and prices for constructing historical P&L            |

## The Key Trade-off

**`option_contracts` (raw) vs `iv_summary` (derived)**:

- **`iv_summary` only**: Compact, fast, covers ~80% of studies. But you can't retroactively ask questions about specific strikes or reconstruct the full chain.
- **Both tables**: ~100x more rows for contracts, but you can always re-derive summaries, build new studies, or backtest strategies involving specific strikes.

Recommendation: start with both, but aggressively filter `option_contracts` to ATM +/- a band. You can widen the band later, but you can't go back and capture chain data you didn't store.

## Storage Estimate

For one symbol, daily snapshots, ATM +/-15% band:
- ~30 strikes x 2 sides x 6 expiries = ~360 contract rows/day
- ~6 summary rows/day
- Over a year: ~90K contract rows, ~1.5K summary rows
- For 20 symbols: ~1.8M contract rows/year — fine for SQLite
