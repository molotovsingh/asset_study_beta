# Probe 2026-11-07: Polycab end-to-end, delisted-price feasibility, raid census

Commissioned by decision D54 (`docs/alignment/decision-register.md`). Hand-run, one-off checks under D53: no app code was added. The scripts beside this note are throwaway probes kept so the results can be reproduced. Downloaded exchange files were kept outside the repo and are not committed (NSE terms do not allow redistribution).

**This is a wiring check on one event, not evidence of a signal.** N = 1.

## 1. Polycab end-to-end

### First public time: four legs, not one date

| Leg | First public | Evidence | Counts from |
|---|---|---|---|
| 1. IT search reported | 2023-12-22, during market hours (stock −3.8% by 11:50 IST; BSE sought clarification the same day) | Business Standard 12:22 IST; BSE clarification notice (seen via Trendlyne mirror); company Reg 30 letter dated 22 Dec 2023 | 2023-12-22 |
| 2. ₹200–300 cr evasion reports | 2024-01-09, intraday | Moneycontrol (CNBC-TV18 sources); company denial filed after close | 2024-01-09 |
| 3. CBDT quantifies (₹1,000 cr unaccounted cash sales) | 2024-01-10 20:06 IST, after close | PIB press release PRID 1994969 (primary) | 2024-01-11 |
| 4. Company: no communication received | 2024-01-11, after close | Exchange filing | 2024-01-12 |

Not verified:
- The exact exchange timestamp of leg 1. BSE's announcement API returns 403 to scripted access, and this probe did not try to bypass it.
- The NSE copy of the company letter has the filename timestamp `POLYCAB_26122023105810` (26 Dec, 10:58). That is four days after the letter's date, so **NSE archive filename times cannot be assumed to be first-public times.**

### Prices: Yahoo matches the exchange on every checked day

POLYCAB EQ closes from NSE CM bhavcopy, and NIFTY 500 closes from NSE `ind_close_all`, match yfinance exactly on all 8 key dates (2023-12-21 through 2024-01-12).

But **yfinance `^CRSLDX` is missing two real trading days** in the window: 2024-01-01 and 2024-02-19. NSE published Nifty 500 closes for both. Aligning on common dates silently stretched the 20- and 60-day horizons. Patching the two days from NSE moved the leg-1 result by up to 1.9 points (60d: −11.51 → −13.40).

Also corrected by exchange data: on 2024-01-11 the press reported the stock "locked in a 20% lower circuit". NSE bhavcopy shows a close of −21.04% and a low of −22.62%, so it kept trading.

### Tradability check (D34), point in time

| Date | In F&O (stock futures listed) | In F&O ban list |
|---|---|---|
| 2023-12-22 | yes | no |
| 2023-12-26 | yes | no |
| 2024-01-11 | yes | no |
| 2024-01-12 | yes | **yes** |

Sources: NSE F&O bhavcopy; NSE `fo_secban_DDMMYYYY.csv`. The stock entered the ban list the day after the −21% day, so no new futures short could be opened just as the bad news was confirmed.

### Result: market-adjusted vs Nifty 500, entry at the close of the first trading day after t0

| Horizon | Leg 1 (t0 2023-12-22, entry 2023-12-26) | Leg 3 (t0 2024-01-11, entry 2024-01-12) |
|---|---|---|
| Event day | −5.22 pts | −21.38 pts |
| 1d | +0.00 | +4.75 |
| 5d | −2.30 | +11.80 |
| 10d | −11.40 | +9.24 |
| 20d | −20.73 | +8.59 |
| 60d | −13.40 | +29.77 |

What one event shows, and only that:
- **The chosen leg flips the story.** Anchored on leg 1, a buy-the-fear entry would have held straight into legs 2 and 3. Anchored on leg 3, the same "buy the panic" idea looks excellent.
- This is a concrete case for D24 (wrong leg blocks), D50 (verify the first public time per event), and super's correction that a later date is not automatically conservative.

## 2. Delisted and suspended prices (bounded: 3 names, 9 bhavcopy dates)

| Name | NSE bhavcopy | Yahoo |
|---|---|---|
| HDFC Ltd (merged July 2023) | EQ until 2023-07-12, absent after | **No data at all** for `HDFC.NS`. Its whole history is gone |
| HDIL (suspended/insolvent) | Present, but in series **BZ** (trade-for-trade); absent on some days (e.g. 2023-07-12, 2023-07-14) | Rows through 2026; on NSE-absent days shows the previous price carried forward with **volume 0** (335 zero-volume rows since 2022) |
| RCOM | Present, mostly series **BE** | Rows through 2026; 353 zero-volume rows |

Findings:
- Survivorship is real here: merged names vanish from Yahoo.
- Yahoo pads non-trading days with stale prices. These must be dropped (volume 0, or absent from the exchange file), not treated as returns.
- **Series matters.** HDIL and RCOM do trade, under BE/BZ (trade-for-trade, delivery-only). A universe filtered to `EQ` only would drop them silently. This is likely why a public write-up claimed such names "never appear in the bhavcopy". Series is also a tradability fact for D34.
- NSE's archive (old CM bhavcopy, F&O bhavcopy, index closes, ban lists) allowed plain scripted downloads. BSE's API did not.

## 3. Return-blind raid census (bounded: 6 Exa queries over exchange-filing domains; no prices looked at)

- About 25 distinct listed companies with a search disclosure were found. Examples: Mankind, Shree Cement, RR Kabel, KEI, Grasim, Vedanta, Divi's, Prime Focus, Transrail.
- NSE-dated hits by year: 2023: 4, 2024: 1, 2025: 2, 2026: 9. That skew is the search index favouring recent pages, not a real trend.
- **This is a lower bound, not a count.** A real census needs the exchanges' own announcement listings by category, which this probe could not reach (BSE API blocked; NSE listing API not tried).

## Problems found (the input for the News DB & ETL interview, per D54)

1. Leg-1 exchange timestamps need BSE/NSE announcement metadata. The BSE API blocks scripts; NSE archive filenames are not first-public times.
2. Events are multi-leg. Leg identification and clustering are needed before any aggregate.
3. Yahoo drops real trading days from index series; the benchmark should come from NSE `ind_close_all`, or at least be checked against it.
4. Yahoo erases merged names and pads suspended names with zero-volume stale prices. Point-in-time work needs NSE bhavcopy, including BE/BZ series.
5. F&O membership and ban status change exactly around events. They are available from NSE archives by date.
6. Discovery search is recency-biased. A census needs exchange category listings, not search engines.

## Sources actually used (candidates to seed the data-sources registry, D37/D40)

| Source | Used for | Tested result |
|---|---|---|
| NSE CM bhavcopy (archives.nseindia.com) | stock prices, series, presence | scripted download OK; matched Yahoo on trading days |
| NSE `ind_close_all` | Nifty 500 closes | OK; exposed Yahoo index gaps |
| NSE F&O bhavcopy, `fo_secban` | F&O membership, ban list | OK |
| yfinance | prices | matches on traded days; drops index days; erases merged names; pads stale prices |
| PIB | regulator press release, timestamped | primary, minute-level time |
| BSE announcement API | exchange timestamps | **blocked (403)** |
| Exa, DeepSeek search | discovery only | found filings and press; recency-biased; not a census |
| Press (Business Standard, Moneycontrol, Mint, NDTV Profit) | intraday timing | useful for leg timing; corroboration only |

## Reproduce

```bash
mkdir -p /tmp/probe_polycab_data
.venv/bin/python -I docs/research/probes/2026-11-07-polycab-and-data-feasibility/scripts/fetch_prices.py /tmp/probe_polycab_data/yf.json
# download NSE files for the dates listed above into /tmp/probe_polycab_data/{bhav,idx,fo}
.venv/bin/python -I .../scripts/crosscheck.py /tmp/probe_polycab_data
.venv/bin/python -I .../scripts/fo_check.py /tmp/probe_polycab_data/fo
.venv/bin/python -I .../scripts/result.py /tmp/probe_polycab_data/yf.json
.venv/bin/python -I .../scripts/delisted.py /tmp/probe_delisted_data
```
