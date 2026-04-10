import {
  DEFAULT_HORIZON_YEARS,
  DEFAULT_TOTAL_INVESTMENT,
  buildLumpsumVsSipStudy,
} from "../lib/lumpsumVsSip.js";
import {
  exportLumpsumVsSipCsv,
  exportLumpsumVsSipXls,
} from "../lib/lumpsumVsSipExport.js";
import { filterSeriesByDate } from "../lib/stats.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  adoptActiveSubjectQuery,
  setActiveSubjectQuery,
} from "./shared/activeSubject.js";
import { createIndexStudyOverviewRuntime } from "./shared/indexStudyOverviewRuntime.js";
import {
  appendCoverageWarnings,
  appendSnapshotWarnings,
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import {
  lumpsumVsSipTemplate,
  renderLumpsumVsSipResults,
} from "./lumpsumVsSipView.js";
import { mountLumpsumVsSipVisuals } from "./lumpsumVsSipVisuals.js";

const defaultStudyWindow = buildDefaultStudyWindow();
const lumpsumVsSipSession = {
  indexQuery: "Nifty 50",
  startDateValue: toInputDate(defaultStudyWindow.startDate),
  endDateValue: toInputDate(defaultStudyWindow.endDate),
  totalInvestmentValue: String(DEFAULT_TOTAL_INVESTMENT),
  horizonYearsValue: String(DEFAULT_HORIZON_YEARS),
  bundledManifest: null,
  rememberedCatalog: [],
  backendState: "unknown",
  lastLoadedSelectionSignature: "none",
  lastLoadedSnapshot: null,
  lastStudyRun: null,
};

function validateStudyInputs(
  selection,
  startValue,
  endValue,
  totalInvestmentValue,
  horizonYearsValue,
) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  const totalInvestment = Number(totalInvestmentValue);
  const horizonYears = Number(horizonYearsValue);

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

  if (!Number.isFinite(totalInvestment) || totalInvestment <= 0) {
    throw new Error("Enter a total investment amount above zero.");
  }

  if (!Number.isFinite(horizonYears) || horizonYears <= 0) {
    throw new Error("Pick a valid comparison horizon.");
  }

  return { start, end, totalInvestment, horizonYears };
}

function renderStudyRunResults(resultsRoot, studyRun) {
  resultsRoot.innerHTML = renderLumpsumVsSipResults(studyRun);
}

function mountLumpsumVsSipOverview(root) {
  if (adoptActiveSubjectQuery(lumpsumVsSipSession)) {
    lumpsumVsSipSession.lastStudyRun = null;
  }

  root.innerHTML = lumpsumVsSipTemplate(
    lumpsumVsSipSession.startDateValue,
    lumpsumVsSipSession.endDateValue,
    lumpsumVsSipSession.totalInvestmentValue,
    Number(lumpsumVsSipSession.horizonYearsValue),
  );

  const form = root.querySelector("#lumpsum-sip-study-form");
  const indexQueryInput = root.querySelector("#lumpsum-sip-query");
  const indexSuggestions = root.querySelector("#lumpsum-sip-suggestions");
  const indexSummary = root.querySelector("#lumpsum-sip-summary");
  const totalInvestmentInput = root.querySelector(
    "#lumpsum-sip-total-investment",
  );
  const horizonYearsInput = root.querySelector("#lumpsum-sip-horizon-years");
  const startDateInput = root.querySelector("#lumpsum-sip-start-date");
  const endDateInput = root.querySelector("#lumpsum-sip-end-date");
  const status = root.querySelector("#lumpsum-sip-status");
  const resultsRoot = root.querySelector("#lumpsum-sip-results-root");
  const lastFiveYearsButton = root.querySelector(
    "#lumpsum-sip-load-five-year-window",
  );

  indexQueryInput.value = lumpsumVsSipSession.indexQuery;
  totalInvestmentInput.value = lumpsumVsSipSession.totalInvestmentValue;
  horizonYearsInput.value = lumpsumVsSipSession.horizonYearsValue;
  startDateInput.value = lumpsumVsSipSession.startDateValue;
  endDateInput.value = lumpsumVsSipSession.endDateValue;

  const state = lumpsumVsSipSession;
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
    triggerSelector: "[data-lumpsum-sip-export]",
    datasetKey: "lumpsumSipExport",
    getPayload: () => state.lastStudyRun,
    exporters: {
      csv: exportLumpsumVsSipCsv,
      xls: exportLumpsumVsSipXls,
    },
    setStatus,
    missingPayloadMessage: "Run the study before exporting.",
  });

  function persistFormState() {
    const subjectChanged = setActiveSubjectQuery(indexQueryInput.value);
    state.indexQuery = indexQueryInput.value;
    state.totalInvestmentValue = totalInvestmentInput.value;
    state.horizonYearsValue = horizonYearsInput.value;
    state.startDateValue = startDateInput.value;
    state.endDateValue = endDateInput.value;
    if (subjectChanged) {
      state.lastStudyRun = null;
    }
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    state.lastStudyRun = null;
    setStatus("Running Lumpsum vs SIP comparison...", "info");

    try {
      const selection = getCurrentSelection();
      const { start, end, totalInvestment, horizonYears } =
        validateStudyInputs(
          selection,
          startDateInput.value,
          endDateInput.value,
          totalInvestmentInput.value,
          horizonYearsInput.value,
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

      const comparisonModel = buildLumpsumVsSipStudy(filteredSeries, {
        totalInvestment,
        horizonYears,
      });

      if (comparisonModel.summary.totalCohorts < 6) {
        warnings.push(
          "Fewer than six full comparison cohorts fit the active window. Treat the win-rate read as directional only.",
        );
      }

      if (selection.targetSeriesType !== "TRI") {
        warnings.push(
          "This selection is not marked as TRI. Price-only data can understate both lumpsum and SIP terminal outcomes.",
        );
      }

      applyLoadedSnapshot(selection, snapshot, rememberedEntry);

      state.lastStudyRun = {
        studyTitle: lumpsumVsSipStudy.title,
        selection: {
          ...selection,
          currency: snapshot.currency || selection.currency || null,
        },
        seriesLabel: selection.label,
        indexSeries: filteredSeries,
        monthlyPoints: comparisonModel.monthlyPoints,
        cohorts: comparisonModel.cohorts,
        summary: comparisonModel.summary,
        warnings,
        methodLabel,
        totalInvestment,
        horizonYears,
        requestedStartDate: start,
        requestedEndDate: end,
        actualStartDate: filteredSeries[0].date,
        actualEndDate: filteredSeries[filteredSeries.length - 1].date,
        exportedAt: new Date(),
      };
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("Lumpsum vs SIP comparison completed.", "success");
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
  totalInvestmentInput.addEventListener("input", handleFormFieldChange);
  totalInvestmentInput.addEventListener("change", handleFormFieldChange);
  horizonYearsInput.addEventListener("change", handleFormFieldChange);
  startDateInput.addEventListener("change", handleFormFieldChange);
  endDateInput.addEventListener("change", handleFormFieldChange);
  lastFiveYearsButton.addEventListener("click", applyLastFiveYears);
  resultsRoot.addEventListener("click", handleResultsClick);

  refreshSelectionUi();
  loadBundledManifest();
  loadRememberedSymbols();

  if (state.lastStudyRun) {
    renderStudyRunResults(resultsRoot, state.lastStudyRun);
    setStatus("Loaded the last completed comparison run.", "success");
  } else {
    updateIndexSummary();
  }

  return () => {
    form.removeEventListener("submit", handleSubmit);
    indexQueryInput.removeEventListener("input", handleSelectionInput);
    indexQueryInput.removeEventListener("change", handleSelectionInput);
    totalInvestmentInput.removeEventListener("input", handleFormFieldChange);
    totalInvestmentInput.removeEventListener("change", handleFormFieldChange);
    horizonYearsInput.removeEventListener("change", handleFormFieldChange);
    startDateInput.removeEventListener("change", handleFormFieldChange);
    endDateInput.removeEventListener("change", handleFormFieldChange);
    lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

function mountLumpsumVsSipVisualsView(root) {
  return mountLumpsumVsSipVisuals(root, lumpsumVsSipSession);
}

const lumpsumVsSipStudy = {
  id: "lumpsum-vs-sip",
  title: "Lumpsum vs SIP",
  description:
    "Compare the same total capital invested upfront versus spread monthly across historical start cohorts.",
  inputSummary:
    "Dataset or symbol, date range, total investment amount, and fixed horizon.",
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
      summary: "Inputs, win rates, cohort table, and export actions.",
      description:
        "Run the comparison, inspect terminal-value differences, and export the cohort panel.",
      mount: mountLumpsumVsSipOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      status: "ready",
      summary: "Advantage and terminal-value charts by start month.",
      description:
        "Read Lumpsum vs SIP advantage and terminal-value paths across historical start cohorts.",
      mount: mountLumpsumVsSipVisualsView,
    },
  ],
};

export { lumpsumVsSipStudy };
