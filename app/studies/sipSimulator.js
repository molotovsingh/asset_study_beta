import {
  DEFAULT_MIN_CONTRIBUTIONS,
  DEFAULT_MONTHLY_CONTRIBUTION,
  buildSipStudy,
} from "../lib/sipSimulator.js";
import {
  exportSipSimulatorCsv,
  exportSipSimulatorXls,
} from "../lib/sipSimulatorExport.js";
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
  getCurrentRouteParams,
  readCommonIndexParams,
  readTextParam,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import {
  buildAvailableStudyWindow,
  buildDefaultStudyWindow,
  toInputDate,
} from "./shared/overviewUtils.js";
import { validateIndexDateRange } from "./shared/validation.js";
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
  const { start, end } = validateIndexDateRange(
    selection,
    startValue,
    endValue,
  );
  const monthlyContribution = Number(monthlyContributionValue);

  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) {
    throw new Error("Enter a monthly contribution amount above zero.");
  }

  return { start, end, monthlyContribution };
}

function renderStudyRunResults(resultsRoot, studyRun) {
  resultsRoot.innerHTML = renderSipSimulatorResults(studyRun);
}

function applySipRouteParams() {
  const params = getCurrentRouteParams();
  const applied = readCommonIndexParams(sipSimulatorSession, params);
  const contribution = readTextParam(params, "contribution");
  if (
    contribution &&
    Number.isFinite(Number(contribution)) &&
    sipSimulatorSession.monthlyContributionValue !== contribution
  ) {
    sipSimulatorSession.monthlyContributionValue = contribution;
    applied.changed = true;
  }

  return applied;
}

function replaceSipRouteParams() {
  replaceRouteInputParams(sipSimulatorStudy.id, "overview", {
    ...buildCommonIndexParams(sipSimulatorSession),
    contribution: sipSimulatorSession.monthlyContributionValue,
  });
}

function mountSipSimulatorOverview(root) {
  const routeParamsApplied = applySipRouteParams();
  const routeHasExplicitWindow = routeParamsApplied.start || routeParamsApplied.end;
  if (routeParamsApplied.changed) {
    sipSimulatorSession.lastStudyRun = null;
  }
  if (routeParamsApplied.subject) {
    setActiveSubjectQuery(sipSimulatorSession.indexQuery);
  } else if (adoptActiveSubjectQuery(sipSimulatorSession)) {
    sipSimulatorSession.lastStudyRun = null;
  }

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
    getRuntimeSnapshot,
    getBundledDatasetForSelection,
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
    const subjectChanged = setActiveSubjectQuery(indexQueryInput.value);
    state.indexQuery = indexQueryInput.value;
    state.monthlyContributionValue = contributionInput.value;
    state.startDateValue = startDateInput.value;
    state.endDateValue = endDateInput.value;
    if (subjectChanged) {
      state.lastStudyRun = null;
    }
    replaceSipRouteParams();
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

      const preparedSeries = await prepareIndexStudySeries({
        selection,
        start,
        end,
        warnings,
        loadSelectionData,
        applyLoadedSnapshot,
      });
      const { filteredSeries, methodLabel } = preparedSeries;

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

      preparedSeries.commitLoadedSnapshot();

      state.lastStudyRun = {
        studyTitle: sipSimulatorStudy.title,
        selection: {
          ...selection,
          currency:
            preparedSeries.snapshot.currency || selection.currency || null,
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
      recordIndexStudyRun(sipSimulatorStudy, state);
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
    applyAvailableWindow({ announce: true, force: true });
  }

  function handleFormFieldChange() {
    persistFormState();
  }

  form.addEventListener("submit", handleSubmit);
  contributionInput.addEventListener("input", handleFormFieldChange);
  contributionInput.addEventListener("change", handleFormFieldChange);
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
    setStatus("Loaded the last completed SIP simulator run.", "success");
  } else {
    updateIndexSummary();
    applyAvailableWindow();
  }

  return () => {
    form.removeEventListener("submit", handleSubmit);
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
    "Active asset from the sidebar, date range, and fixed monthly contribution amount.",
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
