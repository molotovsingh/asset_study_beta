import { studyRegistry, getStudyById } from "./studies/registry.js";
import {
  deleteAutomationConfig,
  deleteStudyPlanRecipe,
  discoverSymbols,
  draftStudyBuilderPlan,
  fetchAssistantReadiness,
  fetchAutomationState,
  fetchRuntimeHealth,
  fetchStudyPlanRecipes,
  fetchStudyRunBrief,
  fetchStudyRuns,
  loadRememberedIndexCatalog,
  liveDraftAssistantStudyPlan,
  recordStudyRunLedgerEntry,
  runAutomationNow,
  saveAutomationConfig,
  saveStudyPlanRecipe,
  validateStudyBuilderPlan,
} from "./lib/syncedData.js";
import {
  getActiveSubjectQuery,
  setActiveSubjectQuery,
  subscribeActiveSubject,
} from "./studies/shared/activeSubject.js";
import {
  discoverSelectionSuggestions,
  mergeSelectionSuggestions,
} from "./studies/shared/indexSelection.js";
import {
  chooseAutoResolvedSuggestion,
  isExplicitMarketSymbol,
  normalizeDiscoveryText,
  parseManualSelectionInput,
  shouldSearchRemoteSymbols,
} from "./lib/symbolDiscovery.js";
import {
  getRecentRuns,
  mergeStudyRuns,
  subscribeRunHistory,
} from "./studies/shared/runHistory.js";
import {
  buildStudyViewHash,
  getDefaultStudyViewId,
  getStudyViews,
  getStudyViewById,
  renderStudyShell,
} from "./studies/studyShell.js";
import { getStudyKickerLabel } from "./studies/shared/studyOrdinal.js";
import {
  DEFAULT_SETTINGS_SECTION,
  STUDY_BUILDER_SETTINGS_SECTION,
  buildSettingsRouteHash,
  isRecognizedSettingsRoute,
  parseAppRouteHash,
} from "./appRoute.js";
import {
  mountAutomationSettingsPage,
  renderAutomationSidebarSummary,
} from "./settings/automationSettings.js";
import { mountStudyRunHistorySettingsPage } from "./settings/studyRunHistorySettings.js";
import { mountStudyBuilderSettingsPage } from "./settings/studyBuilderSettings.js";

const studySelect = document.querySelector("#study-select");
const studyMeta = document.querySelector("#study-meta");
const studyRoot = document.querySelector("#study-root");
const runHistoryRoot = document.querySelector("#run-history");
const activeSubjectForm = document.querySelector("#active-subject-form");
const activeSubjectInput = document.querySelector("#active-subject-input");
const activeSubjectStatus = document.querySelector("#active-subject-status");
const activeSubjectResults = document.querySelector("#active-subject-results");
const automationSidebarSummaryRoot = document.querySelector("#automation-sidebar-summary");

let unmountCurrentView = null;
let activeSubjectSuggestions = [];
let activeSubjectSuggestionQuery = "";
let activeSubjectRememberedCatalog = [];
let activeSubjectRememberedCatalogPromise = null;
let activeSubjectDiscoveryTimer = null;
let activeSubjectDiscoveryToken = 0;
let automationState = null;
let automationRuntimeHealth = null;
let automationStatusMessage = "";
const automationSubscribers = new Set();

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (match) => HTML_ESCAPE_MAP[match]);
}

function clearActiveSubjectSuggestions() {
  activeSubjectSuggestions = [];
  activeSubjectSuggestionQuery = "";
  activeSubjectDiscoveryToken += 1;
  if (activeSubjectDiscoveryTimer) {
    window.clearTimeout(activeSubjectDiscoveryTimer);
    activeSubjectDiscoveryTimer = null;
  }
  renderActiveSubjectSuggestions();
}

function renderActiveSubjectStatus(message = "") {
  if (!activeSubjectStatus) {
    return;
  }
  activeSubjectStatus.textContent = message;
}

function renderActiveSubjectSuggestions() {
  if (!activeSubjectResults) {
    return;
  }

  if (!activeSubjectSuggestions.length) {
    activeSubjectResults.innerHTML = "";
    return;
  }

  activeSubjectResults.innerHTML = `
    ${activeSubjectSuggestions
      .map(
        (suggestion) => `
          <button
            type="button"
            class="active-asset-result"
            data-subject-query="${escapeHtml(suggestion.subjectQuery || "")}"
            data-input-value="${escapeHtml(suggestion.inputValue || suggestion.subjectQuery || "")}"
          >
            <span class="active-asset-result-main">${escapeHtml(
              suggestion.label || suggestion.symbol || suggestion.subjectQuery || "",
            )}</span>
            <span class="active-asset-result-meta">${escapeHtml(
              [
                suggestion.symbol && suggestion.symbol !== suggestion.label
                  ? suggestion.symbol
                  : null,
                suggestion.family || null,
                suggestion.providerName || null,
              ]
                .filter(Boolean)
                .join(" · "),
            )}</span>
          </button>
        `,
      )
      .join("")}
  `;
}

function buildActiveSubjectSelections() {
  return mergeSelectionSuggestions(
    { datasets: [] },
    activeSubjectRememberedCatalog,
  );
}

async function ensureActiveSubjectCatalog() {
  if (!activeSubjectRememberedCatalogPromise) {
    activeSubjectRememberedCatalogPromise = loadRememberedIndexCatalog()
      .then((catalog) => {
        activeSubjectRememberedCatalog = Array.isArray(catalog) ? catalog : [];
        return activeSubjectRememberedCatalog;
      })
      .catch(() => {
        activeSubjectRememberedCatalog = [];
        return activeSubjectRememberedCatalog;
      });
  }

  return activeSubjectRememberedCatalogPromise;
}

function buildLocalActiveSubjectSuggestions(query) {
  return discoverSelectionSuggestions(query, buildActiveSubjectSelections(), {
    limit: 6,
  }).map((suggestion) => ({
    ...suggestion,
    inputValue: suggestion.subjectQuery,
  }));
}

function combineActiveSubjectSuggestions(localSuggestions, remoteSuggestions) {
  const combined = new Map();

  [...localSuggestions, ...remoteSuggestions].forEach((suggestion) => {
    const key =
      normalizeDiscoveryText(suggestion.symbol) ||
      normalizeDiscoveryText(suggestion.subjectQuery) ||
      normalizeDiscoveryText(suggestion.label);
    if (!key) {
      return;
    }

    const current = combined.get(key);
    if (!current || Number(suggestion.matchScore || 0) > Number(current.matchScore || 0)) {
      combined.set(key, suggestion);
    }
  });

  return [...combined.values()]
    .sort((left, right) => {
      if (Number(right.matchScore || 0) !== Number(left.matchScore || 0)) {
        return Number(right.matchScore || 0) - Number(left.matchScore || 0);
      }

      return String(left.label || left.subjectQuery || "").localeCompare(
        String(right.label || right.subjectQuery || ""),
      );
    })
    .slice(0, 8);
}

async function refreshActiveSubjectSuggestions({
  query = activeSubjectInput.value,
  includeRemote = true,
  showLoading = false,
} = {}) {
  const trimmedQuery = String(query || "").trim();
  activeSubjectSuggestionQuery = trimmedQuery;
  if (!trimmedQuery) {
    clearActiveSubjectSuggestions();
    renderActiveSubjectStatus("");
    return [];
  }

  await ensureActiveSubjectCatalog();
  const localSuggestions = buildLocalActiveSubjectSuggestions(trimmedQuery);
  let combinedSuggestions = localSuggestions;
  let providerWarning = "";

  if (showLoading) {
    renderActiveSubjectStatus(
      localSuggestions.length
        ? "Searching more matches..."
        : "Searching symbols...",
    );
  }

  const shouldSearchRemote =
    includeRemote && shouldSearchRemoteSymbols(trimmedQuery);
  if (shouldSearchRemote) {
    const requestToken = ++activeSubjectDiscoveryToken;
    try {
      const payload = await discoverSymbols({
        query: trimmedQuery,
        limit: 6,
      });
      if (
        requestToken !== activeSubjectDiscoveryToken ||
        activeSubjectInput.value.trim() !== trimmedQuery
      ) {
        return activeSubjectSuggestions;
      }

      combinedSuggestions = combineActiveSubjectSuggestions(
        localSuggestions,
        Array.isArray(payload.results) ? payload.results : [],
      );
      providerWarning = String(payload.warning || "").trim();
    } catch (error) {
      providerWarning =
        error?.message || "Could not search symbol matches.";
    }
  }

  activeSubjectSuggestions = combinedSuggestions;
  renderActiveSubjectSuggestions();
  if (combinedSuggestions.length) {
    renderActiveSubjectStatus("");
    return combinedSuggestions;
  }

  const manualSelectionInput = parseManualSelectionInput(trimmedQuery);

  if (providerWarning && !isExplicitMarketSymbol(trimmedQuery) && !manualSelectionInput) {
    renderActiveSubjectStatus(providerWarning);
    return combinedSuggestions;
  }

  if (manualSelectionInput) {
    renderActiveSubjectStatus(
      `Press Enter to use ${manualSelectionInput.label} (${manualSelectionInput.symbol}) as a local manual entry.`,
    );
    return combinedSuggestions;
  }

  if (isExplicitMarketSymbol(trimmedQuery)) {
    renderActiveSubjectStatus("Press Enter to try the raw symbol.");
    return combinedSuggestions;
  }

  renderActiveSubjectStatus("No symbol matches found yet.");
  return combinedSuggestions;
}

function buildCapabilityPills(study) {
  const studyViews = getStudyViews(study);
  const pills = [];
  const readyViews = studyViews.filter((view) => view.status === "ready");
  const plannedViews = studyViews.filter((view) => view.status !== "ready");

  if (readyViews.length) {
    pills.push(
      ...readyViews.map((view) => ({
        label: view.label,
        tone: "ready",
      })),
    );
  }

  if (plannedViews.length) {
    pills.push(
      ...plannedViews.map((view) => ({
        label: `${view.label} ${view.status}`,
        tone: "planned",
      })),
    );
  }

  if (study.capabilities?.exports?.length) {
    pills.push({
      label: `Exports ${study.capabilities.exports
        .map((format) => format.toUpperCase())
        .join(" / ")}`,
      tone: "default",
    });
  }

  return pills;
}

function renderStudyMeta(study, activeView) {
  const capabilityPills = buildCapabilityPills(study);

  studyMeta.innerHTML = `
    <div class="meta-row">
      <p class="meta-label">Summary</p>
      <p>${study.description}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Inputs</p>
      <p>${study.inputSummary}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Current View</p>
      <p>${activeView.summary || activeView.description || activeView.label}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Supports</p>
      <div class="meta-pill-row">
        ${capabilityPills
          .map(
            (pill) => `
              <span class="meta-pill ${pill.tone}">${pill.label}</span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function syncStudyKickers(root, studyId) {
  if (!root || !studyId) {
    return;
  }
  const kickerLabel = getStudyKickerLabel(studyId);
  root.querySelectorAll(".study-kicker").forEach((node) => {
    node.textContent = kickerLabel;
  });
}

function renderActiveSubjectControl() {
  activeSubjectInput.value = getActiveSubjectQuery();
}

function applyActiveSubjectQuery(nextSubject) {
  if (!nextSubject) {
    activeSubjectInput.value = getActiveSubjectQuery();
    return;
  }

  setActiveSubjectQuery(nextSubject);
  renderActiveSubjectStatus("");
  clearActiveSubjectSuggestions();

  const route = parseRouteHash();
  const study =
    route.kind === "study"
      ? getStudyById(route.studyId) || studyRegistry[0] || null
      : getStudyById(studySelect.value) || studyRegistry[0] || null;
  if (!study) {
    return;
  }

  const activeView = getStudyViewById(
    study,
    route.kind === "study" ? route.viewId || getDefaultStudyViewId(study) : getDefaultStudyViewId(study),
  );
  const nextParams =
    route.kind === "study" ? new URLSearchParams(route.params) : new URLSearchParams();
  nextParams.set("subject", nextSubject);
  const targetHash = buildStudyViewHash(study.id, activeView.id, nextParams);

  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountCurrentRoute();
}

async function applyActiveSubjectFromSidebar() {
  const nextSubject = activeSubjectInput.value.trim();
  if (!nextSubject) {
    activeSubjectInput.value = getActiveSubjectQuery();
    clearActiveSubjectSuggestions();
    return;
  }

  const suggestions = await refreshActiveSubjectSuggestions({
    query: nextSubject,
    includeRemote: true,
    showLoading: true,
  });
  const autoResolvedSuggestion = chooseAutoResolvedSuggestion(
    nextSubject,
    suggestions,
  );

  if (autoResolvedSuggestion) {
    activeSubjectInput.value =
      autoResolvedSuggestion.inputValue || autoResolvedSuggestion.subjectQuery;
    applyActiveSubjectQuery(
      autoResolvedSuggestion.subjectQuery || autoResolvedSuggestion.inputValue,
    );
    return;
  }

  if (suggestions.length) {
    renderActiveSubjectStatus("Choose a symbol match below.");
    return;
  }

  applyActiveSubjectQuery(nextSubject);
}

function parseRouteHash() {
  return parseAppRouteHash();
}

function formatHistoryTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderRunHistory() {
  const runs = getRecentRuns();
  if (!runs.length) {
    runHistoryRoot.innerHTML = `
      <p class="summary-meta">Completed local study runs will appear here.</p>
    `;
    return;
  }

  runHistoryRoot.innerHTML = `
    <div class="run-history-list">
      ${runs
        .map(
          (run) => `
            <button class="run-history-item" type="button" data-run-id="${escapeHtml(run.id)}">
              <span class="run-history-main">${escapeHtml(run.selectionLabel)}</span>
              <span class="run-history-meta">${escapeHtml(run.studyTitle)} · ${escapeHtml(formatHistoryTimestamp(run.completedAt))}</span>
              ${
                (run.actualStartDate && run.actualEndDate) ||
                (run.requestedStartDate && run.requestedEndDate)
                  ? `<span class="run-history-meta">${escapeHtml(run.actualStartDate || run.requestedStartDate)} to ${escapeHtml(run.actualEndDate || run.requestedEndDate)}</span>`
                  : run.detailLabel
                    ? `<span class="run-history-meta">${escapeHtml(run.detailLabel)}</span>`
                  : ""
              }
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSettingsMeta(section = DEFAULT_SETTINGS_SECTION) {
  const metaBySection = {
    automations: {
      currentViewLabel: "Automations",
      summaryText:
        "Configure app-level maintenance runs and inspect runtime health outside the study flow.",
      inputText:
        "Automation timing, local universe ids, options collector scope, and health thresholds.",
      supportPills: `
        <span class="meta-pill ready">Automations</span>
        <span class="meta-pill ready">Runtime Health</span>
      `,
    },
    history: {
      currentViewLabel: "Run History",
      summaryText:
        "Inspect the durable backend ledger for completed study runs, recorded windows, summary metrics, and evidence links.",
      inputText:
        "Study filters, run status, result limits, and recorded run metadata.",
      supportPills: `
        <span class="meta-pill ready">Durable Ledger</span>
        <span class="meta-pill ready">Run Summaries</span>
        <span class="meta-pill ready">Evidence Links</span>
      `,
    },
    [STUDY_BUILDER_SETTINGS_SECTION]: {
      currentViewLabel: "Study Builder",
      summaryText:
        "Validate assistant-generated StudyPlan JSON and preview the route handoff before execution.",
      inputText:
        "StudyPlan JSON, route params, deterministic validation issues, and confirmation preview fields.",
      supportPills: `
        <span class="meta-pill ready">StudyPlan v1</span>
        <span class="meta-pill ready">Validation Issues</span>
        <span class="meta-pill ready">Route Preview</span>
      `,
    },
  };
  const meta = metaBySection[section] || metaBySection[DEFAULT_SETTINGS_SECTION];
  studyMeta.innerHTML = `
    <div class="meta-row">
      <p class="meta-label">Summary</p>
      <p>${meta.summaryText}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Inputs</p>
      <p>${meta.inputText}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Current View</p>
      <p>${meta.currentViewLabel}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Supports</p>
      <div class="meta-pill-row">
        ${meta.supportPills}
      </div>
    </div>
  `;
}

function setAutomationStatusMessage(message = "") {
  automationStatusMessage = String(message || "");
  notifyAutomationSubscribers();
}

function subscribeAutomationState(listener) {
  automationSubscribers.add(listener);
  return () => {
    automationSubscribers.delete(listener);
  };
}

function renderSidebarAutomationSummary() {
  if (!automationSidebarSummaryRoot) {
    return;
  }
  automationSidebarSummaryRoot.innerHTML = renderAutomationSidebarSummary(
    automationState,
    automationRuntimeHealth,
  );
}

function notifyAutomationSubscribers() {
  renderSidebarAutomationSummary();
  automationSubscribers.forEach((listener) => {
    listener({
      automationState,
      automationRuntimeHealth,
      automationStatusMessage,
    });
  });
}

async function refreshAutomationData(statusMessage = "") {
  if (statusMessage) {
    automationStatusMessage = statusMessage;
    notifyAutomationSubscribers();
  }
  try {
    const [nextAutomationState, nextRuntimeHealth] = await Promise.all([
      fetchAutomationState(),
      fetchRuntimeHealth(),
    ]);
    automationState = nextAutomationState;
    automationRuntimeHealth = nextRuntimeHealth;
    if (statusMessage) {
      automationStatusMessage = "";
    }
    notifyAutomationSubscribers();
    return {
      state: automationState,
      runtimeHealth: automationRuntimeHealth,
    };
  } catch (error) {
    automationStatusMessage =
      error?.message || "Could not load automation state.";
    notifyAutomationSubscribers();
    throw error;
  }
}

async function hydrateDurableRunHistory() {
  try {
    const payload = await fetchStudyRuns();
    if (Array.isArray(payload.runs) && payload.runs.length) {
      mergeStudyRuns(payload.runs);
      return;
    }

    const localRuns = getRecentRuns();
    if (!localRuns.length) {
      return;
    }

    await Promise.allSettled(
      localRuns.map((run) => recordStudyRunLedgerEntry(run)),
    );

    const refreshedPayload = await fetchStudyRuns();
    mergeStudyRuns(refreshedPayload.runs);
  } catch (error) {
    // Local recents still work without the backend ledger. Keep startup quiet.
  }
}

async function saveAutomation(payload) {
  const response = await saveAutomationConfig(payload);
  automationState = response.state;
  notifyAutomationSubscribers();
  return response;
}

async function runAutomation(automationId) {
  const response = await runAutomationNow({ automationId });
  automationState = response.state;
  automationRuntimeHealth = response.result?.runtimeHealth || automationRuntimeHealth;
  notifyAutomationSubscribers();
  return response;
}

async function deleteAutomation(automationId) {
  const response = await deleteAutomationConfig({ automationId });
  automationState = response.state;
  notifyAutomationSubscribers();
  return response;
}

function handleRunHistoryClick(event) {
  const trigger = event.target.closest("[data-run-id]");
  if (!trigger) {
    return;
  }

  const run = getRecentRuns().find((entry) => entry.id === trigger.dataset.runId);
  if (!run) {
    return;
  }

  if (run.routeHash) {
    if (window.location.hash !== run.routeHash) {
      window.location.hash = run.routeHash;
      return;
    }

    mountCurrentRoute();
    return;
  }

  setActiveSubjectQuery(run.subjectQuery);
  const targetHash = buildStudyViewHash(run.studyId, "overview", {
    subject: run.subjectQuery,
    start: run.actualStartDate || run.requestedStartDate,
    end: run.actualEndDate || run.requestedEndDate,
  });
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountCurrentRoute();
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyCurrentStudyLink(trigger) {
  const originalText = trigger.textContent.trim() || "Copy Link";
  try {
    await writeClipboardText(window.location.href);
    trigger.textContent = "Copied";
    trigger.classList.add("is-copied");
  } catch (error) {
    trigger.textContent = "Copy failed";
  } finally {
    window.setTimeout(() => {
      trigger.textContent = originalText;
      trigger.classList.remove("is-copied");
    }, 1400);
  }
}

function handleStudyRootClick(event) {
  const copyLinkTrigger = event.target.closest("#copy-study-link");
  if (!copyLinkTrigger) {
    return;
  }

  copyCurrentStudyLink(copyLinkTrigger);
}

function unmountWorkspaceView() {
  if (typeof unmountCurrentView === "function") {
    unmountCurrentView();
  }
  unmountCurrentView = null;
}

function mountStudyRoute(route) {
  const study = getStudyById(route.studyId) || studyRegistry[0] || null;

  if (!study) {
    studyRoot.innerHTML = `<div class="empty-state">Study not found.</div>`;
    return;
  }

  const activeView = getStudyViewById(
    study,
    route.viewId || getDefaultStudyViewId(study),
  );
  const targetHash = buildStudyViewHash(study.id, activeView.id, route.params);

  if (route.studyId !== study.id || route.viewId !== activeView.id) {
    window.history.replaceState(null, "", targetHash);
  }

  unmountWorkspaceView();

  studySelect.value = study.id;
  renderStudyMeta(study, activeView);
  studyRoot.innerHTML = renderStudyShell(study, activeView.id, route.params);

  const viewRoot = studyRoot.querySelector("#study-view-root");
  unmountCurrentView = activeView.mount(viewRoot);
  syncStudyKickers(viewRoot, study.id);
}

function mountSettingsRoute(route) {
  const targetHash = buildSettingsRouteHash(route.section || DEFAULT_SETTINGS_SECTION, route.params);
  if (!isRecognizedSettingsRoute(route) || window.location.hash !== targetHash) {
    window.history.replaceState(null, "", targetHash);
  }

  unmountWorkspaceView();
  renderSettingsMeta(route.section);
  studyRoot.innerHTML = "";
  try {
    if (route.section === "history") {
      unmountCurrentView = mountStudyRunHistorySettingsPage(studyRoot, {
        initialParams: route.params,
        fetchStudyRunBrief,
        fetchStudyRuns,
      });
      return;
    }

    if (route.section === STUDY_BUILDER_SETTINGS_SECTION) {
      unmountCurrentView = mountStudyBuilderSettingsPage(studyRoot, {
        deleteStudyPlanRecipe,
        draftStudyBuilderPlan,
        fetchAssistantReadiness,
        fetchStudyPlanRecipes,
        liveDraftAssistantStudyPlan,
        saveStudyPlanRecipe,
        validateStudyBuilderPlan,
      });
      return;
    }

    unmountCurrentView = mountAutomationSettingsPage(studyRoot, {
      getAutomationState: () => automationState,
      getRuntimeHealth: () => automationRuntimeHealth,
      getStatusMessage: () => automationStatusMessage,
      setStatusMessage: setAutomationStatusMessage,
      subscribe: subscribeAutomationState,
      refreshAutomationData,
      saveAutomation,
      runAutomation,
      deleteAutomation,
    });
  } catch (error) {
    studyRoot.innerHTML = `
      <section class="card settings-card">
        <p class="meta-label">Settings Error</p>
        <h2>${escapeHtml(route.section === "history" ? "Run History" : route.section === STUDY_BUILDER_SETTINGS_SECTION ? "Study Builder" : "Automations")} could not load.</h2>
        <p class="summary-meta">${escapeHtml(error?.message || "Unknown settings error.")}</p>
      </section>
    `;
    unmountCurrentView = null;
  }
}

function mountCurrentRoute() {
  const route = parseRouteHash();
  if (route.kind === "settings") {
    mountSettingsRoute(route);
    return;
  }
  mountStudyRoute(route);
}

function populateStudySelect() {
  studySelect.innerHTML = studyRegistry
    .map(
      (study) =>
        `<option value="${study.id}">${study.title}</option>`,
    )
    .join("");
}

studySelect.addEventListener("change", (event) => {
  const study = getStudyById(event.target.value);
  if (!study) {
    return;
  }

  const targetHash = buildStudyViewHash(study.id, getDefaultStudyViewId(study), {
    subject: getActiveSubjectQuery(),
  });
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountCurrentRoute();
});
runHistoryRoot.addEventListener("click", handleRunHistoryClick);
studyRoot.addEventListener("click", handleStudyRootClick);
activeSubjectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void applyActiveSubjectFromSidebar();
});
activeSubjectInput.addEventListener("input", () => {
  const query = activeSubjectInput.value.trim();
  if (activeSubjectDiscoveryTimer) {
    window.clearTimeout(activeSubjectDiscoveryTimer);
  }

  if (!query) {
    clearActiveSubjectSuggestions();
    renderActiveSubjectStatus("");
    return;
  }

  activeSubjectDiscoveryTimer = window.setTimeout(() => {
    void refreshActiveSubjectSuggestions({
      query,
      includeRemote: true,
      showLoading: false,
    });
  }, 180);
});
activeSubjectResults?.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-subject-query]");
  if (!trigger) {
    return;
  }

  const subjectQuery = String(trigger.dataset.subjectQuery || "").trim();
  const inputValue = String(trigger.dataset.inputValue || subjectQuery).trim();
  if (!subjectQuery) {
    return;
  }

  activeSubjectInput.value = inputValue || subjectQuery;
  applyActiveSubjectQuery(subjectQuery);
});

window.addEventListener("hashchange", mountCurrentRoute);
subscribeActiveSubject(() => {
  renderActiveSubjectControl();
  clearActiveSubjectSuggestions();
  renderActiveSubjectStatus("");
  const route = parseRouteHash();
  if (route.kind === "settings") {
    renderSettingsMeta(route.section);
    return;
  }
  const study = getStudyById(route.studyId) || studyRegistry[0] || null;
  if (!study) {
    return;
  }

  const activeView = getStudyViewById(
    study,
    route.viewId || getDefaultStudyViewId(study),
  );
  renderStudyMeta(study, activeView);
});
subscribeRunHistory(renderRunHistory);

populateStudySelect();
renderActiveSubjectControl();
renderRunHistory();
renderSidebarAutomationSummary();
void hydrateDurableRunHistory();
void refreshAutomationData();
mountCurrentRoute();
