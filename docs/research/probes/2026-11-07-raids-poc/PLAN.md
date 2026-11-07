# Raids POC: pre-registered plan (written before any search was run)

Decisions in force: D03, D09, D12, D13, D25, D32/D49, D34, D35/D36, D44, D50, D52, D53, D55–D60 (`docs/alignment/decision-register.md`).

Purpose: test whether the seven vendor-neutral building blocks (D56) and the per-event checks hold up across about 10 events. **This is a method test, not a signal test.** Ten events are far below any usable sample (D52); results are descriptive only.

## What counts as an event (fixed before searching)

- A search or raid by the **Income Tax Department, Enforcement Directorate or CBI** at premises of an **NSE-listed company** (EQ, BE or BZ series on the event date) or of its promoters/key managerial persons, where the company itself disclosed it or an exchange sought clarification about it.
- t0 between **2019-01-01 and 2026-07-31**, so that a 60-trading-day horizon has matured by today (2026-11-07).
- Excluded: SME-platform listings; GST-only inspections; searches only at unlisted group companies with no disclosure by the listed company; assessment orders, demands and appeals (those are later legs, not the search).
- Multi-leg sequences (D24/D57): **leg 1, the first evidenced public disclosure of the search, is the event**. Later legs are recorded, not tested separately.

## Discovery (Search record, D44)

- Fixed queries on exchange-filing domains (NSE archives, BSE corporate filings), via Exa and DeepSeek, listed in `search_record.json` with time, tool, query, filters, result count and result URLs.
- Year-bucketed repeats (2019–2026) of the two core queries, to counter the recency bias seen in the earlier census.
- **Stop rule:** one pass of the fixed query list; budget at most 40 search calls. No query is added after looking at any price.
- **Return-blind:** no price, return or chart is looked at until all 10 events are verified and frozen.

## Selection

1. Every candidate found is listed in `candidates.md`, with the reason for any exclusion.
2. Candidates are verified (critical fields: event real, issuer and ISIN, first public time with basis and precision; D50, D57, D59) in date order.
3. If more than 10 pass, 10 are chosen by a seeded random draw (seed `20261107`) over the passing list, recorded with the list order. If fewer than 10 pass, all passing events are used and the shortfall is reported.

## Study rules (fixed)

- t0 = trading day of the first evidenced public time (D57); entry at the close of the first trading day after t0.
- Horizons: 1, 5, 10, 20, 60 trading days after entry; plus the event-day reaction.
- Benchmark: Nifty 500 over the same window (D35, D36). The placebo is optional for exploration (D49) and is not run in this POC.
- Prices: Yahoo daily closes, accepted only where they match NSE bhavcopy on the checked dates (t0−1, t0, entry, each horizon). Zero-volume rows are dropped. Index gaps are patched from NSE index files and listed.
- Tradability flags at t0 and entry (D34): listing series, F&O membership, F&O ban.
- Output: per-event table, plus count, median and mean of market-adjusted returns per horizon, and the same without the two largest absolute results (D52). No "strong" or "weak" labels.

## Review (D50, D60)

The user reviews every event's critical fields on `review_sheet.md` before freezing. Corrections are recorded per field.

## Storage (D58)

Source documents are kept under `data/local-cache/news-poc/evidence/` (git-ignored), named by SHA-256. The repo keeps references, hashes, fetch times and extracted facts only.
