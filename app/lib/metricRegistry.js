const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MIN_ANNUALIZED_CALENDAR_DAYS = 365;
const MIN_DAILY_RETURN_OBSERVATIONS = 200;
const MIN_CREDIBLE_PERCENTILE_HISTORY = 20;
const DRAWDOWN_MATERIALITY_THRESHOLD = 0.001;
const METRIC_REGISTRY_VERSION = "metric-registry-v1";

const METRIC_PRESENTATION = Object.freeze({
  HEADLINE: "headline",
  DIAGNOSTIC: "diagnostic",
  SUPPRESSED: "suppressed",
});

const METRIC_ISSUE_SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
});

const METRIC_ISSUE_CODES = Object.freeze({
  METRIC_ID_REQUIRED: "metric.id_required",
  METRIC_UNKNOWN: "metric.unknown",
  DOMAIN_MISMATCH: "metric.domain_mismatch",
  STATUS_INVALID: "metric.status_invalid",
  STATUS_MISMATCH: "metric.status_mismatch",
  HEADLINE_UNSAFE: "metric.headline_unsafe",
  HEADLINE_NEEDS_CONTEXT: "metric.headline_needs_context",
  EXPORT_UNSAFE: "metric.export_unsafe",
  LABEL_MISMATCH: "metric.label_mismatch",
});

const METRIC_IDS = Object.freeze({
  TOTAL_RETURN: "risk.total_return",
  ANNUALIZED_RETURN: "risk.annualized_return",
  CALMAR_RATIO: "risk.calmar_ratio",
  RETURN_DRAWDOWN_RATIO: "risk.return_drawdown_ratio",
  VOLATILITY: "risk.volatility",
  SHARPE_RATIO: "risk.sharpe_ratio",
  SORTINO_RATIO: "risk.sortino_ratio",
  RELATIVE_WEALTH: "relative.relative_wealth",
  ACTIVE_RETURN: "relative.active_return",
  ANNUALIZED_SPREAD: "relative.annualized_spread",
  HISTORICAL_PERCENTILE: "options.historical_percentile",
  SEASONALITY_SAMPLE_DEPTH: "seasonality.sample_depth",
  SEASONALITY_YEARS_OBSERVED: "seasonality.years_observed",
  DRAWDOWN_MATERIAL_EPISODES: "drawdown.material_episodes",
  SIP_COHORT_XIRR: "sip.cohort_xirr",
  LUMPSUM_TERMINAL_WEALTH: "lumpsum_vs_sip.terminal_wealth",
});

const METRIC_ROLE_DEFINITIONS = Object.freeze({
  [METRIC_PRESENTATION.HEADLINE]:
    "Primary user-facing truth for the study context. Safe to summarize first.",
  [METRIC_PRESENTATION.DIAGNOSTIC]:
    "Useful supporting evidence. Show sample size, caveat, or calculation context.",
  [METRIC_PRESENTATION.SUPPRESSED]:
    "Do not display or export as a metric value until the required evidence threshold is met.",
});

const METRIC_REGISTRY_RULES = Object.freeze([
  {
    id: METRIC_IDS.TOTAL_RETURN,
    label: "Total Return",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Always safe as the primary period-return truth.",
    diagnosticWhen: "Can move to diagnostic when a full annualized return clears headline thresholds.",
    suppressedWhen: "Never suppressed when the period return is computable.",
    exportBehavior: "Exportable with the same label used in the study view.",
  },
  {
    id: METRIC_IDS.ANNUALIZED_RETURN,
    label: "CAGR / Annualized Pace",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Calendar window is at least 365 days and has at least 200 return observations.",
    diagnosticWhen: "Window or return sample is thin; label as Annualized Pace instead of CAGR.",
    suppressedWhen: "Never suppressed when computable, but must not headline below thresholds.",
    exportBehavior: "Export as CAGR only when headline-eligible; otherwise export as Annualized Pace.",
  },
  {
    id: METRIC_IDS.CALMAR_RATIO,
    label: "Calmar Ratio",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Do not headline by default; it depends on annualized return.",
    diagnosticWhen: "Annualized return clears headline thresholds.",
    suppressedWhen: "Use Return / Max DD instead when annualized return is too fragile.",
    exportBehavior: "Export as Calmar Ratio only when annualized return is headline-eligible.",
  },
  {
    id: METRIC_IDS.RETURN_DRAWDOWN_RATIO,
    label: "Return / Max DD",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Use on short or thin windows instead of Calmar.",
    diagnosticWhen: "Usually replaced by Calmar once annualized return clears thresholds.",
    suppressedWhen: "Suppressed when total return or max drawdown is unavailable.",
    exportBehavior: "Export only when Calmar is not appropriate.",
  },
  {
    id: METRIC_IDS.VOLATILITY,
    label: "Volatility",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Do not headline by default; it is distribution context, not return outcome.",
    diagnosticWhen: "Always show with return-observation count when computable.",
    suppressedWhen: "Suppressed when return observations are unavailable.",
    exportBehavior: "Export with sample-count note.",
  },
  {
    id: METRIC_IDS.SHARPE_RATIO,
    label: "Sharpe Ratio",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Do not headline by default because annualized ratios imply precision.",
    diagnosticWhen: "Show with return-observation count and risk-free-rate context.",
    suppressedWhen: "Suppressed when volatility or excess return cannot be computed.",
    exportBehavior: "Export with sample-count note.",
  },
  {
    id: METRIC_IDS.SORTINO_RATIO,
    label: "Sortino Ratio",
    domains: ["risk-adjusted-return"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Do not headline by default because annualized downside ratios imply precision.",
    diagnosticWhen: "Show with return-observation count and downside-deviation context.",
    suppressedWhen: "Suppressed when downside deviation or excess return cannot be computed.",
    exportBehavior: "Export with sample-count note.",
  },
  {
    id: METRIC_IDS.RELATIVE_WEALTH,
    label: "Relative Wealth",
    domains: ["relative-performance"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Always safe as terminal wealth difference across the overlap.",
    diagnosticWhen: "Rarely diagnostic; it is the primary relative-performance truth.",
    suppressedWhen: "Suppressed only when aligned overlap cannot be computed.",
    exportBehavior: "Always exportable with overlap context.",
  },
  {
    id: METRIC_IDS.ACTIVE_RETURN,
    label: "Active Return",
    domains: ["relative-performance"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Safe as asset total return minus benchmark total return across the overlap.",
    diagnosticWhen: "Can support relative wealth when a view has limited headline space.",
    suppressedWhen: "Suppressed only when aligned overlap cannot be computed.",
    exportBehavior: "Always exportable with overlap context.",
  },
  {
    id: METRIC_IDS.ANNUALIZED_SPREAD,
    label: "CAGR Spread / Annualized Pace Spread",
    domains: ["relative-performance"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Overlap is at least 365 days and has at least 200 aligned return observations.",
    diagnosticWhen: "Overlap is short or thin; label as Annualized Pace Spread.",
    suppressedWhen: "Suppressed only when aligned annualized returns cannot be computed.",
    exportBehavior: "Export with the label selected by the annualization policy.",
  },
  {
    id: METRIC_IDS.HISTORICAL_PERCENTILE,
    label: "Historical Percentile",
    domains: ["monthly-straddle", "options-screener"],
    defaultStatus: METRIC_PRESENTATION.SUPPRESSED,
    headlineWhen: "Do not headline by default; percentiles are context metrics.",
    diagnosticWhen: "At least 20 comparable history observations exist.",
    suppressedWhen: "Fewer than 20 comparable history observations exist.",
    exportBehavior: "Export blank values while suppressed; export percentile values only after depth clears.",
  },
  {
    id: METRIC_IDS.SEASONALITY_SAMPLE_DEPTH,
    label: "Sample Depth",
    domains: ["seasonality"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Use monthly row count and bucket depth as the primary confidence read.",
    diagnosticWhen: "Never demote below years observed for thin samples.",
    suppressedWhen: "Suppressed only when no monthly rows exist.",
    exportBehavior: "Export monthly rows and bucket-depth fields.",
  },
  {
    id: METRIC_IDS.SEASONALITY_YEARS_OBSERVED,
    label: "Years Observed",
    domains: ["seasonality"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Do not headline by default because partial years can overstate sample depth.",
    diagnosticWhen: "Use as context beside bucket observations.",
    suppressedWhen: "Suppressed only when unavailable.",
    exportBehavior: "Exportable as context, not as the primary confidence headline.",
  },
  {
    id: METRIC_IDS.DRAWDOWN_MATERIAL_EPISODES,
    label: "Material Drawdowns",
    domains: ["drawdown-study"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Episode count uses the materiality threshold to avoid microscopic noise.",
    diagnosticWhen: "Raw underwater path remains diagnostic context.",
    suppressedWhen: "Suppressed only when the series cannot form drawdown episodes.",
    exportBehavior: "Export threshold and material episode counts together.",
  },
  {
    id: METRIC_IDS.SIP_COHORT_XIRR,
    label: "Cohort XIRR",
    domains: ["sip-simulator"],
    defaultStatus: METRIC_PRESENTATION.DIAGNOSTIC,
    headlineWhen: "Do not headline alone when cohorts have different contribution counts.",
    diagnosticWhen: "Use with terminal value and visible contribution count.",
    suppressedWhen: "Suppressed only when cash flows cannot form XIRR.",
    exportBehavior: "Export with same-terminal cohort comparison note.",
  },
  {
    id: METRIC_IDS.LUMPSUM_TERMINAL_WEALTH,
    label: "Terminal Wealth",
    domains: ["lumpsum-vs-sip"],
    defaultStatus: METRIC_PRESENTATION.HEADLINE,
    headlineWhen: "Always the win criterion for lumpsum versus SIP cohorts.",
    diagnosticWhen: "CAGR and XIRR remain diagnostic because capital timing differs.",
    suppressedWhen: "Suppressed only when cohort terminal values cannot be computed.",
    exportBehavior: "Export win criterion and return-rate caveat together.",
  },
]);

function toDate(value) {
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calendarDaysBetween(startDate, endDate) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / MS_PER_DAY) + 1);
}

function cleanNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function cloneRegistryValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getMetricRegistryManifest() {
  return {
    version: METRIC_REGISTRY_VERSION,
    purpose:
      "Cross-study metric governance for display, export, and assistant-generated study behavior.",
    statuses: cloneRegistryValue(METRIC_ROLE_DEFINITIONS),
    thresholds: {
      minimumAnnualizedCalendarDays: MIN_ANNUALIZED_CALENDAR_DAYS,
      minimumDailyReturnObservations: MIN_DAILY_RETURN_OBSERVATIONS,
      minimumCrediblePercentileHistory: MIN_CREDIBLE_PERCENTILE_HISTORY,
      drawdownMaterialityThreshold: DRAWDOWN_MATERIALITY_THRESHOLD,
    },
    issueSeverities: Object.values(METRIC_ISSUE_SEVERITY),
    issueCodes: Object.values(METRIC_ISSUE_CODES).sort(),
    rules: cloneRegistryValue(METRIC_REGISTRY_RULES),
  };
}

function listMetricRegistryRules({ domain, status } = {}) {
  return getMetricRegistryManifest().rules.filter((rule) => {
    const domainMatches = !domain || rule.domains.includes(domain);
    const statusMatches = !status || rule.defaultStatus === status;
    return domainMatches && statusMatches;
  });
}

function getMetricRegistryRule(metricId) {
  return getMetricRegistryManifest().rules.find((rule) => rule.id === metricId) || null;
}

function isKnownPresentationStatus(status) {
  return Object.values(METRIC_PRESENTATION).includes(status);
}

function addMetricIssue(issues, { code, severity, message, field = "", metadata = {} }) {
  issues.push({
    code,
    severity,
    message,
    field,
    metadata,
  });
}

function getMetricIssueMessages(issues, severity) {
  return issues
    .filter((issue) => issue.severity === severity)
    .map((issue) => issue.message);
}

function validateMetricDecisionProposal({
  metricId,
  domain = null,
  proposedStatus,
  proposedLabel = null,
  proposedExportable = null,
  evaluatedDecision = null,
} = {}) {
  const issues = [];
  const rule = getMetricRegistryRule(metricId);

  if (!metricId) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.METRIC_ID_REQUIRED,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: "metricId is required",
      field: "metricId",
    });
  }
  if (!rule && metricId) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.METRIC_UNKNOWN,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: `Unknown metricId: ${metricId}`,
      field: "metricId",
    });
  }
  if (rule && domain && !rule.domains.includes(domain)) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.DOMAIN_MISMATCH,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: `Metric ${metricId} is not registered for domain ${domain}`,
      field: "domain",
      metadata: { metricId, domain },
    });
  }
  if (!isKnownPresentationStatus(proposedStatus)) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.STATUS_INVALID,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: `Invalid proposedStatus: ${proposedStatus}`,
      field: "proposedStatus",
    });
  }

  const expectedStatus = evaluatedDecision?.status ?? rule?.defaultStatus ?? null;
  const expectedLabel = evaluatedDecision?.label ?? rule?.label ?? null;
  const expectedExportable = evaluatedDecision
    ? Boolean(evaluatedDecision.exportable)
    : rule?.defaultStatus !== METRIC_PRESENTATION.SUPPRESSED;

  if (expectedStatus && isKnownPresentationStatus(proposedStatus) && proposedStatus !== expectedStatus) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.STATUS_MISMATCH,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: `Metric ${metricId} proposed ${proposedStatus}, expected ${expectedStatus}`,
      field: "proposedStatus",
      metadata: { metricId, proposedStatus, expectedStatus },
    });
  }
  if (
    proposedStatus === METRIC_PRESENTATION.HEADLINE &&
    evaluatedDecision &&
    evaluatedDecision.canHeadline === false
  ) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.HEADLINE_UNSAFE,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: `Metric ${metricId} is not headline-safe in this evaluated context`,
      field: "proposedStatus",
      metadata: { metricId },
    });
  }
  if (
    proposedStatus === METRIC_PRESENTATION.HEADLINE &&
    !evaluatedDecision &&
    rule &&
    rule.defaultStatus !== METRIC_PRESENTATION.HEADLINE
  ) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.HEADLINE_NEEDS_CONTEXT,
      severity: METRIC_ISSUE_SEVERITY.WARNING,
      message: `Metric ${metricId} needs an evaluated decision before it can be promoted to headline`,
      field: "evaluatedDecision",
      metadata: { metricId },
    });
  }
  if (proposedExportable === true && expectedExportable === false) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.EXPORT_UNSAFE,
      severity: METRIC_ISSUE_SEVERITY.ERROR,
      message: `Metric ${metricId} is not exportable in this evaluated context`,
      field: "proposedExportable",
      metadata: { metricId },
    });
  }
  if (proposedLabel && expectedLabel && proposedLabel !== expectedLabel) {
    addMetricIssue(issues, {
      code: METRIC_ISSUE_CODES.LABEL_MISMATCH,
      severity: METRIC_ISSUE_SEVERITY.WARNING,
      message: `Metric ${metricId} label "${proposedLabel}" differs from registry label "${expectedLabel}"`,
      field: "proposedLabel",
      metadata: { metricId, proposedLabel, expectedLabel },
    });
  }

  const errors = getMetricIssueMessages(issues, METRIC_ISSUE_SEVERITY.ERROR);
  const warnings = getMetricIssueMessages(issues, METRIC_ISSUE_SEVERITY.WARNING);

  return {
    ok: errors.length === 0,
    metricId,
    domain,
    issues,
    errors,
    warnings,
    expectedStatus,
    expectedLabel,
    expectedExportable,
    rule: rule ? cloneRegistryValue(rule) : null,
  };
}

function validateMetricDecisionProposals({ domain = null, proposals = [] } = {}) {
  const results = proposals.map((proposal) =>
    validateMetricDecisionProposal({
      domain,
      ...proposal,
    }),
  );
  return {
    ok: results.every((result) => result.ok),
    results,
    issues: results.flatMap((result) => result.issues),
    errors: results.flatMap((result) => result.errors),
    warnings: results.flatMap((result) => result.warnings),
  };
}

function makeMetricDecision({
  id,
  label,
  exportLabel = label,
  status,
  key = null,
  value = undefined,
  styleId = null,
  note = "",
  detail = "",
  reason = "",
  exportable = true,
  metadata = {},
}) {
  return {
    id,
    label,
    exportLabel,
    status,
    key,
    value,
    styleId,
    note,
    detail,
    reason,
    exportable: exportable && status !== METRIC_PRESENTATION.SUPPRESSED,
    canHeadline: status === METRIC_PRESENTATION.HEADLINE,
    metadata,
  };
}

function buildAnnualizedMetricPolicy({
  startDate,
  endDate,
  returnObservations,
  minimumCalendarDays = MIN_ANNUALIZED_CALENDAR_DAYS,
  minimumReturnObservations = MIN_DAILY_RETURN_OBSERVATIONS,
} = {}) {
  const calendarDays = calendarDaysBetween(startDate, endDate);
  const observationCount = cleanNumber(returnObservations);
  const hasCalendarDepth = calendarDays >= minimumCalendarDays;
  const hasObservationDepth = observationCount >= minimumReturnObservations;

  return {
    canHeadlineAnnualized: hasCalendarDepth && hasObservationDepth,
    calendarDays,
    returnObservations: observationCount,
    minimumCalendarDays,
    minimumReturnObservations,
    reason: !hasCalendarDepth
      ? "short-window"
      : !hasObservationDepth
        ? "thin-sample"
        : "headline-ok",
  };
}

function computePeriodReturnDrawdownRatio(metrics) {
  const totalReturn = Number(metrics?.totalReturn);
  const maxDrawdown = Number(metrics?.maxDrawdown);
  if (!Number.isFinite(totalReturn) || !Number.isFinite(maxDrawdown) || maxDrawdown === 0) {
    return null;
  }
  return totalReturn / Math.abs(maxDrawdown);
}

function buildRiskMetricPresentation({ metrics = {}, startDate, endDate } = {}) {
  const policy = buildAnnualizedMetricPolicy({
    startDate,
    endDate,
    returnObservations: metrics.periodicObservations,
  });
  const returnObservationNote = `${policy.returnObservations} return observations`;
  const annualizedStatus = policy.canHeadlineAnnualized
    ? METRIC_PRESENTATION.HEADLINE
    : METRIC_PRESENTATION.DIAGNOSTIC;

  const primaryReturn = policy.canHeadlineAnnualized
    ? makeMetricDecision({
        id: METRIC_IDS.ANNUALIZED_RETURN,
        label: "CAGR",
        key: "annualizedReturn",
        value: metrics.annualizedReturn,
        styleId: "percent",
        status: METRIC_PRESENTATION.HEADLINE,
        note: "Annualized compound return; window and return count clear the headline threshold",
        detail: "Annualized compound return",
        reason: policy.reason,
      })
    : makeMetricDecision({
        id: METRIC_IDS.TOTAL_RETURN,
        label: "Total Return",
        key: "totalReturn",
        value: metrics.totalReturn,
        styleId: "percent",
        status: METRIC_PRESENTATION.HEADLINE,
        note: "Total change across the filtered window; primary return read for short or thin windows",
        detail: "Primary return for short or thin windows",
        reason: policy.reason,
      });

  const secondaryReturn = policy.canHeadlineAnnualized
    ? makeMetricDecision({
        id: METRIC_IDS.TOTAL_RETURN,
        label: "Total Return",
        key: "totalReturn",
        value: metrics.totalReturn,
        styleId: "percent",
        status: METRIC_PRESENTATION.DIAGNOSTIC,
        note: "Total change across the filtered window",
        reason: policy.reason,
      })
    : makeMetricDecision({
        id: METRIC_IDS.ANNUALIZED_RETURN,
        label: "Annualized Pace",
        key: "annualizedReturn",
        value: metrics.annualizedReturn,
        styleId: "percent",
        status: annualizedStatus,
        note: "Annualized compound pace shown as a diagnostic, not the primary return read",
        detail: `Secondary read from ${returnObservationNote}`,
        reason: policy.reason,
      });

  const drawdownEfficiency = policy.canHeadlineAnnualized
    ? makeMetricDecision({
        id: METRIC_IDS.CALMAR_RATIO,
        label: "Calmar Ratio",
        key: "calmarRatio",
        value: metrics.calmarRatio,
        styleId: "number2",
        status: METRIC_PRESENTATION.DIAGNOSTIC,
        note: "CAGR divided by max drawdown",
        detail: "CAGR divided by max drawdown",
        reason: policy.reason,
      })
    : makeMetricDecision({
        id: METRIC_IDS.RETURN_DRAWDOWN_RATIO,
        label: "Return / Max DD",
        key: "returnDrawdownRatio",
        value: computePeriodReturnDrawdownRatio(metrics),
        styleId: "number2",
        status: METRIC_PRESENTATION.HEADLINE,
        note: "Total return divided by absolute max drawdown; used when CAGR is too fragile for headline treatment",
        detail: "Period return divided by max drawdown",
        reason: policy.reason,
      });

  const diagnostics = [
    makeMetricDecision({
      id: METRIC_IDS.VOLATILITY,
      label: "Volatility",
      key: "annualizedVolatility",
      value: metrics.annualizedVolatility,
      styleId: "percent",
      status: METRIC_PRESENTATION.DIAGNOSTIC,
      note: `Annualized volatility of log returns from ${returnObservationNote}`,
    }),
    makeMetricDecision({
      id: METRIC_IDS.SHARPE_RATIO,
      label: "Sharpe Ratio",
      key: "sharpeRatio",
      value: metrics.sharpeRatio,
      styleId: "number2",
      status: METRIC_PRESENTATION.DIAGNOSTIC,
      note: `Annualized excess log return divided by volatility; ${returnObservationNote}`,
    }),
    makeMetricDecision({
      id: METRIC_IDS.SORTINO_RATIO,
      label: "Sortino Ratio",
      key: "sortinoRatio",
      value: metrics.sortinoRatio,
      styleId: "number2",
      status: METRIC_PRESENTATION.DIAGNOSTIC,
      note: `Annualized excess log return divided by downside deviation; ${returnObservationNote}`,
    }),
  ];

  return {
    policy,
    primaryReturn,
    secondaryReturn,
    drawdownEfficiency,
    diagnostics,
  };
}

function buildRelativeMetricPresentation({ relativeMetrics = {} } = {}) {
  const policy = buildAnnualizedMetricPolicy({
    startDate: relativeMetrics.overlapStartDate,
    endDate: relativeMetrics.overlapEndDate,
    returnObservations: relativeMetrics.overlapReturnObservations,
  });
  const observationCount = cleanNumber(relativeMetrics.overlapReturnObservations);
  const annualizedSpread = makeMetricDecision({
    id: METRIC_IDS.ANNUALIZED_SPREAD,
    label: policy.canHeadlineAnnualized ? "CAGR Spread" : "Annualized Pace Spread",
    key: "cagrSpread",
    value: relativeMetrics.cagrSpread,
    styleId: "percent",
    status: policy.canHeadlineAnnualized
      ? METRIC_PRESENTATION.HEADLINE
      : METRIC_PRESENTATION.DIAGNOSTIC,
    note: policy.canHeadlineAnnualized
      ? "Full-year overlap clears the annualized headline threshold"
      : "Diagnostic annualized pace spread; primary read should be relative wealth and active return",
    detail: policy.canHeadlineAnnualized
      ? "Full-year overlap; annualized comparison is headline-eligible"
      : `Secondary read from ${observationCount} aligned returns`,
    reason: policy.reason,
  });

  return {
    policy,
    relativeWealth: makeMetricDecision({
      id: METRIC_IDS.RELATIVE_WEALTH,
      label: "Relative Wealth",
      key: "relativeWealth",
      value: relativeMetrics.relativeWealth,
      styleId: "percent",
      status: METRIC_PRESENTATION.HEADLINE,
      note: "Terminal wealth difference across the overlap",
      detail: "Ending relative wealth from the same start base",
    }),
    activeReturn: makeMetricDecision({
      id: METRIC_IDS.ACTIVE_RETURN,
      label: "Active Return",
      key: "activeReturn",
      value:
        relativeMetrics.assetMetrics?.totalReturn -
        relativeMetrics.benchmarkMetrics?.totalReturn,
      styleId: "percent",
      status: METRIC_PRESENTATION.HEADLINE,
      note: "Asset total return minus benchmark total return across the overlap",
      detail: "Asset period return minus benchmark period return",
    }),
    annualizedSpread,
  };
}

function buildHistoricalPercentileMetric({
  label,
  value,
  observations,
  minimumObservations = MIN_CREDIBLE_PERCENTILE_HISTORY,
  metricId = METRIC_IDS.HISTORICAL_PERCENTILE,
} = {}) {
  const observationCount = cleanNumber(observations);
  const hasDepth = observationCount >= minimumObservations;
  return makeMetricDecision({
    id: metricId,
    label,
    key: null,
    value: hasDepth ? value : null,
    styleId: "percent",
    status: hasDepth ? METRIC_PRESENTATION.DIAGNOSTIC : METRIC_PRESENTATION.SUPPRESSED,
    note: hasDepth
      ? `Percentile based on ${observationCount} observations`
      : `Suppressed until ${minimumObservations} history observations exist`,
    detail: hasDepth
      ? `${observationCount} history observations`
      : `${observationCount}/${minimumObservations} history observations`,
    reason: hasDepth ? "history-ok" : "thin-history",
    metadata: {
      observations: observationCount,
      minimumObservations,
    },
  });
}

function buildSeasonalityMetricPresentation({ summary = {} } = {}) {
  const monthRows = cleanNumber(summary.monthsUsed);
  const minBucketObservations = cleanNumber(summary.minBucketObservations);
  const maxBucketObservations = cleanNumber(summary.maxBucketObservations);

  return {
    sampleDepth: makeMetricDecision({
      id: METRIC_IDS.SEASONALITY_SAMPLE_DEPTH,
      label: "Sample Depth",
      value: monthRows,
      styleId: "integer",
      status: METRIC_PRESENTATION.HEADLINE,
      note: "Monthly rows and per-month bucket depth are safer than a calendar-year headline",
      detail: `${minBucketObservations}-${maxBucketObservations} samples per month bucket`,
    }),
    yearsObserved: makeMetricDecision({
      id: METRIC_IDS.SEASONALITY_YEARS_OBSERVED,
      label: "Years Observed",
      value: cleanNumber(summary.yearsObserved),
      styleId: "integer",
      status: METRIC_PRESENTATION.DIAGNOSTIC,
      note: "Calendar-year count is context only because partial years can overstate bucket depth",
    }),
  };
}

function buildDrawdownMetricPresentation({ summary = {} } = {}) {
  const threshold =
    Number.isFinite(Number(summary.materialityThreshold))
      ? Number(summary.materialityThreshold)
      : DRAWDOWN_MATERIALITY_THRESHOLD;
  return {
    materialEpisodes: makeMetricDecision({
      id: METRIC_IDS.DRAWDOWN_MATERIAL_EPISODES,
      label: "Material Drawdowns",
      value: summary.episodeCount,
      styleId: "integer",
      status: METRIC_PRESENTATION.HEADLINE,
      note: "Episode count excludes microscopic drawdowns below the materiality threshold",
      detail: `Threshold ${(threshold * 100).toFixed(2)}%`,
      metadata: { materialityThreshold: threshold },
    }),
  };
}

function buildSipMetricPresentation() {
  return {
    cohortXirr: makeMetricDecision({
      id: METRIC_IDS.SIP_COHORT_XIRR,
      label: "Cohort XIRR",
      status: METRIC_PRESENTATION.DIAGNOSTIC,
      note: "Same-terminal cohorts can have different contribution counts; compare terminal value with cohort length visible",
      detail: "same-terminal cohort comparison",
    }),
  };
}

function buildLumpsumVsSipMetricPresentation() {
  return {
    terminalWealth: makeMetricDecision({
      id: METRIC_IDS.LUMPSUM_TERMINAL_WEALTH,
      label: "Terminal Wealth",
      exportLabel: "Terminal wealth",
      status: METRIC_PRESENTATION.HEADLINE,
      note: "Winner is based on terminal wealth; CAGR and XIRR are not apples-to-apples because capital timing differs",
      detail: "terminal wealth is the win criterion",
    }),
  };
}

export {
  DRAWDOWN_MATERIALITY_THRESHOLD,
  METRIC_IDS,
  METRIC_ISSUE_CODES,
  METRIC_ISSUE_SEVERITY,
  METRIC_PRESENTATION,
  METRIC_REGISTRY_VERSION,
  MIN_ANNUALIZED_CALENDAR_DAYS,
  MIN_CREDIBLE_PERCENTILE_HISTORY,
  MIN_DAILY_RETURN_OBSERVATIONS,
  buildAnnualizedMetricPolicy,
  buildDrawdownMetricPresentation,
  buildHistoricalPercentileMetric,
  buildLumpsumVsSipMetricPresentation,
  buildRelativeMetricPresentation,
  buildRiskMetricPresentation,
  buildSeasonalityMetricPresentation,
  buildSipMetricPresentation,
  calendarDaysBetween,
  computePeriodReturnDrawdownRatio,
  getMetricRegistryManifest,
  getMetricRegistryRule,
  listMetricRegistryRules,
  validateMetricDecisionProposal,
  validateMetricDecisionProposals,
};
