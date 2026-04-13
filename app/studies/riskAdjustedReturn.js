import {
  exportStudyCsv,
  exportStudyXls,
} from "../lib/studyExport.js";
import {
  filterSeriesByDate,
  computeRiskAdjustedMetrics,
} from "../lib/stats.js";
import {
  renderResults,
  studyTemplate,
} from "./riskAdjustedReturnView.js";
import {
  appendCoverageWarnings,
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import { prepareIndexStudySeries } from "./shared/indexStudyPipeline.js";
import {
  adoptActiveSubjectQuery,
  setActiveSubjectQuery,
} from "./shared/activeSubject.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { createIndexStudyOverviewRuntime } from "./shared/indexStudyOverviewRuntime.js";
import { recordIndexStudyRun } from "./shared/indexRunHistory.js";
import {
  buildCommonIndexParams,
  getCurrentRouteParams,
  readBooleanParam,
  readCommonIndexParams,
  readTextParam,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import { validateIndexDateRange } from "./shared/validation.js";
import { mountRiskAdjustedReturnRelative } from "./riskAdjustedReturnRelative.js";
import { mountRiskAdjustedReturnVisuals } from "./riskAdjustedReturnVisuals.js";

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

const defaultStudyWindow = buildDefaultStudyWindow();
const riskAdjustedReturnSession = {
  indexQuery: "Nifty 50",
  startDateValue: toInputDate(defaultStudyWindow.startDate),
  endDateValue: toInputDate(defaultStudyWindow.endDate),
  riskFreeRateValue: "5.50",
  useDemoData: false,
  bundledManifest: null,
  rememberedCatalog: [],
  backendState: "unknown",
  lastLoadedSelectionSignature: "none",
  lastLoadedSnapshot: null,
  lastStudyRun: null,
  relativeBenchmarkQuery: "",
  relativeBasis: "local",
  relativeBaseCurrency: "USD",
  fxSeriesCache: {},
  lastRelativeLoadedSelectionSignature: "none",
  lastRelativeLoadedSnapshot: null,
  lastRelativeRun: null,
};

function validateStudyInputs(selection, startValue, endValue, riskFreeValue) {
  const { start, end } = validateIndexDateRange(
    selection,
    startValue,
    endValue,
  );
  const riskFreeRate = Number(riskFreeValue);
  if (!Number.isFinite(riskFreeRate)) {
    throw new Error("Enter a valid annual risk-free rate.");
  }

  return { start, end, riskFreeRate };
}

function clearRiskAdjustedRuns() {
  riskAdjustedReturnSession.lastStudyRun = null;
  riskAdjustedReturnSession.lastRelativeRun = null;
}

function applyRiskAdjustedRouteParams() {
  const params = getCurrentRouteParams();
  const applied = readCommonIndexParams(riskAdjustedReturnSession, params);
  const riskFreeRate = readTextParam(params, "rf");
  if (
    riskFreeRate &&
    Number.isFinite(Number(riskFreeRate)) &&
    riskAdjustedReturnSession.riskFreeRateValue !== riskFreeRate
  ) {
    riskAdjustedReturnSession.riskFreeRateValue = riskFreeRate;
    applied.changed = true;
  }

  if (params.has("demo")) {
    const useDemoData = readBooleanParam(params, "demo");
    if (riskAdjustedReturnSession.useDemoData !== useDemoData) {
      riskAdjustedReturnSession.useDemoData = useDemoData;
      applied.changed = true;
    }
  }

  return applied;
}

function replaceRiskAdjustedRouteParams() {
  replaceRouteInputParams(riskAdjustedReturnStudy.id, "overview", {
    ...buildCommonIndexParams(riskAdjustedReturnSession),
    rf: riskAdjustedReturnSession.riskFreeRateValue,
    demo: riskAdjustedReturnSession.useDemoData ? "1" : "",
  });
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
    const routeParamsApplied = applyRiskAdjustedRouteParams();
    if (routeParamsApplied.changed) {
      clearRiskAdjustedRuns();
    }
    if (routeParamsApplied.subject) {
      setActiveSubjectQuery(riskAdjustedReturnSession.indexQuery);
    } else if (adoptActiveSubjectQuery(riskAdjustedReturnSession)) {
      clearRiskAdjustedRuns();
    }

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

    const state = riskAdjustedReturnSession;
    const runtime = createIndexStudyOverviewRuntime({
      session: state,
      queryInput: indexQueryInput,
      suggestionsEl: indexSuggestions,
      summaryEl: indexSummary,
      statusEl: status,
      getSummaryContext: () => ({
        useDemoData: useDemoDataInput.checked,
      }),
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
      triggerSelector: "[data-results-export]",
      datasetKey: "resultsExport",
      getPayload: () => state.lastStudyRun,
      exporters: {
        csv: exportStudyCsv,
        xls: exportStudyXls,
      },
      setStatus,
      missingPayloadMessage: "Run the study before exporting.",
    });

    function persistFormState() {
      const subjectChanged = setActiveSubjectQuery(indexQueryInput.value);
      state.indexQuery = indexQueryInput.value;
      state.startDateValue = startDateInput.value;
      state.endDateValue = endDateInput.value;
      state.riskFreeRateValue = constantRateInput.value;
      state.useDemoData = useDemoDataInput.checked;
      if (subjectChanged) {
        clearRiskAdjustedRuns();
      }
      replaceRiskAdjustedRouteParams();
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
      if (handleExportClick(event)) {
        return;
      }

      const trigger = event.target.closest("[data-results-tab-trigger]");
      if (!trigger) {
        return;
      }

      activateResultsTab(trigger.dataset.resultsTabTrigger);
    }

    async function handleSubmit(event) {
      event.preventDefault();
      persistFormState();
      state.lastStudyRun = null;
      state.lastRelativeRun = null;
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
          const preparedSeries = await prepareIndexStudySeries({
            selection,
            start,
            end,
            warnings,
            loadSelectionData,
            applyLoadedSnapshot,
          });

          indexSeries = preparedSeries.filteredSeries;
          methodLabel = preparedSeries.methodLabel;
          preparedSeries.commitLoadedSnapshot();
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
          selection: {
            ...selection,
            currency:
              (useDemoDataInput.checked
                ? selection.currency
                : state.lastLoadedSnapshot?.currency || selection.currency || null),
          },
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
        recordIndexStudyRun(riskAdjustedReturnStudy, state);
        renderStudyRunResults(resultsRoot, state.lastStudyRun);

        setStatus("Study completed.", "success");
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

function mountRiskAdjustedReturnRelativeView(root) {
  return mountRiskAdjustedReturnRelative(root, riskAdjustedReturnSession);
}

const riskAdjustedReturnStudy = {
  id: "risk-adjusted-return",
  title: "Risk-Adjusted Return",
  description:
    "Measure return, risk, and drawdown for the active asset.",
  inputSummary:
    "Active asset from the sidebar, date range, and annual risk-free rate.",
  capabilities: {
    visuals: "ready",
    relative: "ready",
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
    {
      id: "relative",
      label: "Relative",
      summary: "Benchmark comparison against any other dataset or symbol.",
      description:
        "Compare the last completed study run against any other dataset or symbol using aligned overlapping dates only.",
      status: "ready",
      mount: mountRiskAdjustedReturnRelativeView,
    },
  ],
};

export { riskAdjustedReturnStudy };
