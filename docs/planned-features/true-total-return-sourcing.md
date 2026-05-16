# True Total-Return Index Sourcing Decision Packet

## Summary

The app now treats return basis as a first-class data contract: `price`, `total_return`, or `proxy`. That protects users from quietly reading price-only data as dividend-inclusive evidence.

The remaining decision is not a coding task. It is a product and data-source policy call: which true total-return index sources the app should trust, how licensing is handled, and what the app should do when true TRI is unavailable.

## Current State

- `returnBasis` is already exposed by synced index datasets.
- `Price` datasets remain valid for price-return studies.
- Current Nifty/Sensex TRI bootstrap datasets are marked as `proxy`, not `total_return`.
- Assistant explanation seeds and briefs preserve the warning text: price data used as a TRI proxy must not be treated as true total-return evidence.
- The correct current behavior is to warn clearly, not pretend the proxy is solved.

## Decision Required

The product owner needs to choose the app's true total-return policy before implementation continues.

| Decision | Why It Matters |
| --- | --- |
| Approved source list | Prevents ad hoc mixing of NSE files, Yahoo price series, manual CSVs, and scraped pages. |
| Licensing posture | Determines whether data can be bundled in the repo, cached locally, or only loaded by the user's machine. |
| Universe scope | Nifty 50/Sensex only is a different problem from broad NSE sector and market-cap TRI coverage. |
| Fallback behavior | The app must know whether missing TRI should block a run, downgrade to proxy with warnings, or switch to price-only semantics. |
| Update cadence | Long-term return studies need reproducible data windows; stale TRI data must be visible. |

## Candidate Policies

### Policy A: Strict True TRI

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

## Recommended Direction

The safest default is **Policy C: Dual Track**.

It preserves current exploratory value without lying about evidence quality. It also gives the future assistant a clean rule: explain true TRI as total-return evidence, explain proxy as a caveated approximation, and never collapse the two.

## Implementation Slices After Decision

1. Add a source-policy registry for index datasets.
2. Mark each catalog entry as `approved_total_return`, `price_only`, or `proxy_allowed`.
3. Add source metadata fields: source name, license note, retrieval method, update cadence, and last verified date.
4. Add a true-TRI ingestion path for the approved source.
5. Add validation that blocks TRI labeling when `returnBasis !== "total_return"` unless proxy mode is explicitly selected.
6. Update exports and assistant briefs to include source policy and return-basis caveats.
7. Add fixture tests covering true TRI, price-only, proxy, stale source, and missing source cases.

## Non-Goals

- Do not scrape or bundle licensed data without a clear policy.
- Do not silently replace true TRI with price data.
- Do not broaden provider unification as part of this decision.
- Do not treat Google Finance as a backend ingestion source unless a separate source-policy decision approves it.
- Do not change options evidence work; this is an index-study data policy.

## Product-Owner Questions

1. Should proxy TRI remain allowed for exploration, or should TRI-labeled studies block until true TRI exists?
2. Which first universe matters: Nifty 50/Sensex only, broad NSE indices, or all common user-entered Indian indices?
3. Can true TRI data be committed as repo snapshots, or must it stay local-only?
4. What is the acceptable stale-data threshold for true TRI evidence?
5. Should the UI expose proxy datasets as separate selectable assets, or only as fallback warnings?

## Acceptance Bar

This decision is cleared when the repo can answer, for any index-style run:

- what the dataset claims to be
- what the source actually provided
- whether the source is approved for that claim
- whether the run result is true total-return evidence, price-return evidence, or proxy evidence
- what warning must be carried into the durable ledger and assistant brief

