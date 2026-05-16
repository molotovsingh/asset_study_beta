# Assistant Evidence Boundaries and Model-Risk Notes

_Research refresh: 2026-05-15_

This memo is about the future in-app AI assistant, not about option pricing or signal quality. The key question is:

> If an assistant eventually explains studies, proposes reruns, or helps build research plans, what must the app record and control so the assistant does not become a confident hallucination layer?

The short answer: the assistant should consume deterministic backend evidence packets, not scrape UI text or improvise from chat history.

## Sources reviewed

| Source | Why it matters here |
|---|---|
| [NIST AI Risk Management Framework 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) | General AI-risk framing: governance, mapping context, measuring risk, and managing risk over the lifecycle. |
| [FINRA Regulatory Notice 24-09](https://www.finra.org/rules-guidance/notices/24-09) | Securities-industry reminder that generative AI use still needs governance, model-risk management, data integrity, reliability, accuracy, and supervision. |
| [SEC Division of Examinations 2025 Priorities](https://www.sec.gov/newsroom/press-releases/2024-172) | Confirms AI is a named emerging-risk focus alongside fiduciary duty, conduct standards, cybersecurity, records, and controls. |
| [IOSCO Final Report on AI/ML by Market Intermediaries and Asset Managers](https://www.iosco.org/library/pubdocs/pdf/IOSCOPD684.pdf) | Financial-market AI/ML risks cluster around governance, oversight, testing, monitoring, data quality, bias, explainability, outsourcing, and accountability. |

## What the sources imply for this app

The app is not a regulated broker-dealer or adviser. Still, the engineering lesson transfers cleanly: once an assistant touches financial analytics, the system needs evidence discipline before it needs conversational polish.

The dangerous failure is not that the assistant says "I don't know." The dangerous failure is that it says something plausible from incomplete context.

For `asset_study_beta`, that means the assistant should never be the source of truth for:

- which studies exist
- which parameters are allowed
- which symbols resolved
- what data window was actually available
- whether a metric is headline-safe, diagnostic-only, export-safe, or suppressed
- whether a completed run failed, clipped, warned, or lacked evidence
- whether a run can be replayed safely

Those facts need to come from contracts and ledgers the backend owns.

## Product rule

The assistant can be a translator, explainer, and workflow helper.

The assistant should not be a hidden analytics engine.

That is why the current direction is correct:

- `docs/assistant-contract.json` defines what assistant consumers are allowed to rely on.
- `GET /api/assistant/contract` exposes the contract through the backend.
- `GET /api/assistant/contract-bundle` exposes the broader deterministic rulebook in one payload.
- `GET /api/assistant/readiness` proves that deterministic rulebook is currently loadable, route-wired, and generated-doc aligned without requiring any live AI key.
- `POST /api/assistant/study-plan-dry-run` exercises the planning boundary end-to-end without executing a study or calling an AI model.
- `POST /api/assistant/study-plan-live-draft` is the first optional live-model boundary: OpenAI may draft StudyPlan JSON, but deterministic validation still decides whether the output can be handed to the app.
- `study-plan-v1` turns user intent into a validated route proposal.
- backend StudyPlan recipes store reusable validated requests, not evidence.
- `study_runs` records completed runs.
- `POST /api/assistant/study-run-brief` returns the exact run, handoff, and explanation brief from durable records.
- explanation briefs decide whether result conclusions are allowed, blocked, or caveated.

This is the right split: the model can write, but the app decides what the model is allowed to write from.

## Practical design standards

### 1. No UI scraping for assistant truth

Rendered HTML is for humans. It may contain formatting, labels, omissions, shortened dates, and context that is obvious visually but ambiguous programmatically.

The assistant should read structured payloads:

- assistant contract bundle
- StudyPlan validation response
- study-run ledger payload
- assistant handoff payload
- explanation brief payload
- metric registry manifest

### 2. Permission envelopes before prose

The assistant should not decide from scratch whether it can explain a run. The backend should decide that first.

For example:

- failed run: explain failure only
- clipped run: explain result with mandatory caveats
- short-window annualized metric: do not headline CAGR-like claims
- missing evidence links: do not pretend provenance is complete
- no replayable route: do not offer one-click replay

This is why `study-run-explanation-brief-v1` matters. It is not prose. It is the rule card for future prose.

### 3. Saved recipes are not evidence

A saved StudyPlan recipe is like a saved order-ticket template. It proves only that a request shape was valid when saved.

It does not prove:

- the study was run
- the result was good
- the data was fresh
- the signal matured
- the trade worked

That distinction is essential. If the future assistant confuses recipes with evidence, it will overstate what the system knows.

### 4. Metric policy must be machine-readable

The assistant should not infer metric safety from labels like "CAGR", "Sharpe", or "Win Rate." It should read the registry.

The cross-study metric registry is therefore not just UI cleanup. It is the assistant's non-hallucination rulebook:

- headline-safe metrics can be emphasized
- diagnostic metrics need sample/context caveats
- suppressed metrics should not be promoted
- export behavior should be explicit
- maturity thresholds should block overconfident summaries

### 5. Evidence history and operational history are separate

An assistant needs to know both what happened and whether the machinery was healthy.

Evidence history answers:

- What was the archived signal?
- What was the exact run?
- What did the tracked contract do?
- What matured by the requested horizon?

Operational history answers:

- Did the collector run?
- Which symbols were stale?
- Which provider failed?
- Which universes were incomplete?

Do not collapse these into one generic "history" object. They support different judgments.

## Engineering implications

The backend should keep moving toward small, explicit facades:

- assistant service for assistant-owned API boundaries
- study-builder service for route/plan/recipe validation
- study-run service for durable completed-run records
- runtime-store domain modules for local SQLite persistence
- options domain modules for screener, tracking, and validation evidence

This is not overengineering. It is how a local research app stays honest as it grows.

The danger is a giant `assistant_service.py` or `main.js` that starts "helpfully" joining every concept together. The assistant boundary should stay boring:

```text
request id or intent
  -> load deterministic contracts/evidence
  -> validate shape
  -> return permissioned payload
  -> future model may explain only within that envelope
```

## What to build later

Good next assistant-adjacent slices:

- Add UI consumption of `GET /api/assistant/contract-bundle` inside the Study Builder settings page for visible contract health.
- Add export/import for backend StudyPlan recipes only if recipes become hard to recreate manually.
- Add assistant brief snapshots to durable run exports so an explanation can be reproduced later.
- Add a test fixture where a run has multiple caveats and prove the assistant brief blocks unsupported claims.
- Add visible UI consumption of `GET /api/assistant/readiness`; the backend and CLI preflight already exist.

Bad next slices:

- Let an LLM call run a study directly.
- Let generated prose use screen text instead of `study-run-brief`.
- Let the assistant invent a metric outside the registry.
- Let recipes masquerade as completed evidence.
- Add a chat UI before the deterministic boundaries are boring and stable.

## Bottom line

The app is moving in the right direction if the future assistant feels constrained.

That constraint is the product. It keeps the assistant useful without letting it become a second, untested analytics system hiding behind friendly language.
