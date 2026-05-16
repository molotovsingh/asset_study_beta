# PR 2 Packet Review Result

PR: https://github.com/molotovsingh/asset_study_beta/pull/2

Branch: `codex/asset-study-evidence-assistant-foundations`

## Review Type

This is a stabilization packet review, not a line-by-line final approval. The goal is to answer one narrow question:

> Did CI, live smoke, static scans, or packet review reveal a blocker that requires splitting or fixing the branch before review can proceed?

## Evidence Checked

- GitHub Actions `Validate Repo`: passed on the latest pushed commit.
- Live smoke: passed and recorded in `docs/review/2026-05-16-pr-2-stabilization-plan.md`.
- Repeatable live smoke: `python3 scripts/test_live_app_smoke.py` now starts the dev server on a free port and checks app entrypoints, settings-history routing, assistant readiness, Study Builder plan generation, and the read-only Study Factory proposal endpoint.
- Full local validation matrix: passed after the repeatable live-smoke gate was added.
- Route correction: smoke found the real run-history settings route is `#settings/history`, not `#settings/run-history`; the stabilization checklist was corrected.
- Secret scan: no pasted Finnhub key was found in source/docs. Only placeholder key names such as `FINNHUB_API_KEY`, `RAPIDAPI_KEY`, and `OPENAI_API_KEY` appear.
- Route scan: `#settings/history` is covered in app route parsing and frontend regression checks.
- Contract scan: Study Factory proposal endpoint returns explicit non-execution flags and has route/service/frontend regression coverage.
- Snapshot data audit: validation passes; audit reports warnings only for known stale bundled snapshots ending `2026-04-08`, not branch-introduced schema or runtime failures.

## Packet Status

| Packet | Status | Notes |
| --- | --- | --- |
| Metric trust and cross-study semantics | No blocker found | CI covers the metric registry and frontend regression suite. Review should still inspect whether the UI copy is clear enough for traders. |
| Options evidence engine | No blocker found | Facade compatibility and options evidence tests are present. Real value still depends on collector history maturing after merge. |
| Symbol discovery, runtime health, and automations | No blocker found | Settings route smoke passed for automations. Provider secrets remain backend/environment concerns. |
| Durable run ledger and history settings | No blocker found | Smoke passed on `#settings/history`; the route naming correction is recorded. |
| Study Builder, Study Factory, and assistant boundaries | No blocker found | Dry-run remained non-executing; Study Factory proposal endpoint returned `executed = false`. |
| Documentation and research trail | No blocker found | Review map, stabilization plan, and live-smoke record are now repo-visible. |

## Original Botherations Closed

| Botheration | Closure |
| --- | --- |
| Broad PR is hard to review | Packet map, stabilization plan, packet-review result, CI, and live smoke make the checkpoint reviewable by packet. No packet-level blocker was found that forces an immediate split. |
| Contract surface could become ceremony | Assistant readiness checks, generated contract drift checks, backend route checks, and explicit consumer endpoints now enforce the contract spine. |
| Runtime store is becoming a serious backend layer | Migration/default behavior is covered by runtime-store, options-evidence, study-run, automation, maintenance, and market-collector tests. |
| Options evidence could look more mature than its samples | The ledger and validation paths are structurally tested; real signal value remains dependent on future collector history. This is an operational maturity dependency, not a merge blocker. |
| Frontend testing was too synthetic | Browser live smoke was performed, and `scripts/test_live_app_smoke.py` now gives CI a repeatable server/API smoke gate. |
| Assistant scaffolding could outrun use cases | Live AI remains optional and gated; Study Builder dry-run and Study Factory proposal stay deterministic and non-executing. |

## Remaining Non-Code Dependency

Options evidence needs time and repeated collector runs before trade-validation conclusions become valuable. The PR can ship the evidence machinery, but it cannot manufacture matured samples. Product copy and validation gates should continue to treat early evidence as thin.

## Process Choice

Recommended handling:

- Move the PR out of draft if the user accepts packet review as the review model.
- If the reviewer wants small PRs, split by packet before merge.
- If the reviewer accepts a broad foundation checkpoint, proceed with packet-by-packet review using the two review docs.
- Do not add more feature scope to this branch.

## Decision

No blocker was found that forces an immediate split before review can proceed.

The next decision is human/product-process, not code correctness: review this checkpoint as one broad foundation PR, or split it into packet PRs before merge.
