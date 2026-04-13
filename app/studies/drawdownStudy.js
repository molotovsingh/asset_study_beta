import { buildDrawdownStudy } from "../lib/drawdownStudy.js";
import {
  exportDrawdownStudyCsv,
  exportDrawdownStudyXls,
} from "../lib/drawdownStudyExport.js";
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
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import { validateIndexDateRange } from "./shared/validation.js";
import {
  drawdownStudyTemplate,
  renderDrawdownStudyResults,
} from "./drawdownStudyView.js";
import { mountDrawdownStudyVisuals } from "./drawdownStudyVisuals.js";

const defaultStudyWindow = buildDefaultStudyWindow();
const drawdownStudySession = {
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
  resultsRoot.innerHTML = renderDrawdownStudyResults(studyRun);
}

function replaceDrawdownRouteParams() {
  replaceRouteInputParams(drawdownStudy.id, "overview", {
    ...buildCommonIndexParams(drawdownStudySession),
  });
}

function mountDrawdownOverview(root) {
  const routeParamsApplied = readCommonIndexParams(drawdownStudySession);
  if (routeParamsApplied.changed) {
    drawdownStudySession.lastStudyRun = null;
  }
  if (routeParamsApplied.subject) {
    setActiveSubjectQuery(drawdownStudySession.indexQuery);
  } else if (adoptActiveSubjectQuery(drawdownStudySession)) {
    drawdownStudySession.lastStudyRun = null;
  }

  root.innerHTML = drawdownStudyTemplate(
    drawdownStudySession.startDateValue,
    drawdownStudySession.endDateValue,
  );

  const form = root.querySelector("#drawdown-study-form");
  const indexQueryInput = root.querySelector("#drawdown-query");
  const indexSuggestions = root.querySelector("#drawdown-suggestions");
  const indexSummary = root.querySelector("#drawdown-summary");
  const startDateInput = root.querySelector("#drawdown-start-date");
  const endDateInput = root.querySelector("#drawdown-end-date");
  const status = root.querySelector("#drawdown-status");
  const resultsRoot = root.querySelector("#drawdown-results-root");
  const lastFiveYearsButton = root.querySelector(
    "#drawdown-load-five-year-window",
  );

  indexQueryInput.value = drawdownStudySession.indexQuery;
  startDateInput.value = drawdownStudySession.startDateValue;
  endDateInput.value = drawdownStudySession.endDateValue;

  const state = drawdownStudySession;
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
    triggerSelector: "[data-drawdown-export]",
    datasetKey: "drawdownExport",
    getPayload: () => state.lastStudyRun,
    exporters: {
      csv: exportDrawdownStudyCsv,
      xls: exportDrawdownStudyXls,
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
    replaceDrawdownRouteParams();
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    state.lastStudyRun = null;
    setStatus("Running drawdown study...", "info");

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

      const drawdownModel = buildDrawdownStudy(filteredSeries);
      if (drawdownModel.summary.totalEpisodes < 3) {
        warnings.push(
          "Only a few drawdown episodes formed in this window. Duration and ranking reads are thin.",
        );
      }

      if (drawdownModel.summary.unrecoveredEpisodes > 0) {
        warnings.push(
          "The latest drawdown episode remains open in this sample window.",
        );
      }

      if (selection.targetSeriesType !== "TRI") {
        warnings.push(
          "This selection is not marked as TRI. Price-only series can overstate drawdown persistence when dividends are excluded.",
        );
      }

      preparedSeries.commitLoadedSnapshot();

      state.lastStudyRun = {
        studyTitle: drawdownStudy.title,
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
        ...drawdownModel,
      };
      recordIndexStudyRun(drawdownStudy, state);
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("Drawdown study completed.", "success");
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
    setStatus("Loaded the last completed drawdown study.", "success");
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

function mountDrawdownVisualsView(root) {
  return mountDrawdownStudyVisuals(root, drawdownStudySession);
}

const drawdownStudy = {
  id: "drawdown-study",
  title: "Drawdown Study",
  description:
    "Inspect underwater depth, drawdown durations, and recovery behavior for the active asset.",
  inputSummary:
    "Active asset from the sidebar plus date range; output ranks depth and duration episodes on observed market dates.",
  capabilities: {
    visuals: "ready",
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary: "Inputs, drawdown snapshot cards, ranked episodes, and exports.",
      description:
        "Run the drawdown study, inspect the worst peak-to-trough episodes, and export ranked events and underwater data.",
      status: "ready",
      default: true,
      mount: mountDrawdownOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary: "Underwater path plus ranked depth and duration visual breakdowns.",
      description:
        "Use charts to see drawdown clustering, episode depth ranking, and duration concentration.",
      status: "ready",
      mount: mountDrawdownVisualsView,
    },
  ],
};

export { drawdownStudy };
