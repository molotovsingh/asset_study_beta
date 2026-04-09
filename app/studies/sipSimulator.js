import {
  DEFAULT_MIN_CONTRIBUTIONS,
  DEFAULT_MONTHLY_CONTRIBUTION,
  buildSipStudy,
} from "../lib/sipSimulator.js";
import {
  exportSipSimulatorCsv,
  exportSipSimulatorXls,
} from "../lib/sipSimulatorExport.js";
import { filterSeriesByDate } from "../lib/stats.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { createIndexStudyOverviewRuntime } from "./shared/indexStudyOverviewRuntime.js";
import {
  appendCoverageWarnings,
  appendSnapshotWarnings,
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import {
  renderSipSimulatorResults,
  sipSimulatorTemplate,
} from "./sipSimulatorView.js";
import { mountSipSimulatorVisuals } from "./sipSimulatorVisuals.js";

const defaultStudyWindow = buildDefaultStudyWindow();
const sipSimulatorSession = {
  indexQuery: "Nifty 50",
  startDateValue: toInputDate(defaultStudyWindow.startDate),
  endDateValue: toInputDate(defaultStudyWindow.endDate),
  monthlyContributionValue: String(DEFAULT_MONTHLY_CONTRIBUTION),
  bundledManifest: null,
  rememberedCatalog: [],
  backendState: "unknown",
  lastLoadedSelectionSignature: "none",
  lastLoadedSnapshot: null,
  lastStudyRun: null,
};

function validateStudyInputs(selection, startValue, endValue, monthlyContributionValue) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  const monthlyContribution = Number(monthlyContributionValue);

  if (!selection) {
    throw new Error(
      "Enter a dataset name or a yfinance symbol before running the study.",
    );
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Pick a valid start date and end date.");
  }

  if (start >= end) {
    throw new Error("Start date must be earlier than end date.");
  }

  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) {
    throw new Error("Enter a monthly contribution amount above zero.");
  }

  return { start, end, monthlyContribution };
}

function renderStudyRunResults(resultsRoot, studyRun) {
  resultsRoot.innerHTML = renderSipSimulatorResults(studyRun);
}

function mountSipSimulatorOverview(root) {
  root.innerHTML = sipSimulatorTemplate(
    sipSimulatorSession.startDateValue,
    sipSimulatorSession.endDateValue,
    sipSimulatorSession.monthlyContributionValue,
  );

  const form = root.querySelector("#sip-simulator-study-form");
  const indexQueryInput = root.querySelector("#sip-simulator-query");
  const indexSuggestions = root.querySelector("#sip-simulator-suggestions");
  const indexSummary = root.querySelector("#sip-simulator-summary");
  const contributionInput = root.querySelector("#sip-simulator-contribution");
  const startDateInput = root.querySelector("#sip-simulator-start-date");
  const endDateInput = root.querySelector("#sip-simulator-end-date");
  const status = root.querySelector("#sip-simulator-status");
  const resultsRoot = root.querySelector("#sip-simulator-results-root");
  const lastFiveYearsButton = root.querySelector(
    "#sip-simulator-load-five-year-window",
  );

  indexQueryInput.value = sipSimulatorSession.indexQuery;
  contributionInput.value = sipSimulatorSession.monthlyContributionValue;
  startDateInput.value = sipSimulatorSession.startDateValue;
  endDateInput.value = sipSimulatorSession.endDateValue;

  const state = sipSimulatorSession;
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
    triggerSelector: "[data-sip-export]",
    datasetKey: "sipExport",
    getPayload: () => state.lastStudyRun,
    exporters: {
      csv: exportSipSimulatorCsv,
      xls: exportSipSimulatorXls,
    },
    setStatus,
    missingPayloadMessage: "Run the study before exporting.",
  });

  function persistFormState() {
    state.indexQuery = indexQueryInput.value;
    state.monthlyContributionValue = contributionInput.value;
    state.startDateValue = startDateInput.value;
    state.endDateValue = endDateInput.value;
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    state.lastStudyRun = null;
    setStatus("Running SIP simulator...", "info");

    try {
      const selection = getCurrentSelection();
      const { start, end, monthlyContribution } = validateStudyInputs(
        selection,
        startDateInput.value,
        endDateInput.value,
        contributionInput.value,
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

      const sipModel = buildSipStudy(filteredSeries, {
        monthlyContribution,
        minContributions: DEFAULT_MIN_CONTRIBUTIONS,
      });

      if (sipModel.summary.totalCohorts < 6) {
        warnings.push(
          "Fewer than six SIP cohorts fit the active window. Treat the cohort spread as directional only.",
        );
      }

      if (sipModel.summary.shortestIncludedCohort?.contributionCount === DEFAULT_MIN_CONTRIBUTIONS) {
        warnings.push(
          `Later start months are excluded until they have at least ${DEFAULT_MIN_CONTRIBUTIONS} contributions.`,
        );
      }

      if (selection.targetSeriesType !== "TRI") {
        warnings.push(
          "This selection is not marked as TRI. Price-only SIP results can understate long-run wealth creation.",
        );
      }

      applyLoadedSnapshot(selection, snapshot, rememberedEntry);

      state.lastStudyRun = {
        studyTitle: sipSimulatorStudy.title,
        selection: {
          ...selection,
          currency: snapshot.currency || selection.currency || null,
        },
        seriesLabel: selection.label,
        indexSeries: filteredSeries,
        monthlyPoints: sipModel.monthlyPoints,
        cohorts: sipModel.cohorts,
        summary: sipModel.summary,
        warnings,
        methodLabel,
        monthlyContribution,
        minContributions: DEFAULT_MIN_CONTRIBUTIONS,
        requestedStartDate: start,
        requestedEndDate: end,
        actualStartDate: filteredSeries[0].date,
        actualEndDate: filteredSeries[filteredSeries.length - 1].date,
        endMonthLabel:
          sipModel.monthlyPoints[sipModel.monthlyPoints.length - 1]?.monthLabel ||
          null,
        exportedAt: new Date(),
      };
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("SIP simulator completed.", "success");
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

  function handleSelectionInput() {
    persistFormState();
    updateIndexSummary();
  }

  function handleFormFieldChange() {
    persistFormState();
  }

  form.addEventListener("submit", handleSubmit);
  indexQueryInput.addEventListener("input", handleSelectionInput);
  indexQueryInput.addEventListener("change", handleSelectionInput);
  contributionInput.addEventListener("input", handleFormFieldChange);
  contributionInput.addEventListener("change", handleFormFieldChange);
  startDateInput.addEventListener("change", handleFormFieldChange);
  endDateInput.addEventListener("change", handleFormFieldChange);
  lastFiveYearsButton.addEventListener("click", applyLastFiveYears);
  resultsRoot.addEventListener("click", handleResultsClick);

  refreshSelectionUi();
  loadBundledManifest();
  loadRememberedSymbols();

  if (state.lastStudyRun) {
    renderStudyRunResults(resultsRoot, state.lastStudyRun);
    setStatus("Loaded the last completed SIP simulator run.", "success");
  } else {
    updateIndexSummary();
  }

  return () => {
    form.removeEventListener("submit", handleSubmit);
    indexQueryInput.removeEventListener("input", handleSelectionInput);
    indexQueryInput.removeEventListener("change", handleSelectionInput);
    contributionInput.removeEventListener("input", handleFormFieldChange);
    contributionInput.removeEventListener("change", handleFormFieldChange);
    startDateInput.removeEventListener("change", handleFormFieldChange);
    endDateInput.removeEventListener("change", handleFormFieldChange);
    lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

function mountSipSimulatorVisualsView(root) {
  return mountSipSimulatorVisuals(root, sipSimulatorSession);
}

const sipSimulatorStudy = {
  id: "sip-simulator",
  title: "SIP Simulator",
  description:
    "Simulate a fixed monthly SIP across every eligible start month and compare XIRR, terminal value, and cohort spread.",
  inputSummary:
    "Dataset or symbol, date range, and fixed monthly contribution amount.",
  capabilities: {
    visuals: "ready",
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      status: "ready",
      default: true,
      summary: "Inputs, cohort table, and export actions for one filtered series.",
      description:
        "Run the SIP simulator, compare historical start-month cohorts, and export the cohort table.",
      mount: mountSipSimulatorOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      status: "ready",
      summary: "Cohort XIRR, wealth multiple, and full-window SIP path charts.",
      description:
        "Read cohort XIRR, wealth multiple, and full-window invested-versus-value charts.",
      mount: mountSipSimulatorVisualsView,
    },
  ],
};

export { sipSimulatorStudy };
