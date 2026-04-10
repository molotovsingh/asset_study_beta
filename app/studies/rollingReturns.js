import { buildRollingReturnsStudy } from "../lib/rollingReturns.js";
import {
  exportRollingReturnsCsv,
  exportRollingReturnsXls,
} from "../lib/rollingReturnsExport.js";
import { filterSeriesByDate } from "../lib/stats.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  adoptActiveSubjectQuery,
  setActiveSubjectQuery,
} from "./shared/activeSubject.js";
import { createIndexStudyOverviewRuntime } from "./shared/indexStudyOverviewRuntime.js";
import { recordIndexStudyRun } from "./shared/indexRunHistory.js";
import {
  buildCommonIndexParams,
  readCommonIndexParams,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import {
  appendCoverageWarnings,
  appendSnapshotWarnings,
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import {
  renderRollingReturnsResults,
  rollingReturnsTemplate,
} from "./rollingReturnsView.js";
import { mountRollingReturnsVisuals } from "./rollingReturnsVisuals.js";

const defaultStudyWindow = buildDefaultStudyWindow();
const rollingReturnsSession = {
  indexQuery: "Nifty 50",
  startDateValue: toInputDate(defaultStudyWindow.startDate),
  endDateValue: toInputDate(defaultStudyWindow.endDate),
  bundledManifest: null,
  rememberedCatalog: [],
  backendState: "unknown",
  lastLoadedSelectionSignature: "none",
  lastLoadedSnapshot: null,
  lastStudyRun: null,
};

function validateStudyInputs(selection, startValue, endValue) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);

  if (!selection) {
    throw new Error("Set an active asset in the sidebar before running the study.");
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Pick a valid start date and end date.");
  }

  if (start >= end) {
    throw new Error("Start date must be earlier than end date.");
  }

  return { start, end };
}

function renderStudyRunResults(resultsRoot, studyRun) {
  resultsRoot.innerHTML = renderRollingReturnsResults(studyRun);
}

function replaceRollingReturnsRouteParams() {
  replaceRouteInputParams(rollingReturnsStudy.id, "overview", {
    ...buildCommonIndexParams(rollingReturnsSession),
  });
}

function mountRollingReturnsOverview(root) {
  const routeParamsApplied = readCommonIndexParams(rollingReturnsSession);
  if (routeParamsApplied.changed) {
    rollingReturnsSession.lastStudyRun = null;
  }
  if (routeParamsApplied.subject) {
    setActiveSubjectQuery(rollingReturnsSession.indexQuery);
  } else if (adoptActiveSubjectQuery(rollingReturnsSession)) {
    rollingReturnsSession.lastStudyRun = null;
  }

  root.innerHTML = rollingReturnsTemplate(
    rollingReturnsSession.startDateValue,
    rollingReturnsSession.endDateValue,
  );

  const form = root.querySelector("#rolling-returns-study-form");
  const indexQueryInput = root.querySelector("#rolling-returns-query");
  const indexSuggestions = root.querySelector("#rolling-returns-suggestions");
  const indexSummary = root.querySelector("#rolling-returns-summary");
  const startDateInput = root.querySelector("#rolling-returns-start-date");
  const endDateInput = root.querySelector("#rolling-returns-end-date");
  const status = root.querySelector("#rolling-returns-status");
  const resultsRoot = root.querySelector("#rolling-returns-results-root");
  const lastFiveYearsButton = root.querySelector(
    "#rolling-returns-load-five-year-window",
  );

  indexQueryInput.value = rollingReturnsSession.indexQuery;
  startDateInput.value = rollingReturnsSession.startDateValue;
  endDateInput.value = rollingReturnsSession.endDateValue;

  const state = rollingReturnsSession;
  const runtime = createIndexStudyOverviewRuntime({
    session: state,
    queryInput: indexQueryInput,
    suggestionsEl: indexSuggestions,
    summaryEl: indexSummary,
    statusEl: status,
  });
  const {
    setStatus,
    getCurrentSelection,
    refreshSelectionUi,
    applyLoadedSnapshot,
    loadSelectionData,
    loadBundledManifest,
    loadRememberedSymbols,
    updateIndexSummary,
  } = runtime;
  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-rolling-export]",
    datasetKey: "rollingExport",
    getPayload: () => state.lastStudyRun,
    exporters: {
      csv: exportRollingReturnsCsv,
      xls: exportRollingReturnsXls,
    },
    setStatus,
    missingPayloadMessage: "Run the study before exporting.",
  });

  function persistFormState() {
    const subjectChanged = setActiveSubjectQuery(indexQueryInput.value);
    state.indexQuery = indexQueryInput.value;
    state.startDateValue = startDateInput.value;
    state.endDateValue = endDateInput.value;
    if (subjectChanged) {
      state.lastStudyRun = null;
    }
    replaceRollingReturnsRouteParams();
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    state.lastStudyRun = null;
    setStatus("Running rolling returns study...", "info");

    try {
      const selection = getCurrentSelection();
      const { start, end } = validateStudyInputs(
        selection,
        startDateInput.value,
        endDateInput.value,
      );
      const warnings = [];

      const { snapshot, series, rememberedEntry } =
        await loadSelectionData(selection);
      const filteredSeries = filterSeriesByDate(series, start, end);
      if (filteredSeries.length < 2) {
        throw new Error(
          "The selected date range leaves fewer than two index observations.",
        );
      }

      const methodLabel = snapshot.cache
        ? `Local yfinance fetch using ${snapshot.symbol}`
        : `Bundled snapshot using ${snapshot.symbol}`;

      appendCoverageWarnings(filteredSeries, start, end, warnings);
      appendSnapshotWarnings(snapshot, warnings);

      if (snapshot.sourceSeriesType !== selection.targetSeriesType) {
        warnings.push(
          `Loaded data currently uses ${snapshot.sourceSeriesType} series as a bootstrap proxy for ${selection.targetSeriesType}.`,
        );
      }

      if (snapshot.note) {
        warnings.push(snapshot.note);
      }

      const rollingModel = buildRollingReturnsStudy(filteredSeries);
      if (rollingModel.unavailableWindowSummaries.length) {
        warnings.push(
          `${rollingModel.unavailableWindowSummaries
            .map((windowSummary) => windowSummary.windowLabel)
            .join(", ")} could not be formed from the active date range.`,
        );
      }

      if (selection.targetSeriesType !== "TRI") {
        warnings.push(
          "This selection is not marked as TRI. Price-only rolling CAGR can understate long-run return quality.",
        );
      }

      applyLoadedSnapshot(selection, snapshot, rememberedEntry);

      state.lastStudyRun = {
        studyTitle: rollingReturnsStudy.title,
        selection: {
          ...selection,
          currency: snapshot.currency || selection.currency || null,
        },
        seriesLabel: selection.label,
        indexSeries: filteredSeries,
        warnings,
        methodLabel,
        requestedStartDate: start,
        requestedEndDate: end,
        actualStartDate: filteredSeries[0].date,
        actualEndDate: filteredSeries[filteredSeries.length - 1].date,
        exportedAt: new Date(),
        ...rollingModel,
      };
      recordIndexStudyRun(rollingReturnsStudy, state);
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("Rolling returns study completed.", "success");
    } catch (error) {
      state.lastStudyRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${error.message}
        </div>
      `;
      setStatus(error.message, "error");
    }
  }

  function applyLastFiveYears() {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 5);
    startDateInput.value = toInputDate(start);
    endDateInput.value = toInputDate(end);
    persistFormState();
    setStatus("Loaded a trailing 5-year window.", "info");
  }

  function handleFormFieldChange() {
    persistFormState();
  }

  form.addEventListener("submit", handleSubmit);
  startDateInput.addEventListener("change", handleFormFieldChange);
  endDateInput.addEventListener("change", handleFormFieldChange);
  lastFiveYearsButton.addEventListener("click", applyLastFiveYears);
  resultsRoot.addEventListener("click", handleResultsClick);

  refreshSelectionUi();
  loadBundledManifest();
  loadRememberedSymbols();

  if (state.lastStudyRun) {
    renderStudyRunResults(resultsRoot, state.lastStudyRun);
    setStatus("Loaded the last completed rolling returns study.", "success");
  } else {
    updateIndexSummary();
  }

  return () => {
    form.removeEventListener("submit", handleSubmit);
    startDateInput.removeEventListener("change", handleFormFieldChange);
    endDateInput.removeEventListener("change", handleFormFieldChange);
    lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

function mountRollingReturnsVisualsView(root) {
  return mountRollingReturnsVisuals(root, rollingReturnsSession);
}

const rollingReturnsStudy = {
  id: "rolling-returns",
  title: "Rolling Returns",
  description:
    "Track how rolling 1Y, 3Y, 5Y, and 10Y CAGR changed across historical market dates.",
  inputSummary:
    "Active asset from the sidebar plus the date range that defines which rolling windows can form.",
  capabilities: {
    visuals: "ready",
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary: "Inputs, rolling horizon table, and export actions for one filtered series.",
      description:
        "Run the rolling returns study, compare historical CAGR ranges by horizon, and export the full rolling panel.",
      status: "ready",
      default: true,
      mount: mountRollingReturnsOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary: "Rolling CAGR paths and horizon-level comparison charts.",
      description:
        "Inspect how different rolling horizons behaved through time and compare latest, median, and positive-rate reads.",
      status: "ready",
      mount: mountRollingReturnsVisualsView,
    },
  ],
};

export { rollingReturnsStudy };
