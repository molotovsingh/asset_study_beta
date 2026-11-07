# Live Alignment Interview — News DB & ETL

Started: 2026-11-07
Purpose: Align on how filings and news become trustworthy, timestamped event records for event studies. Deferred from the first interview (D04, `alignment-interview.md` Q23) and scoped by the problem list in `docs/research/probes/2026-11-07-polycab-and-data-feasibility/README.md` (D54).

During this interview, do not edit canonical artifacts. Record questions, answers, tensions, and later-edit candidates here only.

## Interview Protocol Notes

- Default mode: user asks one alignment question at a time; the agent answers and records the Q&A.
- Reverse interview mode: the agent asks the user one question at a time to expose missing assumptions and decisions.
- Consolidation mode: the agent summarizes confirmed principles, tensions, open decisions, and recommended edits without applying them.
- Log location: `docs/alignment/news-etl-interview.md`, chosen by the agent to sit beside the first interview log. Decisions go into the same `decision-register.md`, continuing the ID sequence, under News areas.
- Canonical artifacts frozen during this interview: `docs/planned-features/news-etl-pipeline.md`, `docs/planned-features/event-study.md`, all schemas and contracts under `docs/`, all code under `app/` and `scripts/`, and the probe note.
- Style carried over from the first interview: one short plain-language question per turn, each with the agent's recommendation.
- Standing rule D53 applies: no new machinery without a demonstrated reason from the probe.

## Starting Context (already decided elsewhere)

- **Boundary with the study (first interview):** a study receives event records with a first-public timestamp, a source reference and provenance, plus a coverage report (D18, D19, D44). Fetched news only nominates events. Critical fields (event validity, issuer, first-public time) are verified per event (D50).
- **Deferred design (D04, never accepted):** vendor-agnostic; our archive is the source of truth; discovery may be loose, evidence must be strict; start with hand-fed BSE links.
- **Problems found by the probe (D54):**
  1. Leg-1 exchange timestamps need BSE/NSE announcement metadata; the BSE API blocks scripts; NSE archive filenames are not first-public times.
  2. Events are multi-leg; leg identification and clustering are needed before any aggregate.
  3. Yahoo drops real index trading days; the benchmark should come from NSE `ind_close_all` or be checked against it.
  4. Yahoo erases merged names and pads suspended names with zero-volume stale prices; point-in-time work needs NSE bhavcopy including BE/BZ series.
  5. F&O membership and ban status change around events; they are available from NSE archives by date.
  6. Discovery search is recency-biased; a census needs exchange category listings, not search engines.

## Mode Shift - Reverse Interview

The agent will now ask one question at a time to expose assumptions, ownership decisions, constraints, and unresolved tensions.

Triggered by user: "yes" (2026-11-07), accepting the recommendation to run this interview before building the data-sources registry.

Status: Draft until the user accepts a consolidation.

## Side Question - Does the frontend match the study-builder ambition? (user-led)

**Question:**
User (verbatim): "am curious about one thing the front end design does it match the ambition of a study builder ?"

Asked while Q1 (what the news store is for) was pending. Q1 remains open.

**Answer / Reasoning:**
Checked the running app (dev server on the research branch, screenshots of the home view and `#settings/study-builder`, and one "Draft without AI" run with the built-in example) plus the code.

Partly. It matches a **study launcher**, not yet a **study builder for new ideas**.

What matches the ambition:
- Plain-text request → the app picks a study → shows the setup (plan JSON, link, details) → "Open and check data". AI never runs anything; a confirmation is required; saved studies are kept as "setup, not evidence". This is the non-executing, checked-before-run shape the first interview wanted (D15–D17).
- Calm, consistent visual design; provenance shown on the study page (source policy, retrieval method, freshness).

Gaps against the ambition:
1. **The front door is a catalog, not a question.** Home is "Active Asset + pick one of the fixed studies". The builder sits under **App Settings**, beside Automations and Run History.
2. **It can only map to studies that already exist** (risk, rolling returns, SIP and so on). A new idea like "do raids cause temporary dislocations" has nowhere to go. The Study Factory, which judges new ideas (coverage, missing tools, caveats), exists as a backend API (`/api/study-factory/proposal`) and contract, but **has no screen**.
3. **No clarifying questions.** It is one-shot: sentence → plan. D15/D16/D45 call for 3–5 short questions first.
4. **The read-back is mostly JSON.** D16 wants a plain-language plan with the defaults explained.
5. **One asset at a time.** "Active asset carries across studies" assumes a single subject (plus a benchmark). Event studies are many stocks across many dates.
6. **The data check happens after opening the study.** That is fine for the existing studies; event studies need feasibility before the plan is locked (D16).

**Architecture / Initiative Impact:**
Out of Scope (for this news interview), Later Edit Candidate

**Decision / Tension:**
None decided. Tension: the product's front door (catalog plus single asset) does not match the stated ambition (plain-language question → new study). Per D53, no redesign until a real event study exists to put behind it.

**Later Edit Candidate:**
A separate frontend alignment, after the first event study works: promote "ask a research question" to the front door; surface the Study Factory proposal step; add the clarifying-question turn and a plain-language read-back; support multi-entity (event-set) subjects. Not applied.

## Side Question - Does a news ETL exist? (user-led)

**Question:**
User (verbatim): "tell me if news etl exists ?"

**Answer / Reasoning:**
No, not in this repo. Checked read-only:
- **asset_study_beta:** only design and contracts. `docs/planned-features/news-etl-pipeline.md` is a sketch. `app/studyFactory/studyProposal.js` names a "News/event source archive" requirement and flags `news` as a missing tool kind. No code fetches, stores or parses news; the only other "news" mentions are in tests of that proposal logic.
- **Elsewhere on this machine:** `/Users/aksingh/agents/news_agent` (mesh peer `news_agent@login`) is a **web-research service agent**, not an ETL. It answers research requests from other agents with cited digests saved in a `research/` library (strict citation, dating and "honest null" rules). Its only data pipeline is an LLM price-history log. It has no filing ingestion, no event records and no immutable archive. It could serve as a *discovery* worker (nominating events, with citations), not as the evidence store.
- The probe scripts from D54 are one-off checks, not a pipeline.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: the news ETL is greenfield. Possible reuse: `news_agent` as a discovery worker on the mesh (to discuss in this interview).

**Later Edit Candidate:**
None.

## Protocol Note - Is this designing the news ETL? (2026-11-07)

User asked (verbatim): "are we going into desining of the news etl ?"

Answer recorded: yes, but at the alignment level only. This interview settles *what* the news ETL must do and must not do (purpose, sources of truth, timestamps, archive, verification, scope limits), as decisions in the register. It does not produce code, schemas or tooling. Building anything needs a separate explicit request, and D53 still applies (no machinery without a demonstrated reason). The interview was deferred from the first interview (D04) and scoped by the probe's problem list (D54). Super also noted a News DB is not a prerequisite for a hand-fed first event set, so pausing is a valid choice. Q1 remains open pending the user's choice to continue.

## Side Question - News primitives must not be vendor-driven (user-led)

**Question:**
User (verbatim): "see the news primitives should not be vendor driven , u see the problem i am hinting at"

Raised after the agent proposed a hand-fed POC and said its failure list "should shape the news ETL".

**Answer / Reasoning:**
Yes. The agent's last two turns fell into it. The probe's problem list is mostly **vendor behaviour**: the BSE API returns 403, NSE filename times are upload times, Yahoo drops index days and pads stale prices, search engines favour recent pages. If that list shapes the ETL, the primitives inherit one vendor's quirks. For example, a "first-public time" designed around NSE filenames, or a design that works around BSE being blocked. Change vendor, and the design is wrong.

The fix is to separate two things:
1. **Primitives come from what an event study needs to know**, and are stated without naming any vendor.
2. **Vendors are adapters that fill those primitives**, and each one's quirks are recorded as limitations in the data-sources registry (D37, D40), never as fields or rules in the primitives.

Draft vendor-neutral primitives (agent proposal, not decided):
- **Event:** something that happened to an issuer, of a plain type (D09).
- **Disclosure (leg):** one moment when information about the event became public. An event has one or more, ordered.
- **Public-time claim:** when a disclosure became public, with its **precision** (minute / day), its **basis** (exchange stamp, regulator release, press report, company letter date) and its **confidence**. Several claims may conflict; none is assumed true because of who supplied it.
- **Evidence document:** a saved, hash-identified copy of a source, with retrieval time.
- **Issuer identity at the time:** who the company was on that date (renames, mergers, listing series).
- **Verification:** who checked the critical fields, against what evidence (D50).

Re-reading the probe's six problems through this lens: problems 2 (multi-leg) and the timestamp-basis part of 1 are **primitive needs**. Problems 3–6 and the BSE/NSE specifics of 1 are **vendor limitations** for the registry.

**Architecture / Initiative Impact:**
Tension, Open Decision

**Decision / Tension:**
Tension recorded: the agent's proposed sequencing (let vendor failures scope the ETL) would make primitives vendor-driven. Open: define vendor-neutral primitives first, and record the hand-fed POC events in them, so the POC tests the primitives rather than the vendors.

**Later Edit Candidate:**
In news-etl-pipeline.md: state the primitives without vendor names; move vendor-specific behaviour into the data-sources registry. Not applied.

User confirmed (verbatim): "yes"

Decision recorded as D55: news primitives are defined from what an event study needs and named without vendors; vendors are adapters that fill them; vendor quirks live in the data-sources registry as limitations. Sequencing: settle the primitives first, then record the hand-fed POC events in them, so the POC tests the primitives, not the vendors. The pending Q1 ("what is the news store for") is replaced by a question about the primitive list itself.

## Q1 - Is the building-block list right?

**Question:**
Are the six building blocks (Event, Disclosure, Public-time claim, Evidence document, Company identity on that date, Verification) the right list? Recommendation: add a seventh, Search record (what was searched, where, when, what came back, including empty results), because coverage cannot be stated without it (D19, D44). Event types stay in their own registry (D46).

**Answer / Reasoning:**
User answer (verbatim): "lets start there then as we learn more about api documentaion and richness we will learn"

Accepted provisionally: seven building blocks, to be refined as source documentation is studied.

Guardrail so this stays consistent with D55: richer sources may add **optional detail** (finer time precision, extra identifiers, attachments) or show that a block is missing. They must not change what a block *means*, or make a block depend on one vendor's shape.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed (provisional): seven vendor-neutral building blocks: Event, Disclosure, Public-time claim, Evidence document, Company identity on that date, Verification, Search record.

**Later Edit Candidate:**
State the seven blocks in news-etl-pipeline.md, vendor-free. Not applied.

## Q2 - Conflicting public-time claims

**Question:**
When two claims about when a disclosure became public disagree, which counts? Recommendation: (1) the earliest time backed by a saved document showing the information was actually public then, whoever supplied it; (2) a document's own date alone does not count (it shows when it was written, not released); (3) precision travels with the time, and if only the day is known, that trading day is the earliest possible start, so entry is never before release; (4) unresolved conflicts block the event from the frozen set until checked (D50). Polycab: 22 Dec, market hours (press stamp 12:22, price move by 11:50); the letter date and the NSE upload time are kept as supporting claims.

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. Note for the build: with entry at the close of the first trading day after t0 (D03), a day-only time is safe against lookahead whether the release was before or after the close. What it can blur is the event-day reaction, which should be labelled with the time's precision.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: public time = earliest evidenced release time, source-agnostic; document dates alone do not count; precision is recorded and day-only times are treated as the earliest possible start; unresolved conflicts block freezing.

**Later Edit Candidate:**
Add the rule to the Public-time claim block in news-etl-pipeline.md and to the event-record definition in event-study.md. Not applied.

## Q3 - Where evidence documents live, and whether they can be published

**Question:**
Recommendation: source documents stay on the local machine outside git; the repo keeps only reference, content hash, retrieval time and extracted facts; reruns look up local copies by hash and report missing copies instead of silently re-fetching.

**Answer / Reasoning:**
User answer (verbatim): "i am not qualified to assist u here"

Recorded as a delegation, not as agreement. Agent decision: adopt the recommendation. It is the conservative and reversible choice. Keeping copies private can later be relaxed per source; publishing cannot be undone. The licensing reasoning is precautionary, not a legal opinion: redistribution terms vary by source and were not reviewed for each one.

Companion technical decision, delegated on the same basis (identity anchor):
- **Company identity on a date:** anchored on ISIN, with the exchange symbol, trading series (EQ / BE / BZ …) and company name recorded *as of that date*. Renames and symbol changes keep the same anchor. When a corporate action issues a new ISIN, the link between old and new is recorded explicitly, never inferred from the name.

Protocol adjustment: questions that are purely technical will be decided by the agent and reported, logged as delegated. The user is asked only for judgement calls (scope, risk appetite, what counts as success, how much of the user's time to spend).

**Architecture / Initiative Impact:**
Confirmed (by delegation)

**Decision / Tension:**
Delegated to agent: evidence documents stay local, with the repo holding references, hashes and extracted facts only; company identity anchored on ISIN with date-stamped symbol/series/name and explicit links across ISIN changes.

**Later Edit Candidate:**
Add both rules to news-etl-pipeline.md (Evidence document, Company identity blocks). Not applied.

## Q4 - How much of the user's time the POC takes

**Question:**
Agent researches and prepares each event with evidence; user reviews a short sheet (about a minute per event). Start with 10 raids; go to 20 only if the first 10 go smoothly. Does that fit?

**Answer / Reasoning:**
User answer (verbatim): "time is secondary for now , lets get something working also its not an hft game and throwness and accuracy are top desired properties ,but no over egnineering just because of the top properties"

Read as: time is not the constraint; **thoroughness and accuracy** are the top properties; but they must not become an excuse for over-engineering (consistent with D53). The user still reviews each event's critical fields (D50). "lets get something working" is taken as the instruction to pause this interview and build the hand-fed POC.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: POC priorities are thoroughness and accuracy over speed, with plain artifacts (scripts, one event file, one review sheet) and no framework or app code. Start with 10 raids; user reviews every event.

**Later Edit Candidate:**
None.

## Interview Paused - 2026-11-07

Paused at the user's instruction to "get something working". Settled so far: D55 (vendor-neutral primitives), D56 (seven building blocks), D57 (public-time rule), D58 (evidence stays local), D59 (ISIN identity), D60 (POC priorities). Resume after the POC, with its findings. Open for later: discovery workers (e.g. `news_agent` on the mesh), search-record detail, and coverage estimation.

## Protocol Note - Earlier sketches dropped (2026-11-07)

User ruling (verbatim, on PR #62): "1 yes delete 2 drop them too", following "vol stuff needs works from scratch i dont want that to persist in the codebase".

`docs/planned-features/event-study.md` and `docs/planned-features/news-etl-pipeline.md` (sketches from 4–5 Nov, partly superseded by later decisions: the soft/hard 2×2, the 8/20 suppression thresholds, and a vendor-named pipeline) were removed from the branch, with their index rows. They do not land on `main`. When either is needed, it will be rewritten from the decision register (D01–D61) and the probe findings, not restored. References to them elsewhere in this log and in `alignment-interview.md` are historical; their "Later Edit Candidates" now apply to the rewrite. Also lost with them: the Polycab discovery-tool bake-off write-up and the news-source qualification rubric. The probe notes keep the measured findings.
