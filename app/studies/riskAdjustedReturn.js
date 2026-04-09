import { formatDate } from "../lib/format.js";
import {
  exportStudyCsv,
  exportStudyXls,
} from "../lib/studyExport.js";
import {
  filterSeriesByDate,
  computeRiskAdjustedMetrics,
} from "../lib/stats.js";
import {
  buildLocalApiUnavailableMessage,
  fetchIndexSeries,
  getManifestDataset,
  getSnapshotFreshness,
  loadRememberedIndexCatalog,
  loadSyncManifest,
  loadSyncedSeries,
} from "../lib/syncedData.js";
import {
  buildSelectionSignature,
  buildSeriesRequest,
  findSelectionByQuery,
  mergeSelectionSuggestions,
  upsertRememberedCatalogEntry,
} from "./riskAdjustedReturnSelection.js";
import {
  renderResults,
  renderSelectionDetails,
  studyTemplate,
} from "./riskAdjustedReturnView.js";
import { mountRiskAdjustedReturnVisuals } from "./riskAdjustedReturnVisuals.js";
import { createPlaceholderView } from "./studyShell.js";

const demoIndexSeries = [
  ["2021-04-07", 14500],
  ["2021-07-07", 15680],
  ["2021-10-07", 17220],
  ["2022-01-07", 18340],
  ["2022-04-07", 17860],
  ["2022-07-07", 16210],
  ["2022-10-07", 17040],
  ["2023-01-07", 18120],
  ["2023-04-07", 17780],
  ["2023-07-07", 19650],
  ["2023-10-07", 20340],
  ["2024-01-07", 21620],
  ["2024-04-07", 22480],
  ["2024-07-07", 24750],
  ["2024-10-07", 26120],
  ["2025-01-07", 25240],
  ["2025-04-07", 26980],
  ["2025-07-07", 27560],
  ["2025-10-07", 28890],
  ["2026-01-07", 27980],
  ["2026-04-07", 29520],
].map(([date, value]) => ({ date: new Date(`${date}T00:00:00`), value }));

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
const riskAdjustedReturnSession = {
  indexQuery: "Nifty 50",
  startDateValue: toInputDate(defaultStudyWindow.startDate),
  endDateValue: toInputDate(defaultStudyWindow.endDate),
  riskFreeRateValue: "5.50",
  useDemoData: false,
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

function validateStudyInputs(selection, startValue, endValue, riskFreeValue) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  const riskFreeRate = Number(riskFreeValue);

  if (!selection) {
    throw new Error(
      "Enter an index name or a yfinance symbol before running the study.",
    );
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Pick a valid start date and end date.");
  }
  if (start >= end) {
    throw new Error("Start date must be earlier than end date.");
  }
  if (!Number.isFinite(riskFreeRate)) {
    throw new Error("Enter a valid annual risk-free rate.");
  }

  return { start, end, riskFreeRate };
}

function renderStudyRunResults(resultsRoot, studyRun) {
  resultsRoot.innerHTML = renderResults({
    metrics: studyRun.metrics,
    startDate: studyRun.actualStartDate,
    endDate: studyRun.actualEndDate,
    methodLabel: studyRun.methodLabel,
    warnings: studyRun.warnings,
  });
}

function mountRiskAdjustedReturnOverview(root) {
    root.innerHTML = studyTemplate(
      riskAdjustedReturnSession.startDateValue,
      riskAdjustedReturnSession.endDateValue,
    );

    const form = root.querySelector("#risk-study-form");
    const indexQueryInput = root.querySelector("#index-query");
    const indexSuggestions = root.querySelector("#index-suggestions");
    const indexSummary = root.querySelector("#index-summary");
    const startDateInput = root.querySelector("#start-date");
    const endDateInput = root.querySelector("#end-date");
    const useDemoDataInput = root.querySelector("#use-demo-data");
    const constantRateInput = root.querySelector("#constant-rate");
    const status = root.querySelector("#study-status");
    const resultsRoot = root.querySelector("#results-root");
    const lastFiveYearsButton = root.querySelector("#load-five-year-window");

    indexQueryInput.value = riskAdjustedReturnSession.indexQuery;
    startDateInput.value = riskAdjustedReturnSession.startDateValue;
    endDateInput.value = riskAdjustedReturnSession.endDateValue;
    constantRateInput.value = riskAdjustedReturnSession.riskFreeRateValue;
    useDemoDataInput.checked = riskAdjustedReturnSession.useDemoData;

    const state = {
      bundledManifest: null,
      rememberedCatalog: [],
      backendState: "unknown",
      lastLoadedSelectionSignature:
        riskAdjustedReturnSession.lastLoadedSelectionSignature,
      lastLoadedSnapshot: riskAdjustedReturnSession.lastLoadedSnapshot,
      lastStudyRun: riskAdjustedReturnSession.lastStudyRun,
    };

    function setStatus(message, statusState = "info") {
      status.className = `status ${statusState}`;
      status.textContent = message;
    }

    function persistFormState() {
      riskAdjustedReturnSession.indexQuery = indexQueryInput.value;
      riskAdjustedReturnSession.startDateValue = startDateInput.value;
      riskAdjustedReturnSession.endDateValue = endDateInput.value;
      riskAdjustedReturnSession.riskFreeRateValue = constantRateInput.value;
      riskAdjustedReturnSession.useDemoData = useDemoDataInput.checked;
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
        useDemoDataInput.checked,
        state.backendState,
      );
    }

    function refreshSelectionUi() {
      populateSuggestionList();
      updateIndexSummary();
    }

    function activateResultsTab(tabId) {
      const tabRoot = resultsRoot.querySelector("[data-results-tabs]");
      if (!tabRoot) {
        return;
      }

      const triggers = tabRoot.querySelectorAll("[data-results-tab-trigger]");
      const panels = tabRoot.querySelectorAll("[data-results-tab-panel]");

      triggers.forEach((trigger) => {
        const isActive = trigger.dataset.resultsTabTrigger === tabId;
        trigger.classList.toggle("is-active", isActive);
        trigger.setAttribute("aria-selected", String(isActive));
      });

      panels.forEach((panel) => {
        panel.hidden = panel.dataset.resultsTabPanel !== tabId;
      });
    }

    function handleResultsClick(event) {
      const exportTrigger = event.target.closest("[data-results-export]");
      if (exportTrigger) {
        if (!state.lastStudyRun) {
          setStatus("Run the study before exporting.", "info");
          return;
        }

        try {
          if (exportTrigger.dataset.resultsExport === "csv") {
            exportStudyCsv(state.lastStudyRun);
            setStatus("Downloaded the CSV export.", "success");
            return;
          }

          if (exportTrigger.dataset.resultsExport === "xls") {
            exportStudyXls(state.lastStudyRun);
            setStatus("Downloaded the XLS export.", "success");
            return;
          }
        } catch (error) {
          setStatus(error.message, "error");
          return;
        }
      }

      const trigger = event.target.closest("[data-results-tab-trigger]");
      if (!trigger) {
        return;
      }

      activateResultsTab(trigger.dataset.resultsTabTrigger);
    }

    function rememberCatalogEntry(entry) {
      state.rememberedCatalog = upsertRememberedCatalogEntry(
        state.rememberedCatalog,
        entry,
      );
      refreshSelectionUi();
    }

    function applyLoadedSnapshot(selection, snapshot, rememberedEntry) {
      state.lastLoadedSelectionSignature = buildSelectionSignature(selection);
      state.lastLoadedSnapshot = snapshot;
      riskAdjustedReturnSession.lastLoadedSelectionSignature =
        state.lastLoadedSelectionSignature;
      riskAdjustedReturnSession.lastLoadedSnapshot = snapshot;

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
      riskAdjustedReturnSession.lastStudyRun = null;
      setStatus("Running study...", "info");

      try {
        const selection = getCurrentSelection();
        const { start, end, riskFreeRate } = validateStudyInputs(
          selection,
          startDateInput.value,
          endDateInput.value,
          constantRateInput.value,
        );

        let indexSeries = [];
        const warnings = [];
        let methodLabel = "";

        if (useDemoDataInput.checked) {
          indexSeries = filterSeriesByDate(demoIndexSeries, start, end);
          methodLabel = "Synthetic demo data";
          warnings.push(
            "Demo mode uses synthetic data only. It is for UI testing, not analysis.",
          );
          appendCoverageWarnings(indexSeries, start, end, warnings);
        } else {
          const { snapshot, series, rememberedEntry } =
            await loadSelectionData(selection);

          indexSeries = filterSeriesByDate(series, start, end);
          methodLabel = snapshot.cache
            ? `Local yfinance fetch using ${snapshot.symbol}`
            : `Bundled snapshot using ${snapshot.symbol}`;
          appendCoverageWarnings(indexSeries, start, end, warnings);
          appendSnapshotWarnings(snapshot, warnings);

          if (snapshot.sourceSeriesType !== selection.targetSeriesType) {
            warnings.push(
              `Loaded data currently uses ${snapshot.sourceSeriesType} series as a bootstrap proxy for ${selection.targetSeriesType}.`,
            );
          }

          if (snapshot.note) {
            warnings.push(snapshot.note);
          }

          applyLoadedSnapshot(selection, snapshot, rememberedEntry);
        }

        if (indexSeries.length < 2) {
          throw new Error(
            "The selected date range leaves fewer than two index observations.",
          );
        }

        const metrics = computeRiskAdjustedMetrics(indexSeries, {
          constantRiskFreeRate: riskFreeRate / 100,
        });

        if (selection.targetSeriesType !== "TRI") {
          warnings.push(
            "This selection is not marked as TRI. Dividend exclusion can understate long-run return quality.",
          );
        }

        state.lastStudyRun = {
          studyTitle: riskAdjustedReturnStudy.title,
          selection,
          seriesLabel: useDemoDataInput.checked
            ? `${selection.label} Demo`
            : selection.label,
          indexSeries,
          metrics,
          warnings,
          methodLabel,
          annualRiskFreeRate: riskFreeRate / 100,
          requestedStartDate: start,
          requestedEndDate: end,
          actualStartDate: indexSeries[0].date,
          actualEndDate: indexSeries[indexSeries.length - 1].date,
          useDemoData: useDemoDataInput.checked,
          exportedAt: new Date(),
        };
        riskAdjustedReturnSession.lastStudyRun = state.lastStudyRun;
        renderStudyRunResults(resultsRoot, state.lastStudyRun);

        setStatus("Study completed.", "success");
      } catch (error) {
        state.lastStudyRun = null;
        riskAdjustedReturnSession.lastStudyRun = null;
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
        refreshSelectionUi();
      } catch (error) {
        state.bundledManifest = null;
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
        refreshSelectionUi();
      } catch (error) {
        state.rememberedCatalog = [];
        state.backendState = "unavailable";
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
    useDemoDataInput.addEventListener("change", updateIndexSummary);
    useDemoDataInput.addEventListener("change", handleFormFieldChange);
    startDateInput.addEventListener("input", handleFormFieldChange);
    endDateInput.addEventListener("input", handleFormFieldChange);
    constantRateInput.addEventListener("input", handleFormFieldChange);
    form.addEventListener("submit", handleSubmit);
    lastFiveYearsButton.addEventListener("click", applyLastFiveYears);
    resultsRoot.addEventListener("click", handleResultsClick);

    refreshSelectionUi();
    loadBundledManifest();
    loadRememberedSymbols();
    if (state.lastStudyRun) {
      renderStudyRunResults(resultsRoot, state.lastStudyRun);
      setStatus("Loaded the last completed study run.", "success");
    }

    return () => {
      form.removeEventListener("submit", handleSubmit);
      indexQueryInput.removeEventListener("input", handleSelectionInput);
      indexQueryInput.removeEventListener("change", handleSelectionInput);
      useDemoDataInput.removeEventListener("change", updateIndexSummary);
      useDemoDataInput.removeEventListener("change", handleFormFieldChange);
      startDateInput.removeEventListener("input", handleFormFieldChange);
      endDateInput.removeEventListener("input", handleFormFieldChange);
      constantRateInput.removeEventListener("input", handleFormFieldChange);
      lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
      resultsRoot.removeEventListener("click", handleResultsClick);
    };
}

function mountRiskAdjustedReturnVisualsView(root) {
  return mountRiskAdjustedReturnVisuals(root, riskAdjustedReturnSession);
}

const riskAdjustedReturnStudy = {
  id: "risk-adjusted-return",
  title: "Risk-Adjusted Return",
  description:
    "Measure return, risk, and drawdown for a bundled dataset or yfinance symbol.",
  inputSummary:
    "Dataset or symbol, date range, and annual risk-free rate.",
  capabilities: {
    visuals: "ready",
    relative: "planned",
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary: "Inputs, diagnostics, and export actions for one filtered series.",
      description:
        "Run the current study, review the diagnostics, and export the aligned dataset.",
      status: "ready",
      default: true,
      mount: mountRiskAdjustedReturnOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary: "Study-specific charts and rolling views.",
      description:
        "Inspect the last completed run through growth, drawdown, rolling volatility, and return-distribution charts.",
      status: "ready",
      mount: mountRiskAdjustedReturnVisualsView,
    },
    createPlaceholderView({
      id: "relative",
      label: "Relative",
      summary: "Benchmark comparison when this study adds it.",
      description:
        "This view is reserved for aligned benchmark comparisons, excess-return math, and relative exports.",
      bullets: [
        {
          label: "Benchmarks",
          copy:
            "Pair the current series with a benchmark selector and overlap diagnostics.",
        },
        {
          label: "Relative Exports",
          copy:
            "Export aligned asset and benchmark returns once this view becomes active.",
        },
      ],
    }),
  ],
};

export { riskAdjustedReturnStudy };
