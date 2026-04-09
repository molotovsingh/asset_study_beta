import { formatDate } from "../lib/format.js";
import { buildSeasonalityStudy } from "../lib/seasonality.js";
import {
  exportSeasonalityCsv,
  exportSeasonalityXls,
} from "../lib/seasonalityExport.js";
import {
  buildLocalApiUnavailableMessage,
  fetchIndexSeries,
  getManifestDataset,
  getSnapshotFreshness,
  loadRememberedIndexCatalog,
  loadSyncManifest,
  loadSyncedSeries,
} from "../lib/syncedData.js";
import { filterSeriesByDate } from "../lib/stats.js";
import {
  buildSelectionSignature,
  buildSeriesRequest,
  findSelectionByQuery,
  mergeSelectionSuggestions,
  upsertRememberedCatalogEntry,
} from "./riskAdjustedReturnSelection.js";
import { renderSelectionDetails } from "./riskAdjustedReturnView.js";
import {
  renderSeasonalityResults,
  seasonalityTemplate,
} from "./seasonalityView.js";
import { mountSeasonalityVisuals } from "./seasonalityVisuals.js";

const bundledManifestSyncConfig = {
  provider: "yfinance",
  datasetType: "index",
};

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDefaultWindow() {
  const today = new Date();
  const endDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 5);

  return {
    startDate,
    endDate,
  };
}

const defaultStudyWindow = buildDefaultWindow();
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

function appendCoverageWarnings(series, startDate, endDate, warnings) {
  if (!series.length) {
    return;
  }

  const firstDate = series[0].date;
  const lastDate = series[series.length - 1].date;

  if (firstDate > startDate) {
    warnings.push(
      `The loaded data starts on ${formatDate(firstDate)}, later than your requested start date.`,
    );
  }

  if (lastDate < endDate) {
    warnings.push(
      `The loaded data ends on ${formatDate(lastDate)}, earlier than your requested end date.`,
    );
  }
}

function appendSnapshotWarnings(snapshot, warnings) {
  const freshness = getSnapshotFreshness(snapshot);

  if (freshness.marketLagDays !== null && freshness.marketLagDays > 5) {
    warnings.push(
      `Latest market date is ${formatDate(freshness.latestDate)}, which is ${freshness.marketLagDays} days behind today.`,
    );
  }

  if (freshness.syncAgeDays !== null && freshness.syncAgeDays > 2) {
    const fetchLabel = snapshot.cache ? "fetched" : "synced";
    warnings.push(
      `This series was last ${fetchLabel} ${freshness.syncAgeDays} days ago.`,
    );
  }
}

function validateStudyInputs(selection, startValue, endValue) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);

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

  return { start, end };
}

function renderStudyRunResults(resultsRoot, studyRun) {
  resultsRoot.innerHTML = renderSeasonalityResults(studyRun);
}

function mountSeasonalityOverview(root) {
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

  const state = {
    bundledManifest: seasonalitySession.bundledManifest,
    rememberedCatalog: seasonalitySession.rememberedCatalog,
    backendState: seasonalitySession.backendState,
    lastLoadedSelectionSignature:
      seasonalitySession.lastLoadedSelectionSignature,
    lastLoadedSnapshot: seasonalitySession.lastLoadedSnapshot,
    lastStudyRun: seasonalitySession.lastStudyRun,
  };

  function setStatus(message, statusState = "info") {
    status.className = `status ${statusState}`;
    status.textContent = message;
  }

  function persistFormState() {
    seasonalitySession.indexQuery = indexQueryInput.value;
    seasonalitySession.startDateValue = startDateInput.value;
    seasonalitySession.endDateValue = endDateInput.value;
    seasonalitySession.includePartialBoundaryMonths =
      includePartialInput.checked;
  }

  function getSuggestions() {
    return mergeSelectionSuggestions(
      state.bundledManifest,
      state.rememberedCatalog,
    );
  }

  function getCurrentSelection() {
    return findSelectionByQuery(indexQueryInput.value, getSuggestions());
  }

  function getRuntimeSnapshot(selection) {
    const selectionSignature = buildSelectionSignature(selection);
    return selectionSignature === state.lastLoadedSelectionSignature
      ? state.lastLoadedSnapshot
      : null;
  }

  function populateSuggestionList() {
    indexSuggestions.innerHTML = getSuggestions()
      .map(
        (entry) =>
          `<option value="${entry.label}" label="${entry.symbol} · ${entry.family}"></option>`,
      )
      .join("");
  }

  function updateIndexSummary() {
    const selection = getCurrentSelection();
    indexSummary.innerHTML = renderSelectionDetails(
      selection,
      getRuntimeSnapshot(selection),
      false,
      state.backendState,
    );
  }

  function refreshSelectionUi() {
    populateSuggestionList();
    updateIndexSummary();
  }

  function handleResultsClick(event) {
    const exportTrigger = event.target.closest("[data-seasonality-export]");
    if (!exportTrigger) {
      return;
    }

    if (!state.lastStudyRun) {
      setStatus("Run the study before exporting.", "info");
      return;
    }

    try {
      if (exportTrigger.dataset.seasonalityExport === "csv") {
        exportSeasonalityCsv(state.lastStudyRun);
        setStatus("Downloaded the seasonality CSV export.", "success");
        return;
      }

      if (exportTrigger.dataset.seasonalityExport === "xls") {
        exportSeasonalityXls(state.lastStudyRun);
        setStatus("Downloaded the seasonality XLS export.", "success");
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  function rememberCatalogEntry(entry) {
    state.rememberedCatalog = upsertRememberedCatalogEntry(
      state.rememberedCatalog,
      entry,
    );
    seasonalitySession.rememberedCatalog = state.rememberedCatalog;
    refreshSelectionUi();
  }

  function applyLoadedSnapshot(selection, snapshot, rememberedEntry) {
    state.lastLoadedSelectionSignature = buildSelectionSignature(selection);
    state.lastLoadedSnapshot = snapshot;
    seasonalitySession.lastLoadedSelectionSignature =
      state.lastLoadedSelectionSignature;
    seasonalitySession.lastLoadedSnapshot = snapshot;

    if (rememberedEntry) {
      rememberCatalogEntry(rememberedEntry);
      return;
    }

    updateIndexSummary();
  }

  async function loadSelectionData(selection) {
    if (selection.kind === "builtin" || selection.kind === "bundled") {
      const manifestDataset =
        state.bundledManifest && selection.sync
          ? getManifestDataset(state.bundledManifest, selection.sync)
          : null;

      return loadSyncedSeries(selection.sync, manifestDataset);
    }

    return fetchIndexSeries(buildSeriesRequest(selection));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    state.lastStudyRun = null;
    seasonalitySession.lastStudyRun = null;
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

      applyLoadedSnapshot(selection, snapshot, rememberedEntry);

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
      seasonalitySession.lastStudyRun = state.lastStudyRun;
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("Seasonality study completed.", "success");
    } catch (error) {
      state.lastStudyRun = null;
      seasonalitySession.lastStudyRun = null;
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

  async function loadBundledManifest() {
    try {
      state.bundledManifest = await loadSyncManifest(bundledManifestSyncConfig);
      seasonalitySession.bundledManifest = state.bundledManifest;
      refreshSelectionUi();
    } catch (error) {
      state.bundledManifest = null;
      seasonalitySession.bundledManifest = null;
      refreshSelectionUi();
      setStatus(
        `${error.message} Built-in datasets can still load directly if their snapshot files exist.`,
        "info",
      );
    }
  }

  async function loadRememberedSymbols() {
    try {
      state.rememberedCatalog = await loadRememberedIndexCatalog();
      state.backendState = "ready";
      seasonalitySession.rememberedCatalog = state.rememberedCatalog;
      seasonalitySession.backendState = "ready";
      refreshSelectionUi();
    } catch (error) {
      state.rememberedCatalog = [];
      state.backendState = "unavailable";
      seasonalitySession.rememberedCatalog = [];
      seasonalitySession.backendState = "unavailable";
      refreshSelectionUi();
      if (!status.textContent) {
        setStatus(buildLocalApiUnavailableMessage(), "info");
      }
    }
  }

  function handleSelectionInput() {
    persistFormState();
    updateIndexSummary();
  }

  function handleFormFieldChange() {
    persistFormState();
  }

  indexQueryInput.addEventListener("input", handleSelectionInput);
  indexQueryInput.addEventListener("change", handleSelectionInput);
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
    indexQueryInput.removeEventListener("input", handleSelectionInput);
    indexQueryInput.removeEventListener("change", handleSelectionInput);
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
    "Inspect month-of-year tendencies for one bundled dataset or yfinance symbol.",
  inputSummary:
    "Dataset or symbol, date range, and whether to include partial boundary months.",
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
