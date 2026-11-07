# Raids POC: review sheet

Please check the three critical fields for each event (D50): **is the event real**, **is it the right company**, and **is the first-public time right**. Mark each OK or correct it. No prices had been looked at when this was reviewed. **Reviewed by the user on 2026-11-07: "all ok". Set frozen.**

t0 rule (D57): the trading day of the earliest evidenced public time. Before 15:30 IST on a trading day → that day; after close or on a non-trading day → the next trading day. Entry is at the close of the day after t0.

| # | Company (NSE, ISIN) | What happened | Search began | First public (IST) | Basis | t0 | Flags | Your check |
|---|---|---|---|---|---|---|---|---|
| C01 | Divi's Laboratories (DIVISLAB, INE361B01024, EQ) | Income Tax: IT search at head office and manufacturing sites (s.132) | 2019-02-14 | 2019-02-15 01:15 IST | press (Deccan Chronicle, on-page stamp) | **2019-02-15** | search began 14 Feb; no 14 Feb report found | OK (user, 2026-11-07) |
| C03 | Mankind Pharma (MANKIND, INE634S01028, EQ) | Income Tax: IT search at offices and plants of company and subsidiaries | 2023-05-11 | 2023-05-11 10:45 IST | press (Moneycontrol, on-page stamp) | **2023-05-11** | listed 9 May 2023, two trading days before t0 | OK (user, 2026-11-07) |
| C04 | Heads UP Ventures (HEADSUP, INE759V01019, EQ) | CBI: CBI search at corporate office; warrant named Mandhana Industries | 2023-09-14 | 2023-09-15 20:14 IST | exchange filing (NSE filename time; signed 19:57) | **2023-09-18** | warrant in another company's name; very thin trading (~24k shares on t0); no press before the filing found | OK (user, 2026-11-07) |
| C11 | Interarch Building Solutions (INTERARCH, INE00M901018, BE) | Income Tax: IT search at Pantnagar plant and Noida office | 2025-08-18 | 2025-08-18 12:19 IST | wire brief (Reuters via TradingView) | **2025-08-18** | BE series (trade-for-trade) on t0 | OK (user, 2026-11-07) |
| C14 | Ashapura Minechem (ASHAPURMIN, INE348A01023, EQ) | Income Tax: IT search at registered office, 13-16 Oct 2025 | 2025-10-13 | 2025-10-16 21:28 IST | press (ScanX, on-page stamp) of the company's same-evening filing | **2025-10-17** | search ran 4 days with no public report found: possible leakage before t0 | OK (user, 2026-11-07) |
| C16 | Refex Industries (REFEX, INE056I01025, EQ) | Income Tax: IT search at registered office, plants and group locations | 2025-12-09 | 2025-12-10 08:11 IST | press (Dinamalar, Tamil, names Refex Industries; on-page stamp) | **2025-12-10** | first pass dated it 12 Dec (company confirmation, -20% day): wrong leg, corrected; TOI 10 Dec 00:18 IST described the searches without naming the company | OK (user, 2026-11-07) |
| C17 | Balu Forge Industries (BALUFORGE, INE011E01029, EQ) | Income Tax: IT search at offices and manufacturing units | 2026-01-06 | 2026-01-07 12:09 IST | press (Zee Business, on-page stamp) | **2026-01-07** | stock fell ~16-20% in early trade on t0 before the first report: possible leakage | OK (user, 2026-11-07) |
| C18 | Touchwood Entertainment (TOUCHWOOD, INE486Y01013, EQ) | Income Tax: IT search at corporate office, 28-31 Jan 2026 | 2026-01-28 | 2026-02-03 19:16 IST | exchange filing (NSE filename time) | **2026-02-04** | disclosed 6 days after the search began; no press found; thin trading (~12k shares on t0) | OK (user, 2026-11-07) |
| C21 | Reliance Communications (RCOM, INE330H01018, BE) | CBI: CBI search at office of wholly owned subsidiary Reliance Telecom, and ex-directors' homes | 2026-03-26 | 2026-03-26 10:37 IST (page 'updated' time; original could be earlier) | press (DT Next / IANS, on-page stamp) | **2026-03-26** | search tool labelled the IST time as UTC: corrected from the page; company in insolvency; price ~Rs 0.79; BE series; part of an ongoing multi-agency saga, not a first shock; search at subsidiary premises | OK (user, 2026-11-07) |
| C23 | Vedanta (VEDL, INE205A01025, EQ) | ED: ED FEMA searches at company premises in several cities | 2026-06-02 | 2026-06-02 10:12 IST | press (Economic Times) | **2026-06-02** | - | OK (user, 2026-11-07) |

Excluded during verification: C06 Bhagyanagar India (an ED information visit about suppliers, not a search of the company).

Tradability at t0 (D34): stock futures available only for DIVISLAB and VEDL; none on the F&O ban list; INTERARCH and RCOM in the BE (trade-for-trade) series.

Evidence: hash prefixes refer to `evidence_manifest.json`; copies are in `data/local-cache/news-poc/evidence/` on this machine (not in git, D58).
