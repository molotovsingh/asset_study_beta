# PR 2 Stabilization Plan

PR: https://github.com/molotovsingh/asset_study_beta/pull/2

Branch: `codex/asset-study-evidence-assistant-foundations`

## Purpose

This PR is a broad checkpoint. The stabilization goal is not to add more product scope. The goal is to make the checkpoint reviewable, prove the core flows still work, and decide whether the branch can be merged as a foundation slice or should be split before merge.

## Current Status

- GitHub Actions `Validate Repo` is green on the PR branch.
- Live smoke completed on 2026-05-16 against `http://127.0.0.1:8000`.
- The PR remains draft until packet review decides whether the broad checkpoint can be merged as-is.
- The packet review map lives at `docs/review/2026-05-15-autonomous-slice-map.md`.
- No live AI call is required for this stabilization pass.

## Non-Goals

- Do not add new study features during stabilization.
- Do not add new schema tables unless a blocking defect requires it.
- Do not redesign provider policy.
- Do not start live AI product testing.
- Do not convert the draft PR to ready-for-review until live smoke is done.

## Review Order

Review in packets, not file order:

1. Metric trust and cross-study semantics.
2. Options evidence engine.
3. Symbol discovery, runtime health, and automations.
4. Durable run ledger and history settings.
5. Study Builder, Study Factory, and assistant boundaries.
6. Documentation and research trail.

If a packet fails review, fix only that packet and rerun its listed checks plus the frontend regression suite.

## Merge Gates

- CI is green on the latest pushed commit.
- Generated contracts are in sync with their JS sources.
- SQLite migrations are additive and older local databases upgrade in place.
- `options_service.py` facade monkeypatch compatibility remains tested.
- Settings routes do not break existing study hash routes.
- Live smoke confirms the main route families render and core controls respond.
- The PR body links this plan and the packet review map.

## Live Smoke Checklist

Start the app:

```bash
./.venv/bin/python scripts/dev_server.py --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

Smoke these routes:

- `#risk-adjusted-return/overview?subject=Nifty+50`
- `#monthly-straddle/overview?subject=AAPL`
- `#options-screener/overview`
- `#options-validation/overview`
- `#settings/automations`
- `#settings/study-builder`
- `#settings/history`

Required observations:

- Existing study routes still mount the study shell.
- Settings routes mount app-level settings, not study shell pages.
- Sidebar operations panel is summary-only and links to automations settings.
- Options Screener renders active sort context and archive controls.
- Options Validation distinguishes underlying validation from trade validation.
- Study Builder dry-run stays non-executing.
- Study Factory proposal endpoint stays read-only if called manually.
- Run History shows durable ledger controls without requiring UI scraping.

## Live Smoke Result

Status: passed on 2026-05-16.

Observed routes:

- `#risk-adjusted-return/overview?subject=Nifty+50` rendered the Risk-Adjusted Return study overview.
- `#monthly-straddle/overview?subject=AAPL` rendered Monthly Straddle and exposed `Run Snapshot`.
- `#options-screener/overview` rendered Options Screener and exposed `Run Screener`.
- `#options-validation/overview` rendered Options Validation and exposed `Load Validation`.
- `#settings/automations` rendered the settings automation form and configured jobs panel.
- `#settings/study-builder` rendered the Study Builder settings page, accepted an intent, produced a risk-adjusted-return relative route preview, and remained non-executing.
- `#settings/history` rendered the durable Run History settings page and ledger filters.
- `POST /api/study-factory/proposal` returned `study-proposal-response-v1` with `execution.executed = false`, `generatedCode = false`, and `fetchedExternalData = false`.
- `python3 scripts/test_live_app_smoke.py` now provides a repeatable server-level smoke for the same route/API boundary.

Correction made during smoke:

- The first checklist draft used `#settings/run-history`; the actual route model uses `#settings/history`. The checklist above now matches the implemented route.

## If CI Fails

Use this order:

1. Read the failing job log.
2. Classify the failure by packet.
3. Patch only that packet.
4. Run the packet checks locally.
5. Run `node scripts/run_frontend_regression_checks.mjs`.
6. Push one follow-up commit.

## If Live Smoke Fails

Treat live smoke failures as product blockers, not polish. Fix only the smallest cause:

- broken route parsing
- missing DOM mount/unmount cleanup
- stale generated contract
- backend route dispatch mismatch
- migration/default-value issue
- user-visible metric trust regression

Do not add new features while fixing smoke failures.

## Decision Point

After CI and live smoke:

- If no blockers remain, move the PR out of draft for packet review.
- If reviewers cannot reason about the diff even with packets, split the branch before merge.
- If only one packet is disputed, keep the checkpoint PR draft and extract that packet into a smaller follow-up branch.
