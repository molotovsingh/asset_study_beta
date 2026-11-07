# Event Study

## Status

Planned. Sketch only — no code, no route, no study registration yet.

This is the first study type that is not "one series over one window". It is
the missing middle layer between a natural-language market story ("tax raids
cause temporary price distortions that mean-revert") and the evidence ledger
this repo already knows how to keep.

## Product Thesis

The useful event study is not an event backtester and not a news feed.

It is a falsification machine for event stories:

```text
story in plain language
  -> explicit event set (who, when, sourced from where)
  -> event-window alignment on relative trading days
  -> abnormal returns vs an estimation-window market model
  -> aggregation across events, with a placebo control
  -> governed verdict: pattern present, absent, or sample too thin to say
  -> only then: tracked-trade evidence, kept separate
```

The point is not to find edges quickly. The point is to kill weak event
stories cheaply and on the record, so the ones that survive are worth a
tradability investigation.

## What It Must Not Do

- It must not accept an event without a source reference and a timestamp
  precise enough to place t0. Unsourced events are anecdotes.
- It must not let the user pick the sample after seeing the result. The event
  set is frozen into the run artifact before computation.
- It must not report a mean effect from a handful of events as a headline.
  Small samples are diagnostics or suppressed, per the metric registry.
- It must not claim tradability. A significant CAR is a price pattern, not an
  executable trade. Tradability needs its own later evidence path, like the
  tracked straddle ledger did for options.
- It must not use information that was not knowable at the event time when
  assigning entities, memberships, or categories (no lookahead in curation).

## Required Contracts

### `event-record-v1`

One event. Supplied manually in the first slice; a future news tool fills the
same shape (`news-evidence-extraction-v1` in the Agentic Study Factory doc).

```json
{
  "version": "event-record-v1",
  "eventId": "tax-raid-2024-03-acme-cement",
  "entityQuery": "ACMECEM.NS",
  "eventDateTime": "2024-03-14T10:30:00+05:30",
  "timezone": "Asia/Kolkata",
  "announcedDuringMarketHours": true,
  "category": "tax-raid",
  "label": "IT department search at registered offices",
  "source": {
    "kind": "exchange-filing | regulator | news | manual",
    "ref": "BSE announcement id or URL",
    "retrievedAt": "2026-11-04T09:00:00+05:30"
  },
  "notes": "Optional curator note. Notes are never inputs to computation."
}
```

Rules:

- `eventDateTime` is when the information became public, not when the curator
  learned of it. `retrievedAt` is kept separate so retroactive curation is
  visible, not hidden.
- t0 convention (deterministic, in the run artifact): if the announcement
  time is at or before market close on a trading day, t0 is that day;
  otherwise the next trading day. `announcedDuringMarketHours: false` with an
  after-close time must agree with that rule or validation errors.
- One entity per record. A raid hitting five group companies is five records
  sharing a `category`, not one record with a list — aggregation and clustering
  rules need to see them individually.

### Where events come from (source hierarchy)

There is no news source in this repo today. The Study Factory names the
requirement (`news-event-archive` in `app/studyFactory/studyProposal.js`:
source IDs, publication timestamps, query terms, extracted labels), but the
approved tool catalog has no `news` kind, and the Finnhub provider does symbol
discovery and candles only. In the first slice the curator supplies events;
this hierarchy decides what counts as an acceptable `source.ref`, strongest
first:

1. **Exchange filings** — BSE/NSE company announcements. Timestamped by the
   exchange, entity-specific, and the timestamp the market could first trade
   on. This is the default evidence for Indian events (raids, orders, bans,
   defaults, resignations).
2. **Regulator and primary official sources** — SEBI orders, RBI circulars,
   Income Tax / ED / CBI releases via PIB, ministry gazettes, court orders.
   Authoritative on what happened; timestamps are publication times, so the
   exchange filing (usually minutes to hours later) may be the tradable t0.
   When both exist, record the regulator item as the source and note the
   filing time if it differs materially.
3. **Company press releases and concall disclosures** — usable, flagged in
   curation notes as self-reported timing.
4. **Wires and financial press** (PTI, Reuters, Bloomberg, ET, Mint, Business
   Standard, Moneycontrol) — discovery aid only in the first slice. An event
   found via press should be upgraded to a filing or regulator reference
   before it enters a frozen set; press-only events carry
   `source.kind: "news"` and are visibly weaker in exports.

For US entities the same ladder applies with SEC EDGAR (8-K/6-K) at the top.
The vendored `vendors/global-stock-data` filing stream can help *find* US
events later, but a headline search result is not archived evidence; the
filing accession number is.

Automated event discovery (crawling any of the above) is a non-goal for the
first slice. When it arrives, it fills `event-record-v1` plus the
`news-evidence-extraction-v1` fields (query, article IDs, extraction rule) —
it does not get a side door around them. The ideal vendor-agnostic workflow
for that pipeline — watch spec, discovery, immutable archive, resolution,
extraction, curation, freeze, replay — is designed in
[News ETL Pipeline](news-etl-pipeline.md); this study consumes only its
frozen `event-set-v1` output.

#### Candidate discovery tool: Exa

Exa (search + contents fetch) is a plausible first discovery tool: it is
already available in the operator's agent environment, supports
`includeDomains` allowlists and `startPublishedDate` / `endPublishedDate`
filters, returns result IDs/URLs with `publishedDate`, and can fetch full
page text in the same workflow. Used well, the flow is:

```text
curator query ("income tax search <company>", domains: bseindia.com,
nseindia.com, sebi.gov.in, pib.gov.in, date window)
  -> Exa results (discovery only)
  -> fetch the filing/regulator page itself
  -> archive raw fetched content + query + filters + result IDs + retrievedAt
  -> draft event-record-v1 pointing at the filing, not at the search result
  -> human confirms the event set before it freezes
```

What Exa must never be in this design: the source of record, or the timestamp
authority. Search indexes are mutable (the same query next month can rank or
date results differently) and `publishedDate` is extracted metadata, not an
exchange stamp. That is exactly why the archive step is mandatory: the frozen
evidence is the fetched filing content stored at curation time, with the Exa
query kept as provenance of *how it was found*.

Before Exa can be listed as an approved tool it needs, in-repo:

- `EXA_API_KEY` handling via `.env` (not present today; the agent-layer tools
  the operator already has do not count as an in-app integration).
- An archive writer that stores fetched content immutably (hash + raw text),
  so re-running extraction on the archive reproduces the same events without
  calling Exa again.
- A domain allowlist config, defaulting to exchange/regulator domains; press
  domains only with an explicit flag that marks resulting events
  `source.kind: "news"`.
- A timestamp cross-check: Exa `publishedDate` vs the filing's own timestamp.
  Disagreement beyond a day is a curation error to resolve, never silently
  one or the other.

Until those exist, Exa's honest status is: useful today for a human curator
working outside the app to *find* candidate filings faster; not yet an
approved in-app tool, and its output enters a frozen set only as
`event-record-v1` rows whose `source.ref` is the filing itself.

### What makes a good news/event source (qualification rubric)

A source qualifies for a role, not in the abstract. The roles are:
**Evidence** (can be the `source.ref` of record in a frozen event set),
**Discovery** (finds candidate events that must then be upgraded to an
evidence source), and **Corroboration** (second timestamp/opinion, never
sufficient alone). Properties, in the order this repo should weigh them:

1. **Accountable origin.** A named issuer (exchange, regulator, company under
   disclosure obligation) stands behind the item. Anonymous or rewritten
   aggregation fails this by construction.
2. **Immutable, addressable record.** A stable ID (accession/announcement
   number) whose content does not change silently; corrections arrive as new
   linked items. If the page can be edited in place, it must be archived with
   a content hash at retrieval time or it is not evidence.
3. **Authoritative tradable timestamp.** Publication time (with timezone, to
   the minute or better) is the moment the market could first trade on it,
   kept distinct from event time, update time, and index/crawl time.
4. **Point-in-time fidelity.** Historical queries return what was knowable
   then: no silent backfill, no revised timestamps, versioned corrections.
   A source that "improves" its past breaks lookahead discipline.
5. **Known completeness.** The denominator is knowable: mandated disclosure
   (exchange filings, EDGAR) approaches complete coverage of its class;
   editorial selection (press, wires, search ranking) has unknown missingness,
   which must be treated as selection bias, not ignored.
6. **Entity resolution.** Items map unambiguously to an instrument
   (scrip code, ISIN, CIK) without name-matching guesswork.
7. **Machine readability.** Stable schema or at least stable documents, full
   text available, category/filing-type fields, bulk or API access that does
   not require screen-scraping against terms.
8. **Reproducible extraction.** Same archived input + same extraction rule =
   same events, offline. Live search ranking fails this unaided; archiving
   the fetched documents is what repairs it.
9. **Latency (discovery role only).** Seconds-to-minutes from publication to
   searchable. Irrelevant for evidence, decisive for discovery.
10. **Access and licence.** Cost, rate limits, and whether archiving and
    internal redistribution of the raw item are permitted. A source we cannot
    archive cannot be evidence here, however authoritative it looks.

Candidate assessment against that rubric (judgement at sketch time, to be
re-verified before any approval):

| Candidate | Qualifies as | Why / main gap |
| --- | --- | --- |
| BSE announcements | Evidence | Mandated disclosure, exchange timestamp, stable IDs, scrip-mapped. Gap: programmatic access is unofficial; filing can lag the regulator's own release. |
| NSE announcements | Evidence | Same strengths as BSE. Gap: access friction (session/cookie behaviour) makes archival fetch engineering real work. |
| SEBI orders / RBI circulars | Evidence (regulatory events) | Primary and authoritative. Gap: often date-only timestamps and long lags after the underlying action; the tradable moment is usually the exchange filing. |
| PIB releases (Income Tax / ED / CBI) | Evidence with care | Primary official confirmation with release timestamps. Gap: selective publicity (unknown denominator) and unstructured entity naming. |
| SEC EDGAR (US) | Evidence, gold standard | Accession numbers, accepted timestamps to the second, free API, immutable archive, CIK mapping. The bar other sources are measured against. |
| Company press releases / concalls | Corroboration | Primary but self-timed and self-selected; after-close timing strategy is common. |
| Finnhub company news | Discovery candidate | Already a repo provider family (unused for news today): ticker-tagged, timestamped, API-clean. Gaps: publisher timestamps, selective coverage skewed to US, licence/Redistribution terms to check, India depth unproven. |
| Exa search + fetch | Discovery candidate | Domain/date filters and full-text fetch make filing-hunting fast. Gaps: mutable index and extracted `publishedDate` fail properties 3, 4, 8 unless the fetched filing is archived at curation time. |
| DeepSeek Search + Fetch | Discovery candidate, cheap first pass | Fast, very cheap keyword search over its own index; query operators (`site:`, `after:`, `lang:`), native `date` field when present, and two vendor signals per result — `rerank_score` (0–3) and an `authority` tier (0–4). Those signals are useful *curation filters* (e.g. only review authority ≥ 3), never evidence properties. Gaps: rerank blends freshness in, which works against historical filings; English/India canonical-source recall is unproven and observed to skew toward secondary coverage; companion Fetch is plain extraction (weak on JS pages and PDFs, which exchange filings often are). Best role: cheap wide sweep to nominate candidates that Exa/BSE fetch then verifies. |
| Wires (Reuters / PTI / Bloomberg) | Discovery + corroboration | Fast, professional timestamps. Gaps: licence cost and redistribution/archival restrictions; editorial selection. |
| Press & aggregators (ET, Mint, Moneycontrol, Trendlyne mirrors) | Discovery only | Good recall and human-readable context. Gaps: articles are edited in place, timestamps drift to update time, and mirrors are second-hand — verify against the exchange original before freezing. |
| GDELT | Discovery (research) | Free, bulk, historical, timestamped. Gaps: noisy entity extraction and duplicates; useful for finding candidate windows, never for t0. |
| Yahoo / Eastmoney headline search (vendored toolkit) | Not qualifying alone | Live headline convenience with restrictive terms and no archive guarantee. May corroborate that *something* was reported; cannot anchor an event. |
| Serper / SerpApi (Google SERP + News APIs) | Discovery candidate, strong recall | Google's index is likely the deepest for Indian filings and press; `site:`-style restriction and `tbs` date filters (coarse `qdr:` windows, custom range on web search). Gaps: result dates are often relative ("2 days ago") — the weakest timestamp signal in this table; ranking/index mutable; SERP-scraping terms and licence to store results must be checked before any in-app use; full text needs a separate fetch step. |
| Tavily | Discovery candidate | Agent-oriented search with native `include_domains`, time range, news topic, and content extraction in one call — closest functional peer to Exa. Same ceiling: aggregated/reranked index, extracted dates, mutable. |
| Brave News Search API | Discovery candidate | Own independent index (diversifies away from Google's), dedicated news endpoint with freshness/date filtering. Gaps: domain restriction is weaker (site queries / Goggles), India index depth unproven here. |
| NewsAPI.org / GNews and similar aggregator APIs | Discovery only, weak | Tidy JSON with `publishedAt` and source filters. Gaps: shallow history windows on common tiers, headline/summary rather than full text, publisher timestamps, licence terms that can restrict storage/redistribution, India source list skews to big outlets. |
| Ticker-tagged financial news APIs (Alpha Vantage news/sentiment, Polygon, Tiingo, Benzinga) | Discovery candidate (US-first) | Entity resolution is solved upstream (ticker tags, timestamps), which removes name-matching work. Gaps: US-listed focus, India applicability doubtful, sentiment scores are vendor model output (never evidence), cost. |
| Common Crawl News (CC-NEWS) | Discovery (research), reproducibility outlier | Free immutable bulk dumps: the same dump + same extraction reproduces exactly, which no live search API offers. Gaps: crawl selection unknown, noisy duplicates, historical research aid rather than timely discovery. |
| Self-hosted SearXNG | Discovery candidate (operator-controlled) | No vendor lock or per-query cost; engines and config are ours and versionable. Gaps: inherits upstream engines' mutability and rate-limit behaviour; maintenance is ours. |
| Exchange / regulator RSS and listing pages | Evidence fetch path, not search | BSE/NSE/SEBI/PIB feeds and listing pages are how Evidence-tier items would be *retrieved* programmatically. Judged by the source they carry, not as discovery ranking. |

Among discovery tools the honest differentiators are: whose index (Google via
Serper/SerpApi, Brave's own, Exa/Tavily neural/aggregated), how explicit the
date and domain filters are, whether full-text fetch is built in, and licence
terms for storing what was fetched. None of those differences change the
ceiling: every tool in this group fails the immutable-record and
point-in-time properties until its output is archived by us, at which point
the *archive* — not the tool — becomes the reproducible input.

Rule that falls out of the rubric: **discovery may be wide and sloppy;
evidence may not.** Any tool may nominate an event. Only Evidence-tier
sources may anchor `eventRecord.eventDateTime`, and whatever nominated it is
recorded as provenance, not as proof.

#### Bake-off note (2026-11-04, tools callable in-session)

Same two queries on the Polycab income-tax search (searches began
2023-12-22; CBDT statement 2024-01-10; stock fell ~20% on 2024-01-11),
run through every discovery tool actually available in the operator's
environment. Ground-truth evidence items: BSE clarification sought
2023-12-22 11:30 IST, company intimation 2023-12-22 20:22 IST, company
clarification filing dated 2024-01-10.

- **Natural query, all tools:** press only (Reuters, Mint, Moneycontrol…).
  No tool surfaced a filing without being domain-restricted. Discovery
  queries for this repo must be domain-allowlisted by default.
- **Built-in web search, `site:bseindia.com`:** best result — BSE
  announcement *detail pages* at ranks 1 and 5, with to-the-second
  timestamps in the snippet. Detail pages (stable `newsid`) are the right
  archival target, ahead of raw filing PDFs.
- **DeepSeek Search API:** natural query returned clean structured dates
  (day precision in practice) plus `rerank_score`/`authority`. The
  domain query put the actual 2024-01-10 filing PDF at rank 1 but with
  `date: null` and an uninformative extracted title; ranks 2+ were noise.
  Filing *found*, timestamp *not supplied* — fetch/archival still required.
- **TinyFish search:** good press recall on the natural query; the
  domain-restricted query failed (financial-results PDFs mentioning "income
  tax", no announcement page in the top results, no dates shown).
- **Finnhub company-news (`POLYCAB.NS`):** worked unmodified with the repo
  key and clean epoch timestamps — but returned only 3 items in the window
  and missed the 2023-12-22 first disclosure entirely. Ticker-tagged
  convenience, thin India event coverage. Confirms its Discovery-candidate
  rating and argues against it as the sole nomination source.
- **Not testable in that session** (no keys): Exa, Serper, Tavily, Brave.
  Their table ratings remain unverified judgements, unlike the above.

Design lesson beyond tool choice: this event is a *sequence* — media report
(morning, 22 Dec) → exchange seeks clarification (11:30, during hours) →
company replies (20:22, after close) → regulator quantifies findings
(10 Jan). t0 must anchor on the first *tradable* public timestamp, with
later legs recorded as separate records in the same cluster. A single
"event date" field without that rule would have silently moved this study's
window by three weeks depending on which article the curator read first.

### Event set as a study input

The study takes an **event set**, not a single `subject`:

- Inline table in the run (first slice): pasted rows parsed to
  `event-record-v1` objects, frozen into the StudyPlan params and the run
  artifact. Same input, same events, forever.
- Later slices may load a named, versioned event set from the runtime store.
  Editing a set creates a new version; old runs keep pointing at the old one.

### Study params (`study-plan-v1` additions)

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `events` | event-record array | — | The frozen event set. Required, min 1 to validate, but see headline thresholds. |
| `benchmark` | text | subject's index | Market model regressor (existing param, reused). |
| `estimationWindow` | trading days | 120 | Pre-event window ending 10 trading days before t0, used to fit alpha/beta. |
| `preWindow` | trading days | 20 | Event window start, relative to t0. |
| `postWindow` | trading days | 60 | Event window end, relative to t0. |
| `placebo` | enum: `random-dates` \| `none` | `random-dates` | Control: same entities, random non-event dates, same pipeline. |
| `placeboSeed` | integer | 1 | Seeded, stored in the artifact. Placebo results must be reproducible. |
| `clusterGap` | trading days | 10 | Events for one entity closer than this are one cluster, counted once in hit-rate denominators. |

### Run artifact additions

Per event: resolved symbol, t0 trading day, estimation-window alpha/beta and
observation count, daily abnormal returns t−20…t+60, and exclusion reason if
dropped (no data, window clipped, duplicate cluster). Exclusions are listed,
never silent.

## Computation (Deterministic)

1. **Resolve and align.** For each event, load the entity series and the
   benchmark through existing data paths (bundled snapshot or local backend).
   Align on trading days; suspended/missing days are gaps, not zeros.
2. **Market model.** On the estimation window (default: 120 trading days
   ending 10 before t0), regress entity log returns on benchmark log returns
   (the regression already lives in `app/lib/relativeStats.js`). Expected
   return in the event window is alpha + beta × benchmark return.
3. **Abnormal returns.** AR(t) = actual − expected, per relative trading day.
   CAR(a, b) is the sum of AR over relative days a…b. The holding period is
   an *output* of the backtest, not an input: pre-register the horizon
   *grid and selection rules* (every holding day t+1…t+60, entry at t+1),
   never the winning horizon. All horizons are reported; none is hidden
   because another looked better.
4. **Aggregation.** Mean and median CAR across event clusters, hit rate
   (share of clusters with CAR of the hypothesised sign), and a median
   event-day path (median AR per relative day, the "shape" chart) — each
   computed across the full horizon grid, as a **horizon profile**, not at
   one assumed holding period.
5. **Placebo control.** Repeat the identical pipeline on seeded random
   non-event dates for the same entities, at every horizon. The placebo CAR
   profile is the null the real profile must beat across the holding range;
   it is shown next to the result, not buried.
6. **Recovery.** For negative-shock hypotheses, days from t0 until cumulative
   abnormal return first returns to ≥ 0 (or window end, marked censored).
7. **Horizon discovery, then freeze (two stages).** *Discovery*: read the
   horizon profile — where CAR peaks, where it plateaus, when it decays
   into market risk. A candidate holding period must show a plateau (not a
   one-day spike), agreement between sample halves, and separation from the
   placebo profile over the same range. *Freeze*: that candidate holding
   period becomes part of the frozen signal definition and must then
   survive matured forward evidence (the tracked-trade pattern from options
   validation: pending rows excluded, only matured rows count) before it
   may be called tradable. Discovery proposes; forward tracking disposes.
   This mirrors the existing options validation design, which archives
   rows and measures forward returns at 1/5/10/20/21/63 trading days
   (`app/lib/optionsValidation.js`) rather than assuming one horizon.

No cross-sectional return model, no factor adjustment, and no significance
machinery beyond the placebo comparison in the first slice. Simple, auditable,
and hard to game is the point.

## Metric Registry Entries (Draft)

Domain: `event-study`. Thresholds deliberately stricter than the existing
percentile floor because event samples are easy to over-read:
headline requires ≥ 20 independent event clusters; 8–19 is diagnostic with an
explicit thin-sample caveat; below 8, aggregate metrics are suppressed and only
per-event paths are shown.

| ID | Label | Default | Headline when | Suppressed when |
| --- | --- | --- | --- | --- |
| `event.car_profile` | CAR Horizon Profile, t+1…t+60 | diagnostic | ≥ 20 clusters and placebo profile present | < 8 clusters |
| `event.mean_car_5d` | Mean CAR, t0…t+5 (shock anchor) | diagnostic | ≥ 20 clusters and placebo run present | < 8 clusters |
| `event.candidate_holding_days` | Candidate Holding Period (discovered) | diagnostic | never headlines from backtest alone; headlines only after freeze + matured forward evidence | no plateau, sample halves disagree, or < 20 clusters |
| `event.hit_rate_profile` | Hit Rate by Holding Day | diagnostic | ≥ 20 clusters | < 8 clusters |
| `event.median_recovery_days` | Median Recovery Days | diagnostic | ≥ 20 clusters with a negative t0…t+5 CAR | < 8 such clusters |
| `event.placebo_car_profile` | Placebo CAR Horizon Profile | diagnostic | never headlines; always shown beside `event.car_profile` | placebo disabled by param (which also demotes the real profile to diagnostic) |
| `event.cluster_count` | Independent Event Clusters | headline | always (it is the sample-size truth) | never |

## Worked Example: "Tax Raids Cause Temporary Distortions"

**Natural-language input (Study Builder):**

> Do stocks that get raided by the income-tax department over-fall and then
> recover over the next month?

**Proposal step (Study Factory, read-only today)** would return:

- Existing coverage: none. No current study aligns discrete events.
- Required data: event set with sourced timestamps (`event-record-v1`),
  daily prices for each entity and a benchmark (approved tools exist),
  corporate-actions awareness for splits during windows (exists).
- Missing today: the event set itself. First slice answer: the user curates
  it (exchange filings are the preferred `source.kind`).
- Caveats: raids cluster in stressed sectors and falling markets; entities
  may already be falling pre-event (pre-trend must be visible in t−20…t−1);
  some raids reveal real fraud and never recover — the mean can hide a bimodal
  outcome, which is why the median path and hit rate ship together.

**StudyPlan (after human confirmation of the event set):**

- Benchmark: Nifty 500 (or the sector index, if the hypothesis is sector-pure;
  the choice is frozen in the plan, not toggled after results).
- Windows: estimation 120d, pre 20d, post 60d. Placebo: `random-dates`, seed 1.
- Pre-registered read: the hypothesis predicts negative CAR t0…t+5 (the fall)
  and a recovery *profile* thereafter (the distortion closing). The holding
  period is not pre-chosen; the horizon grid, entry at t+1, and the
  plateau/split-sample selection rules are. Slower frequency is a stated
  constraint (no intraday): t+1 entry is the earliest tradable assumption.

**What each outcome means, decided before running:**

- *Supports the story:* mean CAR t0…t+5 clearly negative vs placebo, median
  path V-shaped, hit rate well above the placebo hit rate, median recovery
  inside ~20 trading days. Next step is a separate tradability slice (entry
  at t+1 open, costs, liquidity), not a trade.
- *Kills the story:* fall is matched by placebo dates (these stocks just fall
  a lot generally), or no recovery within 60 days (repricing, not distortion),
  or the effect is one or two famous events carrying the mean while the median

  is flat.
- *Inconclusive:* fewer than 8 independent clusters survive exclusions. The
  correct output is "sample too thin", with per-event paths still inspectable.

## First Slice Scope

Files, following the existing study pattern:

- `app/lib/eventStudy.js` — pure computation: t0 resolution, alignment,
  market-model AR/CAR, clustering, placebo sampling (seeded), aggregation.
- `app/lib/eventStudyExport.js` — per-event AR table + summary export.
- `app/studies/eventStudy.js` / `eventStudyView.js` / `eventStudyVisuals.js` —
  registry entry, event-table input, median-path chart, per-event small
  multiples, placebo comparison.
- Metric registry: the six draft rules above, in `app/lib/metricRegistry.js`
  and the generated manifest.
- StudyPlan contract: the params table above, with `events` validated as
  `event-record-v1` (source required, t0 rule checked, future events rejected).

Tests required before it counts as implemented:

- Synthetic panel with a planted −5% shock and recovery: engine must recover
  the CAR sign, rough magnitude, and recovery window.
- Synthetic null panel (no planted effect): real and placebo must not separate.
- Lookahead traps: after-close announcement lands on next trading day;
  retroactively edited event set produces a different run artifact version.
- Threshold behaviour: 7 clusters suppress aggregate metrics; 8 demote to
  diagnostic; 20 allow headline.

## Non-Goals (First Slice)

- No news scraping, no automatic event discovery, no LLM event extraction.
- No intraday data or intraday t0 handling.
- No trading simulation, costs, or position sizing. That is a later evidence
  slice, modelled on the tracked straddle ledger, and only for hypotheses
  that survive this one.
- No cross-event factor model (size/value/momentum adjustment).

## Graduation Check

Against the rule in `docs/planned-features.md`:

- User-facing workflow: paste/curate events → confirm frozen set → run → read
  governed verdict next to its placebo. **Yes.**
- Strict data contract: `event-record-v1`, params, artifact additions above.
  **Sketched here;** to be frozen in `docs/` contracts at implementation.**
- Deterministic validation gate: StudyPlan validation + metric registry
  thresholds + placebo requirement for headline status. **Yes.**
- Non-goals: listed above. **Yes.**
- First slice small enough to test in isolation: manual event sets, daily
  data, six metrics, synthetic-panel tests. **Yes.**

