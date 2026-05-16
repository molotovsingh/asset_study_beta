import { buildRollingReturnsStudy } from "../lib/rollingReturns.js";
import {
  exportRollingReturnsCsv,
  exportRollingReturnsXls,
} from "../lib/rollingReturnsExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  adoptActiveSubjectQuery,
  setActiveSubjectQuery,
} from "./shared/activeSubject.js";
import { createIndexStudyOverviewRuntime } from "./shared/indexStudyOverviewRuntime.js";
import { recordIndexStudyRun } from "./shared/indexRunHistory.js";
import { prepareIndexStudySeries } from "./shared/indexStudyPipeline.js";
import {
  buildCommonIndexParams,
  readCommonIndexParams,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import {
  buildAvailableStudyWindow,
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import { validateIndexDateRange } from "./shared/validation.js";
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
  return validateIndexDateRange(selection, startValue, endValue);
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
  const routeHasExplicitWindow = routeParamsApplied.start || routeParamsApplied.end;
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
    getRuntimeSnapshot,
    getBundledDatasetForSelection,
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

  function applyAvailableWindow({ announce = false, force = false } = {}) {
    if (!force && routeHasExplicitWindow) {
      return false;
    }

    const selection = getCurrentSelection();
    const manifestDataset = getBundledDatasetForSelection(selection);
    const nextWindow = buildAvailableStudyWindow({
      selection: manifestDataset
        ? { ...selection, range: manifestDataset.range || selection.range }
        : selection,
      runtimeSnapshot: getRuntimeSnapshot(selection),
    });
    const nextStartValue = toInputDate(nextWindow.startDate);
    const nextEndValue = toInputDate(nextWindow.endDate);

    if (
      startDateInput.value === nextStartValue &&
      endDateInput.value === nextEndValue
    ) {
      return false;
    }

    startDateInput.value = nextStartValue;
    endDateInput.value = nextEndValue;
    persistFormState();
    if (announce) {
      setStatus(
        nextWindow.anchoredToAvailableEndDate
          ? "Loaded the last 5 available market years."
          : "Loaded a trailing 5-year window.",
        "info",
      );
    }
    return true;
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

      const preparedSeries = await prepareIndexStudySeries({
        selection,
        start,
        end,
        warnings,
        loadSelectionData,
        applyLoadedSnapshot,
      });
      const { filteredSeries, methodLabel } = preparedSeries;

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

      preparedSeries.commitLoadedSnapshot();

      state.lastStudyRun = {
        studyTitle: rollingReturnsStudy.title,
        selection: {
          ...selection,
          currency:
            preparedSeries.snapshot.currency || selection.currency || null,
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
    applyAvailableWindow({ announce: true, force: true });
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
  loadBundledManifest().finally(() => {
    if (!state.lastStudyRun) {
      applyAvailableWindow();
    }
  });
  loadRememberedSymbols().finally(() => {
    if (!state.lastStudyRun) {
      applyAvailableWindow();
    }
  });

  if (state.lastStudyRun) {
    renderStudyRunResults(resultsRoot, state.lastStudyRun);
    setStatus("Loaded the last completed rolling returns study.", "success");
  } else {
    updateIndexSummary();
    applyAvailableWindow();
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
