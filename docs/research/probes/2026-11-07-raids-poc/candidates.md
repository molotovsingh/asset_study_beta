# Raids POC: candidates

Built from `search_record.json` (pre-registered pass plus the labelled pass 0) and the documents in `evidence_manifest.json`. **No prices were looked at.**

## Plan amendment (made before any price was seen)

PLAN.md said: verify all candidates, then draw 10 at random. Amended for cost: all candidates are put in one seeded random order (seed `20261107`) and verified down that order until 10 pass. Same selection properties (random, return-blind), less verification work.

Cluster rule (not anticipated in PLAN.md): related companies searched in the same operation on the same day count as **one slot**. Only the first company in the cluster (by listing order) is tested; the others are recorded.

## Candidates (24, listed by date)

| ID | Company | NSE symbol | Agency | Approx. t0 | Notes | Evidence (sha256 prefix) |
|---|---|---|---|---|---|---|
| C01 | Divi's Laboratories | DIVISLAB | IT | 2019-02-14 | search began 14 Feb; ET Now news 15 Feb; exchange query 15 Feb | b51346754e |
| C02 | Sambhaav Media | SAMBHAAV | IT | 2021-09 | search at registered office; letter Sept 2021 | c9e24b709b |
| C03 | Mankind Pharma | MANKIND | IT | 2023-05-11 | communications 11-12 May 2023; summary letter 17 May | 25acb10ce3 |
| C04 | Heads UP Ventures | HEADSUP | CBI | 2023-09-15 | CBI search, warrant named Mandhana Industries (flag) | d29dac1691 |
| C05 | R R Kabel | RRKABEL | IT | 2023-11-29 | disclosure 29 Nov 2023 19:47 | 5f929c93c8 |
| C06 | Bhagyanagar India | BHAGYANGR | ED | 2024-03-23 | disclosure 23 Mar 2024 12:23 (Saturday) | 4b20247f24 |
| C07 | Rana Sugars | RANASUG | IT | 2025-02 | update letter 10 Feb 2025 | 46ee0a3c96 |
| C08 | Medi Assist Healthcare | MEDIASSIST | ED | 2025-04 | ED search at subsidiary premises, Ranchi (flag: subsidiary) | 16373a32ae |
| C09 | Salasar Techno Engineering | SALASAR | ED | 2025-04-16 | ED search at residence of Mr Alok Kumar only (flag: promoter/KMP status to verify) | 0bc9417a47 |
| C10 | Easy Trip Planners | EASEMYTRIP | ED | 2025-04 | ED search at one office; letter 17 Apr 2025 | b0e015d79b |
| C11 | Interarch Building Solutions | INTERARCH | IT | 2025-08-18 | intimation 18 Aug 2025; completion 22 Aug | 974472acfa |
| C12 | Reliance Communications (Aug 2025) | RCOM | CBI | 2025-08-23 | CBI search at company office; company in insolvency (flag) | 2db73b1424 |
| C13 | Mirza International | MIRZAINT | IT | 2025-09 | letter 16 Sep 2025 | 32b12357a3 |
| C14 | Ashapura Minechem | ASHAPURMIN | IT | 2025-10-13 | search 13-16 Oct 2025 | 482acf7def |
| C15 | Praveg | PRAVEG | IT | 2025-10 | conclusion letter 17 Oct 2025; NSE listing to verify | 233936ab5c |
| C16 | Refex Industries | REFEX | IT | 2025-12-12 | clarification 12 Dec 2025 (only a later letter fetched) | 1704b0918b |
| C17 | Balu Forge Industries | BALUFORGE | IT | 2026-01 | letter 13 Jan 2026 | 25d57139d8 |
| C18 | Touchwood Entertainment | TOUCHWOOD | IT | 2026-02 | disclosure 3 Feb 2026 | 6cfa9433c2 |
| C19 | Greenply / Greenpanel / Greenlam (one cluster) | GREENPLY|GREENPANEL|GREENLAM | IT | 2026-02-26 | same-day search across related companies; one slot | 019c8b7877|2ff4d436c0|6aecfaaff6 |
| C20 | Transrail Lighting | TRANSRAILL | IT | 2026-03-24 | search since 24 Mar; disclosure 25 Mar 13:02 | 5a33d716ec |
| C21 | Reliance Communications (Mar 2026) | RCOM | CBI | 2026-03 | CBI search at subsidiary RTL office (flag: subsidiary) | 6d437b2463 |
| C22 | TARC | TARC | ED | 2026-04 | ED search, mainly pre-demerger entity (flag) | 22238887e9 |
| C23 | Vedanta | VEDL | ED | 2026-06 | ED search; follow-up letter 4 Jun 2026 | 005bcccf1d |
| C24 | Authum Investment & Infrastructure | AIIL | IT | 2026-07 | search commenced; letter 22 Jul 2026 | fc3b8ceefd |

## Excluded, with reasons

| Company | Reason |
|---|---|
| Polycab India | Chosen earlier *because* its price crash was known: selection bias. Kept as the hand-checked reference case only |
| Shree Cement (Jun 2023) | Income-tax **survey** (s.133A), not a search (s.132) |
| Prism Johnson (Jan 2026) | GST inspection |
| Prime Focus, Innovision, R&B Denims, BN Agrochem, Vashu Bhagnani Industries (Oct 2026 letters) | t0 after 2026-07-31; horizons not matured, and/or not NSE-listed |
| B.R. Goyal Infrastructure, Hilltone Software & Gases | BSE SME listings |
| Srestha Finvest | BSE and MSE only |
| Gujarat Credit Corporation | BSE only |
| Aditya Vision (2018) | Before 2019 and a survey |
| Grasim (Oct 2026) | Reassessment notice and rumour verification, not a search |
| R R Kabel (Mar 2026), Interarch (Sep 2026), KEI (results), Puravankara (auditor note) | Later legs or unrelated documents, not the search disclosure |

## Verification order (seed 20261107)

C21 → C23 → C17 → C06 → C11 → C18 → C01 → C16 → C04 → C03 → C14 → C24 → C09 → C20 → C12 → C07 → C08 → C10 → C05 → C02 → C15 → C13 → C22 → C19

Verification stops when 10 events pass. Results are recorded in `verification.md`.

## Search-quality observations

- 20 of 24 candidates are from 2025–2026. This is the search index favouring recent pages, not evidence that raids became more frequent.
- DeepSeek's date operators returned 8 results across 8 years on this domain.
- Recall is low: well-known earlier raids (for example Hero MotoCorp, March 2022) were not found by the fixed queries. Per the stop rule, no query was added.
