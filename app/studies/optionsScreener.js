import {
  DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  getOptionsScreenerUniverseById,
  optionsScreenerUniverseCatalog,
} from "../catalog/optionsScreenerCatalog.js";
import {
  DEFAULT_OPTIONS_SCREENER_BIAS,
  DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER,
  DEFAULT_OPTIONS_SCREENER_SORT_KEY,
  buildOptionsScreenerStudyRun,
  getSortDefinition,
  normalizeCandidateFilter,
} from "../lib/optionsScreener.js";
import {
  exportOptionsScreenerCsv,
  exportOptionsScreenerXls,
} from "../lib/optionsScreenerExport.js";
import {
  fetchOptionsScreenerHistory,
  fetchOptionsScreenerSnapshot,
} from "../lib/syncedData.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  getCurrentRouteParams,
  readTextParam,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import {
  optionsScreenerTemplate,
  renderOptionsScreenerHistory,
  renderOptionsScreenerResults,
  renderUniversePresetInfo,
} from "./optionsScreenerView.js";
import { mountOptionsScreenerVisuals } from "./optionsScreenerVisuals.js";

const optionsScreenerSession = {
  universeId: DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  bias: DEFAULT_OPTIONS_SCREENER_BIAS,
  candidateFilter: DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER,
  sortKey: DEFAULT_OPTIONS_SCREENER_SORT_KEY,
  minimumDteValue: String(
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID)
      ?.defaultMinimumDte || 25,
  ),
  lastStudyRun: null,
  lastRunSignature: "",
};

function buildRunSignature(session) {
  return [
    session.universeId,
    session.bias,
    session.candidateFilter,
    session.sortKey,
    session.minimumDteValue,
  ].join("|");
}

function normalizeUniverseId(value) {
  return getOptionsScreenerUniverseById(value)?.id || DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID;
}

function normalizeBias(value) {
  const nextValue = String(value || "").trim().toLowerCase();
  if (nextValue === "rich" || nextValue === "cheap") {
    return nextValue;
  }
  return DEFAULT_OPTIONS_SCREENER_BIAS;
}

function normalizeSortKey(value) {
  return getSortDefinition(value).key;
}

function applyRouteParams() {
  const params = getCurrentRouteParams();
  const nextUniverseId = normalizeUniverseId(readTextParam(params, "u"));
  const nextBias = normalizeBias(readTextParam(params, "bias"));
  const nextCandidateFilter = normalizeCandidateFilter(readTextParam(params, "advice"));
  const nextSortKey = normalizeSortKey(readTextParam(params, "sort"));
  const nextMinimumDte = readTextParam(params, "dte");
  let changed = false;

  if (optionsScreenerSession.universeId !== nextUniverseId) {
    optionsScreenerSession.universeId = nextUniverseId;
    changed = true;
  }

  if (optionsScreenerSession.bias !== nextBias) {
    optionsScreenerSession.bias = nextBias;
    changed = true;
  }

  if (optionsScreenerSession.candidateFilter !== nextCandidateFilter) {
    optionsScreenerSession.candidateFilter = nextCandidateFilter;
    changed = true;
  }

  if (optionsScreenerSession.sortKey !== nextSortKey) {
    optionsScreenerSession.sortKey = nextSortKey;
    changed = true;
  }

  if (
    nextMinimumDte &&
    Number.isFinite(Number(nextMinimumDte)) &&
    String(Math.trunc(Number(nextMinimumDte))) === nextMinimumDte &&
    optionsScreenerSession.minimumDteValue !== nextMinimumDte
  ) {
    optionsScreenerSession.minimumDteValue = nextMinimumDte;
    changed = true;
  }

  if (changed && optionsScreenerSession.lastRunSignature !== buildRunSignature(optionsScreenerSession)) {
    optionsScreenerSession.lastStudyRun = null;
  }
}

function replaceOptionsScreenerRouteParams(viewId = "overview") {
  replaceRouteInputParams(optionsScreenerStudy.id, viewId, {
    u: optionsScreenerSession.universeId,
    bias: optionsScreenerSession.bias,
    advice: optionsScreenerSession.candidateFilter,
    sort: optionsScreenerSession.sortKey,
    dte: optionsScreenerSession.minimumDteValue,
  });
}

function validateInputs(universe, minimumDteValue) {
  if (!universe?.id) {
    throw new Error("Select a valid screener universe.");
  }

  const minimumDte = Number(minimumDteValue);
  if (!Number.isFinite(minimumDte) || minimumDte < 7 || minimumDte > 365) {
    throw new Error("Minimum DTE must be between 7 and 365 days.");
  }

  return {
    minimumDte: Math.trunc(minimumDte),
    maxContracts: universe.maxContracts || 1,
  };
}

function mountOptionsScreenerOverview(root) {
  applyRouteParams();
  const initialUniverse =
    getOptionsScreenerUniverseById(optionsScreenerSession.universeId) ||
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
  if (!initialUniverse) {
    throw new Error("Options screener universe catalog is unavailable.");
  }

  root.innerHTML = optionsScreenerTemplate({
    universeCatalog: optionsScreenerUniverseCatalog,
    universeId: initialUniverse.id,
    bias: optionsScreenerSession.bias,
    candidateFilter: optionsScreenerSession.candidateFilter,
    sortKey: optionsScreenerSession.sortKey,
    minimumDteValue: optionsScreenerSession.minimumDteValue,
    presetMarkup: renderUniversePresetInfo(initialUniverse),
  });

  const form = root.querySelector("#options-screener-form");
  const universeSelect = root.querySelector("#options-screener-universe");
  const biasSelect = root.querySelector("#options-screener-bias");
  const candidateFilterSelect = root.querySelector("#options-screener-candidate");
  const sortSelect = root.querySelector("#options-screener-sort");
  const minimumDteInput = root.querySelector("#options-screener-min-dte");
  const statusEl = root.querySelector("#options-screener-status");
  const presetRoot = root.querySelector("#options-screener-preset-root");
  const historyRoot = root.querySelector("#options-screener-history-root");
  const resultsRoot = root.querySelector("#options-screener-results-root");
  let disposed = false;

  function setStatus(message, state = "info") {
    statusEl.className = `status ${state}`;
    statusEl.textContent = message;
  }

  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-options-screener-export]",
    datasetKey: "optionsScreenerExport",
    getPayload: () => optionsScreenerSession.lastStudyRun,
    exporters: {
      csv: exportOptionsScreenerCsv,
      xls: exportOptionsScreenerXls,
    },
    setStatus,
    missingPayloadMessage: "Run the screener before exporting.",
  });

  function currentUniverse() {
    return (
      getOptionsScreenerUniverseById(universeSelect.value) ||
      getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID)
    );
  }

  function refreshPresetMarkup(universe) {
    presetRoot.innerHTML = renderUniversePresetInfo(universe);
  }

  function renderHistory(universe, historyPayload) {
    if (!historyRoot) {
      return;
    }
    historyRoot.innerHTML = renderOptionsScreenerHistory(
      historyPayload,
      universe?.label || "current universe",
    );
  }

  async function loadHistory(universe, { force = false } = {}) {
    if (!historyRoot || !universe?.id) {
      return;
    }

    if (!force && universe.historyPayload) {
      renderHistory(universe, universe.historyPayload);
      return;
    }

    historyRoot.innerHTML = `
      <div class="detail-block options-screener-history-block">
        <h3>Recent Archive</h3>
        <p class="summary-meta">Loading recent archived runs for ${universe.label}...</p>
      </div>
    `;

    try {
      const historyPayload = await fetchOptionsScreenerHistory({
        universeId: universe.id,
        limit: 6,
        rowLimit: 8,
      });
      universe.historyPayload = historyPayload;
      if (!disposed) {
        renderHistory(universe, historyPayload);
      }
    } catch (error) {
      if (!disposed) {
        historyRoot.innerHTML = `
          <div class="detail-block options-screener-history-block">
            <h3>Recent Archive</h3>
            <p class="summary-meta">${error.message}</p>
          </div>
        `;
      }
    }
  }

  function persistFormState() {
    const previousSignature = buildRunSignature(optionsScreenerSession);
    optionsScreenerSession.universeId = normalizeUniverseId(universeSelect.value);
    optionsScreenerSession.bias = normalizeBias(biasSelect.value);
    optionsScreenerSession.candidateFilter = normalizeCandidateFilter(
      candidateFilterSelect.value,
    );
    optionsScreenerSession.sortKey = normalizeSortKey(sortSelect.value);
    optionsScreenerSession.minimumDteValue = minimumDteInput.value.trim();
    const nextSignature = buildRunSignature(optionsScreenerSession);
    if (previousSignature !== nextSignature) {
      optionsScreenerSession.lastStudyRun = null;
    }
    replaceOptionsScreenerRouteParams();
  }

  function maybeRenderExistingRun() {
    if (
      optionsScreenerSession.lastStudyRun &&
      optionsScreenerSession.lastRunSignature === buildRunSignature(optionsScreenerSession)
    ) {
      resultsRoot.innerHTML = renderOptionsScreenerResults(
        optionsScreenerSession.lastStudyRun,
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();

    try {
      const universe = currentUniverse();
      const { minimumDte, maxContracts } = validateInputs(
        universe,
        minimumDteInput.value,
      );
      setStatus(`Loading ${universe.label}...`, "info");
      resultsRoot.innerHTML = `
        <div class="empty-state">
          Loading front-month option snapshots for ${universe.label}...
        </div>
      `;

      const screenerPayload = await fetchOptionsScreenerSnapshot({
        universeId: universe.id,
        universeLabel: universe.label,
        symbols: universe.symbols.map((entry) => entry.symbol),
        minimumDte,
        maxContracts,
      });
      const studyRun = buildOptionsScreenerStudyRun({
        universe,
        screenerPayload,
        minimumDte,
        maxContracts,
        sortKey: optionsScreenerSession.sortKey,
        bias: optionsScreenerSession.bias,
        candidateFilter: optionsScreenerSession.candidateFilter,
      });

      optionsScreenerSession.lastStudyRun = studyRun;
      optionsScreenerSession.lastRunSignature = buildRunSignature(
        optionsScreenerSession,
      );
      resultsRoot.innerHTML = renderOptionsScreenerResults(studyRun);
      universe.historyPayload = null;
      void loadHistory(universe, { force: true });
      setStatus("Options screener completed.", "success");
    } catch (error) {
      optionsScreenerSession.lastStudyRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${error.message}
        </div>
      `;
      setStatus(error.message, "error");
    }
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  function handleUniverseChange() {
    const universe = currentUniverse();
    minimumDteInput.value = String(universe.defaultMinimumDte || 25);
    refreshPresetMarkup(universe);
    persistFormState();
    void loadHistory(universe);
    setStatus("Universe updated. Run the screener to refresh results.", "info");
  }

  function handleFieldChange() {
    persistFormState();
    setStatus("Inputs updated. Run the screener to refresh results.", "info");
  }

  maybeRenderExistingRun();
  void loadHistory(initialUniverse);

  form.addEventListener("submit", handleSubmit);
  universeSelect.addEventListener("change", handleUniverseChange);
  biasSelect.addEventListener("change", handleFieldChange);
  candidateFilterSelect.addEventListener("change", handleFieldChange);
  sortSelect.addEventListener("change", handleFieldChange);
  minimumDteInput.addEventListener("change", handleFieldChange);
  resultsRoot.addEventListener("click", handleResultsClick);

  return () => {
    disposed = true;
    form.removeEventListener("submit", handleSubmit);
    universeSelect.removeEventListener("change", handleUniverseChange);
    biasSelect.removeEventListener("change", handleFieldChange);
    candidateFilterSelect.removeEventListener("change", handleFieldChange);
    sortSelect.removeEventListener("change", handleFieldChange);
    minimumDteInput.removeEventListener("change", handleFieldChange);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

const optionsScreenerStudy = {
  id: "options-screener",
  title: "Options Screener",
  description:
    "Front-month daily options screen for a small preset universe, ranking rich-versus-cheap volatility reads with drilldowns into the monthly straddle study.",
  inputSummary:
    "Universe preset, bias filter, sort key, and minimum days to expiry.",
  capabilities: {
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary:
        "Preset universe, ranked rich/cheap volatility rows, and direct drilldowns to single-name monthly straddles.",
      description:
        "Run a small liquid universe and screen front-month straddles by IV/HV, percentile context, liquidity, and spread quality.",
      status: "ready",
      default: true,
      mount: mountOptionsScreenerOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary:
        "Pricing mix, rich/cheap leaderboards, and cross-sectional context for the last completed screen.",
      description:
        "Visualize the latest screener run once the overview has been completed.",
      status: "ready",
      mount(root) {
        return mountOptionsScreenerVisuals(root, optionsScreenerSession);
      },
    },
  ],
};

export { optionsScreenerStudy };
