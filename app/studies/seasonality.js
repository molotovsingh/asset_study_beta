import { buildSeasonalityStudy } from "../lib/seasonality.js";
import {
  exportSeasonalityCsv,
  exportSeasonalityXls,
} from "../lib/seasonalityExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import { prepareIndexStudySeries } from "./shared/indexStudyPipeline.js";
import {
  adoptActiveSubjectQuery,
  setActiveSubjectQuery,
} from "./shared/activeSubject.js";
import { createIndexStudyOverviewRuntime } from "./shared/indexStudyOverviewRuntime.js";
import { recordIndexStudyRun } from "./shared/indexRunHistory.js";
import {
  buildCommonIndexParams,
  getCurrentRouteParams,
  readBooleanParam,
  readCommonIndexParams,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import { validateIndexDateRange } from "./shared/validation.js";
import {
  renderSeasonalityResults,
  seasonalityTemplate,
} from "./seasonalityView.js";
import { mountSeasonalityVisuals } from "./seasonalityVisuals.js";

const defaultStudyWindow = buildDefaultStudyWindow();
const seasonalitySession = {
  indexQuery: "Nifty 50",
  startDateValue: toInputDate(defaultStudyWindow.startDate),
  endDateValue: toInputDate(defaultStudyWindow.endDate),
  includePartialBoundaryMonths: false,
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
  resultsRoot.innerHTML = renderSeasonalityResults(studyRun);
}

function applySeasonalityRouteParams() {
  const params = getCurrentRouteParams();
  const applied = readCommonIndexParams(seasonalitySession, params);
  if (params.has("partial")) {
    const includePartial = readBooleanParam(params, "partial");
    if (seasonalitySession.includePartialBoundaryMonths !== includePartial) {
      seasonalitySession.includePartialBoundaryMonths = includePartial;
      applied.changed = true;
    }
  }

  return applied;
}

function replaceSeasonalityRouteParams() {
  replaceRouteInputParams(seasonalityStudy.id, "overview", {
    ...buildCommonIndexParams(seasonalitySession),
    partial: seasonalitySession.includePartialBoundaryMonths ? "1" : "",
  });
}

function mountSeasonalityOverview(root) {
  const routeParamsApplied = applySeasonalityRouteParams();
  if (routeParamsApplied.changed) {
    seasonalitySession.lastStudyRun = null;
  }
  if (routeParamsApplied.subject) {
    setActiveSubjectQuery(seasonalitySession.indexQuery);
  } else if (adoptActiveSubjectQuery(seasonalitySession)) {
    seasonalitySession.lastStudyRun = null;
  }

  root.innerHTML = seasonalityTemplate(
    seasonalitySession.startDateValue,
    seasonalitySession.endDateValue,
    seasonalitySession.includePartialBoundaryMonths,
  );

  const form = root.querySelector("#seasonality-study-form");
  const indexQueryInput = root.querySelector("#seasonality-query");
  const indexSuggestions = root.querySelector("#seasonality-suggestions");
  const indexSummary = root.querySelector("#seasonality-summary");
  const startDateInput = root.querySelector("#seasonality-start-date");
  const endDateInput = root.querySelector("#seasonality-end-date");
  const includePartialInput = root.querySelector("#seasonality-include-partial");
  const status = root.querySelector("#seasonality-status");
  const resultsRoot = root.querySelector("#seasonality-results-root");
  const lastFiveYearsButton = root.querySelector(
    "#seasonality-load-five-year-window",
  );

  indexQueryInput.value = seasonalitySession.indexQuery;
  startDateInput.value = seasonalitySession.startDateValue;
  endDateInput.value = seasonalitySession.endDateValue;
  includePartialInput.checked =
    seasonalitySession.includePartialBoundaryMonths;

  const state = seasonalitySession;
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
    triggerSelector: "[data-seasonality-export]",
    datasetKey: "seasonalityExport",
    getPayload: () => state.lastStudyRun,
    exporters: {
      csv: exportSeasonalityCsv,
      xls: exportSeasonalityXls,
    },
    setStatus,
    missingPayloadMessage: "Run the study before exporting.",
  });

  function persistFormState() {
    const subjectChanged = setActiveSubjectQuery(indexQueryInput.value);
    state.indexQuery = indexQueryInput.value;
    state.startDateValue = startDateInput.value;
    state.endDateValue = endDateInput.value;
    state.includePartialBoundaryMonths = includePartialInput.checked;
    if (subjectChanged) {
      state.lastStudyRun = null;
    }
    replaceSeasonalityRouteParams();
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    state.lastStudyRun = null;
    setStatus("Running seasonality study...", "info");

    try {
      const selection = getCurrentSelection();
      const { start, end } = validateStudyInputs(
        selection,
        startDateInput.value,
        endDateInput.value,
      );
      const includePartialBoundaryMonths = includePartialInput.checked;
      const warnings = [];

      const preparedSeries = await prepareIndexStudySeries({
        selection,
        start,
        end,
        warnings,
        loadSelectionData,
        applyLoadedSnapshot,
      });
      const { snapshot, series, filteredSeries, methodLabel } = preparedSeries;

      const seasonalityModel = buildSeasonalityStudy(series, {
        startDate: start,
        endDate: end,
        includePartialBoundaryMonths,
      });

      if (seasonalityModel.summary.yearsObserved < 3) {
        warnings.push(
          "Fewer than three years are in the active window. Seasonality patterns may be too thin to trust.",
        );
      }

      if (seasonalityModel.summary.monthsUsed < 24) {
        warnings.push(
          "The active window contains fewer than 24 monthly observations. Treat this as descriptive only.",
        );
      }

      if (seasonalityModel.summary.thinMonthCount > 0) {
        warnings.push(
          `${seasonalityModel.summary.thinMonthCount} month buckets have fewer than 4 observations. Their confidence bands are especially fragile.`,
        );
      }

      if (seasonalityModel.summary.skippedTransitions > 0) {
        warnings.push(
          "One or more month-to-month gaps were skipped because the series did not have consecutive month anchors.",
        );
      }

      if (selection.targetSeriesType !== "TRI") {
        warnings.push(
          "This selection is not marked as TRI. Dividend exclusion can distort monthly seasonality reads.",
        );
      }

      preparedSeries.commitLoadedSnapshot();

      state.lastStudyRun = {
        studyTitle: seasonalityStudy.title,
        selection: {
          ...selection,
          currency: snapshot.currency || selection.currency || null,
        },
        seriesLabel: selection.label,
        indexSeries: filteredSeries,
        bucketStats: seasonalityModel.bucketStats,
        monthlyRows: seasonalityModel.monthlyRows,
        heatmap: seasonalityModel.heatmap,
        summary: seasonalityModel.summary,
        warnings,
        methodLabel,
        requestedStartDate: start,
        requestedEndDate: end,
        actualStartDate: filteredSeries[0].date,
        actualEndDate: filteredSeries[filteredSeries.length - 1].date,
        includePartialBoundaryMonths,
        monthlyReturnMode: seasonalityModel.monthlyReturnMode,
        confidenceLevel: seasonalityModel.confidenceLevel,
        exportedAt: new Date(),
      };
      recordIndexStudyRun(seasonalityStudy, state);
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("Seasonality study completed.", "success");
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

  startDateInput.addEventListener("input", handleFormFieldChange);
  endDateInput.addEventListener("input", handleFormFieldChange);
  includePartialInput.addEventListener("change", handleFormFieldChange);
  form.addEventListener("submit", handleSubmit);
  lastFiveYearsButton.addEventListener("click", applyLastFiveYears);
  resultsRoot.addEventListener("click", handleResultsClick);

  refreshSelectionUi();
  loadBundledManifest();
  loadRememberedSymbols();
  if (state.lastStudyRun) {
    renderStudyRunResults(resultsRoot, state.lastStudyRun);
    setStatus("Loaded the last completed seasonality run.", "success");
  }

  return () => {
    startDateInput.removeEventListener("input", handleFormFieldChange);
    endDateInput.removeEventListener("input", handleFormFieldChange);
    includePartialInput.removeEventListener("change", handleFormFieldChange);
    form.removeEventListener("submit", handleSubmit);
    lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

function mountSeasonalityVisualsView(root) {
  return mountSeasonalityVisuals(root, seasonalitySession);
}

const seasonalityStudy = {
  id: "seasonality",
  title: "Seasonality",
  description:
    "Inspect month-of-year tendencies for the active asset.",
  inputSummary:
    "Active asset from the sidebar, date range, and partial-month handling.",
  capabilities: {
    visuals: "ready",
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary: "Inputs, month buckets, and export actions for one series.",
      description:
        "Run the seasonality study, inspect the month table, and export the monthly panel.",
      status: "ready",
      default: true,
      mount: mountSeasonalityOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary: "Heatmap and month-bucket charts for the last completed run.",
      description:
        "Inspect the heatmap, average month return, win rate, and volatility by month.",
      status: "ready",
      mount: mountSeasonalityVisualsView,
    },
  ],
};

export { seasonalityStudy };
