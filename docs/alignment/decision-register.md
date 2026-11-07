# Decision Register

Companion to [alignment-interview.md](alignment-interview.md). Trial started 2026-11-06 (Q15). Structure revised at Q16. Interview closed 2026-11-07 (consolidation at Q41); amended the same day after super-advisor review (D49–D54); no later edits applied yet. The planning sketches those edits targeted were dropped (D61); the edit candidates now apply to their rewrite.

## Which document wins

1. Your exact words in the interview log win. If this register disagrees with the log, the register is wrong and gets corrected.
2. A newer decision replaces an older one on the same question. The old row stays, marked `Superseded → Dnn`.
3. Planning docs, prototypes and agent proposals cannot create or upgrade a decision. Only a recorded user answer can.
4. Working rule D10 applies to everything: all choices are provisional until tested.

## How rows work

- One decision per row, one line per row. Detail and reasoning stay in the log; the Source column points there.
- Rows are grouped by area for lookup. IDs never change and are never reused.
- Scope: `General` (applies to every signal) · `Per-signal` (a setting for one signal, e.g. raids) · `Process` (how this interview is kept).
- Status: `Confirmed` · `Provisional` (accepted, open to change after testing) · `Working Direction` (useful, not yet accepted) · `Delegated` · `Deferred` · `Superseded`.
- Who decided: `User` · `Agent → accepted` · `Super proposal → user accepted` · `Agent proposal` (not yet accepted) · `Delegated to agent`.

## Decisions

| Area | ID | Scope | Decision | Status | Who decided | Source |
|---|---|---|---|---|---|---|
| Scope | D01 | Per-signal | Fear/greed via news, organised as a soft/hard × fear/greed 2×2 | Superseded → D09 | Agent proposal | Pre-interview |
| Scope | D14 | General | Commission → run → report; monitoring and alerts wait until a signal passes | Confirmed | User | Q8 |
| Frequency | D02 | General | No intraday, no HFT; edge comes from judgement over days | Confirmed | User | Pre-interview |
| Holding period | D03 | General | Holding period is a backtest output (horizon grid, entry ≥ t+1, plateau), then frozen and forward-tracked | Confirmed | Agent → accepted | Pre-interview |
| Qualification | D05 | General | Capital needs all three layers: full trade rules, after-cost economics, statistical credibility (placebo now optional, see D32) | Superseded → D52 | User + agent research | Q1, Q18 |
| Qualification | D08 | General | Sample size warns, never blocks; event count always shown; trader decides | Confirmed | User | Q3 |
| Qualification | D41 | General | Sample warning levels follow practitioner convention: <30 below minimum, 30–99 limited, 100–199 adequate, 200+ strong; count and top-2-removed always shown | Superseded → D52 | Agent → accepted | Q32 |
| Qualification | D42 | General | Result labels: PF <1.3 weak, ≥1.5 acceptable, ≥2.0 strong; after-cost expectancy >0 at 1× and 2× costs; drawdown shown unlabelled | Superseded → D52 | Agent → accepted | Q33 |
| Qualification | D43 | General | Every version tried is counted per study and shown in plain words; formal deflated Sharpe / PBO added later | Confirmed | Agent → accepted | Q34 |
| Qualification | D52 | General | Research scorecard, not a capital gate: counts and profit factor shown as descriptive bands, never 'adequate'/'strong' claims | Confirmed | Super proposal → user accepted | Amendment 2026-11-07 |
| Kill rule | D25 | General | Drop the idea if, after costs, no tradable long or short effect vs same-period index | Provisional | User | Q14 |
| Benchmark | D26 | General | Same-window index is primary; random-date placebo also required; market model and sector as robustness | Superseded → D32 | Agent proposal | Q14 |
| Benchmark | D32 | General | Same-period index comparison is mandatory; random-date placebo optional for now, with a warning when skipped | Partially superseded → D49 | User | Q18 |
| Benchmark | D49 | General | Random-date placebo optional for exploration, required before a study justifies capital; design frozen before results | Confirmed | Super proposal → user accepted | Amendment 2026-11-07 |
| Benchmark | D35 | General | Benchmark is a broad index that matches the stock list | Confirmed | Agent → accepted | Q28 |
| Benchmark | D36 | Per-signal | Indian equities: Nifty 500 (^CRSLDX), price index, dividend gap disclosed | Confirmed | Agent → accepted | Q28 |
| Deployment | D06 | General | Signal study uses the same virtual amount per trade; sizing and instrument choice are a separate study | Confirmed | User | Q2 |
| Deployment | D07 | General | Virtual baseline is plain stocks with a stated cost model; futures and options go to the deployment study | Confirmed | Agent → accepted | Q2 |
| Deployment | D27 | Per-signal | Short-side tradability flagged by F&O eligibility at the event date | Superseded → D34 | Agent proposal | Q14 |
| Tradability | D34 | General | Every signal build gets a quick point-in-time regulatory/tradability check, reported as flags | Confirmed | User | Q20 |
| Event types | D09 | General | Group events by plain type read from the filing; no judgement labels as input | Confirmed | User | Q4, Q5 |
| Event types | D11 | Per-signal | First test: tax/enforcement raids; switch to a more frequent type if too sparse | Provisional | Agent → accepted | Q6 |
| Event types | D46 | General | Event-type registry: definition, filing wording, start-date rule, regulatory notes; agent drafts, user approves; draft → tested → retired | Confirmed | Agent → accepted | Q37 |
| Event types | D47 | Per-signal | Queue after raids: order wins → management exits → rating changes → index changes; one at a time, small steps | Provisional | Agent → accepted | Q38, Q39 |
| Universe | D12 | General | Search every listed stock; size and liquidity are assessed after, not filtered before | Confirmed | User | Q7 |
| Universe | D13 | General | Size/liquidity measured before the event; include later-delisted stocks; each slice disclosed as a test | Confirmed | Agent → accepted | Q7, Q19 |
| Commissioning | D15 | General | Starts with a plain-language sentence, then simple clarifying questions | Confirmed | User | Q9 |
| Commissioning | D16 | General | 3–5 questions, plan read back, data check, confirm and lock; later changes create new runs | Confirmed | Agent → accepted | Q9, Q22 |
| Commissioning | D17 | General | Sensible defaults are used and shown, all editable | Confirmed | Agent → accepted | Q10 |
| Commissioning | D45 | General | Soft cap of 5 clarifying questions, result-changing only; the rest are defaults in the read-back; user can ask for more | Confirmed | Agent → accepted | Q36 |
| Data gaps | D18 | General | Pre-run data check can trigger news fetching; the app finds and classifies gaps itself | Confirmed | User | Q10 |
| Data gaps | D19 | General | Fetched news only suggests events; fill before lock; keep all found; report coverage | Confirmed (keep-all Provisional) | Agent → accepted | Q10 |
| Data gaps | D44 | General | Gap search scope, stop rule and budget fixed in advance; stopping never sees returns; two-tool overlap gives rough coverage | Confirmed | Agent → accepted | Q35 |
| News pipeline | D04 | General | Vendor-agnostic; our archive is the truth; discovery loose, evidence strict; start with hand-fed BSE links | Deferred → separate News DB & ETL interview | Agent proposal | Pre-interview, Q23 |
| News pipeline | D55 | General | News primitives come from what a study needs and name no vendor; vendors are adapters; quirks go to the source registry as limitations; primitives settled before the hand-fed POC | Confirmed | User | News interview, primitives side question |
| News pipeline | D56 | General | Seven building blocks: Event, Disclosure, Public-time claim, Evidence document, Company identity on that date, Verification, Search record; richer sources may add detail, never change meaning | Provisional | Agent → accepted | News Q1 |
| News pipeline | D57 | General | Public time = earliest evidenced release time, whoever supplied it; document dates alone don't count; precision kept; day-only = earliest start; conflicts block freezing | Confirmed | Agent → accepted | News Q2 |
| News pipeline | D58 | General | Evidence documents stay local, outside git; repo keeps reference, hash, fetch time and extracted facts; reruns report missing copies, never silently re-fetch | Confirmed | Delegated to agent | News Q3 |
| News pipeline | D59 | General | Company identity anchored on ISIN; symbol, series and name recorded as of the date; ISIN changes linked explicitly, never by name | Confirmed | Delegated to agent | News Q3 |
| News pipeline | D60 | General | POC: thoroughness and accuracy over speed, plain artifacts, no over-engineering; 10 raids, every event reviewed by the user | Confirmed | User | News Q4 |
| Process | D61 | General | Vol-curve tool and the early event-study / news-ETL sketches removed from the codebase; redo from scratch, sketches rewritten from this register when needed | Confirmed | User | PR #62 review, 2026-11-07 |
| Data sources | D37 | General | Keep a data-sources registry that parks all good candidates with documentation | Confirmed | User | Q29 |
| Data sources | D38 | General | Registry = registry.json (master) + one Markdown page per source, kept in sync by a validator | Confirmed | Delegated to agent | Q30 |
| Data sources | D39 | Per-signal | Indian equities: NSE bhavcopy is the candidate source for point-in-time prices and stock lists | Provisional | Agent → accepted | Q29 |
| Data sources | D40 | General | Source stages: candidate → tested → approved per use → wired in → retired/blocked; fields: coverage, licence, key, point-in-time trust, last checked | Confirmed | Agent → accepted | Q31 |
| Data sources | D51 | General | Stop committing/publishing Yahoo-derived data; old public history needs a separate owner decision | Confirmed | Super proposal → user accepted | Amendment 2026-11-07 |
| Review gate | D20 | General | Review each event first (event and company); approve batches once trust is earned | Confirmed | User | Q11 |
| Review gate | D21 | General | Switch to batch approval at ≥80% of reviewed events accepted unchanged | Partially superseded → D50 | User | Q12 |
| Review gate | D22 | General | Trust measured over the last 50 reviewed events | Provisional | Agent → accepted | Q12, Q24 |
| Review gate | D48 | General | Trust is earned per event type; every new type starts in review-every-event mode | Confirmed | Agent → accepted | Q40 |
| Review gate | D50 | General | Critical fields (event, issuer, first-public time) verified per event always; batches cover non-critical fields only | Confirmed | Super proposal → user accepted | Amendment 2026-11-07 |
| Dates | D23 | General | Date tolerance rule | Delegated | Delegated to agent | Q13 |
| Dates | D24 | General | Late by ≤1 trading day is fine; too-early dates and wrong-announcement dates block | Partially superseded → D50 (late-side tolerance withdrawn; too-early and wrong-leg still block) | Agent → accepted | Q13, Q25 |
| Working rule | D10 | General | Everything is provisional until tested | Confirmed | User | Q6 |
| Working rule | D33 | General | Raids are a probe for general primitives; process stays signal-agnostic; signal specifics are per-signal settings | Confirmed | User | Q19 follow-up |
| Working rule | D53 | General | No new machinery without a demonstrated reason from the probe | Confirmed | User | Amendment 2026-11-07 |
| Working rule | D54 | General | Next work: hand-fed Polycab end-to-end check, then bounded delisted-price check; return-blind raid count before any aggregate study | Confirmed | Super proposal → user accepted | Amendment 2026-11-07 |
| Process | D28 | Process | Keep a decision register beside the interview log, trialled here first | Confirmed | User | Q15 |
| Process | D29 | Process | End design: register generated from the log; propose an interview-skill change after the trial | Confirmed | Agent → accepted | Protocol note, Q26 |
| Process | D31 | Process | Register gets an area column, a "which document wins" section, and a one-line-per-row cap | Confirmed | Delegated to agent | Q16 |
| Research tooling | D30 | Process | Exa is the default research tool wherever it is callable | Confirmed | User | Protocol note |

## Open questions

| Area | ID | Scope | Question | Source |
|---|---|---|---|---|
| Qualification | O01 | General | ~~Exact thresholds for profit factor, expectancy, drawdown~~ Resolved → D42 | Q1, Q33 |
| Qualification | O02 | General | ~~Deflated Sharpe / PBO formal vs approximated~~ Resolved → D43 | Q1, Q34 |
| Qualification | O03 | General | ~~Cut-offs for the sample-size warning bands~~ Resolved → D41 | Q3, Q32 |
| Event types | O04 | General | ~~Who maintains the event-type list and how new types are added~~ Resolved → D46 | Q5, Q37 |
| Event types | O05 | Per-signal | ~~Second event type if raids prove too sparse~~ Resolved → D47 | Q6, Q39 |
| Universe | O06 | General | ~~Source for point-in-time listings and delisted-stock prices~~ Resolved → D39 (candidate, via registry D37) | Q7, Q29 |
| Commissioning | O07 | General | ~~Maximum number of clarifying questions~~ Resolved → D45 | Q9, Q36 |
| Data gaps | O08 | General | ~~Stopping rule for gap-filling searches~~ Resolved → D44 | Q10, Q35 |
| Review gate | O09 | General | ~~Trust tracked per source / per event type, or overall~~ Resolved → D48 | Q11, Q24, Q40 |
| Benchmark | O10 | General | ~~Which index: Nifty 50, Nifty 500, or sector~~ Resolved → D35, D36 | Q14, Q28 |
| Data sources | O11 | General | ~~Registry fields and status lifecycle~~ Resolved → D40 | Q30, Q31 |
