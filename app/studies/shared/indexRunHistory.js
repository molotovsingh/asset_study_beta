import {
  createSummaryItem,
  recordLocalStudyRun,
} from "./studyRunHistory.js";

function buildIndexStudySummaryItems(studyId, studyRun) {
  const summary = studyRun?.summary || {};
  const metrics = studyRun?.metrics || {};

  switch (studyId) {
    case "risk-adjusted-return":
      return [
        createSummaryItem({
          key: "cagr",
          label: "CAGR",
          valueNumber: metrics.annualizedReturn,
          valueKind: "percent",
          sortOrder: 0,
        }),
        createSummaryItem({
          key: "volatility",
          label: "Volatility",
          valueNumber: metrics.annualizedVolatility,
          valueKind: "percent",
          sortOrder: 1,
        }),
        createSummaryItem({
          key: "max-drawdown",
          label: "Max Drawdown",
          valueNumber: metrics.maxDrawdown,
          valueKind: "percent",
          sortOrder: 2,
        }),
        createSummaryItem({
          key: "sharpe",
          label: "Sharpe",
          valueNumber: metrics.sharpeRatio,
          valueKind: "number",
          sortOrder: 3,
        }),
      ].filter(Boolean);
    case "seasonality":
      return [
        createSummaryItem({
          key: "years-observed",
          label: "Years Observed",
          valueNumber: summary.yearsObserved,
          valueKind: "integer",
          sortOrder: 0,
        }),
        createSummaryItem({
          key: "months-used",
          label: "Monthly Rows",
          valueNumber: summary.monthsUsed,
          valueKind: "integer",
          sortOrder: 1,
        }),
        createSummaryItem({
          key: "spread",
          label: "Seasonality Spread",
          valueNumber: summary.seasonalitySpread,
          valueKind: "percent",
          sortOrder: 2,
        }),
        createSummaryItem({
          key: "clear-signals",
          label: "Clear Signals",
          valueNumber: summary.clearSignalCount,
          valueKind: "integer",
          sortOrder: 3,
        }),
      ].filter(Boolean);
    case "rolling-returns":
      return [
        createSummaryItem({
          key: "available-horizons",
          label: "Available Horizons",
          valueNumber: summary.availableWindowCount,
          valueKind: "integer",
          sortOrder: 0,
        }),
        createSummaryItem({
          key: "rolling-observations",
          label: "Rolling Windows",
          valueNumber: summary.totalRollingObservations,
          valueKind: "integer",
          sortOrder: 1,
        }),
        createSummaryItem({
          key: "strongest-median-window",
          label: "Strongest Median Window",
          valueText: summary.strongestMedianWindow?.windowLabel || "",
          sortOrder: 2,
        }),
        createSummaryItem({
          key: "strongest-median-cagr",
          label: "Strongest Median CAGR",
          valueNumber: summary.strongestMedianWindow?.medianCagr,
          valueKind: "percent",
          sortOrder: 3,
        }),
      ].filter(Boolean);
    case "sip-simulator":
      return [
        createSummaryItem({
          key: "cohorts",
          label: "Cohorts",
          valueNumber: summary.totalCohorts,
          valueKind: "integer",
          sortOrder: 0,
        }),
        createSummaryItem({
          key: "median-xirr",
          label: "Median XIRR",
          valueNumber: summary.medianXirr,
          valueKind: "percent",
          sortOrder: 1,
        }),
        createSummaryItem({
          key: "positive-rate",
          label: "Positive Rate",
          valueNumber: summary.positiveRate,
          valueKind: "percent",
          sortOrder: 2,
        }),
        createSummaryItem({
          key: "monthly-contribution",
          label: "Monthly Contribution",
          valueNumber: studyRun.monthlyContribution,
          valueKind: "currency",
          sortOrder: 3,
        }),
      ].filter(Boolean);
    case "lumpsum-vs-sip":
      return [
        createSummaryItem({
          key: "cohorts",
          label: "Cohorts",
          valueNumber: summary.totalCohorts,
          valueKind: "integer",
          sortOrder: 0,
        }),
        createSummaryItem({
          key: "lumpsum-win-rate",
          label: "Lumpsum Win Rate",
          valueNumber: summary.lumpsumWinRate,
          valueKind: "percent",
          sortOrder: 1,
        }),
        createSummaryItem({
          key: "sip-win-rate",
          label: "SIP Win Rate",
          valueNumber: summary.sipWinRate,
          valueKind: "percent",
          sortOrder: 2,
        }),
        createSummaryItem({
          key: "median-advantage",
          label: "Median Advantage",
          valueNumber: summary.medianAdvantageRate,
          valueKind: "percent",
          sortOrder: 3,
        }),
      ].filter(Boolean);
    case "drawdown-study":
      return [
        createSummaryItem({
          key: "time-underwater",
          label: "Time Underwater",
          valueNumber: summary.timeUnderwaterRate,
          valueKind: "percent",
          sortOrder: 0,
        }),
        createSummaryItem({
          key: "total-episodes",
          label: "Episodes",
          valueNumber: summary.totalEpisodes,
          valueKind: "integer",
          sortOrder: 1,
        }),
        createSummaryItem({
          key: "latest-depth",
          label: "Latest Depth",
          valueNumber: summary.latestDepth,
          valueKind: "percent",
          sortOrder: 2,
        }),
        createSummaryItem({
          key: "max-depth",
          label: "Worst Episode",
          valueNumber: summary.maxDrawdownEpisode?.maxDepth,
          valueKind: "percent",
          sortOrder: 3,
        }),
      ].filter(Boolean);
    default:
      return [];
  }
}

function buildIndexDataSnapshotRefs(studyRun) {
  const selection = studyRun?.selection || {};
  if (!selection?.path && !selection?.cacheKey) {
    return [];
  }
  return [
    {
      kind: "series-selection",
      label: selection.label || selection.symbol || "",
      symbol: selection.symbol || "",
      path: selection.path || selection.cacheKey || "",
      providerName: selection.providerName || "",
    },
  ];
}

function buildIndexProviderSummary(studyRun) {
  const selection = studyRun?.selection || {};
  if (!selection?.providerName && !selection?.symbol) {
    return {};
  }
  return {
    primaryProviderName: selection.providerName || null,
    symbol: selection.symbol || null,
    targetSeriesType: selection.targetSeriesType || null,
    sourceSeriesType: selection.sourceSeriesType || null,
  };
}

function recordIndexStudyRun(study, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    return false;
  }

  return recordLocalStudyRun({
    study,
    subjectQuery: session.indexQuery,
    selectionLabel: studyRun.selection?.label || session.indexQuery,
    symbol: studyRun.selection?.symbol || "",
    requestedStartDate: studyRun.requestedStartDate,
    requestedEndDate: studyRun.requestedEndDate,
    actualStartDate: studyRun.actualStartDate,
    actualEndDate: studyRun.actualEndDate,
    requestedParams: {
      subject: session.indexQuery,
      start: studyRun.requestedStartDate || "",
      end: studyRun.requestedEndDate || "",
      useDemoData: Boolean(studyRun.useDemoData),
    },
    resolvedParams: {
      symbol: studyRun.selection?.symbol || "",
      start: studyRun.actualStartDate?.toISOString?.()?.slice(0, 10) || "",
      end: studyRun.actualEndDate?.toISOString?.()?.slice(0, 10) || "",
      warnings: Array.isArray(studyRun.warnings) ? studyRun.warnings.length : 0,
    },
    providerSummary: buildIndexProviderSummary(studyRun),
    dataSnapshotRefs: buildIndexDataSnapshotRefs(studyRun),
    summaryItems: buildIndexStudySummaryItems(study.id, studyRun),
    warningCount: Array.isArray(studyRun.warnings) ? studyRun.warnings.length : 0,
    completedAt: studyRun.exportedAt?.toISOString?.() || new Date().toISOString(),
  });
}

export { recordIndexStudyRun };
