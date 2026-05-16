# Agentic Study Factory

## Status

Vision parked. First read-only proposal slice is now implemented.

This is the bigger idea behind an app-controlled research agent: a user brings a study idea, the app gives the agent approved data/news/API tools, and the agent helps decide whether the idea is testable before anyone writes code or trusts a result.

This is intentionally beyond the current AI Study Builder. The current Study Builder maps intent to existing study routes. This vision asks whether the system can design new studies responsibly.

The implemented slice is deliberately small: `POST /api/study-factory/proposal` returns a deterministic `study-proposal-v1` packet. It does not call an LLM, fetch external data, generate code, execute a study, or write artifacts. It only answers: what does this idea need, does an existing study already cover part of it, what tools are missing, and what caveats must block over-reading?

## Product Thesis

The useful agent is not an autonomous trader and not a hidden analytics engine.

The useful agent is a research architect:

```text
study idea
  -> inspect approved data/news/tool catalog
  -> decide whether the idea is testable
  -> propose data contract and metrics
  -> expose caveats and failure modes
  -> produce a reviewable study proposal
  -> only then consider implementation
```

The point is not speed alone. The point is disciplined exploration. A good agent should save time by rejecting weak ideas early, identifying missing data, and forcing hypotheses into explicit evidence contracts.

## What The Agent Could Do

- Translate a rough idea into a testable hypothesis.
- Identify required datasets, fields, lookback windows, freshness needs, and provider risks.
- Query approved data/news APIs to assess feasibility.
- Build a `study-proposal-v1` object with inputs, metrics, caveats, and validation rules.
- State when an idea is not testable with current tools.
- Recommend whether the idea maps to an existing study, an options evidence workflow, or a genuinely new study.
- Produce implementation scope only after the proposal passes deterministic validation.

## What It Must Not Do

- It must not silently add a study to the live app.
- It must not invent datasets, fields, metrics, or provider capabilities.
- It must not treat news text as evidence without archiving source IDs, timestamps, queries, and extraction logic.
- It must not convert a narrative idea into a conclusion before the data pipeline exists.
- It must not bypass the metric registry, study catalog, runtime store, or evidence ledger.
- It must not give trading advice.

## Required Contracts

A future version should have explicit contracts before implementation:

- `tool-catalog-v1`: approved APIs, auth requirements, rate limits, fields, and allowed use.
- `study-proposal-v1`: hypothesis, universe, inputs, metrics, windows, caveats, and proposed outputs.
- `data-feasibility-report-v1`: what data exists, what is missing, provider reliability, and minimum viable sample depth.
- `news-evidence-extraction-v1`: source query, article IDs, timestamps, extracted event labels, confidence, and archived raw references.
- `implementation-plan-v1`: files to add/change, tests required, schema impact, and non-goals.

The important distinction:

- a proposal is not evidence
- an article is not a signal
- a generated implementation plan is not a merged study
- a study result is not validated until it is archived and matured

## Implemented Read-Only Slice

The first slice is read-only:

```text
User: "Can we study whether RBI policy headlines move bank index volatility?"

Backend returns:
  - whether existing studies already cover it
  - required data sources
  - whether news timestamps and market data granularity are sufficient
  - proposed metrics
  - caveats
  - "build / do not build yet" recommendation
```

No code generation. No route execution. No result prose.

The route is:

```text
POST /api/study-factory/proposal
```

The request shape is:

```json
{
  "idea": "Can RBI policy headlines move bank index volatility?",
  "approvedTools": [
    {
      "id": "example-news-archive",
      "label": "Example news archive",
      "kind": "news"
    }
  ]
}
```

The response is versioned as `study-proposal-response-v1` and contains:

- `proposal`: the `study-proposal-v1` feasibility packet.
- `execution`: explicit proof that nothing ran, no code was generated, and no external data was fetched.

The generated contract lives at `docs/study-proposal-contract.json`, sourced from `app/studyFactory/studyProposal.js`. Python calls that same JS builder through `scripts/build_study_proposal_payload.mjs`; it does not reimplement the rules.

## Why The Full Agent Belongs Later

The app is still building the foundations:

- durable study-run ledger
- options evidence archive
- metric registry
- assistant contracts
- readiness checks
- StudyPlan validation
- backend-owned handoff packets

Those foundations matter because an agentic study factory without evidence discipline becomes a hallucination factory. The agent should arrive after the app can prove what it saw, when it saw it, and how it measured it.

## Practical North Star

The agent should be allowed to ask:

> "Can this idea be tested with the approved tools we have?"

It should not be allowed to imply:

> "This idea is true because I can produce a convincing study-shaped answer."

That is the product line to protect.
