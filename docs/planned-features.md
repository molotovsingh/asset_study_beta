# Planned Features

This file is the parking lot for product directions that are real enough to preserve, but not yet implementation tickets.

The rule for this repo is simple: if a future feature matters, it should have a named planning document, a rough architecture path, and a clear boundary against the current app. That keeps ideas from becoming stray chat notes.

## Active Planned Tracks

| Feature | Status | Planning doc | Why it matters |
| --- | --- | --- | --- |
| AI Study Builder | Planned | [AI Study Builder](planned-features/ai-study-builder.md) | Lets users describe the study they want in natural language while keeping the app's deterministic study engine, metric policy, and data-window validation in control. |
| Agentic Study Factory | Read-only proposal slice implemented | [Agentic Study Factory](planned-features/agentic-study-factory.md) | Evaluates whether a new study idea has existing-study coverage, approved tools, evidence requirements, and caveats before code, data fetching, or conclusions exist. |
| True Total-Return Sourcing | Strict policy + source metadata implemented; no approved source configured | [True Total-Return Sourcing](planned-features/true-total-return-sourcing.md) | Blocks TRI-labeled runs until approved true total-return evidence exists, and exposes source-policy metadata while true-TRI ingestion remains intentionally unavailable. |
| Event Study | Sketched | [Event Study](planned-features/event-study.md) | First non-single-series study type: sourced event sets, event-window abnormal returns vs a market model, placebo controls, and governed aggregate metrics — the computation layer natural-language event hypotheses (raids, orders, bans, guidance shocks) need before any edge claim. |
| News ETL Pipeline | Sketched | [News ETL Pipeline](planned-features/news-etl-pipeline.md) | Vendor-agnostic ideal workflow that turns filings and discovery hits into frozen, replayable event sets for the Event Study: watch spec, discovery, immutable archive, resolution, extraction, curation gate, freeze. Vendors qualify per role against a golden corpus; starts at hand-fed BSE URLs. |

## Parked Vision Tracks

| Feature | Status | Planning doc | Why it matters |
| --- | --- | --- | --- |
| Full Agentic Study Factory | Vision parked | [Agentic Study Factory](planned-features/agentic-study-factory.md) | Explores whether an app-controlled agent could use approved data/news/API tools to design new studies, but only after deterministic proposal and evidence contracts mature. |

## Graduation Rule

A planned feature can move toward implementation when it has:

- a user-facing workflow
- a strict data contract
- a deterministic validation gate
- a list of non-goals
- a first slice small enough to test in isolation

For this repo, that matters because market-study software can look confident even when its assumptions are weak. Planned features should strengthen the trust model before they add surface area.
