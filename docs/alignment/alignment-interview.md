# Live Alignment Interview

Started: 2026-11-05
Purpose: Fear-and-greed via news as a slower-frequency, tradable signal class — filing-sourced event signals (soft/hard fear, soft/hard greed), holding period discovered by backtest, then frozen and forward-tracked.

During this interview, do not edit canonical artifacts. Record questions, answers, tensions, and later-edit candidates here only.

## Interview Protocol Notes

- Default mode: user asks one alignment question at a time; the agent answers and records the Q&A.
- Reverse interview mode: the agent asks the user one question at a time to expose missing assumptions and decisions.
- Consolidation mode: the agent summarizes confirmed principles, tensions, open decisions, and recommended edits without applying them.
- Log location chosen by agent at user request ("u decide"): `Alignment Interview.md` in repo root, per skill rule.
- Canonical artifacts frozen during interview: `docs/planned-features/event-study.md`, `docs/planned-features/news-etl-pipeline.md`, all schemas/contracts under `docs/`, all code under `app/` and `scripts/`.
- Reference materials: `docs/planned-features/event-study.md`, `docs/planned-features/news-etl-pipeline.md`, `app/lib/optionsValidation.js` (existing forward-horizon validation pattern).

## Retroactive Capture — 2026-11-05 Session (pre-interview)

Interview started late in this session. The following were established in conversation *before* interview mode and are recorded here as context, not as live Q&A. They remain open to correction in the interview.

- Signal class in focus: **fear and greed via news**, expressed through filing-sourced events.
- Working 2×2: soft fear (unquantified, overreaction → recovery), hard fear (confirmed damage → repricing), hard greed (quantified good news → drift), soft greed (vague narrative → spike and fade). Hardness — numbers, counterparty, obligation vs intention/exploration — is the proposed discriminator.
- Frequency constraint: **no intraday / no HFT**. Slower frequency only; edge must be judgement over days, not speed.
- Holding period: **an output, not an input**. Backtest over a pre-registered horizon grid (entry at t+1) produces a horizon profile per signal; a candidate holding period must show a plateau and split-sample agreement, then is frozen into the signal definition and must survive matured forward evidence before being called tradable. (This was already edited into `event-study.md` before interview mode froze it.)
- News pipeline: ideal vendor-agnostic workflow designed in `news-etl-pipeline.md` (watch spec → discovery → immutable archive → resolution → extraction → curation → freeze → replay). Discovery may be sloppy; evidence may not. Start small: hand-fed BSE URLs first.
- Vendor findings so far: domain-restricted search can find BSE filings; no tested tool can authoritatively date them; Finnhub India event coverage measured thin; Exa/Serper/Tavily/Brave untested.

## Mode Shift - Reverse Interview

The agent will now ask one question at a time to expose assumptions, ownership decisions, constraints, and unresolved tensions.

Triggered by user: "reverse continue from todays session, we should have started this earlier" (2026-11-05).

Status: Draft. Decisions below are Draft until user explicitly accepts a consolidation as Final.

## Q1 - Success criteria for capital

**Question:**
What would a fear/greed-via-news signal have to show before you would actually put capital on it — as opposed to calling it an interesting research result and leaving it in the lab?

**Answer / Reasoning:**
User answer (verbatim): "the signal must qualify the normal trading criterin ; entry exit rules , p-test etc , profit factor , success/failure ratio etc. research a bit"

Researched "normal trading criteria" (practitioner and event-study sources, 2026-11-05). Qualification is three layers, all required; passing one layer does not compensate for failing another:

1. **Complete trade definition** — trigger, entry rule (earliest t+1, slower frequency), exit rule (discovered holding period plus thesis invalidation if a soft-fear event converts to hard fear), universe/liquidity filter, position sizing, and costs/slippage assumptions. No complete rule, no backtest counts.
2. **Economic performance after costs** — expectancy per trade > 0, where expectancy = (win rate × avg win) − (loss rate × avg loss); profit factor = gross profit / gross loss (practitioner bands: <1.3 weak, ≥1.5 acceptable, ≥2.0 strong); success/failure read jointly as win rate *and* payoff ratio (avg win / avg loss), never win rate alone; max drawdown and a risk-adjusted ratio (Sharpe/Calmar) reported beside returns; average trade large relative to assumed costs, stressed at 2× costs.
3. **Statistical credibility** — significance test appropriate to event studies (BMP standardised cross-sectional test preferred as headline because event-induced variance makes Patell over-reject; cross-sectional t and sign/rank tests as robustness); placebo distribution as empirical null (already in this repo's design); multiple-testing discipline across horizons, quadrants, and categories tried (deflated Sharpe ≥0.95 and PBO <0.5 are the reference concepts). Practitioner sample guidance: ~30 trades absolute floor, 100+ for expectancy to be meaningful, 200+ for profit factor to stabilise. A p-value <0.05 alone is a research result, not a tradable signal.

Robustness cross-checks before capital: split-sample agreement, plateau across neighbouring holding periods (not a one-day spike), result survives removing the best few events, and matured forward evidence after freeze (repo's options-validation pattern).

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: capital requires the full normal trading qualification — complete entry/exit rules, after-cost expectancy/profit factor/payoff, event-study-appropriate significance, multiple-testing discipline, and forward matured evidence. Tension identified for Q2: practitioner sample bars (100+ trades) vs the scarcity of any single Indian event category (e.g. tax raids may yield only tens of clusters). How the bar is applied to scarce events is not yet decided.

**Later Edit Candidate:**
Add a "signal qualification scorecard" (the three layers above, with thresholds) to the event-study plan and metric registry draft as the gate between research headline and tradable signal. Not applied during interview.

**Potential Open Decisions:**
- Whether the 100+ sample bar applies per category, pooled across fear/greed categories, or via a probationary tier (Q2).
- Exact numeric thresholds for profit factor, expectancy, and drawdown at each tier.
- Whether deflated Sharpe / PBO are computed formally or approximated via placebo + trial counting in the first slice.

## Protocol Note - Research Tooling (2026-11-05)

User reminded: "are u aware that exa search is avilable for research"

Recorded as a protocol note, not a Q&A entry. Preference going forward: use Exa search for research where the active harness exposes it (deep / structured search for canonical sources), because earlier vendor evaluation found Exa's domain/date filters and fetch best suited to filing-oriented research. Q1 research in this session used the Muse built-in web search; the Exa-native tool (`exa_search`, listed in the pi tool environment) is not callable from this Muse toolset. If the user wants Q1's trading-criteria research re-run or deepened via Exa, run it from pi or explicitly request a re-run when Exa is callable.

**Architecture / Initiative Impact:**
Out of Scope

**Later Edit Candidate:**
None. Tooling preference only. Q2 (sample-size bar: tiered/probation vs strict per-category vs loose) remains open and unanswered.

## Protocol Note - Simpler Questions (2026-11-05)

User asked: "can u simplfy the above with one q at a time ?"

Going forward: one short, plain-language question per turn, with no option lists unless asked. Q2 is being re-asked as smaller questions. Also noted: `exa_search` is now callable in the pi harness, so Exa is the default research tool from here.

## Q2 - Is a small sample enough for small capital?

**Question:**
A single event type like tax raids may only give 20–30 past cases. Is that enough history for you to trade it with a small amount of money?

**Answer / Reasoning:**
User answer (verbatim): "capital deployed and position sizing deserve its own robust methodology from the study i feel. get the signal right with an assumed virtual money deployment and then worry about how much money and position sizing . plus it also depends on whether the asset if stocks or leveraged futures or options contract and also liquidity in those contracts etc"

The user rejected the question's premise. Signal validation and capital deployment are two separate problems:

1. **Signal study** uses an assumed virtual deployment, a standard notional per trade, so every event counts equally. It answers one question: is there a real, repeatable, after-cost edge, and over what holding period?
2. **Deployment methodology** is its own later study. It covers how much capital to use, position sizing, and the choice of instrument (cash equity, leveraged futures, options) under each instrument's liquidity constraints.

Implication: the probation tier proposed in the earlier Q2 options (small capped capital) is out of the signal study. The sample-size question still matters, but only for signal credibility, not for capital.

Note on the instrument: the instrument changes the payoff shape (options), the leverage and margin path (futures), and costs and capacity (liquidity). So the deployment study may also need to re-check economics per instrument. A signal can be real in the cash market and still not be tradable through F&O.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: the signal study evaluates the edge under a virtual, uniform-notional deployment. Sizing, capital, and instrument choice are out of its scope. Tension: Q1's after-cost economics depend on the cost model, and costs depend on the instrument. Proposed resolution: the signal study assumes cash equity with a stated cost model. Instrument-specific economics move to the deployment study.

**Later Edit Candidate:**
In event-study.md, state that the signal study uses virtual uniform notional, with the cash-equity cost model as baseline. Add a separate planned feature, "deployment methodology", covering sizing, capital allocation, instrument selection (equity / futures / options), liquidity and capacity checks, and leverage and margin risk. Not applied during interview.

**Potential Open Decisions:**
- Sample-size bar for signal credibility alone (follow-up question).
- Baseline instrument and cost model for the virtual deployment (cash equity assumed; to confirm).

User confirmed Q2 as stated, including the cash-equity baseline for the virtual deployment: "makes sense as stated for q2".

## Q3 - Sample size needed to believe a signal

**Question:**
Leave money aside. How many past cases of one event type would make you believe the signal is real, and not luck?

**Answer / Reasoning:**
User answer (verbatim): "we should only warn and let the trader decide the sample size thing"

Sample size becomes a disclosure, not a gate. The system always shows the count of independent events (clusters), plus a plain warning when the sample is thin, and the trader decides whether to believe it.

What this keeps:
- The numbers are always shown. Nothing is hidden because the sample is small.
- The warnings are honest and specific: number of clusters, how wide the uncertainty is, how much the result depends on the top few events, and how many variants were tried.

What it changes:
- The current event-study sketch suppresses aggregates below 8 clusters and demotes 8–19 to diagnostic. Under this answer, those thresholds become warning levels, not blocks.

**Architecture / Initiative Impact:**
Tension, Later Edit Candidate

**Decision / Tension:**
Confirmed: for event studies, sample size is warn-and-disclose, and the trader decides. Tension: the repo's metric-registry philosophy normally suppresses or demotes metrics below evidence thresholds ("a new metric cannot headline itself without clearing a bar"). Proposed resolution, to confirm in consolidation: keep the registry's thresholds as labelled warning bands (e.g. "thin sample: 12 clusters") instead of suppression, and keep sample size permanently visible beside every headline number. The registry still classifies; it just stops hiding.

**Later Edit Candidate:**
In event-study.md and the event-study metric rules, replace suppression below 8 clusters and the diagnostic demotion at 8–19 with graded warning bands. Always show cluster count, a confidence interval, the result without the top N events, and the number of variants tried. Not applied during interview.

**Potential Open Decisions:**
- Whether warn-only also applies to other gates (placebo, multiple testing), or only to sample size.
- Warning band cut-offs (e.g. <8 severe, 8–19 thin, 20–99 moderate, 100+ adequate).

## Q4 - Who labels soft vs hard fear

**Question:**
When an event happens, who decides whether it is soft fear or hard fear: you by hand, or a fixed rule based on the filing's wording?

**Answer / Reasoning:**
User answer (verbatim): "am not sure of these categories help"

The user questioned the 2×2 taxonomy itself (soft/hard × fear/greed) rather than how it gets labelled. That is a fair challenge:

- The 2×2 is a *prediction* about the price path (soft fear recovers, hard fear keeps falling). Putting it in as an input label risks baking in the answer, and hand labelling adds lookahead risk, because a curator judging "hard or soft" already knows how the story ended.
- Plain event types (raid, order win, auditor exit, clarification) are observable from the filing at t0, need no judgement, and are harder to bias.
- The backtest can then *reveal* the path per event type: recovers, drifts, or keeps falling. If "hardness" matters, test it later as one measurable feature (does the filing state a quantified amount? is this a clarification leg?), not as the primary grouping.

Agent's lean: demote the 2×2 from taxonomy to hypothesis. It stays useful as language for explaining results, not as the input the study is built on.

**Architecture / Initiative Impact:**
Tension, Open Decision

**Decision / Tension:**
Tension: the pre-interview working model (the 2×2 as the organising grouping) is not accepted by the user. Open: whether to group events by plain, filing-observable event type and let the backtest reveal each type's behaviour (pending the user's answer to the follow-up).

**Later Edit Candidate:**
If confirmed: in event-study.md, replace the 2×2 as the primary grouping with filing-observable event types. Keep soft/hard only as optional, testable features defined by objective filing attributes, never hand labels. Not applied during interview.

**Potential Open Decisions:**
- Primary grouping: plain event type vs the 2×2.
- Whether "quantified vs unquantified" and "first leg vs clarification" become tested features.

## Q5 - Group events by plain type

**Question:**
Should we group events by plain type, like raid or order win, and let the backtest show how each one behaves?

**Answer / Reasoning:**
User answer (verbatim): "yes its clearer without venturing into useless lables"

Resolves the Q4 tension. The primary grouping is filing-observable event type, assigned from what the filing says at t0, with no judgement about hardness or emotion. Behaviour (recovers, drifts, keeps falling) is an output of the backtest per type, not an input label. The fear/greed and soft/hard vocabulary is dropped as a study input. It may survive only as plain-English description of results.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: events are grouped by plain, filing-observable type. No subjective labels in the study input. Any extra split (e.g. amount stated vs not, first filing vs clarification) must be an objective filing attribute, and is tested as a feature, never hand-assigned.

**Later Edit Candidate:**
In event-study.md: remove the soft/hard 2×2 as a grouping and define an event-type list keyed to filing content. Reword the initiative purpose from "soft/hard fear and greed" to "filing-sourced event types; behaviour discovered by backtest". Not applied during interview.

**Potential Open Decisions:**
- Which event type to test first.
- Who maintains the event-type list and how new types are added.

## Q6 - First event type to test

**Question:**
Which event type do you want tested first? Tax raids, or something else?

**Answer / Reasoning:**
User answer (verbatim): "actually we have to start somewhere to test stuff and kepps things provisional tull then"

Principle stated: pick a starting point and keep all choices provisional until tested. The first event type is a starting probe, not a commitment.

Agent's provisional pick: **income-tax / ED / CBI searches (raids)** on listed Indian companies, because:
- it is the motivating example for the whole initiative;
- a hand-verified golden case already exists (Polycab, Dec 2023 – Jan 2024), with known BSE filing timestamps;
- exchanges typically ask for a clarification after media reports, so a filing trail is likely.

Known risk: raids may be too rare for a meaningful sample. If so, that is itself a finding, and the next probe moves to a more frequent filing type (e.g. order wins).

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed as a working rule: everything is provisional until tested. Provisional first event type: tax/enforcement searches (raids). Open to replacement at any time.

**Later Edit Candidate:**
In event-study.md, mark the first-slice event type as provisional (tax/enforcement searches) and state the switch-over rule: if raids prove too sparse, try a frequent type next. Not applied during interview.

**Potential Open Decisions:**
- Stock universe for the probe.
- Second event type if raids prove too sparse.

## Q7 - Stock universe

**Question:**
Should the test cover only larger, liquid stocks (for example the top 500), or every listed stock?

**Answer / Reasoning:**
User answer (verbatim): "wont this be dependent on the signal itself ? we cannot dictate what we find we only extract it or detect it . the cap thing is just a post facto assessment ? be honest here i am brainstorming"

Mostly right, with three honest caveats.

Right: detection should not be pre-filtered. Find every qualifying event on every listed stock, and let the results show where the effect lives (large caps, small caps, or nowhere). Market cap and liquidity are attributes of each event, not filters on the search.

Caveats:
1. **Measure the attribute at t0, not after.** Cap and liquidity must be taken from data before the event (e.g. 20-day average traded value before t0). Using today's index membership, or post-event liquidity, is lookahead.
2. **Include dead stocks.** "Every listed stock" must mean every stock listed *at the time*, including companies later delisted or suspended. Otherwise the sample silently loses the raids that went worst (survivorship bias).
3. **Post-facto slicing counts as testing.** Splitting by cap after seeing results is fine, but each split is another variant tried, and it is disclosed as such (ties to Q1 multiple-testing discipline). An effect that only appears in illiquid microcaps may be real but not capturable: stale prices, wide spreads, circuit limits. That is a tradability finding, reported, not a hidden filter.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: detect on the full point-in-time universe, including later-delisted names. Cap and liquidity are recorded per event at t0, used for post-facto breakdowns, and disclosed as variants tried. Tradability is assessed after detection, not assumed before it.

**Later Edit Candidate:**
In event-study.md: add event attributes measured at t0 (market cap, pre-event average traded value, F&O eligibility). Require a point-in-time universe including delisted stocks. Add a tradability flag (circuit hits, zero-volume days, spread proxy) to results instead of a pre-filter. Not applied during interview.

**Potential Open Decisions:**
- Source of point-in-time listings and delisted-stock prices (yfinance coverage of delisted Indian names is likely poor; a data gap to check).

## Q8 - Output shape: report or alerts

**Question:**
What should the result look like for you: a research report per event type, or alerts when a new raid happens?

**Answer / Reasoning:**
User answer (verbatim): "intitally it will be user commissions a study and test occur , future monitoring is premature till we get the first goal right"

The first goal is an on-demand, commissioned study: the user asks, the study runs, a result comes back. Live monitoring and alerts wait until a signal has passed the study. This matches the repo's existing shape (study shell, run ledger, shareable runs) and the earlier news-ETL sequencing (live polling was already a late step).

**Architecture / Initiative Impact:**
Confirmed, Out of Scope

**Decision / Tension:**
Confirmed: scope is commission → run → report. Out of scope for now: live monitoring, alerts, new-event notifications.

**Later Edit Candidate:**
In event-study.md and news-etl-pipeline.md, mark live polling, monitoring and alerts as explicitly deferred until a signal passes the study. Not applied during interview.

**Potential Open Decisions:**
- How a study is commissioned (plain-language request vs structured form).

## Q9 - How a study is commissioned

**Question:**
When you commission a study, do you want to type the idea in plain words, or fill in a short form with the event type and dates?

**Answer / Reasoning:**
User answer (verbatim): "it starts with a simple natural language statement of user -- followed up with simple questions to get the scope and intent clear and then rest of it , whats is your opinion and recommendation"

Agent opinion: agree. That is the right shape, and the repo already has most of it (AI Study Builder plus the Study Factory proposal contract, both non-executing).

Recommended flow:
1. **Plain statement.** E.g. "Do stocks recover after tax raids?"
2. **A few clarifying questions.** One at a time, and only about things that change the result: which events count, what period, what "recover" means. Aim for 3–5 questions, not a form in disguise.
3. **Plan read-back.** The system shows the structured study plan back in plain words, including any defaults it chose (history length, benchmark, horizon grid), each marked as editable.
4. **Feasibility check before running.** If the data cannot support the plan (no event source, too little history), say so before running, not after.
5. **Confirm, freeze, run.** The confirmed plan runs, not the sentence. The AI drafts; the deterministic engine executes.

Why the freeze matters: the clarifying answers act as the pre-registration. Once results are visible, changing the definition means a new, separately recorded run, never an edit to the old one. This is what keeps natural-language studies honest (ties to Q1 multiple-testing discipline).

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: commissioning is plain statement → short clarifying dialogue → plan read-back with visible defaults → feasibility check → confirm and freeze → run. AI drafts, never executes. Post-result changes create new runs.

**Later Edit Candidate:**
Extend the Study Factory / AI Study Builder flow with a clarifying-question step and a plain-language plan read-back for event studies. Record clarifying Q&A in the frozen plan as pre-registration. Not applied during interview.

**Potential Open Decisions:**
- Default handling: use and show defaults vs ask about every parameter.
- Maximum number of clarifying questions.

## Q10 - Defaults, and what happens when data is missing

**Question:**
When a sensible default exists, like 10 years of history, should the system just use it and show you, or ask you every time?

**Answer / Reasoning:**
User answer (verbatim): "makes sense to reuse . but if the data gap is high then ? fetch news to fill gap"

Read as: use sensible defaults and show them (agent interpretation of "reuse"; correct if wrong). The user then raised a new link: when the feasibility check finds a large data gap, the system should fetch news to fill it.

Agent view: yes. The feasibility check should be able to start a news-ETL job. This connects the two planned docs. Four guardrails:

1. **Name the gap type first.** News fills an *event* gap (we don't know enough raids). It cannot fill a *price* gap (no history for a delisted stock) or a *timestamp* gap (we know the raid but not its first public time; that needs the filing). Each gap type has a different fill.
2. **Filled events go through the normal pipeline.** Fetched news only nominates events. Each one is archived, resolved, and curated like any other before it enters the study. Nothing enters straight from a search result.
3. **Fill before freeze, and record it.** Gap-filling happens before the plan is confirmed. The plan records which queries ran, which sources, and how many events came back, so the sample's origin is visible.
4. **Keep everything found, and report coverage.** All qualifying events from the search are kept, not just the convenient ones. Results show the coverage reached and the remaining unknowns (e.g. "found 34 raids; estimated coverage unknown; press-sourced, not exchange-sourced: 9").

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: defaults are used and shown, all editable. Confirmed: a feasibility event gap can trigger news discovery to build the event set, under the guardrails above. Tension to watch: searching until the sample "looks good enough" is a form of sample shopping. A stopping rule should be fixed before the search runs.

**Later Edit Candidate:**
Link event-study.md feasibility to news-etl-pipeline.md: a gap classifier (event / price / timestamp) and an "event-gap → watch spec → discovery → archive → curation" path. Record the fill provenance in the frozen plan. Not applied during interview.

**Potential Open Decisions:**
- Review gate for gap-filled events: per event vs batch approval.
- Stopping rule for gap-filling searches.

Q10 clarification from user (verbatim): "i see what u meant now i thought re use news . agreed as stated .1 - gap will not be directly named or known (news or price) . the app will do all that we have hte data soruces machinery (which will improve) 2. obviously 3. yes 4 yes provisiionally ."

Q10 update:
- "Reuse" meant reusing the news machinery. Defaults: agreed as stated (use and show).
- Guardrail 1 refined: the user does not name or classify the gap. The app detects the gap and its type (event / price / timestamp) automatically, using the data-source machinery, which is expected to improve over time. The gap type is still recorded internally and shown in results, not asked of the user.
- Guardrails 2 and 3: confirmed. Guardrail 4 (keep everything found, stopping rule, coverage report): confirmed provisionally.

## Q11 - Review gate for news-found events

**Question:**
When news finds new events, do you want to check each one yourself, or approve the whole batch at once?

**Answer / Reasoning:**
User answer (verbatim): "maybe intially to trest the news found and entity discoverd yes. approve the whole batch makes sense once the trust is established ."

A graduated review gate: per-event review at the start, to test both the news found and the entity matched (right company, right listing). Batch approval comes later, once trust is earned.

Implication: "trust established" needs a measurable definition, or it becomes a feeling. The natural measure comes from the per-event reviews themselves. Track how often the user accepts the system's event, entity, and timestamp unchanged. Once that rate is high over enough reviewed events, switch to batch, and keep spot-checks after the switch so drift is caught.

**Architecture / Initiative Impact:**
Confirmed, Open Decision

**Decision / Tension:**
Confirmed: per-event review first (event validity plus entity resolution), then batch approval after trust is established. Open: the measurable trust criterion and post-switch spot-check rate.

**Later Edit Candidate:**
In news-etl-pipeline.md's curation gate: record each review outcome (accepted / corrected / rejected, per field: event, entity, timestamp). Compute an acceptance rate. Define a switch rule to batch mode and a spot-check sample after the switch. Not applied during interview.

**Potential Open Decisions:**
- Trust threshold for switching to batch approval (e.g. ≥95% unchanged over ≥50 reviewed events).
- Whether trust is tracked per source / per event type or globally.

## Q12 - Trust threshold for batch approval

**Question:**
What acceptance rate would make you comfortable switching to batch approval? For example, 95% of events accepted unchanged over the last 50 you reviewed?

**Answer / Reasoning:**
User answer (verbatim): "at least 80%"

The provisional threshold is ≥80% of reviewed events accepted unchanged. The review window was not stated; 50 events assumed provisionally.

Honest implication: once batch mode starts, uncaught errors flow into the frozen set. At an 80% acceptance rate, up to about 1 in 5 events may carry an error that nobody fixes. Not all errors are equal:
- **Wrong date (t0)** is the most damaging. It shifts the event window, smears the price reaction, and pushes results toward "no effect", so real signals get missed.
- **Wrong company** adds noise from unrelated price moves.
- **Wrong event type** mixes groups, blurring per-type behaviour.

Consistent with Q3 (warn, let the trader decide): the 80% bar stands, and the study report shows the current acceptance rate and spot-check error rate next to the results, so the trader can judge.

**Architecture / Initiative Impact:**
Confirmed, Tension

**Decision / Tension:**
Confirmed (provisional): switch to batch approval at ≥80% unchanged acceptance. Tension: a single overall threshold treats a wrong date the same as a minor field fix, though a wrong date harms results most. Possible refinement: field-level thresholds, with a stricter bar for the timestamp.

**Later Edit Candidate:**
In news-etl-pipeline.md's curation gate: set the batch-switch threshold at ≥80% unchanged acceptance (provisional), measured per field. Show the acceptance and spot-check error rates in each study report. Not applied during interview.

**Potential Open Decisions:**
- Review window size (provisionally 50 events).
- Stricter threshold for timestamps vs other fields.

## Q13 - Stricter bar for dates?

**Question:**
Is 80% fine for every field, or should dates have a stricter bar, since a wrong date hurts the results most?

**Answer / Reasoning:**
User answer (verbatim): "super accuracy in dates hurts the results but not fataly . because we dont trade HFT . so i will let you judge this once we reach there"

Mostly right. With multi-day holding and entry no earlier than t+1, a one-day slip changes a 20-day result only a little. Two exceptions remain, recorded for when the agent makes this call:

1. **Direction matters.** A date recorded *too late* is conservative: we enter after the news and just miss part of the move. A date recorded *too early* is lookahead: the backtest "enters" before the news was public, which inflates results. Early-date errors are the one fatal kind.
2. **Wrong leg ≠ small slip.** Picking the regulator statement instead of the first exchange query (Polycab: 2023-12-22 vs 2024-01-10) is a three-week error, not a one-day one. That is a sequence error, caught by clustering legs, not by date precision.

**Architecture / Initiative Impact:**
Open Decision

**Decision / Tension:**
Deferred to agent judgement when the curation gate is built. Recorded constraint for that judgement: tolerate small late-side date errors; treat early-side errors and wrong-leg errors as blocking.

**Later Edit Candidate:**
In the curation gate: flag any event whose recorded t0 is earlier than the first verifiable public timestamp as blocking; treat late-side slips of ≤1 trading day as acceptable. Not applied during interview.

**Potential Open Decisions:**
- Final date tolerance rule (agent to decide at build time).

## Q14 - Kill criterion for the first study

**Question:**
For the first raids study, what result would make you drop the idea? For example: raided stocks recover no better than stocks picked on random dates.

**Answer / Reasoning:**
User answer (verbatim): "yes if there is no tradebale effect long or short side from say buy and hold say the markets index for the same period may be one bench mark (i dont know it clearly yet)"

Kill rule, provisional: drop the idea if there is no tradable effect on either the long or the short side, measured against buying and holding the market index over the same period. The user is not yet sure about the benchmark.

Agent recommendation on benchmark: use two comparisons, each answering a different question.
1. **Versus the index over the same window** (market-adjusted return). Did the raided stock beat simply holding Nifty? This is the user's benchmark: simple, intuitive, and the primary measure. A beta-adjusted market model and a sector index can be robustness checks later.
2. **Versus random dates** (placebo). Is the effect caused by the *event*, or would any random day in that stock look the same? This catches stocks that simply behave unusually anyway.

The idea survives only if it beats both.

Two-sided note: testing long *and* short doubles the chances of a lucky result, so both directions count as variants tried (Q1 discipline). Tradability on the short side is also narrower in India. Cash-market shorts cannot be held overnight, so a held short needs stock futures (F&O-eligible names only) or securities lending. The study can still measure a negative effect on all stocks, but short-side tradability is flagged using the F&O-eligibility attribute at t0 (Q7). Instrument choice stays with the deployment study (Q2).

**Architecture / Initiative Impact:**
Confirmed, Open Decision

**Decision / Tension:**
Confirmed (provisional): the first study is killed if, after costs, neither the long side nor the short side shows a tradable effect beyond the same-period index return and beyond the random-date placebo. Open: final benchmark choice (index-relative primary recommended; market model and sector as robustness).

**Later Edit Candidate:**
In event-study.md: make the same-window index return the primary benchmark, the market model a robustness check, and the placebo a required second comparison. Pre-register the kill rule as two-sided. Add a short-side tradability flag based on F&O eligibility at t0. Not applied during interview.

**Potential Open Decisions:**
- Benchmark index for Indian events (Nifty 50 vs Nifty 500 vs sector index).

## Protocol Note - Proposed Decision Register (2026-11-06)

User proposed (verbatim): "i was thinking of maintaining a cousin document to interview one called decision register ? does it make sense debate"

Raised in place of an answer to Q15 (summarise vs continue). Recorded as a protocol note because it changes how the interview is kept, not the initiative.

Debate:

*For:*
- The log is chronological and verbose. It cannot quickly answer "what is currently decided about X?" after 14 questions.
- Decisions already move: Q5 overturned the pre-interview 2×2, Q10 was reinterpreted, Q13 was delegated to the agent. A register shows the *current* state and makes supersession explicit.
- It separates who decided: Q6's raid pick and Q14's two-benchmark design are agent proposals the user accepted provisionally, while Q3 and Q8 are direct user rulings. That distinction blurs in prose.
- It fits the repo's culture of ledgers over opinions, and feeds consolidation and later edits directly.

*Against:*
- Two documents can drift and become two sources of truth.
- One-line rows compress nuance. The reasoning and verbatim answers live only in the log.
- Consolidation mode already produces a decision summary, just at the end instead of continuously.

Agent recommendation: yes, with rules that remove the drift risk.
1. The log stays the source of record (append-only, verbatim). The register is a derived index; every row cites its Q#.
2. One row per decision: ID, decision in one line, status (Confirmed / Provisional / Delegated / Deferred / Superseded), who decided (user ruling / agent proposal accepted / delegated to agent), source Q#.
3. Rows are never deleted. A changed decision gets a new row, and the old row is marked Superseded with a pointer to it.
4. The register is an interview artifact, not a canonical one, so it may be updated during interview mode, alongside the log.

**Architecture / Initiative Impact:**
Out of Scope (protocol), Open Decision

**Later Edit Candidate:**
None for canonical artifacts. If approved, create `Decision Register.md` in the repo root and backfill rows from the pre-interview capture and Q1–Q14.

**Potential Open Decisions:**
- Create the register now and backfill Q1–Q14 (pending user answer).
- Q15 (summarise vs continue) is superseded by this proposal.

## Protocol Note - Should the register live in the interview skill? (2026-11-06)

User counter-question (verbatim): "counter question should it be baked in to the interview-skill itself ?"

Debate:

*For baking it in:*
- The need is general. Any interview past ~10 questions drifts the same way this one did. One design, reused, beats re-arguing it each time.
- The advanced skill (`~/.pi/agent/skills/alignment-interview-advanced/SKILL.md`) is already halfway there: separate Decision Status (Confirmed / Working Direction / Deferred / Delegated / Superseded…), Position Source (User Ruling / Agent Proposal / …), and append-only correction entries. A register is the missing current-state view on top of those fields.
- Inside the skill, the rules (derived index, cites Q#, never delete rows) are enforced every time, not remembered.

*Against, or not yet:*
- Untested. We have not used a register for even one interview. Baking in an untried format freezes guesses into a reused tool.
- The light skill's value is being light. A mandatory register adds overhead to short interviews that do not need it.
- Workbench mode only writes through host tools (`append_alignment_entry`). A register would need host support or would have to be generated from the log.
- The skill lives outside this repo (pi-lab / pi skills). Changing it is outside this initiative's scope and is a canonical artifact for this interview.

Agent recommendation: yes eventually, but prove it here first.
1. Trial the register in this interview.
2. Strongest end design: make each log entry carry structured fields (status, who decided, supersedes), so the register is *generated* from the log, not hand-maintained. Generated means it cannot drift. This removes the main objection from the earlier debate.
3. Home: the advanced skill (it already has the fields). The light skill gets it as optional, switched on for long interviews.
4. Propose the skill change with this trial as evidence.

**Architecture / Initiative Impact:**
Out of Scope (skill change is outside this initiative), Later Edit Candidate

**Later Edit Candidate:**
After the trial: propose an amendment to alignment-interview-advanced (and an optional mode for alignment-interview) adding a Decision Register generated from structured log-entry fields, with supersession pointers. Not applied during interview; outside this repo.

**Potential Open Decisions:**
- Trial-first vs change the skill now (pending user answer).

## Q15 - Start the Decision Register trial

**Question:**
Should I start the trial now by creating `Decision Register.md` and filling it from everything we've decided so far?

**Answer / Reasoning:**
User answer (verbatim): "yes and post doing that check how junior repo has done it before (had used fable earlier)"

Created `Decision Register.md` in the repo root, backfilled from the pre-interview capture, Q1–Q14, and the protocol notes: 30 decisions (D01–D30) and 10 open decisions (O01–O10). Each row cites its source entry. Next: look at prior art in the "junior" repo, which used the Fable workflow (goal/findings ledgers).

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: the register trial is live (D28). The register is updated alongside the log from now on.

**Later Edit Candidate:**
None.

**Potential Open Decisions:**
- Whether to adopt structure from the junior repo's prior approach (pending review).

## Protocol Note - Prior art from the junior repo (2026-11-06)

Reviewed `/Users/aksingh/junior` (read-only). It keeps three layers, not one:

1. `docs/alignment-interview.md`: the founder's near-verbatim answers, one question at a time (1,440 lines). On conflict, the verbatim answer wins.
2. `docs/founding-decisions.md`: an append-only provenance register. D-numbered rulings (D1…D71+), grouped by theme and then dated sections (108 sections, 2,585 lines), with amendments and corrections kept visible, and ratification status ("Founder decision", "Ratified by founder delegation", "Marked for ratification").
3. `docs/current-decisions.md`: a short normative index of *current effect*. Table columns: Area | Current rule | Authority (D-links) | Status. Opens with an explicit authority and reading order: a later ruling supersedes an earlier one; the plan document cannot create or upgrade a decision; prototypes and review findings are not authority.

Fable: no Fable goal/findings ledger files were found in junior. The only match is a model mention in `AGENTS.md`. The Fable model was likely used there; the Fable workflow ledgers were not.

Lessons for our trial:
- **Keep:** verbatim-wins rule; append-only history with visible supersession; ratification status separate from the decision. Our register already has these.
- **Adopt:** (a) an *Area* column, so "what is the rule on X?" is answered by topic, not ID; (b) an explicit authority and reading-order section; (c) eventually, a separate current-effect view once the register grows (junior needed one at ~70 decisions).
- **Avoid:** junior's current index rotted into prose. Single cells run to paragraphs (174 lines, ~49 KB). Its own "anti-drift discipline" rule suggests the hand-maintained index drifted. That supports the generated-register end design (D29) and a hard one-line cap per row.

**Architecture / Initiative Impact:**
Out of Scope (protocol)

**Later Edit Candidate:**
Apply (a) and (b) to `Decision Register.md` and add a one-line-per-row cap, pending user approval. Carry the junior lessons into the eventual interview-skill proposal (D29).

## Q16 - Restructure the register

**Question:**
Should I add a topic (area) column, a "which document wins" section, and a one-line-per-row cap to the register now? (Re-explained in plain terms at the user's request.)

**Answer / Reasoning:**
User answer (verbatim): "u decide"

Agent decision: yes, all three, because they only change how the register is organised, not any decision. Applied: rows are now grouped by area with stable IDs; a "which document wins" section is at the top (log wins; newer replaces older; plans and proposals cannot create decisions); rows are shortened to one line each. Recorded as D31.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed by delegation: register restructured (D31).

**Later Edit Candidate:**
None.

## Q17 - Review the agent's unaccepted proposals

**Question:**
Nine rows in the register are my proposals that you haven't explicitly accepted. They're marked "Working Direction". Do you want to go through them one at a time now, or leave them as they are until the first test shows whether they matter?

**Answer / Reasoning:**
User answer (verbatim): "lets go through them"

Correction: the actual count is eight, not nine. Working Direction rows: D26, D13, D27, D16, D04, D22, D24, D29. Each gets one plain question. Order: most result-affecting first.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: review the eight Working Direction rows one at a time, starting with D26.

**Later Edit Candidate:**
None.

## Q18 - D26 benchmark: index and placebo

**Question:**
To count as a real effect, a raided stock would have to clear two bars: (1) beat holding the market index over the same days; (2) beat the same stock on random, raid-free days. Do you accept requiring both?

**Answer / Reasoning:**
User answer (verbatim): "1 is mandatory second optional for now"

The same-period index comparison is mandatory. The random-date placebo is optional for now.

Implication: without the placebo, the study cannot tell an event effect from a stock that simply bounces a lot anyway. Raided stocks are often already falling before the raid, and falling stocks often bounce, so the risk is real. Consistent with D08 (warn, don't block): when the placebo is skipped, the report shows a plain warning, e.g. "No random-date check run: the effect may not be caused by the event."

This partly revises D05 (Q1), which listed the placebo inside the statistical-credibility layer. The placebo moves from required to optional-with-warning.

**Architecture / Initiative Impact:**
Confirmed, Tension

**Decision / Tension:**
Confirmed: index benchmark mandatory; placebo optional for now, warned when absent. D26 superseded by D32. Tension: D05's statistical-credibility layer is weakened until the placebo becomes standard.

**Later Edit Candidate:**
In event-study.md: make the placebo an optional control (it is currently required for a headline), and add a missing-placebo warning to the report. Not applied during interview.

**Potential Open Decisions:**
- When, if ever, the placebo becomes mandatory (e.g. before any capital).

## Q19 - D13 universe rules

**Question:**
Three rules for the stock list: (1) measure each stock's size and liquidity before the raid, not after; (2) include companies that were later delisted, so the worst outcomes don't quietly disappear; (3) if we later split results by size, each split counts as an extra test and gets disclosed. Do you accept all three?

**Answer / Reasoning:**
User answer (verbatim): "accept all three"

All three are accepted. Practical consequence carried forward: rule 2 depends on open question O06 (a source for delisted-stock prices). Until that exists, the report must state how many events were lost because no price history was found.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: D13 accepted by the user.

**Later Edit Candidate:**
As recorded under Q7.

## Q19 follow-up - Do not overfit the process to raids

User statement (verbatim): "one thing on q19 - i feel we should not overfit the process to the signal because there will be completely different and diverse signals . we are using raids to see how the study build primitives work etc ."

**Answer / Reasoning:**
An important principle. Raids are a *probe* to exercise the study-building primitives, not the product. The process must stay general enough for very different signals.

Check against Q19: the three D13 rules are general event-study hygiene, not raid-specific. Measure attributes before the event, include dead stocks, and disclose every slice: these apply to any signal (earnings, order wins, index changes, macro events), so D13 stands.

Some decisions so far *are* raid-shaped and should be marked that way, so they are not mistaken for general rules:
- D11 (raids first) is per-probe by definition.
- D24's "wrong announcement leg" comes from the Polycab sequence. The general form is "anchor on the first tradable public time".
- D27 (F&O eligibility for shorts) is an Indian-equity instance of a general need (see Q20).

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed (D33): raids are a probe for building general study primitives. Process decisions must be signal-agnostic. Signal-specific choices are recorded as per-signal settings, not process rules.

**Later Edit Candidate:**
In event-study.md: separate general primitives (event record, point-in-time attributes, universe, benchmark, horizon profile, warnings) from per-signal settings (event type, legs, instrument rules). Frame raids as the first probe, not the design target. Not applied during interview.

## Q20 - D27 short-side tradability

**Question:**
In India you can't hold a short in ordinary shares overnight. A short trade lasting days needs stock futures, which exist for only about 200 F&O stocks. The study would still measure falls in every stock but mark which ones you could actually have shorted, based on F&O membership on the raid date. Do you accept that?

**Answer / Reasoning:**
User answer (verbatim): "q20 - this called for a quick regulatory check for each signal build is what is read."

The user generalised the proposal, consistent with D33. Instead of a raid-specific F&O flag, every signal build gets a quick regulatory and tradability check. That check asks what the market rules allow for this instrument and direction, *as of the event date*, because the rules and eligibility lists change over time.

Examples of what the check covers for Indian equities: overnight short-selling limits; F&O eligibility; the F&O ban period (a stock is barred from new futures positions once open interest nears the market-wide limit, which can happen to a stock right after bad news); price-band and circuit limits; lot sizes. For other markets or instruments, the same step asks the equivalent questions.

The output is flags in the report (e.g. "short side: 14 of 31 events were shortable on the date"). It is not a filter, consistent with D08 and D12.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed (D34): every signal build includes a quick regulatory/tradability check, point-in-time, reported as flags. D27 superseded by D34; F&O eligibility is one instance.

**Later Edit Candidate:**
Add a "regulatory and tradability check" step to the study-build flow (event-study.md, commissioning flow), with point-in-time rule sources per market. Not applied during interview.

**Potential Open Decisions:**
- Source of point-in-time rule data (e.g. historical F&O lists, ban lists, price bands).
- Whether to tag every register row as general vs per-signal.

## Q21 - Tag register rows as general or per-signal

**Question:**
Following your point, should I label each register row as either a general rule (applies to every signal) or a per-signal setting (raids only, for now)?

**Answer / Reasoning:**
User answer (verbatim): "sure"

Applied. Added a Scope column with three values: General, Per-signal, and Process (the interview's own bookkeeping, e.g. the register itself and research tooling). Result: almost every decision so far is General, which is what D33 asks for. Per-signal: D01 (superseded), D11 (raids first), D27 (superseded), and open question O05. D24 is tagged General: its rule ("too-early and wrong-announcement dates block") applies to any signal, even though the example came from Polycab.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: register rows carry a Scope tag. Few per-signal decisions so far, which supports D33.

**Later Edit Candidate:**
None.

## Q22 - D16 commissioning flow

**Question:**
After your opening sentence, the system would ask 3–5 short questions, read the plan back to you in plain words, check the data is there, then lock the plan and run it. If you change something after seeing results, that becomes a new run and the old one stays on record. Do you accept this flow?

**Answer / Reasoning:**
User answer (verbatim): "i love this flow feels intuitive"

Accepted with enthusiasm. The flow matches how the user naturally works: it is the same shape as this interview, a plain statement followed by short questions.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: D16 accepted by the user.

**Later Edit Candidate:**
As recorded under Q9.

## Q23 - D04 news pipeline rules

**Question:**
Three rules for how news gets in: (1) every filing or article is saved in our own archive before we use it; (2) search tools only point us to news, and the saved filing is the proof; (3) start small by pasting a few BSE filing links by hand, and automate only once that works. Do you accept these?

**Answer / Reasoning:**
User answer (verbatim): "this is related to building the news db and etl . which should be a seperate interview"

Scope boundary drawn. Building the news database and ETL gets its own alignment interview. This interview keeps only the *interface*: what a study needs to receive from the news system. That means event records with a first-public timestamp, a source reference, and provenance (D18, D19), plus a coverage report. *How* the news system finds, archives, and verifies items belongs to the separate interview.

**Architecture / Initiative Impact:**
Out of Scope, Open Decision

**Decision / Tension:**
D04 deferred to a separate News DB & ETL interview. D18 and D19 stay here as the boundary between study and news system.

**Later Edit Candidate:**
Start a separate alignment log for the News DB & ETL (seeded with D04 and news-etl-pipeline.md as reference). Not applied during interview.

**Potential Open Decisions:**
- When to run the News DB & ETL interview.

## Q24 - D22 trust window

**Question:**
The 80% acceptance rate for switching to batch approval would be measured over the last 50 events you reviewed. Is 50 the right number?

**Answer / Reasoning:**
User answer (verbatim): "well 50 is provissional cool it dependends so much on the incident"

50 is accepted provisionally. The user notes the right window depends heavily on the kind of incident. That points toward open question O09: trust should be tracked per event type, not overall. A system that is reliable on raids may still be unreliable on order wins, where entity matching and dates behave differently.

**Architecture / Initiative Impact:**
Confirmed, Open Decision

**Decision / Tension:**
Confirmed (provisional): window of 50 reviewed events. Working direction for O09: trust measured per event type.

**Later Edit Candidate:**
As recorded under Q11/Q12, with trust tracked per event type.

## Q25 - D24 date limits

**Question:**
You handed me the date rule earlier. Limits I'd work within: a date up to 1 trading day late is fine; a date too early is blocking (the backtest would act before the news was public); a date from the wrong announcement in a chain is blocking (e.g. Polycab's January statement instead of December's). Do you accept those limits?

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. The detailed tolerance rule (D23) stays delegated to the agent, within these limits.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: D24 accepted by the user.

**Later Edit Candidate:**
As recorded under Q13.

## Q26 - D29 register's future

**Question:**
Later on, the register would be generated automatically from the interview log instead of kept by hand, so the two can never disagree. Once this trial has shown it works, I'd propose adding it to the interview skill itself. Do you accept that plan?

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. This closes the review of the eight Working Direction rows begun at Q17. Outcomes: D13, D16, D24, D29 accepted; D22 accepted provisionally; D26 replaced by D32 (placebo optional); D27 replaced by D34 (general regulatory check); D04 deferred to a separate News DB & ETL interview.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: D29 accepted by the user. No Working Direction rows remain.

**Later Edit Candidate:**
As recorded in the protocol note on the interview skill.

## Q27 - Summary now, or open questions first

**Question:**
Should I write the summary of the interview now, or go through the 10 open questions first?

**Answer / Reasoning:**
User answer (verbatim): "open question should be shared with your recommendation one at a time"

Protocol: open questions are taken one at a time, each with the agent's recommendation. Order, most needed for a first run first: O10 benchmark index, O06 delisted prices, O03 warning bands, O01 thresholds, O02 deflated Sharpe / PBO, O08 stopping rule, O07 clarifying-question cap, O04 event-type list, O05 second event type, O09 trust scope.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: walk the open questions one at a time, with a recommendation each. Summary afterwards.

**Later Edit Candidate:**
None.

## Q28 - O10 benchmark index

**Question:**
Do you accept Nifty 500 as the default benchmark, with the general rule "a broad index that matches the stock list"?

**Answer / Reasoning:**
User answer (verbatim): "sure"

Agent recommendation accepted. Reasoning recorded: Nifty 50 is large caps only, while the universe is every listed stock (D12) and raided companies are often mid/small caps. A large-cap benchmark would mix the raid effect with the small-vs-large-cap gap. Nifty 500 (`^CRSLDX`) is available on the existing yfinance path from 2005-09-26 (checked 2026-11-06; Nifty 50 from 2007-09-17). Sector indexes stay an optional robustness check. Yahoo's series is a price index, not total return; the dividend gap over days to weeks is small and is disclosed per the repo's return-basis labelling.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: general rule D35, the benchmark is a broad index matching the universe. Per-market setting D36: Nifty 500 for Indian equities, price-index basis disclosed. O10 resolved.

**Later Edit Candidate:**
In event-study.md: state D35 as the benchmark rule and D36 as the Indian-equity default. Not applied during interview.

## Q29 - O06 delisted prices, and a data-sources registry

**Question:**
Do you accept NSE bhavcopy as the price and stock-list source of record, with the rules above (follow renames, adjust corporate actions, never fill after the last trade, NSE-only gap, local copy only)?

**Answer / Reasoning:**
User answer (verbatim): "makes sense however a feeling i have is that u have not seen the app current codebase , have alook and let talk again on the bove . we should have a data sources registry and park all good candidates along with documentaion i think"

A fair challenge. The agent reviewed the codebase read-only before continuing. Findings:

*What already exists (three provenance layers, none of them source-level):*
1. **Per-dataset provenance:** `sync_yfinance.py`, `index_service.py` and the bundled snapshots carry `sourcePolicy` (`price_only` / `approved_total_return` / `blocked_proxy_tri`), `returnBasis`, `sourceName`, `sourceUrl`, `licenseNote`, `retrievalMethod`, `updateCadence`, `lastVerifiedDate`.
2. **Per-instrument capability:** the Verified Instrument Registry (SQLite: `instruments`, `instrument_provider_mappings` with capability flags such as `priceHistory`, `fundamentals`, `optionsUnderlying`; `verified` vs `legacy`). Principle in FOR_AKSINGH.md: "search is not identity".
3. **Provider adapters + router:** yfinance, yahoo_finance15 (RapidAPI), Finnhub; Databento has only a connection test. Principle: "source truth should be per claim, not per vendor brand" (Nifty 500 membership from the NSE/Nifty Indices CSV; fundamentals from Finnhub).

*Where candidate sources are parked today (scattered across four places):*
- `docs/research/options-providers/`: India (21) and US (24) option-chain provider CSVs plus recommendations, dated 2026-05-16.
- `docs/planned-features/true-total-return-sourcing.md`: an "approved source list" concept with licensing posture (bundle / cache locally / user machine only). The list is currently empty.
- `docs/planned-features/event-study.md` and `news-etl-pipeline.md`: news-source candidate tables and roles.
- `vendors/global-stock-data` and `.env.example` (Databento, Finnhub, RapidAPI keys).

*Bearing on O06:*
- The codebase has **zero** handling of delisting or survivorship (no matches for delist / survivor / point-in-time outside the new planning docs). So O06 is a real gap, not a duplicate.
- The existing Nifty 500 universe is honestly named `nifty-500-current`: today's members only. Correct for today's fundamentals, unusable as a point-in-time event-study universe.
- Precedent: the repo already fetches NSE files directly (`archives.nseindia.com` constituents CSV), so NSE direct fetch is an accepted pattern here.
- The store already has `daily_prices`, `corporate_actions` and `symbol_universes` tables, which a bhavcopy archive could feed, subject to design.

Conclusion: the bhavcopy recommendation stands, and it fits existing tables and precedent. The user's registry idea fills the missing middle layer: a **source-level** registry (which sources exist, what each is approved for, licence posture, status, docs), sitting between per-dataset provenance and per-instrument capability.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate, Open Decision

**Decision / Tension:**
Confirmed (user direction): create a data-sources registry that parks all good candidates with documentation. O06 bhavcopy: accepted in principle ("makes sense"), to be entered in the registry as a candidate rather than wired directly. Open: the registry's shape and home.

**Later Edit Candidate:**
Create a data-sources registry consolidating the four scattered candidate lists, with per-source docs. Add a delisting/point-in-time capability to the planning docs. Not applied during interview.

**Potential Open Decisions:**
- Registry home and format (docs Markdown vs machine-readable JSON as source of truth, like `workflow-map.json`).
- Registry fields and status lifecycle.

## Q30 - Registry home and format

**Question:**
Where and in what format should the registry live? Recommendation: a machine-readable `docs/data-sources/registry.json` as the master copy, with one short Markdown page per source beside it (same pattern as `workflow-map.json`). Alternative: Markdown only.

**Answer / Reasoning:**
User answer (verbatim): "ur choice"

Agent decision: JSON master plus one Markdown page per source. Reason: the app must read the registry when it checks for data gaps (D18), and it can read JSON but not prose. The Markdown pages hold the human documentation (what was tested, licence notes, caveats) and are linked from each JSON entry. A validation check should keep the two in sync, so they cannot drift (lesson from the junior repo).

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed by delegation: data-sources registry = `docs/data-sources/registry.json` (master) + `docs/data-sources/<source-id>.md` per source, with a validation check.

**Later Edit Candidate:**
Create `docs/data-sources/` with the registry JSON, per-source pages, and a validator. Migrate candidates from options-providers CSVs, the TRI approved-source list, news-source tables, vendors/, and the current adapters. Not applied during interview.

**Potential Open Decisions:**
- Registry fields and status lifecycle (next question).

## Q31 - Registry stages and fields

**Question:**
What stages should a source move through in the registry? Recommendation: (1) Candidate, (2) Tested, (3) Approved for a specific use (per claim), (4) Wired in, (5) Retired or blocked, with the reason kept and nothing deleted. Each entry also records coverage (markets, history depth), licence posture (store / local cache only / don't store), whether an API key is needed, whether history can be trusted as of a past date, and when it was last checked.

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. Two notes for the build:
- "Approved" is always *per use*. One source can be approved for one claim and only a candidate for another (e.g. Finnhub: wired for symbol master and fundamentals, tested and thin for India news).
- Status moves are logged with a date and the evidence that justified them, matching the instrument registry's verified-vs-legacy discipline.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: five-stage lifecycle with per-use approval, plus coverage, licence posture, key requirement, point-in-time trust, and last-checked date. O11 resolved.

**Later Edit Candidate:**
Encode the lifecycle and fields in the registry JSON schema and validator. Not applied during interview.

## Q32 - O03 sample-size warning levels

**Question:**
Four warning levels by number of separate events: under 8 "very thin", 8–19 "thin", 20–99 "moderate", 100+ "adequate", with the exact count and a "without the top 2 events" check always shown. Do you accept?

**Answer / Reasoning:**
User answer (verbatim): "as long as it is clear to the user and convention is followed i am ok"

Conditional acceptance: clear to the user, and following convention. Honest correction: the proposed 8 / 20 cut-offs came from this repo's own draft sketch, not from an external convention. The convention found in the Q1 research is the practitioner one: about 30 trades as an absolute floor, 100+ for expectancy to mean much, and 200+ for profit factor to stabilise. To meet the user's condition, the levels are re-based on that convention:

- under 30: **below the usual minimum** (read events individually);
- 30–99: **limited**;
- 100–199: **adequate for averages**;
- 200+: **strong**.

The exact count and the top-2-removed check are always shown. Labels are plain words, each with a one-line meaning in the report.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed (conditional on clarity and convention): warning levels at 30 / 100 / 200 independent events, plain labels, count and top-2-removed always visible. O03 resolved. Note: the repo's draft thresholds (8 / 20) are replaced by the convention-based ones.

**Later Edit Candidate:**
In event-study.md and the metric-registry draft: replace the 8 / 20 suppression thresholds with the 30 / 100 / 200 warning levels and wording. Not applied during interview.

## Q33 - O01 result labels

**Question:**
Result labels, following practitioner convention: profit factor under 1.3 weak, 1.5 acceptable, 2.0+ strong; average result per trade after costs must be above zero, and still above zero at double costs; drawdown reported but not labelled, because it depends on position size (deployment study). Do you accept?

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. Since capital moved to a separate study (D06), these are labels shown in the report (warn-don't-block, D08), not capital gates.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: PF bands <1.3 weak / ≥1.5 acceptable / ≥2.0 strong; after-cost expectancy > 0 at 1× and 2× costs; drawdown reported unlabelled. O01 resolved.

**Later Edit Candidate:**
Add these labels to the signal qualification scorecard in event-study.md and the metric-registry draft. Not applied during interview.

## Q34 - O02 guarding against picking the best of many versions

**Question:**
Start simple: count every version tried (holding period, long/short, size split) automatically per study; show it in plain words ("Best of 14 versions tried. Expect some lucky results at this count."); add formal deflated Sharpe / PBO later, once a signal has enough trades. Do you accept?

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. Fits D08 (warn, don't block): results are never hidden, but the search effort behind them is always shown.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: automatic per-study trial count, shown in plain words beside results; formal deflated Sharpe / PBO deferred until trade counts support them. O02 resolved.

**Later Edit Candidate:**
In event-study.md: add a per-study trial ledger (every variant run is counted, linked to the run ledger) and the plain-language disclosure line. Not applied during interview.

## Q35 - O08 stopping rule for gap-filling searches

**Question:**
Fixed before the search starts: (1) what gets searched (date range, fixed terms, fixed sources per event type); (2) when it stops (one full pass, or a second pass finds nothing new, or the call/cost budget runs out, whichever is first); (3) the stopping decision never sees stock returns. Bonus: overlap between two search tools gives a rough estimate of events both missed. Do you accept?

**Answer / Reasoning:**
User answer (verbatim): "yes"

Accepted. The overlap estimate is the standard capture–recapture idea: if two independent searches each find many of the same events, few are likely missed; little overlap means many are. It assumes the tools search independently, which is only roughly true, so it is reported as a rough estimate.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: search scope, stopping rule and budget fixed before the search; stopping is blind to returns; two-tool overlap reported as a rough coverage estimate. O08 resolved.

**Later Edit Candidate:**
Record the search scope, stopping rule, budget and overlap estimate in the frozen plan (event-study.md feasibility step). The search mechanics belong to the separate News DB & ETL interview. Not applied during interview.

## Q36 - O07 clarifying-question limit

**Question:**
Soft limit of 5 clarifying questions when starting a study: ask only when the answer changes the result; everything else gets a default shown in the plan read-back; the user can ask for more. Do you accept?

**Answer / Reasoning:**
User answer (verbatim): "sure"

Accepted.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: soft cap of 5 result-changing questions; defaults go to the read-back; the user can extend. O07 resolved.

**Later Edit Candidate:**
Add the soft cap and the "only result-changing questions" rule to the commissioning flow (D16). Not applied during interview.

## Q37 - O04 event-type list

**Question:**
Keep event types in a small registry like the data-sources one. Each entry holds a plain definition, the filing wording/category that identifies it, which announcement counts as the start date, and regulatory-check notes (D34); per-signal settings (D33) live here. New types arrive through the commissioning flow: the agent drafts a definition and the user confirms. Agent drafts, only the user approves. Lifecycle: draft → tested (after its first study) → retired, never deleted. Do you accept?

**Answer / Reasoning:**
User answer (verbatim): "yes" (sent twice, plus a third "yes" after an empty agent turn; treated as one acceptance).

Accepted.

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: event-type registry with agent-drafted, user-approved definitions; draft → tested → retired lifecycle; per-signal settings live in each entry. O04 resolved.

**Later Edit Candidate:**
Create an event-type registry beside the data-sources registry (same JSON + Markdown pattern, D38), seeded with tax/enforcement raids. Not applied during interview.

## Q38 - O05 second event type

**Question:**
If raids turn out to be too rare, should order wins be the second event type tested?

**Answer / Reasoning:**
User answer (verbatim): "have more than one recommendation order wins , c level changes maybe ?"

The user wants a queue of candidates, not a single second type. Agent proposal: an ordered queue, where each type is chosen to exercise a *different* general primitive (D33), not to find the best trade.

1. **Order wins:** frequent; good news / long side; a stated rupee value tests number extraction and order-size-vs-company-size.
2. **Top-management exits (CEO / CFO / MD resignations):** mandatory exchange disclosures; often bad news with an *unstated* reason, which tests the case where the filing hides the real story. CFO exits are a known red flag in practice.
3. **Credit rating changes:** downgrades and upgrades filed by companies and published by rating agencies; tests a *second, independent source* confirming the same event, and a graded size (one notch vs several).
4. **Index additions and deletions:** dates announced *in advance*; tests price moves *before* the event date (the market trades the announcement, not the effective day), and forced buying/selling by index funds.

Auditor resignations were also considered, but held back: they are rare (the same sample problem as raids) and largely overlap with item 2's "unstated reason" test.

**Architecture / Initiative Impact:**
Open Decision

**Decision / Tension:**
Proposed (pending acceptance): replace "a second event type" with an ordered candidate queue (order wins → management exits → rating changes → index changes), all provisional under D10.

**Later Edit Candidate:**
Seed the event-type registry (D46) with these as `draft` entries. Not applied during interview.

## Q39 - Accept the event-type queue

**Question:**
Do you accept this queue, in this order: order wins, management exits, rating changes, index changes? All four stay provisional.

**Answer / Reasoning:**
User answer (verbatim): "yes take small steps"

Accepted, with a pacing instruction: one event type at a time, in queue order. The next type starts only after the previous study has run and its lessons are recorded.

**Architecture / Initiative Impact:**
Confirmed

**Decision / Tension:**
Confirmed: ordered queue after raids (order wins → management exits → rating changes → index changes), taken one at a time. O05 resolved.

**Later Edit Candidate:**
As recorded under Q38.

## Q40 - O09 trust scope

**Question:**
Should trust in the review gate be tracked separately for each event type, or once overall? Recommendation: per event type. Each new type starts in review-every-event mode and earns batch approval on its own record (80% unchanged over 50 reviews); source and company-matching track record shown as background.

**Answer / Reasoning:**
User answer (verbatim): "sure"

Accepted. Consistent with the user's Q24 remark that the window "dependends so much on the incident".

**Architecture / Initiative Impact:**
Confirmed, Later Edit Candidate

**Decision / Tension:**
Confirmed: trust is earned per event type; each new type starts at per-event review. O09 resolved. All ten original open questions (O01–O10) and O11 are now resolved.

**Later Edit Candidate:**
In news-etl-pipeline.md's curation gate: acceptance rate computed per event type; new types start in per-event review. Not applied during interview.

## Q41 - Consolidate now?

**Question:**
Should I write the wrap-up now, or is there something else you want to probe first?

**Answer / Reasoning:**
User answer (verbatim): "yes"

Entering consolidation mode.

## Consolidation - 2026-11-07

### Confirmed Principles
- **Purpose:** plain-language, filing-sourced event studies that find out whether an event type leaves a tradable, slower-frequency edge. No intraday, no HFT (D02).
- **Raids are a probe, not the product:** the process stays signal-agnostic; signal specifics are per-signal settings (D33). Everything is provisional until tested (D10). Small steps, one event type at a time (D47).
- **Events, not labels:** grouped by plain filing type; behaviour is discovered, never assumed (D09). Queue after raids: order wins → management exits → rating changes → index changes (D11, D47).
- **The study measures the signal, not the money:** same virtual amount per trade on plain stocks (D06, D07). Sizing, capital and instruments are a separate deployment study.
- **Holding period is an output** of the backtest, then frozen and forward-tracked (D03).
- **Warn, never block:** sample size, missing placebo, versions tried, and review error rate are always shown, and the trader decides (D08, D41, D43).
- **Scorecard labels follow convention:** <30 / 30–99 / 100–199 / 200+ events; PF <1.3 weak, ≥1.5 acceptable, ≥2.0 strong; after-cost expectancy >0 at 1× and 2× costs; drawdown unlabelled (D41, D42).
- **Kill rule:** no tradable long or short effect after costs vs the same-period index (D25), Nifty 500 for India under a general "broad index matching the universe" rule (D32, D35, D36).
- **Honest universe:** every listed stock at the time, delisted included, attributes measured before the event, every slice disclosed (D12, D13). A point-in-time regulatory/tradability check per signal (D34).
- **Commissioning:** sentence → up to ~5 result-changing questions → plan read-back with defaults → data check → lock → run; changes after results are new runs (D15–D17, D45). Monitoring waits until a signal passes (D14).
- **Data gaps:** the app detects and classifies gaps itself, may trigger news discovery, fixes the search scope and stop rule in advance, never stops on returns, and reports coverage (D18, D19, D44).
- **Review gate:** per-event review first; batch at ≥80% unchanged over 50 reviews, earned per event type (D20–D22, D48). Dates: late ≤1 day is fine; too-early or wrong-announcement dates block (D24).
- **Registries:** a data-sources registry (JSON master + per-source pages, five-stage lifecycle with per-use approval) and an event-type registry on the same pattern (D37, D38, D40, D46). NSE bhavcopy is the candidate for point-in-time Indian prices and stock lists (D39).

### Open Tensions
- **Placebo optional (D32) vs statistical credibility (D05):** a falling-then-bouncing stock can look like an event effect. Mitigated only by the warning.
- **D05 is still worded as a capital gate,** while D06/D08 moved capital out of scope and made checks warn-only. It should be reworded as "what the scorecard shows", with capital decided in the deployment study.
- **Warn-only vs the repo's suppression culture:** the metric registry hides metrics below thresholds today. Event studies would label instead. The two styles must be reconciled deliberately, not left inconsistent.
- **80% batch threshold:** up to about 1 in 5 events may carry an uncorrected error. Shown in reports, but real.
- **Dating depends on work not yet done:** no tested tool dates filings authoritatively (pre-interview bake-off). This rests on the deferred News DB & ETL interview.
- **Bhavcopy is untested here:** it is NSE-only (BSE-only names missing), local copy only under NSE terms, and needs our own rename and corporate-action handling. Meanwhile, today's yfinance path may *invent* prices for suspended names.

### Open Decisions
- Date tolerance rule in detail (D23, delegated to the agent within D24).
- When to run the separate News DB & ETL interview (D04).
- When, if ever, the placebo becomes mandatory.
- Register generator and interview-skill amendment, after this trial (D29).

### Later Edit Candidates
- **`docs/planned-features/event-study.md`:** drop the 2×2 grouping and use filing types; frame raids as the first probe and separate general primitives from per-signal settings; uniform virtual notional on cash equity; same-period Nifty 500 benchmark with an optional, warned placebo; two-sided kill rule; horizon profile; warning levels and result labels replacing 8/20 suppression; versions-tried ledger; t0 attributes, delisted universe, tradability flags; regulatory check step; feasibility gap → news path with a fixed stop rule; monitoring deferred.
- **`docs/planned-features/news-etl-pipeline.md`:** curation gate with per-field outcomes, 80%/50 per event type, date blocking rules, monitoring deferred. (The pipeline design itself goes to the separate interview.)
- **Metric-registry draft for the event-study domain:** warning bands and result labels instead of suppression.
- **Study Factory / AI Study Builder flow:** clarifying questions (soft cap 5), plain read-back, clarifying Q&A frozen as pre-registration.
- **New `docs/data-sources/`:** `registry.json`, per-source pages, validator; migrate the options-provider CSVs, TRI approved list, news candidates, vendors/, and current adapters.
- **New event-type registry:** raids plus the four queued types as drafts.
- **New planned feature:** deployment methodology (sizing, instruments, liquidity, leverage).
- **Outside this repo:** propose the register-in-skill amendment after the trial.

### Suggested Next Step
- Exit interview mode, then in small steps: (1) apply the `event-study.md` edits in one reviewed pass; (2) create `docs/data-sources/` seeded from the existing scattered lists; (3) test bhavcopy on a few dates with known delisted/suspended names (e.g. HDIL, RCOM); (4) run the News DB & ETL interview; (5) only then, the first raids study with Polycab as the hand-checked case.

## Interview Closed - 2026-11-07

User instruction (verbatim): "end the itnerview - dont do step 1 yet."

Interview mode ended. No later edit candidates have been applied; canonical artifacts (`event-study.md`, `news-etl-pipeline.md`, schemas, code) are unchanged by this interview. Step 1 of the suggested next steps (apply `event-study.md` edits) is explicitly on hold until the user asks. The Decision Register trial (D28) remains the current-state index for this interview.

## Protocol Note - Files relocated (2026-11-07)

On committing, this log and the Decision Register moved from the repo root (`Alignment Interview.md`, `Decision Register.md`) to `docs/alignment/alignment-interview.md` and `docs/alignment/decision-register.md`, following the junior repo's convention of keeping alignment records under `docs/`. Earlier entries that mention the root filenames are historical and left unchanged.

## Post-interview Amendment - super-advisor review (2026-11-07)

After the interview closed, the decisions were shared with the super-advisor agent (`/Users/aksingh/agents/super_advisor_agent@super`, reply id `01a1b4e7-a62e-7127-83c0-ec71db82ce8a`), which reviewed commit `949a532` and recommended "reframe": keep the small filing-sourced probe, but fix publication rights and event-time validity before expanding infrastructure.

User ruling (verbatim): "agreed unless its buildiong more machinery without reason"

Rulings accepted, with the user's condition as a standing rule:

1. **Placebo:** optional for exploration; **required before a study is used to justify capital**. Control design frozen before results. Amends D32.
2. **Metrics:** one metric registry with consistent meanings and declared per-domain criteria. Exploratory event results are shown with warnings but are not qualified headlines merely because suppression is off. Correction: the agent's claim that the rest of the app "hides" weak metrics was too broad (the manifest already allows diagnostics with context).
3. **Review gate:** critical fields (event validity, issuer identity, first-public time) are source-verified **per admitted event**, always. Batch approval covers non-critical fields only. Critical-field corrections are measured separately; no new percentage threshold is invented. Partially supersedes D21. Correction to Q12–Q13 reasoning: a wrong date does not only bias toward "no effect", and a late date is **not** always conservative. It can move entry past a loss into a rebound. A deliberate delayed entry is a strategy setting, not a timestamp tolerance.
4. **Sequence:** next work is one hand-fed Polycab end-to-end check (first public time → eligible entry → prices/actions → benchmark → result), then a bounded historical-price/listing feasibility check including suspended/delisted names. The registry is seeded only with sources actually used; the problems found scope the News DB & ETL interview. The hold on applying `event-study.md` edits stays.
5. **First probe:** raids stay for wiring. A return-blind event-count/coverage census comes before choosing the first aggregate study. Switch to order wins only if it gives a materially better independent sample.
6. **Yahoo data:** stop committing and publishing it. A private repo or the library licence would not grant data rights. Existing public history needs a separate owner disposition (no history rewrite).
7. **Certainty labels:** sample-count and profit-factor bands become descriptive, not quality claims (no "adequate" or "strong"), because dependence, effect size, variance and search count matter; overlapping same-entity clusters are not automatically independent. D05 becomes a research scorecard; capital belongs to the deployment study.

Standing rule from the user's condition: no new machinery without a demonstrated reason. Each build step must be justified by a concrete failure or need found in the hand-fed probe.
