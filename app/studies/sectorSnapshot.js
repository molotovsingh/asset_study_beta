import {
  DEFAULT_SECTOR_MARKET_ID,
  SECTOR_HORIZON_YEARS,
  buildSectorSeriesRequest,
  getSectorMarketById,
} from "../catalog/sectorSnapshotCatalog.js";
import {
  buildSectorSnapshotStudyRun,
  DEFAULT_FOCUS_HORIZON_YEARS,
  DEFAULT_FOCUS_METRIC_KEY,
  getMetricDefinition,
} from "../lib/sectorSnapshot.js";
import {
  exportSectorSnapshotCsv,
  exportSectorSnapshotXls,
} from "../lib/sectorSnapshotExport.js";
import { fetchIndexSeries } from "../lib/syncedData.js";
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
  renderMarketPresetInfo,
  renderSectorSnapshotResults,
  sectorSnapshotTemplate,
} from "./sectorSnapshotView.js";
import { mountSectorSnapshotVisuals } from "./sectorSnapshotVisuals.js";

const DEFAULT_FETCH_CONCURRENCY = 3;

function getDefaultRiskFreeRateValue(marketId) {
  return (
    getSectorMarketById(marketId)?.defaultRiskFreeRatePercent ||
    getSectorMarketById(DEFAULT_SECTOR_MARKET_ID)?.defaultRiskFreeRatePercent ||
    "0.00"
  );
}

const sectorSnapshotSession = {
  marketId: DEFAULT_SECTOR_MARKET_ID,
  focusHorizonYears: String(DEFAULT_FOCUS_HORIZON_YEARS),
  focusMetricKey: DEFAULT_FOCUS_METRIC_KEY,
  riskFreeRateValue: getDefaultRiskFreeRateValue(DEFAULT_SECTOR_MARKET_ID),
  lastStudyRun: null,
  lastRunSignature: "",
};

function buildRunSignature(session) {
  return [
    session.marketId,
    session.focusHorizonYears,
    session.focusMetricKey,
    session.riskFreeRateValue,
  ].join("|");
}

function readSectorSnapshotParams(session, params = getCurrentRouteParams()) {
  const nextMarketId = readTextParam(params, "market");
  const nextHorizon = readTextParam(params, "h");
  const nextMetric = readTextParam(params, "metric");
  const nextRiskFreeRate = readTextParam(params, "rf");
  let changed = false;

  if (nextMarketId && getSectorMarketById(nextMarketId) && session.marketId !== nextMarketId) {
    session.marketId = nextMarketId;
    changed = true;
  }

  if (
    SECTOR_HORIZON_YEARS.map(String).includes(nextHorizon) &&
    session.focusHorizonYears !== nextHorizon
  ) {
    session.focusHorizonYears = nextHorizon;
    changed = true;
  }

  if (nextMetric && getMetricDefinition(nextMetric).key === nextMetric && session.focusMetricKey !== nextMetric) {
    session.focusMetricKey = nextMetric;
    changed = true;
  }

  if (nextRiskFreeRate && session.riskFreeRateValue !== nextRiskFreeRate) {
    session.riskFreeRateValue = nextRiskFreeRate;
    changed = true;
  }

  if (changed && session.lastRunSignature !== buildRunSignature(session)) {
    session.lastStudyRun = null;
  }
}

function replaceSectorRouteParams(viewId = "overview") {
  replaceRouteInputParams(sectorSnapshotStudy.id, viewId, {
    market: sectorSnapshotSession.marketId,
    h: sectorSnapshotSession.focusHorizonYears,
    metric: sectorSnapshotSession.focusMetricKey,
    rf: sectorSnapshotSession.riskFreeRateValue,
  });
}

function validateRiskFreeRate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
    throw new Error("Enter a valid annual risk-free rate percentage.");
  }

  return numericValue / 100;
}

async function loadMarketSeries(market, setStatus) {
  const jobs = [market.benchmark, ...market.sectors];
  const results = new Array(jobs.length);
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      const entry = jobs[index];
      const { snapshot, series } = await fetchIndexSeries(
        buildSectorSeriesRequest(entry, market),
      );
      results[index] = {
        entry,
        snapshot,
        series,
      };
      completed += 1;
      setStatus(
        `Loaded ${completed} of ${jobs.length} series for ${market.label}.`,
        "info",
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(DEFAULT_FETCH_CONCURRENCY, jobs.length) },
      () => worker(),
    ),
  );

  return {
    benchmarkLoaded: results[0],
    sectorLoaded: results.slice(1),
  };
}

function buildStudyWarnings(studyRun) {
  const warnings = [];
  const preferredProvider =
    studyRun.market.preferredProvider || "yfinance";
  const fallbackProviders = studyRun.providerSummary.filter(
    (entry) => entry.provider !== preferredProvider,
  );
  if (fallbackProviders.length) {
    warnings.push(
      `Some series used fallback providers: ${fallbackProviders
        .map((entry) => `${entry.providerName} (${entry.count})`)
        .join(" · ")}.`,
    );
  }

  studyRun.horizonResults.forEach((result) => {
    if (result.unavailableCount > 0) {
      warnings.push(
        `${result.years}Y horizon is unavailable for ${result.unavailableCount} sector${result.unavailableCount === 1 ? "" : "s"} because trailing coverage is incomplete.`,
      );
    }
  });

  return warnings;
}

function mountSectorSnapshotOverview(root) {
  readSectorSnapshotParams(sectorSnapshotSession);
  const market = getSectorMarketById(sectorSnapshotSession.marketId);
  if (!market) {
    throw new Error("Sector snapshot market preset is unavailable.");
  }

  root.innerHTML = sectorSnapshotTemplate({
    market,
    focusMetricKey: sectorSnapshotSession.focusMetricKey,
    focusHorizonYears: sectorSnapshotSession.focusHorizonYears,
    riskFreeRateValue: sectorSnapshotSession.riskFreeRateValue,
  });

  const form = root.querySelector("#sector-snapshot-form");
  const marketSelect = root.querySelector("#sector-market");
  const focusHorizonSelect = root.querySelector("#sector-focus-horizon");
  const focusMetricSelect = root.querySelector("#sector-focus-metric");
  const riskFreeRateInput = root.querySelector("#sector-risk-free-rate");
  const statusEl = root.querySelector("#sector-snapshot-status");
  const resultsRoot = root.querySelector("#sector-snapshot-results-root");
  const presetContextRoot = root.querySelector("#sector-preset-context-root");

  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-sector-export]",
    datasetKey: "sectorExport",
    getPayload: () => sectorSnapshotSession.lastStudyRun,
    exporters: {
      csv: exportSectorSnapshotCsv,
      xls: exportSectorSnapshotXls,
    },
    setStatus,
    missingPayloadMessage: "Run the study before exporting.",
  });

  function setStatus(message, state = "info") {
    statusEl.className = `status ${state}`;
    statusEl.textContent = message;
  }

  function refreshPresetContext() {
    const currentMarket = getSectorMarketById(sectorSnapshotSession.marketId);
    if (!currentMarket) {
      return;
    }
    presetContextRoot.innerHTML = renderMarketPresetInfo(currentMarket);
  }

  function persistFormState() {
    sectorSnapshotSession.marketId = marketSelect.value;
    sectorSnapshotSession.focusHorizonYears = focusHorizonSelect.value;
    sectorSnapshotSession.focusMetricKey = focusMetricSelect.value;
    sectorSnapshotSession.riskFreeRateValue = riskFreeRateInput.value.trim();
    replaceSectorRouteParams();
    refreshPresetContext();
  }

  function maybeRenderExistingRun() {
    if (
      sectorSnapshotSession.lastStudyRun &&
      sectorSnapshotSession.lastRunSignature === buildRunSignature(sectorSnapshotSession)
    ) {
      resultsRoot.innerHTML = renderSectorSnapshotResults(
        sectorSnapshotSession.lastStudyRun,
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();
    const currentMarket = getSectorMarketById(sectorSnapshotSession.marketId);
    if (!currentMarket) {
      setStatus("Select a valid market preset.", "error");
      return;
    }

    try {
      const riskFreeRate = validateRiskFreeRate(riskFreeRateInput.value);
      sectorSnapshotSession.lastStudyRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          Loading ${currentMarket.label} sector universe...
        </div>
      `;
      setStatus(`Loading ${currentMarket.label} sector universe...`, "info");

      const { benchmarkLoaded, sectorLoaded } = await loadMarketSeries(
        currentMarket,
        setStatus,
      );

      const studyRun = buildSectorSnapshotStudyRun({
        market: currentMarket,
        benchmarkEntry: benchmarkLoaded.entry,
        benchmarkSnapshot: benchmarkLoaded.snapshot,
        benchmarkSeries: benchmarkLoaded.series,
        sectorEntries: sectorLoaded,
        riskFreeRate,
        focusHorizonYears: sectorSnapshotSession.focusHorizonYears,
        focusMetricKey: sectorSnapshotSession.focusMetricKey,
        warnings: [],
      });
      studyRun.warnings = buildStudyWarnings(studyRun);

      sectorSnapshotSession.lastStudyRun = studyRun;
      sectorSnapshotSession.lastRunSignature = buildRunSignature(
        sectorSnapshotSession,
      );
      recordLocalStudyRun({
        study: sectorSnapshotStudy,
        subjectQuery: currentMarket.id,
        selectionLabel: currentMarket.label,
        symbol: currentMarket.benchmark?.symbol || "",
        actualEndDate: studyRun.commonEndDate,
        detailLabel: `${currentMarket.universeLabel} · ${studyRun.focusHorizonYears}Y ${getMetricDefinition(studyRun.focusMetricKey).label}`,
        requestedParams: {
          marketId: currentMarket.id,
          focusHorizonYears: sectorSnapshotSession.focusHorizonYears,
          focusMetricKey: sectorSnapshotSession.focusMetricKey,
          riskFreeRate,
        },
        resolvedParams: {
          commonEndDate: studyRun.commonEndDate?.toISOString?.()?.slice(0, 10) || "",
          providerCount: Array.isArray(studyRun.providerSummary) ? studyRun.providerSummary.length : 0,
        },
        providerSummary: {
          providers: studyRun.providerSummary,
        },
        summaryItems: [
          createSummaryItem({
            key: "focus-horizon",
            label: "Focus Horizon",
            valueText: `${studyRun.focusHorizonYears}Y`,
            sortOrder: 0,
          }),
          createSummaryItem({
            key: "focus-metric",
            label: "Focus Metric",
            valueText: getMetricDefinition(studyRun.focusMetricKey).label,
            sortOrder: 1,
          }),
          createSummaryItem({
            key: "sector-count",
            label: "Sectors",
            valueNumber: Array.isArray(studyRun.focusRows) ? studyRun.focusRows.length : 0,
            valueKind: "integer",
            sortOrder: 2,
          }),
          createSummaryItem({
            key: "focus-leader",
            label: "Focus Leader",
            valueText: studyRun.focusRows?.[0]?.label || "",
            sortOrder: 3,
          }),
        ],
        warnings: studyRun.warnings,
        warningCount: Array.isArray(studyRun.warnings) ? studyRun.warnings.length : 0,
        completedAt: studyRun.exportedAt?.toISOString?.() || new Date().toISOString(),
      });
      resultsRoot.innerHTML = renderSectorSnapshotResults(studyRun);
      setStatus("Sector snapshot completed.", "success");
    } catch (error) {
      sectorSnapshotSession.lastStudyRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${error.message}
        </div>
      `;
      setStatus(error.message, "error");
    }
  }

  function handleResultsClick(event) {
    handleExportClick(event);
  }

  function handleMarketChange() {
    const nextMarketId = marketSelect.value;
    const nextMarket = getSectorMarketById(nextMarketId);
    if (!nextMarket) {
      return;
    }

    riskFreeRateInput.value = nextMarket.defaultRiskFreeRatePercent;
    persistFormState();
    setStatus("Preset updated. Run the snapshot to refresh results.", "info");
  }

  function handleFieldChange() {
    persistFormState();
    setStatus("Inputs updated. Run the snapshot to refresh results.", "info");
  }

  maybeRenderExistingRun();

  form.addEventListener("submit", handleSubmit);
  marketSelect.addEventListener("change", handleMarketChange);
  focusHorizonSelect.addEventListener("change", handleFieldChange);
  focusMetricSelect.addEventListener("change", handleFieldChange);
  riskFreeRateInput.addEventListener("change", handleFieldChange);
  resultsRoot.addEventListener("click", handleResultsClick);

  return () => {
    form.removeEventListener("submit", handleSubmit);
    marketSelect.removeEventListener("change", handleMarketChange);
    focusHorizonSelect.removeEventListener("change", handleFieldChange);
    focusMetricSelect.removeEventListener("change", handleFieldChange);
    riskFreeRateInput.removeEventListener("change", handleFieldChange);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

const sectorSnapshotStudy = {
  id: "sector-snapshot",
  title: "Sector Snapshot",
  description:
    "Cross-sectional sector performance by market preset with same-end-date benchmark-relative comparisons across 1Y, 5Y, 10Y, and 20Y windows.",
  inputSummary:
    "Market preset, focus horizon, focus metric, and annual risk-free rate.",
  capabilities: {
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary:
        "Preset sector universe, benchmark-relative heatmaps, and a sortable focus-horizon table.",
      description:
        "Run a market preset and compare sector leaders, laggards, and relative spreads versus the broad benchmark.",
      status: "ready",
      default: true,
      mount: mountSectorSnapshotOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary:
        "Heatmaps, leadership matrix, and risk/return scatter for the last completed snapshot.",
      description:
        "Inspect the focus metric across horizons and compare sector return/volatility positioning.",
      status: "ready",
      mount(root) {
        return mountSectorSnapshotVisuals(root, sectorSnapshotSession);
      },
    },
  ],
};

export { sectorSnapshotStudy };
