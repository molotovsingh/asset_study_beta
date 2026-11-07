# News ETL Pipeline — Ideal Workflow

## Status

Planned. Design only — no code, no vendor approved, no route yet.

This doc designs the workflow as if perfect vendors exist for every job.
Vendor names come last. Once the workflow and its contracts are fixed,
choosing a vendor becomes filling a named slot against a named test —
not reshaping the product around whatever a tool happens to return.

It serves one consumer first: the [Event Study](event-study.md). Its output
is not "news". Its output is a **frozen, sourced, replayable event set**.

## Design Stance

1. **Vendors are replaceable adapters. The archive is the source of truth.**
   Any vendor can be swapped without changing a past study, because studies
   read our archive, never a live vendor response.
2. **Discovery may be wide and sloppy; evidence may not.** (From the
   qualification rubric in [event-study.md](event-study.md).) Every stage
   below exists to upgrade sloppy nominations into strict evidence, or to
   visibly fail to.
3. **Backfill and live are the same pipeline.** Historical curation (a 2021
   raid) and future live monitoring differ only in how Stage 1 is triggered.
   No second code path to drift.
4. **Humans freeze, machines nominate.** Automation drafts events. A person
   confirms the set that a study runs on. That gate is a feature, not a
   temporary embarrassment.
5. **Start small, scale smart.** One exchange, one event category, one
   discovery path — end to end, replayable — before any breadth. Breadth is
   added as new adapters and categories, never as new pipeline logic.

## The Perfect Vendor Set (Roles, Not Brands)

Assume each role is served perfectly. The workflow names six roles; one
real vendor may fill several, but it is qualified per role, per test.

| # | Role | Perfect version gives us | Fills stage |
| --- | --- | --- | --- |
| R1 | Filing authority | Mandated disclosures with stable IDs, exchange timestamps to the second, scrip/ISIN mapping, full text + attachments, complete denominator | 2, 4 |
| R2 | Regulator / primary source | Orders and releases with publication timestamps, case/entity references | 2, 4 |
| R3 | Discovery search | Domain- and date-filtered search over a deep index, result IDs, best-available dates | 1 |
| R4 | Ticker-tagged wire | Timestamped items already resolved to instruments, for recall cross-checks | 1 |
| R5 | Fetch & extraction | Clean full text / PDF text for any URL the pipeline hands it | 2, 3 |
| R6 | Reference data | Instrument master (scrip ↔ ISIN ↔ ticker history), trading calendar, market close times | 4 |

What "perfect" deliberately does **not** include: sentiment scores,
"importance" rankings, AI summaries, predicted impact. Those are vendor
opinions. The pipeline transports facts with provenance; interpretation
belongs to the study layer.

## Ideal Workflow

```text
0  Watch spec         what counts as an event, for which entities, which window
      |
1  Discovery          R3/R4 nominate candidate documents (recall over precision)
      |
2  Fetch & archive    R1/R2/R5 bytes -> immutable bronze store (hash-addressed)
      |
3  Parse & normalise  bronze bytes -> parsed document (text, fields, attachments)
      |
4  Resolve            entity (R6) + tradable timestamp adjudication
      |
5  Extract            parsed documents -> draft event candidates (rule versioned)
      |
6  Dedupe & cluster   same disclosure across sources; multi-leg sequences
      |
7  Human curation     confirm / reject / needs-upgrade, with reason codes
      |
8  Freeze             versioned event set (gold) -> event-record-v1 rows
      |
9  Study & replay     event study runs on gold; replay re-derives gold offline
```

Side rails at every stage: a provenance record of *how this row came to be*
(query, vendor, rule version, timestamps), and quality monitors (Stage
"Quality Gates" below). A row without provenance does not advance.

### Stage 0 — Watch spec (`watch-spec-v1`)

The explicit question the pipeline is answering. Written before any search,
stored with every downstream row.

```json
{
  "version": "watch-spec-v1",
  "watchId": "in-tax-raids-2019-2026",
  "hypothesisRef": "study-proposal id or free-text story",
  "category": "tax-raid",
  "inclusionRule": "IT/ED search or survey at listed co. premises, publicly disclosed",
  "exclusionRule": "Routine assessment notices; promoter-personal matters with no co. filing",
  "entityScope": "NSE/BSE listed, point-in-time membership",
  "window": { "from": "2019-01-01", "to": "2026-12-31" },
  "discoveryPlan": [
    { "role": "R3", "queryTemplate": "\"income tax\" search {company}", "domains": ["bseindia.com", "nseindia.com", "pib.gov.in"] },
    { "role": "R1", "listingScan": "BSE announcements, category text match" }
  ]
}
```

The inclusion/exclusion text is the anti-cherry-picking device: borderline
cases are decided against a rule written before results were seen.

### Stage 1 — Discovery (`discovery-hit-v1`)

Recall over precision. Inputs: watch spec. Modes: backfill sweep
(domain-allowlisted queries per entity/period), listing scan (R1 category
pages), wire cross-check (R4), and manual nomination (a pasted URL is a
first-class hit with `discoveredBy: "manual"`).

Output per hit: `watchId`, vendor + result ID, URL, vendor date (labelled
as vendor-claimed), query/filter snapshot, `retrievedAt`. A hit asserts
nothing except "worth fetching". Open-web (non-allowlisted) queries are
permitted but their hits are born flagged `needs-upgrade`.

### Stage 2 — Fetch & archive, bronze (`archived-document-v1`)

Fetch the document itself — for BSE, the announcement **detail page**
(stable `newsid`, to-the-second stamp) with the filing PDF as attachment,
per the Polycab bake-off in [event-study.md](event-study.md).

```json
{
  "version": "archived-document-v1",
  "documentId": "sha256 of canonical bytes",
  "sourceRole": "R1", "sourceKind": "exchange-filing",
  "sourceRef": "BSE newsid / EDGAR accession / PIB release id",
  "url": "final URL after redirects",
  "fetchedAt": "2026-11-04T09:14:00+05:30",
  "http": { "status": 200, "contentType": "text/html" },
  "blobPath": "news/bronze/ab/cd/<documentId>.html",
  "attachments": [ { "documentId": "sha256…", "role": "filing-pdf" } ],
  "discoveryHitIds": ["…every hit that led here, none are evidence…"]
}
```

Bronze rules: write-once, content-addressed, never edited. A refetch that
returns different bytes creates a new document linked to the old — that is
how silent upstream edits become visible instead of corrupting history.

### Stage 3 — Parse & normalise, silver (`parsed-document-v1`)

Deterministic transforms over bronze only: HTML/PDF → text, headline,
stated timestamps (all of them, labelled: published / event / updated),
stated entity names and codes, filing category, attachment text. Parser
name + version recorded. Re-running a newer parser creates a new silver
version; bronze never changes. No LLM in this stage — parsing must replay
byte-identically.

### Stage 4 — Resolve entity and timestamp

Two adjudications, both rule-based, both emitting evidence for the curator:

- **Entity**: stated scrip/ISIN/CIK (R6) > exchange page context > name
  match. Name-only matches are flagged low-confidence and cannot auto-pass.
  Resolution is point-in-time (ticker/ISIN as of the event date).
- **Tradable timestamp**: filing stamp (R1) > regulator stamp (R2) >
  publisher stamp > vendor-claimed date. The winner sets the draft
  `eventDateTime`; losers are kept. Disagreement > 1 day between any two
  is a `timestamp-conflict` flag, never a silent choice. The t0 trading-day
  rule from `event-record-v1` is applied here using R6 calendar data and
  shown to the curator, not buried in computation.

### Stage 5 — Extract event candidates (`event-candidate-v1`)

Versioned deterministic rules first (filing category + keyword patterns on
silver text), LLM assistance only as a *second* drafter whose output is
stored separately and never overwrites the rule output. Each candidate
carries: draft `event-record-v1` fields, `documentIds` it rests on,
`extractionRunId`, rule hits (matched text spans, so a human sees *why*),
and quality flags (`needs-upgrade`, `timestamp-conflict`,
`entity-low-confidence`, `press-only`). This stage, with its run record,
is the `news-evidence-extraction-v1` contract the Study Factory names:
query, document IDs, timestamps, extracted labels, rule version, confidence.

### Stage 6 — Dedupe & cluster

- **Same disclosure, many copies**: BSE + NSE + mirror of one filing →
  one candidate, all documents attached, R1 copy primary. Keys: sourceRef,
  then normalised headline + entity + timestamp bucket, then text hash.
- **Multi-leg sequences**: media report → exchange query → company reply →
  regulator quantification (the Polycab shape) → separate candidates in one
  `clusterId`, ordered. t0 anchors on the first *tradable* leg. Clustering
  never merges legs into one date.

### Stage 7 — Human curation gate

A queue, not a form. States: `nominated → archived → drafted →
confirmed | rejected | needs-upgrade`. The curator sees, per candidate:
archived source text, matched spans, all candidate timestamps with the
adjudication winner marked, entity evidence, cluster view, and the watch
spec's inclusion rule. Decisions carry reason codes (`not-an-event`,
`duplicate`, `wrong-entity`, `press-only-unupgraded`, `out-of-scope`).
Rejections are kept — the rejected pile is what proves the confirmed pile
was not cherry-picked.

### Stage 8 — Freeze (`event-set-v1`)

Confirmed candidates → a named, versioned, immutable set: `setId`,
`version`, `watchId`, ordered `event-record-v1` rows, counts (confirmed /
rejected / excluded with reasons), content hash over the rows, frozen-at
timestamp, curator identity. Editing means a new version. Studies cite
`setId@version`; the run artifact stores the hash.

### Stage 9 — Study & replay

The event study consumes gold only. Replay test: with network off and
vendors deleted, re-running Stages 3–8 from bronze + recorded rule
versions must reproduce the identical `event-set-v1` hash. If it cannot,
the set was never really frozen.

## Storage Shape (Local-First, Following Repo Patterns)

- Blobs: `data/local-cache/news/bronze/` (content-addressed files,
  git-ignored like the existing cache). Bytes never go in SQLite.
- Rows: a new `scripts/runtime_store_news.py` behind the existing
  `runtime_store` facade, same pattern as `runtime_store_options.py`.
  Tables: `news_watch_specs`, `news_discovery_hits`, `news_documents`
  (bronze), `news_parsed_documents` (silver), `news_event_candidates`,
  `news_extraction_runs`, `news_event_sets`, `news_event_set_items`,
  `news_curation_decisions`.
- Idempotency: `documentId` = content hash; hit key = (vendor, result ID);
  candidate key = (cluster root document, category, rule version). Every
  stage is safely re-runnable; re-runs append versions, never mutate.
- Vendor adapters: `scripts/providers/news/<vendor>.py`, each implementing
  only the roles it fills — `discover(watch)`, `fetch(url)`,
  `poll(cursor)` (later), `health()` — routed like `scripts/providers/router.py`.
  Adapter output is validated against the stage contract before storage;
  a vendor field that has no contract home is dropped, not improvised in.

## Quality Gates

| Gate | Test | Blocks |
| --- | --- | --- |
| Archive completeness | Every confirmed candidate rests on ≥1 Evidence-role bronze doc | Freeze |
| Timestamp integrity | No unresolved `timestamp-conflict` in a frozen set | Freeze |
| Golden recall | Pipeline rediscovers the golden corpus (below) end to end | Vendor approval, rule changes |
| Replay | Offline re-derivation reproduces the set hash | Freeze |
| Precision sample | Curator-audited sample of auto-drafted candidates per rule version; error rate reported, not hidden | Rule promotion |
| Coverage honesty | Per watch: hits → archived → drafted → confirmed funnel with rejection reasons, exported with the study | Study headline |

**Golden corpus**: a small hand-verified set (start: Polycab 2023–24 plus
5–10 known raids/orders with hand-checked filing timestamps). It is the
regression test for every vendor, parser, and rule change — the same role
the planted-shock synthetic panel plays for the study engine.

## Vendor Qualification, Derived From The Workflow

A vendor is approved **for a role** by passing that role's test:

- **R3 Discovery**: on golden-corpus queries (domain-allowlisted), surfaces
  the R1/R2 document URL in top results. Ranking quality beyond that is a
  cost/convenience question, not a trust question.
- **R1/R2 fetch path**: returns stable IDs and to-the-minute stamps;
  archival licence permits storing raw bytes. Access method must not
  require violating source terms.
- **R5 Fetch**: extracted text matches the archived bytes it was given
  (it is a convenience over Stage 3, never a substitute for bronze).
- **R4 Wire**: timestamp + entity precision measured on the golden corpus;
  used for recall cross-checks, its misses are informative, not fatal.

Measured so far (see bake-off in [event-study.md](event-study.md)):
domain-restricted search *can* fill R3 for BSE; no tested tool fills R1's
timestamp role; Finnhub is a weak R4 for India. Untested tools stay
unapproved until run against the corpus — including ones already paid for.

## Start Small, Scale Smart

Each step is end-to-end usable and leaves the next step as pure addition.
No step requires a later step's vendor.

| Step | Scope | Proves | Explicitly not yet |
| --- | --- | --- | --- |
| 0. Manual archive | Curator pastes BSE detail-page URLs; Stages 2–4 + manual candidate entry; freeze by hand | Bronze/silver contracts, hash replay, `event-set-v1` shape | Any search vendor, any auto-extraction |
| 1. One category, assisted | `tax-raid` watch spec; domain-allowlisted discovery (one R3 adapter); deterministic extraction rules v1; curation queue (CLI or minimal UI) | Full funnel on one category; golden corpus recall | NSE dedupe, other categories, LLM drafting |
| 2. Second exchange + sequences | NSE adapter, cross-exchange dedupe, multi-leg clustering | One disclosure counted once; Polycab-shaped sequences handled | Live polling, US filings |
| 3. Category library | New categories as new watch specs + rule versions only (orders, pledges, auditor exits…) | Breadth without pipeline change — the scaling claim itself | Auto-confirmation at any confidence |
| 4. Live mode | Same pipeline on a schedule: `poll()` adapters, new-hit alerts into the curation queue | Forward event sets with zero lookahead by construction | Trading integration, sentiment, auto-trade |

Step 0 is deliberately unglamorous and is the whole bet: if hand-fed URLs
cannot produce a replayable frozen set, no vendor will save the design.
If they can, every vendor after that is an optimisation of Stage 1.

## Non-Goals

- No real-time trading feed, alerting-to-trade, or latency work.
- No vendor sentiment, summarisation-as-evidence, or impact scoring.
- No auto-confirmation: extraction confidence never bypasses Stage 7.
- No open-web crawling beyond watch-spec allowlists.
- No storing what a source's terms forbid storing. A source we cannot
  archive stays Discovery-only, however good it looks.

## Open Decisions (Resolve Before Step 0 Code)

1. **BSE fetch method**: which endpoints/headers are terms-compliant for
   archival fetch of detail pages + PDFs, and at what rate?
2. **PDF text extraction**: which local library owns Stage 3 PDF parsing
   (must be deterministic and version-pinnable)?
3. **Category seed list**: is `tax-raid` alone the right Step 1, or does
   the golden corpus need a second, cleaner category (e.g. SEBI orders) to
   keep recall honest?
4. **Curation surface**: CLI report first, or minimal in-app queue? (The
   contracts are identical; this is purely where curator time is spent.)

## Graduation Check

Against the rule in [planned-features.md](../planned-features.md):

- User-facing workflow: watch spec → discovery → curation queue → frozen
  set → study. **Yes.**
- Strict data contract: `watch-spec-v1`, `discovery-hit-v1`,
  `archived-document-v1`, `parsed-document-v1`, `event-candidate-v1`,
  `event-set-v1`, reusing `event-record-v1`. **Sketched here; freeze in
  `docs/` contracts at Step 0.**
- Deterministic validation gate: archive completeness, timestamp
  integrity, golden recall, offline replay. **Yes.**
- Non-goals: listed above. **Yes.**
- First slice small enough to test in isolation: Step 0, hand-fed URLs,
  no vendor dependency. **Yes.**
