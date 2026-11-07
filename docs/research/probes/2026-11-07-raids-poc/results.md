# Raids POC: results

Run on the frozen event set `f55e29ffa9a2…` (events.json, after the C21 holiday correction). Rules from PLAN.md.

**Read this first.** Ten events is a method test, not a signal test (D52). There are no costs, no placebo (optional under D49 and not run), and no quality labels. The numbers below show that the steps work end to end. They say nothing reliable about raids as a trade.

## Per event: market-adjusted return vs Nifty 500, in percentage points

Event day = t0 close vs the previous close. Holds run from the entry close (the first trading day after t0).

| # | Company | t0 | Event day | 1d | 5d | 10d | 20d | 60d |
|---|---|---|---|---|---|---|---|---|
| C01 | Divi's Laboratories | 2019-02-15 | -0.51 | +0.97 | -1.35 | +0.86 | -1.62 | -2.94 |
| C03 | Mankind Pharma | 2023-05-11 | -0.29 | -1.15 | -4.11 | -6.50 | +3.93 | +19.78 |
| C04 | Heads UP Ventures | 2023-09-18 | -0.12 | -0.00 | +1.45 | -2.73 | +10.84 | +14.41 |
| C11 | Interarch Building Solutions | 2025-08-18 | -2.23 | -1.28 | +0.68 | +1.42 | -2.14 | +20.90 |
| C14 | Ashapura Minechem | 2025-10-17 | -0.68 | +0.32 | -3.61 | +0.59 | +4.01 | +23.97 |
| C16 | Refex Industries | 2025-12-10 | -0.28 | -20.74 | -13.28 | -18.52 | -25.35 | -27.66 |
| C17 | Balu Forge Industries | 2026-01-07 | -11.57 | -8.68 | -9.25 | -21.15 | -4.18 | -2.38 |
| C18 | Touchwood Entertainment | 2026-02-04 | -3.50 | +1.09 | -0.90 | -5.19 | -18.59 | -14.36 |
| C21 | Reliance Communications | 2026-03-27 | -2.69 | +1.96 | +15.85 | +26.47 | +15.82 | +6.40 |
| C23 | Vedanta | 2026-06-02 | -1.44 | -0.42 | -7.83 | -9.54 | -19.50 | -18.97 |

## Summary (descriptive bands only, D52)

| | Event day | 1d | 5d | 10d | 20d | 60d |
|---|---|---|---|---|---|---|
| Median, all 10 | -1.06 | -0.21 | -2.48 | -3.96 | -1.88 | 2.01 |
| Mean, all 10 | -2.33 | -2.79 | -2.23 | -3.43 | -3.68 | 1.92 |
| Above zero, of 10 | 0 | 4 | 3 | 4 | 4 | 5 |
| Median without top 2 | -0.59 | 0.16 | -2.48 | -3.96 | 1.16 | 2.01 |
| Mean without top 2 | -1.03 | 0.19 | -3.12 | -4.95 | 1.01 | 2.86 |

Top two removed per column (largest absolute values): event: C17, C18; 1: C16, C17; 5: C16, C21; 10: C17, C21; 20: C16, C23; 60: C14, C16

## Data checks

- Stock and index closes: Yahoo matched NSE (CM bhavcopy, `ind_close_all`) on all 80 checked dates (t0−1, t0, entry and five horizon dates per event).
- Yahoo's Nifty 500 series is missing **1 January** in every year that came up (2024 and 2026 here; also 2024 in the Polycab probe). Patched from NSE each time.
- C21: 26 Mar 2026 was an NSE holiday. t0 was corrected to 27 Mar by rule, before C21's result existed (see `events.json` amendments).
- C04: one non-trading day inside the window; last traded price carried.

## What the POC taught (method, not signal)

1. **The first public naming is not always when the market priced it.** Refex was named by a Tamil daily on 10 Dec, before the open. The market barely moved that day (−0.3 pts); the −20.7 pts came two days later on the company's own confirmation. Anchoring on the earliest evidence (D57) is right against lookahead, but it can put the entry *before* the leg the market trades. Same pattern as Polycab.
2. **Prices moved before the first evidence.** Balu Forge fell sharply in early trade before the first report (event day −11.6 pts). Ashapura and Touchwood were searched for days with nothing public found. The pre-t0 window matters.
3. **Disclosure lag is measurable and varies:** same day (Mankind, Vedanta) to six days late (Touchwood).
4. **The trading calendar is part of t0**, not an afterthought (the C21 error).
5. **Timestamps must come from the page, not the search tool:** one tool labelled an IST time as UTC (C21).
6. **Discovery is still the weak link:** 20 of 24 candidates were from 2025–26, and recall of earlier raids was poor.
7. **Tradability limits the short side:** only 2 of 10 had stock futures; two traded in the restricted BE series; one was a ₹0.79 insolvent stock.

## Building blocks (D56) under test

- **Held up:** Event, Disclosure (multi-leg), Public-time claim (with basis and precision), Evidence document (hash-named local copies), Company identity on the date (ISIN, symbol, series), Verification (agent prepared, user reviewed), Search record.
- **Missing:** the exchange's **trading calendar on that date** is needed to turn a public time into t0. It is vendor-neutral reference data, like company identity.
- **Strained:** "first public" vs "first disclosure the market traded". The Disclosure block can hold both; which one anchors a study should be a pre-registered study choice, counted as a variant when changed (D43).
