# True Total-Return Index Sourcing Decision Packet

## Summary

The app now treats return basis as a first-class data contract: `price`, `total_return`, or `proxy`. That protects users from quietly reading price-only data as dividend-inclusive evidence.

The selected policy is **Strict True TRI**. TRI-labeled index-study runs are blocked unless the loaded data is approved true total-return data. Price and proxy datasets remain valid only when they are not presented as true TRI evidence.

## Current State

- `returnBasis` is already exposed by synced index datasets.
- `Price` datasets remain valid for price-return studies.
- Current Nifty/Sensex TRI bootstrap datasets are marked as `proxy`, not `total_return`.
- Assistant explanation seeds and briefs preserve the warning text: price data used as a TRI proxy must not be treated as true total-return evidence.
- The correct current behavior is to block TRI-labeled runs when only proxy data is available, not pretend the proxy is solved.

## Current Guardrails Already In Place

These are not the final source-approval policy. They are the safety rails that prevent the app from overstating current evidence while approved true total-return sourcing remains incomplete.

| Guardrail | Where It Lives | What It Prevents |
| --- | --- | --- |
| Return-basis normalization | `app/studies/shared/returnBasis.js` | Price data cannot claim `total_return` when source and target series types differ. |
| Source-policy metadata | `scripts/sync_yfinance.py` and bundled yfinance snapshots | Current datasets expose whether they are `price_only`, `approved_total_return`, or `blocked_proxy_tri`. |
| Strict TRI run block | `app/studies/shared/indexStudyPipeline.js` | TRI-labeled runs stop before study calculation when the loaded data is not true total-return data. |
| Index-study warning injection | `app/studies/shared/indexStudyPipeline.js` | Non-blocking proxy contexts still carry explicit warnings into study results. |
| Selection display caveat | `app/studies/shared/selectionSummaryView.js` | Users see the return-basis label and proxy warning near the selected asset. |
| Durable warning ledger | `scripts/runtime_store_runs.py` | Warning messages are preserved and deduplicated when runs are written. |
| Assistant explanation caveats | `app/studyBuilder/studyRunExplanation.js` and `app/studyBuilder/studyRunExplanationBrief.js` | Future assistant prose must repeat proxy warnings instead of converting them into conclusions. |
| Snapshot validation | `scripts/validate_yfinance_snapshots.py` | Bundled yfinance snapshots and manifests must agree on return basis. |

Regression coverage currently lives in:

- `scripts/test_yfinance_sync_idempotence.py`
- `scripts/test_symbol_discovery.mjs`
- `scripts/test_study_run_service.py`
- `scripts/test_assistant_service.py`
- `scripts/test_study_builder.mjs`
- `scripts/run_frontend_regression_checks.mjs`

The next true-TRI implementation should add tests, not weaken these. In particular, any true source must prove why `returnBasis: "total_return"` is justified.

## Selected Decision

| Decision | Why It Matters |
| --- | --- |
| Approved source list | Prevents ad hoc mixing of NSE files, Yahoo price series, manual CSVs, and scraped pages. |
| Licensing posture | Determines whether data can be bundled in the repo, cached locally, or only loaded by the user's machine. |
| Universe scope | Nifty 50/Sensex only is a different implementation problem from broad NSE sector and market-cap TRI coverage. |
| Fallback behavior | Chosen: missing true TRI blocks TRI-labeled runs. It does not downgrade to proxy under the same label. |
| Update cadence | Long-term return studies need reproducible data windows; stale TRI data must be visible. |

## Candidate Policies Considered

### Policy A: Strict True TRI - Selected

Use only approved total-return sources for TRI-labeled datasets. If true TRI is unavailable, the app does not run that dataset as TRI.

Use when:
- user trust matters more than convenience
- results may be cited outside casual exploration
- licensing/source provenance can be resolved cleanly

Tradeoff:
- fewer symbols and more blocked runs until sourcing is solved

### Policy B: Explicit Proxy Mode

Allow price proxies only when they are visibly marked as `proxy`, with warnings in the UI, ledger, exports, and assistant briefs.

Use when:
- exploratory research should continue
- the app must remain useful while data sourcing is incomplete
- users can tolerate strong caveats

Tradeoff:
- users may still over-read proxy results unless UI and assistant caveats stay prominent

### Policy C: Dual Track

Support both true TRI and proxy datasets, but never under the same label. Example: `Nifty 50 TRI` for true TRI, `Nifty 50 TRI Proxy` for proxy.

Use when:
- broad exploration and strict evidence both matter
- the app needs gradual migration from proxy to true TRI
- users should compare what changes when dividends are included

Tradeoff:
- catalog and UI become more complex

## Implementation Slices After Decision

1. Strict run blocking for TRI labels when `returnBasis !== "total_return"` is implemented.
2. Source-policy metadata for bundled yfinance datasets is implemented.
3. Current catalog entries are marked as `price_only` or `blocked_proxy_tri`.
4. Source metadata fields now cover source name, license note, retrieval method, update cadence, and last verified date.
5. Assistant explanation seeds, handoffs, and briefs now carry source policy explicitly and caveat `blocked_proxy_tri` runs.
6. Add a true-TRI ingestion path for the approved source.
7. Add fixture tests covering true TRI, stale approved sources, and missing source cases.

## Non-Goals

- Do not scrape or bundle licensed data without a clear policy.
- Do not silently replace true TRI with price data.
- Do not run a TRI-labeled study from proxy data under the same label.
- Do not broaden provider unification as part of this decision.
- Do not treat Google Finance as a backend ingestion source unless a separate source-policy decision approves it.
- Do not change options evidence work; this is an index-study data policy.

## Product-Owner Questions

1. Which first universe matters: Nifty 50/Sensex only, broad NSE indices, or all common user-entered Indian indices?
2. Which source is approved for true total-return evidence?
3. Can true TRI data be committed as repo snapshots, or must it stay local-only?
4. What is the acceptable stale-data threshold for true TRI evidence?
5. Should blocked proxy datasets remain discoverable with an explanation, or be hidden from normal selection?

## Acceptance Bar

This decision is cleared when the repo can answer, for any index-style run:

- what the dataset claims to be
- what the source actually provided
- whether the source is approved for that claim
- whether the run result is true total-return evidence, price-return evidence, or proxy evidence
- what warning must be carried into the durable ledger and assistant brief
