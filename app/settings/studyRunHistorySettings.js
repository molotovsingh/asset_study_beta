import { studyRegistry } from "../studies/registry.js";
import { buildSettingsRouteHash } from "../appRoute.js";
import { downloadTextFile } from "../lib/studyExport.js";
import { buildStudyPlanFromRouteHash } from "../studyBuilder/studyPlan.js";
import { buildStudyRunExplanationBriefFromHandoff } from "../studyBuilder/studyRunExplanationBrief.js";
import { buildStudyRunAssistantHandoff } from "../studyBuilder/studyRunHandoff.js";
import {
  buildStudyRunExplanationSeed,
  serializeStudyRunExplanationSeed,
} from "../studyBuilder/studyRunExplanation.js";
import { escapeHtml, formatSettingsTimestamp, renderSettingsSectionNav } from "./shared.js";

const HISTORY_LIMIT_OPTIONS = [12, 25, 50, 100];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeFilters(params) {
  return {
    studyId: String(params?.get("studyId") || "").trim(),
    status: String(params?.get("status") || "").trim().toLowerCase(),
    limit: parsePositiveInteger(params?.get("limit"), 25),
  };
}

function buildHistoryRouteHash(filters, selectedRunId = "") {
  return buildSettingsRouteHash("history", {
    studyId: filters.studyId || null,
    status: filters.status || null,
    limit: filters.limit || 25,
    runId: selectedRunId || null,
  });
}

function formatSummaryValue(item) {
  if (!item) {
    return "";
  }
  if (item.valueText) {
    return String(item.valueText);
  }
  if (Number.isFinite(item.valueNumber)) {
    if (item.valueKind === "integer") {
      return String(Math.round(item.valueNumber));
    }
    return Number(item.valueNumber).toFixed(2).replace(/\.00$/, "");
  }
  return "";
}

function renderHistoryStatusPill(status) {
  const normalized = String(status || "success").trim().toLowerCase();
  const tone =
    normalized === "failed"
      ? "attention"
      : normalized === "success"
        ? "ok"
        : "inactive";
  return `<span class="automation-pill ${tone}">${escapeHtml(normalized || "unknown")}</span>`;
}

function formatHistoryDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  return text;
}

function buildHandoffFilenameSegment(value, fallback) {
  const segment = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return segment || fallback;
}

function buildStudyRunHandoffFilename(run) {
  const studyId = buildHandoffFilenameSegment(run?.studyId, "study");
  const runId = buildHandoffFilenameSegment(run?.runId, "selected-run");
  return `study-run-handoff-${studyId}-${runId}.json`;
}

function buildLocalAssistantPayload(run) {
  const handoff = buildStudyRunAssistantHandoff(run);
  return {
    run,
    handoff,
    explanationBrief: buildStudyRunExplanationBriefFromHandoff(handoff),
  };
}

function getAssistantPayloadForRun(run, assistantPayloadByRunId) {
  const runId = String(run?.runId || "").trim();
  if (runId && assistantPayloadByRunId?.[runId]) {
    return assistantPayloadByRunId[runId];
  }
  return buildLocalAssistantPayload(run);
}

function renderRunWindow(run) {
  const startDate = formatHistoryDate(run.actualStartDate || run.requestedStartDate);
  const endDate = formatHistoryDate(run.actualEndDate || run.requestedEndDate);
  if (!startDate || !endDate) {
    return "";
  }
  return `${startDate} to ${endDate}`;
}

function renderJsonBlock(label, value) {
  const hasArray = Array.isArray(value) && value.length > 0;
  const hasObject =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0;
  if (!hasArray && !hasObject) {
    return "";
  }
  return `
    <div class="settings-history-data-block">
      <p class="meta-label">${escapeHtml(label)}</p>
      <pre class="settings-history-code">${escapeHtml(JSON.stringify(value, null, 2))}</pre>
    </div>
  `;
}

function renderExplanationSeed(run) {
  const seed = buildStudyRunExplanationSeed(run);
  const caveats = Array.isArray(seed.caveats) ? seed.caveats : [];
  const bullets = Array.isArray(seed.explanationBullets) ? seed.explanationBullets : [];
  const serializedSeed = serializeStudyRunExplanationSeed(run);

  return `
    <div class="settings-detail-item">
      <div class="automation-item-head">
        <div>
          <p class="settings-detail-title">Assistant-safe explanation seed</p>
          <p class="summary-meta">Source: ${escapeHtml(seed.source)} · confidence ${escapeHtml(seed.confidence)}</p>
        </div>
        <div class="automation-pill-row">
          <span class="automation-pill ${seed.canExplain ? "ok" : "attention"}">
            ${seed.canExplain ? "Explainable" : "Blocked"}
          </span>
        </div>
      </div>
      ${
        bullets.length
          ? `
            <div class="settings-detail-list">
              ${bullets
                .map(
                  (bullet) => `
                    <div class="settings-history-summary-row">
                      <span class="summary-meta">${escapeHtml(bullet)}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>
          `
          : `<p class="summary-meta">This run does not have enough successful ledger context for a result explanation.</p>`
      }
      ${
        caveats.length
          ? `
            <div class="settings-study-builder-issues">
              <p class="meta-label">Required caveats</p>
              <div class="settings-detail-list">
                ${caveats
                  .map(
                    (issue) => `
                      <div class="settings-detail-item">
                        <p class="settings-detail-title">${escapeHtml(issue.code)}</p>
                        <p class="summary-meta">${escapeHtml(issue.message)}</p>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          `
          : `<p class="summary-meta">No explanation caveats were generated from the ledger record.</p>`
      }
      <div class="settings-history-data-block">
        <p class="meta-label">Seed JSON</p>
        <pre class="settings-history-code">${escapeHtml(serializedSeed)}</pre>
      </div>
    </div>
  `;
}

function renderReplayStudyPlan(run) {
  const routeHash = String(run?.routeHash || "").trim();
  if (!routeHash) {
    return "";
  }
  const replayPlan = buildStudyPlanFromRouteHash(routeHash);
  const displayPlan = replayPlan.normalizedPlan || replayPlan.rawPlan || null;
  return `
    <div class="settings-history-data-block">
      <div class="automation-item-head">
        <div>
          <p class="meta-label">Replay StudyPlan</p>
          <p class="summary-meta">Derived from the recorded route hash, then checked by the StudyPlan validator.</p>
        </div>
        <div class="automation-pill-row">
          <span class="automation-pill ${replayPlan.ok ? "ok" : "attention"}">
            ${replayPlan.ok ? "Route-safe" : "Blocked"}
          </span>
        </div>
      </div>
      ${
        replayPlan.issues?.length
          ? `
            <div class="settings-study-builder-issues">
              <p class="meta-label">Replay issues</p>
              <div class="settings-detail-list">
                ${replayPlan.issues
                  .map(
                    (issue) => `
                      <div class="settings-detail-item">
                        <p class="settings-detail-title">${escapeHtml(issue.code)}</p>
                        <p class="summary-meta">${escapeHtml(issue.message)}</p>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
      ${displayPlan ? `<pre class="settings-history-code">${escapeHtml(JSON.stringify(displayPlan, null, 2))}</pre>` : ""}
    </div>
  `;
}

function renderAssistantBrief(run, assistantPayload) {
  const brief = assistantPayload?.explanationBrief || buildLocalAssistantPayload(run).explanationBrief;
  const allowedActions = Array.isArray(brief.allowedAssistantActions)
    ? brief.allowedAssistantActions
    : [];
  const caveats = Array.isArray(brief.requiredCaveats)
    ? brief.requiredCaveats
    : [];
  const prohibitedClaims = Array.isArray(brief.prohibitedClaims)
    ? brief.prohibitedClaims
    : [];

  return `
    <div class="settings-history-data-block">
      <div class="automation-item-head">
        <div>
          <p class="meta-label">Assistant Explanation Brief</p>
          <p class="summary-meta">Deterministic permission envelope for future generated prose.</p>
        </div>
        <div class="automation-pill-row">
          <span class="automation-pill ${brief.resultConclusionAllowed ? "ok" : "attention"}">
            ${escapeHtml(brief.mode)}
          </span>
        </div>
      </div>
      <p class="settings-detail-title">${escapeHtml(brief.title)}</p>
      <p class="summary-meta">${escapeHtml(brief.summary)}</p>
      <div class="settings-detail-list">
        <div class="settings-history-summary-row">
          <span class="summary-meta">Result conclusions</span>
          <strong>${brief.resultConclusionAllowed ? "Allowed" : "Blocked"}</strong>
        </div>
        <div class="settings-history-summary-row">
          <span class="summary-meta">Replay handoff</span>
          <strong>${brief.replay?.canReplay ? "Route-safe" : "Blocked"}</strong>
        </div>
      </div>
      <div class="settings-detail-list">
        <p class="meta-label">Allowed assistant actions</p>
        ${
          allowedActions.length
            ? allowedActions
                .map(
                  (action) => `
                    <div class="settings-history-summary-row">
                      <span class="summary-meta">${escapeHtml(action)}</span>
                    </div>
                  `,
                )
                .join("")
            : `<p class="summary-meta">No assistant prose actions are allowed from this brief.</p>`
        }
      </div>
      ${
        caveats.length
          ? `
            <div class="settings-study-builder-issues">
              <p class="meta-label">Mandatory caveats</p>
              <div class="settings-detail-list">
                ${caveats
                  .map(
                    (issue) => `
                      <div class="settings-detail-item">
                        <p class="settings-detail-title">${escapeHtml(issue.code)}</p>
                        <p class="summary-meta">${escapeHtml(issue.message)}</p>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          `
          : `<p class="summary-meta">No mandatory caveats were generated for this brief.</p>`
      }
      <details class="settings-history-disclosure">
        <summary>Prohibited claims</summary>
        <div class="settings-detail-list">
          ${prohibitedClaims
            .map(
              (claim) => `
                <div class="settings-history-summary-row">
                  <span class="summary-meta">${escapeHtml(claim)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </details>
    </div>
  `;
}

function renderAssistantHandoff(run, assistantPayload) {
  const handoff = assistantPayload?.handoff || buildLocalAssistantPayload(run).handoff;
  return `
    <div class="settings-history-data-block">
      <div class="automation-item-head">
        <div>
          <p class="meta-label">Assistant Handoff JSON</p>
          <p class="summary-meta">Single deterministic payload for result explanation and replay handoff.</p>
        </div>
        <button
          class="button ghost"
          type="button"
          data-history-handoff-export="${escapeHtml(run?.runId || "")}"
        >
          Download Handoff JSON
        </button>
      </div>
      <pre class="settings-history-code">${escapeHtml(`${JSON.stringify(handoff, null, 2)}\n`)}</pre>
    </div>
  `;
}

function renderAssistantPayloadStatus(run, assistantPayloadStatusByRunId) {
  const runId = String(run?.runId || "").trim();
  const status = runId ? assistantPayloadStatusByRunId?.[runId] : "";
  if (!status || status === "ready") {
    return "";
  }
  const text =
    status === "loading"
      ? "Loading backend assistant handoff and brief..."
      : "Could not load backend assistant handoff; showing local contract fallback.";
  return `<p class="summary-meta">${escapeHtml(text)}</p>`;
}

function renderHistoryDetail(
  run,
  assistantPayloadByRunId = {},
  assistantPayloadStatusByRunId = {},
) {
  if (!run) {
    return `
      <section class="card settings-card">
        <div class="settings-card-head">
          <div>
            <p class="meta-label">Run Detail</p>
            <h3 class="settings-card-title">No run selected</h3>
          </div>
        </div>
        <p class="summary-meta">Choose a durable run from the list to inspect its recorded window, parameters, summaries, and evidence links.</p>
      </section>
    `;
  }

  const summaryItems = Array.isArray(run.summaryItems) ? run.summaryItems : [];
  const links = Array.isArray(run.links) ? run.links : [];
  const assistantPayload = getAssistantPayloadForRun(run, assistantPayloadByRunId);

  return `
    <section class="card settings-card">
      <div class="settings-card-head">
        <div>
          <p class="meta-label">Run Detail</p>
          <h3 class="settings-card-title">${escapeHtml(run.studyTitle || run.studyId)}</h3>
        </div>
        <div class="automation-pill-row">
          ${renderHistoryStatusPill(run.status)}
          <span class="automation-pill inactive">Run ${escapeHtml(run.runId)}</span>
        </div>
      </div>

      <div class="settings-detail-grid">
        <div class="settings-detail-column">
          <div class="settings-detail-item">
            <p class="settings-detail-title">${escapeHtml(
              run.selectionLabel || run.subjectQuery || "Unknown selection",
            )}</p>
            <p class="automation-item-meta">${escapeHtml(run.studyId)}${run.viewId ? ` · ${escapeHtml(run.viewId)}` : ""}</p>
            <p class="automation-item-meta">Completed ${escapeHtml(formatSettingsTimestamp(run.completedAt))}</p>
            ${
              renderRunWindow(run)
                ? `<p class="automation-item-meta">${escapeHtml(renderRunWindow(run))}</p>`
                : ""
            }
            ${run.detailLabel ? `<p class="automation-item-meta">${escapeHtml(run.detailLabel)}</p>` : ""}
            ${run.errorMessage ? `<p class="automation-item-meta">Error: ${escapeHtml(run.errorMessage)}</p>` : ""}
          </div>
          <div class="settings-detail-item">
            <p class="settings-detail-title">Recorded context</p>
            <p class="automation-item-meta">Subject: ${escapeHtml(run.subjectQuery || "n/a")}</p>
            <p class="automation-item-meta">Symbol: ${escapeHtml(run.symbol || "n/a")}</p>
            <p class="automation-item-meta">Warnings: ${escapeHtml(run.warningCount || 0)}</p>
            <p class="automation-item-meta">Run kind: ${escapeHtml(run.runKind || "analysis")}</p>
            ${run.routeHash ? `<p class="automation-item-meta">Route: ${escapeHtml(run.routeHash)}</p>` : ""}
          </div>
        </div>

        <div class="settings-detail-column">
          <div class="settings-detail-item">
            <p class="settings-detail-title">Summary Items</p>
            ${
              summaryItems.length
                ? `
                  <div class="settings-detail-list">
                    ${summaryItems
                      .map(
                        (item) => `
                          <div class="settings-history-summary-row">
                            <span class="summary-meta">${escapeHtml(item.label || item.summaryKey || "Metric")}</span>
                            <strong>${escapeHtml(formatSummaryValue(item) || "n/a")}</strong>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>
                `
                : `<p class="summary-meta">No summary items were recorded for this run.</p>`
            }
          </div>
          <div class="settings-detail-item">
            <p class="settings-detail-title">Evidence Links</p>
            ${
              links.length
                ? `
                  <div class="settings-detail-list">
                    ${links
                      .map(
                        (link) => `
                          <div class="settings-detail-item">
                            <p class="settings-detail-title">${escapeHtml(link.targetLabel || link.targetId || link.targetKind)}</p>
                            <p class="automation-item-meta">${escapeHtml(link.linkType)} · ${escapeHtml(link.targetKind)} · ${escapeHtml(link.targetId)}</p>
                            ${
                              link.metadata && Object.keys(link.metadata).length
                                ? `<pre class="settings-history-code">${escapeHtml(JSON.stringify(link.metadata, null, 2))}</pre>`
                                : ""
                            }
                          </div>
                        `,
                      )
                      .join("")}
                  </div>
                `
                : `<p class="summary-meta">No durable evidence links were recorded for this run.</p>`
            }
          </div>
          ${renderExplanationSeed(run)}
        </div>
      </div>

      <div class="settings-history-data-grid">
        ${renderJsonBlock("Requested Params", run.requestedParams)}
        ${renderJsonBlock("Resolved Params", run.resolvedParams)}
        ${renderJsonBlock("Provider Summary", run.providerSummary)}
        ${renderJsonBlock("Snapshot Refs", run.dataSnapshotRefs)}
        ${renderAssistantPayloadStatus(run, assistantPayloadStatusByRunId)}
        ${renderReplayStudyPlan(run)}
        ${renderAssistantBrief(run, assistantPayload)}
        ${renderAssistantHandoff(run, assistantPayload)}
      </div>
    </section>
  `;
}

function renderRunHistorySettingsPage({
  runs = [],
  statusMessage = "",
  filters,
  selectedRunId = "",
  isLoading = false,
  assistantPayloadByRunId = {},
  assistantPayloadStatusByRunId = {},
}) {
  const studyOptions = studyRegistry
    .map(
      (study) => `
        <option value="${escapeHtml(study.id)}" ${filters.studyId === study.id ? "selected" : ""}>
          ${escapeHtml(study.title)}
        </option>
      `,
    )
    .join("");

  const selectedRun =
    runs.find((entry) => String(entry.runId) === String(selectedRunId || "")) ||
    runs[0] ||
    null;

  return `
    <section class="settings-shell">
      <div class="study-view-toolbar settings-toolbar">
        <div>
          <p class="eyebrow">App Settings</p>
          <h2 class="settings-title">Run History</h2>
          <p class="summary-meta settings-copy">Inspect the durable backend ledger instead of relying on browser-only recents. This is the audit trail for what actually ran.</p>
        </div>
      </div>

      ${renderSettingsSectionNav("history")}

      <p class="summary-meta settings-status" aria-live="polite">${escapeHtml(
        statusMessage || (isLoading ? "Loading durable run history..." : ""),
      )}</p>

      <div class="settings-grid">
        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">History Filters</p>
              <h3 class="settings-card-title">Ledger query</h3>
            </div>
            <button id="settings-history-refresh" class="button ghost automation-refresh-button" type="button">Refresh</button>
          </div>
          <form id="settings-history-filter-form" class="automation-form">
            <label class="field-label" for="settings-history-study-id">Study</label>
            <select id="settings-history-study-id" class="input">
              <option value="">All studies</option>
              ${studyOptions}
            </select>

            <label class="field-label" for="settings-history-status">Status</label>
            <select id="settings-history-status" class="input">
              <option value="" ${!filters.status ? "selected" : ""}>Any status</option>
              <option value="success" ${filters.status === "success" ? "selected" : ""}>Success</option>
              <option value="failed" ${filters.status === "failed" ? "selected" : ""}>Failed</option>
            </select>

            <label class="field-label" for="settings-history-limit">Limit</label>
            <select id="settings-history-limit" class="input">
              ${HISTORY_LIMIT_OPTIONS.map(
                (option) => `
                  <option value="${option}" ${Number(filters.limit) === option ? "selected" : ""}>${option}</option>
                `,
              ).join("")}
            </select>

            <div class="automation-actions">
              <button class="button" type="submit">Apply</button>
              <button id="settings-history-reset" class="button ghost" type="button">Reset</button>
            </div>
          </form>
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Ledger Summary</p>
              <h3 class="settings-card-title">Durable runs</h3>
            </div>
          </div>
          <div class="automation-runtime-health-grid">
            <div class="automation-health-metric">
              <span class="automation-health-value">${escapeHtml(runs.length)}</span>
              <span class="summary-meta">Runs loaded</span>
            </div>
            <div class="automation-health-metric">
              <span class="automation-health-value">${escapeHtml(
                runs.filter((entry) => String(entry.status).toLowerCase() === "failed").length,
              )}</span>
              <span class="summary-meta">Failures in view</span>
            </div>
            <div class="automation-health-metric">
              <span class="automation-health-value">${escapeHtml(
                runs.filter((entry) => Array.isArray(entry.links) && entry.links.length).length,
              )}</span>
              <span class="summary-meta">Evidence-linked</span>
            </div>
            <div class="automation-health-metric">
              <span class="automation-health-value">${escapeHtml(
                runs.filter((entry) => Array.isArray(entry.summaryItems) && entry.summaryItems.length).length,
              )}</span>
              <span class="summary-meta">With summaries</span>
            </div>
          </div>
          <p class="summary-meta">
            Filters: ${escapeHtml(filters.studyId || "all studies")} · ${escapeHtml(filters.status || "any status")} · limit ${escapeHtml(filters.limit)}
          </p>
        </section>
      </div>

      <div class="settings-detail-grid">
        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Run List</p>
              <h3 class="settings-card-title">Recorded executions</h3>
            </div>
          </div>
          ${
            runs.length
              ? `
                <div class="settings-history-list">
                  ${runs
                    .map(
                      (run) => `
                        <button
                          class="settings-history-item${String(run.runId) === String(selectedRun?.runId || "") ? " is-selected" : ""}"
                          type="button"
                          data-history-run-id="${escapeHtml(run.runId)}"
                        >
                          <div class="settings-history-item-head">
                            <div>
                              <p class="settings-detail-title">${escapeHtml(run.selectionLabel || run.subjectQuery || run.studyTitle)}</p>
                              <p class="automation-item-meta">${escapeHtml(run.studyTitle)} · ${escapeHtml(formatSettingsTimestamp(run.completedAt))}</p>
                            </div>
                            ${renderHistoryStatusPill(run.status)}
                          </div>
                          ${run.detailLabel ? `<p class="automation-item-meta">${escapeHtml(run.detailLabel)}</p>` : ""}
                          ${
                            renderRunWindow(run)
                              ? `<p class="automation-item-meta">${escapeHtml(renderRunWindow(run))}</p>`
                              : ""
                          }
                        </button>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<p class="summary-meta">No durable runs matched the current filters.</p>`
          }
        </section>

        ${renderHistoryDetail(selectedRun, assistantPayloadByRunId, assistantPayloadStatusByRunId)}
      </div>
    </section>
  `;
}

function mountStudyRunHistorySettingsPage(root, controller) {
  const state = {
    filters: normalizeFilters(controller.initialParams),
    selectedRunId: String(controller.initialParams?.get("runId") || "").trim(),
    runs: [],
    statusMessage: "",
    isLoading: false,
    assistantPayloadByRunId: {},
    assistantPayloadStatusByRunId: {},
  };
  let isClosed = false;

  function render() {
    if (isClosed) {
      return;
    }
    root.innerHTML = renderRunHistorySettingsPage(state);
  }

  function findRunById(runId) {
    const normalizedRunId = String(runId || "").trim();
    return (
      state.runs.find((entry) => String(entry.runId) === normalizedRunId) ||
      null
    );
  }

  async function loadAssistantPayload(runId, { force = false } = {}) {
    const normalizedRunId = String(runId || "").trim();
    if (!normalizedRunId) {
      return null;
    }
    if (!force && state.assistantPayloadByRunId[normalizedRunId]) {
      return state.assistantPayloadByRunId[normalizedRunId];
    }
    if (typeof controller.fetchStudyRunBrief !== "function") {
      return null;
    }

    state.assistantPayloadStatusByRunId = {
      ...state.assistantPayloadStatusByRunId,
      [normalizedRunId]: "loading",
    };
    render();

    try {
      const payload = await controller.fetchStudyRunBrief({
        runId: Number.parseInt(normalizedRunId, 10),
      });
      if (isClosed) {
        return null;
      }
      state.assistantPayloadByRunId = {
        ...state.assistantPayloadByRunId,
        [normalizedRunId]: payload,
      };
      state.assistantPayloadStatusByRunId = {
        ...state.assistantPayloadStatusByRunId,
        [normalizedRunId]: "ready",
      };
      return payload;
    } catch (error) {
      if (!isClosed) {
        state.assistantPayloadStatusByRunId = {
          ...state.assistantPayloadStatusByRunId,
          [normalizedRunId]: "error",
        };
        state.statusMessage =
          error?.message || "Could not load backend assistant handoff.";
      }
      return null;
    } finally {
      if (!isClosed) {
        render();
      }
    }
  }

  async function loadHistory(statusMessage = "") {
    state.isLoading = true;
    state.statusMessage = statusMessage;
    render();
    try {
      const payload = await controller.fetchStudyRuns({
        studyId: state.filters.studyId || null,
        status: state.filters.status || null,
        limit: state.filters.limit,
      });
      if (isClosed) {
        return;
      }
      state.runs = Array.isArray(payload?.runs) ? payload.runs : [];
      const hasSelectedRun = state.runs.some(
        (entry) => String(entry.runId) === String(state.selectedRunId || ""),
      );
      if (!hasSelectedRun) {
        state.selectedRunId = state.runs[0] ? String(state.runs[0].runId) : "";
      }
      state.statusMessage = "";
      if (state.selectedRunId) {
        void loadAssistantPayload(state.selectedRunId);
      }
    } catch (error) {
      if (isClosed) {
        return;
      }
      state.runs = [];
      state.statusMessage =
        error?.message || "Could not load durable study history.";
    } finally {
      if (!isClosed) {
        state.isLoading = false;
        render();
      }
    }
  }

  function buildFiltersFromForm() {
    return {
      studyId: String(root.querySelector("#settings-history-study-id")?.value || "").trim(),
      status: String(root.querySelector("#settings-history-status")?.value || "").trim(),
      limit: parsePositiveInteger(root.querySelector("#settings-history-limit")?.value, 25),
    };
  }

  function navigateTo(filters, selectedRunId = "") {
    const targetHash = buildHistoryRouteHash(filters, selectedRunId);
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
      return false;
    }
    state.filters = filters;
    state.selectedRunId = selectedRunId;
    void loadHistory();
    return true;
  }

  function handleSubmit(event) {
    const form = event.target.closest("#settings-history-filter-form");
    if (!form) {
      return;
    }
    event.preventDefault();
    navigateTo(buildFiltersFromForm());
  }

  async function handleClick(event) {
    const refreshTrigger = event.target.closest("#settings-history-refresh");
    if (refreshTrigger) {
      void loadHistory("Refreshing durable run history...");
      return;
    }

    const resetTrigger = event.target.closest("#settings-history-reset");
    if (resetTrigger) {
      navigateTo({ studyId: "", status: "", limit: 25 });
      return;
    }

    const handoffExportTrigger = event.target.closest("[data-history-handoff-export]");
    if (handoffExportTrigger) {
      const exportRunId = String(
        handoffExportTrigger.dataset.historyHandoffExport || "",
      ).trim();
      const run = findRunById(exportRunId);
      if (!run) {
        state.statusMessage = "Could not find the selected run to export.";
        render();
        return;
      }

      try {
        const assistantPayload =
          state.assistantPayloadByRunId[exportRunId] ||
          (await loadAssistantPayload(exportRunId));
        const handoff =
          assistantPayload?.handoff || buildLocalAssistantPayload(run).handoff;
        downloadTextFile(
          buildStudyRunHandoffFilename(run),
          `${JSON.stringify(handoff, null, 2)}\n`,
          "application/json;charset=utf-8",
        );
        state.statusMessage = `Downloaded assistant handoff JSON for run ${run.runId}.`;
      } catch (error) {
        state.statusMessage =
          error?.message || "Could not download assistant handoff JSON.";
      }
      render();
      return;
    }

    const runId = String(
      event.target.closest("[data-history-run-id]")?.dataset.historyRunId || "",
    ).trim();
    if (runId) {
      if (navigateTo(state.filters, runId)) {
        void loadAssistantPayload(runId);
      }
    }
  }

  root.addEventListener("submit", handleSubmit);
  root.addEventListener("click", handleClick);
  render();
  void loadHistory();

  return () => {
    isClosed = true;
    root.removeEventListener("submit", handleSubmit);
    root.removeEventListener("click", handleClick);
  };
}

export { mountStudyRunHistorySettingsPage, renderRunHistorySettingsPage };
