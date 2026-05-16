import {
  DEFAULT_CONTRACT_COUNT,
  DEFAULT_MINIMUM_DTE,
  buildMonthlyStraddleStudyRun,
} from "../lib/monthlyStraddle.js";
import {
  exportMonthlyStraddleCsv,
  exportMonthlyStraddleXls,
} from "../lib/monthlyStraddleExport.js";
import { fetchMonthlyStraddleSnapshot } from "../lib/syncedData.js";
import {
  adoptActiveSubjectQuery,
  getActiveSubjectQuery,
  setActiveSubjectQuery,
} from "./shared/activeSubject.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  getCurrentRouteParams,
  readTextParam,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import {
  createSummaryItem,
  recordLocalStudyRun,
} from "./shared/studyRunHistory.js";
import {
  monthlyStraddleTemplate,
  renderMonthlyStraddleResults,
} from "./monthlyStraddleView.js";
import { mountMonthlyStraddleVisuals } from "./monthlyStraddleVisuals.js";

const monthlyStraddleSession = {
  indexQuery: getActiveSubjectQuery(),
  minimumDteValue: String(DEFAULT_MINIMUM_DTE),
  contractCountValue: String(DEFAULT_CONTRACT_COUNT),
  lastStudyRun: null,
  lastRunSignature: "",
};

function buildRunSignature(session) {
  return [session.indexQuery, session.minimumDteValue, session.contractCountValue].join("|");
}

function applyRouteParams() {
  const params = getCurrentRouteParams();
  const subject = readTextParam(params, "subject");
  const minimumDte = readTextParam(params, "dte");
  const contractCount = readTextParam(params, "count");
  let changed = false;

  if (subject && monthlyStraddleSession.indexQuery !== subject) {
    monthlyStraddleSession.indexQuery = subject;
    changed = true;
  }

  if (
    minimumDte &&
    Number.isFinite(Number(minimumDte)) &&
    String(Math.trunc(Number(minimumDte))) === minimumDte &&
    monthlyStraddleSession.minimumDteValue !== minimumDte
  ) {
    monthlyStraddleSession.minimumDteValue = minimumDte;
    changed = true;
  }

  if (
    contractCount &&
    Number.isFinite(Number(contractCount)) &&
    String(Math.trunc(Number(contractCount))) === contractCount &&
    monthlyStraddleSession.contractCountValue !== contractCount
  ) {
    monthlyStraddleSession.contractCountValue = contractCount;
    changed = true;
  }

  if (subject) {
    setActiveSubjectQuery(monthlyStraddleSession.indexQuery);
  } else if (adoptActiveSubjectQuery(monthlyStraddleSession)) {
    changed = true;
  }

  if (changed && monthlyStraddleSession.lastRunSignature !== buildRunSignature(monthlyStraddleSession)) {
    monthlyStraddleSession.lastStudyRun = null;
  }
}

function replaceMonthlyStraddleRouteParams(viewId = "overview") {
  replaceRouteInputParams(monthlyStraddleStudy.id, viewId, {
    subject: monthlyStraddleSession.indexQuery,
    dte: monthlyStraddleSession.minimumDteValue,
    count: monthlyStraddleSession.contractCountValue,
  });
}

function validateInputs(symbol, minimumDteValue, contractCountValue) {
  const minimumDte = Number(minimumDteValue);
  const contractCount = Number(contractCountValue);
  if (!symbol) {
    throw new Error("Set an active asset in the sidebar before running the study.");
  }
  if (!Number.isFinite(minimumDte) || minimumDte < 7 || minimumDte > 365) {
    throw new Error("Minimum DTE must be between 7 and 365 days.");
  }
  if (!Number.isFinite(contractCount) || contractCount < 1 || contractCount > 8) {
    throw new Error("Contract count must be between 1 and 8.");
  }
  return {
    minimumDte: Math.trunc(minimumDte),
    contractCount: Math.trunc(contractCount),
  };
}

function mountMonthlyStraddleOverview(root) {
  applyRouteParams();

  root.innerHTML = monthlyStraddleTemplate({
    activeSymbol: monthlyStraddleSession.indexQuery,
    minimumDteValue: monthlyStraddleSession.minimumDteValue,
    contractCountValue: monthlyStraddleSession.contractCountValue,
  });

  const form = root.querySelector("#monthly-straddle-form");
  const minimumDteInput = root.querySelector("#monthly-straddle-min-dte");
  const contractCountInput = root.querySelector("#monthly-straddle-contract-count");
  const statusEl = root.querySelector("#monthly-straddle-status");
  const resultsRoot = root.querySelector("#monthly-straddle-results-root");

  const setStatus = (message, state = "info") => {
    statusEl.className = `status ${state}`;
    statusEl.textContent = message;
  };

  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-straddle-export]",
    datasetKey: "straddleExport",
    getPayload: () => monthlyStraddleSession.lastStudyRun,
    exporters: {
      csv: exportMonthlyStraddleCsv,
      xls: exportMonthlyStraddleXls,
    },
    setStatus,
    missingPayloadMessage: "Run the study before exporting.",
  });

  function persistFormState() {
    monthlyStraddleSession.indexQuery = getActiveSubjectQuery();
    monthlyStraddleSession.minimumDteValue = minimumDteInput.value.trim();
    monthlyStraddleSession.contractCountValue = contractCountInput.value.trim();
    replaceMonthlyStraddleRouteParams();
  }

  function maybeRenderExistingRun() {
    if (
      monthlyStraddleSession.lastStudyRun &&
      monthlyStraddleSession.lastRunSignature === buildRunSignature(monthlyStraddleSession)
    ) {
      resultsRoot.innerHTML = renderMonthlyStraddleResults(
        monthlyStraddleSession.lastStudyRun,
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();

    try {
      const symbol = monthlyStraddleSession.indexQuery;
      const { minimumDte, contractCount } = validateInputs(
        symbol,
        minimumDteInput.value,
        contractCountInput.value,
      );
      setStatus(`Loading monthly straddles for ${symbol}...`, "info");
      resultsRoot.innerHTML = `
        <div class="empty-state">
          Loading live monthly contracts for ${symbol}...
        </div>
      `;

      const snapshot = await fetchMonthlyStraddleSnapshot({
        symbol,
        minimumDte,
        maxContracts: contractCount,
      });
      const studyRun = buildMonthlyStraddleStudyRun(snapshot, {
        requestedSymbol: symbol,
        minimumDte,
        maxContracts: contractCount,
      });

      monthlyStraddleSession.lastStudyRun = studyRun;
      monthlyStraddleSession.lastRunSignature = buildRunSignature(
        monthlyStraddleSession,
      );
      recordLocalStudyRun({
        study: monthlyStraddleStudy,
        subjectQuery: symbol,
        selectionLabel: symbol,
        symbol: studyRun.symbol,
        actualEndDate: studyRun.asOfDate,
        detailLabel: `${minimumDte}D minimum · ${contractCount} contract${contractCount === 1 ? "" : "s"}`,
        requestedParams: {
          symbol,
          minimumDte,
          contractCount,
        },
        resolvedParams: {
          asOfDate: studyRun.asOfDate?.toISOString?.()?.slice(0, 10) || "",
          provider: studyRun.provider || "",
          loadedContracts: studyRun.contracts.length,
        },
        providerSummary: {
          provider: studyRun.provider,
          providerName: studyRun.providerName,
        },
        summaryItems: [
          createSummaryItem({
            key: "spot-price",
            label: "Spot Price",
            valueNumber: studyRun.spotPrice,
            valueKind: "currency",
            sortOrder: 0,
          }),
          createSummaryItem({
            key: "front-iv",
            label: "Front IV",
            valueNumber: studyRun.focusContract?.straddleImpliedVolatility,
            valueKind: "percent",
            sortOrder: 1,
          }),
          createSummaryItem({
            key: "implied-move",
            label: "Implied Move",
            valueNumber: studyRun.focusContract?.impliedMovePercent,
            valueKind: "percent",
            sortOrder: 2,
          }),
          createSummaryItem({
            key: "curve-shape",
            label: "Curve Shape",
            valueText: studyRun.curveShape,
            sortOrder: 3,
          }),
        ],
        warningCount: Array.isArray(studyRun.warnings) ? studyRun.warnings.length : 0,
        completedAt: studyRun.exportedAt?.toISOString?.() || new Date().toISOString(),
      });
      resultsRoot.innerHTML = renderMonthlyStraddleResults(studyRun);
      setStatus("Monthly straddle snapshot completed.", "success");
    } catch (error) {
      monthlyStraddleSession.lastStudyRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${error.message}
        </div>
      `;
      setStatus(error.message, "error");
    }
  }

  const handleResultsClick = (event) => {
    handleExportClick(event);
  };

  maybeRenderExistingRun();

  form.addEventListener("submit", handleSubmit);
  resultsRoot.addEventListener("click", handleResultsClick);

  return () => {
    form.removeEventListener("submit", handleSubmit);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

const monthlyStraddleStudy = {
  id: "monthly-straddle",
  title: "Monthly Straddle",
  description:
    "Live snapshot of ATM monthly straddles, implied move, annualized IV, and IV/HV context for the active symbol.",
  inputSummary:
    "Active symbol, minimum days to expiry, and number of monthly contracts to load.",
  capabilities: {
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary:
        "Front monthly straddle summary, contract table, and warnings for the active symbol.",
      description:
        "Use the active symbol from the sidebar, then compare the next standard monthly contracts.",
      status: "ready",
      default: true,
      mount: mountMonthlyStraddleOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary:
        "IV curve, implied move bars, and liquidity bars for the loaded monthly contracts.",
      description:
        "Visualize the current monthly term structure once the overview has been run.",
      status: "ready",
      mount(root) {
        return mountMonthlyStraddleVisuals(root, monthlyStraddleSession);
      },
    },
  ],
};

export { monthlyStraddleStudy };
