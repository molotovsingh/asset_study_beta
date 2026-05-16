import { fileURLToPath } from "node:url";

import { checkManifestSync } from "./export_metric_registry_manifest.mjs";
import {
  DRAWDOWN_MATERIALITY_THRESHOLD,
  METRIC_IDS,
  METRIC_ISSUE_CODES,
  METRIC_PRESENTATION,
  METRIC_REGISTRY_VERSION,
  MIN_CREDIBLE_PERCENTILE_HISTORY,
  buildDrawdownMetricPresentation,
  buildHistoricalPercentileMetric,
  buildLumpsumVsSipMetricPresentation,
  buildRelativeMetricPresentation,
  buildRiskMetricPresentation,
  buildSipMetricPresentation,
  getMetricRegistryManifest,
  getMetricRegistryRule,
  listMetricRegistryRules,
  validateMetricDecisionProposal,
  validateMetricDecisionProposals,
} from "../app/lib/metricRegistry.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function runMetricRegistryChecks() {
  const shortRiskPresentation = buildRiskMetricPresentation({
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    metrics: {
      totalReturn: 0.08,
      annualizedReturn: 0.38,
      maxDrawdown: -0.04,
      periodicObservations: 61,
    },
  });

  assert(
    shortRiskPresentation.primaryReturn.label === "Total Return",
    "short-window risk headline should use total return",
  );
  assert(
    shortRiskPresentation.secondaryReturn.status === METRIC_PRESENTATION.DIAGNOSTIC,
    "short-window annualized return should be diagnostic",
  );
  assert(
    shortRiskPresentation.drawdownEfficiency.label === "Return / Max DD",
    "short-window drawdown efficiency should avoid Calmar",
  );

  const fullRiskPresentation = buildRiskMetricPresentation({
    startDate: "2025-01-01",
    endDate: "2026-01-05",
    metrics: {
      totalReturn: 0.14,
      annualizedReturn: 0.13,
      maxDrawdown: -0.08,
      calmarRatio: 1.6,
      periodicObservations: 252,
    },
  });

  assert(
    fullRiskPresentation.primaryReturn.label === "CAGR",
    "full-window risk headline should allow CAGR",
  );
  assert(
    fullRiskPresentation.drawdownEfficiency.label === "Calmar Ratio",
    "full-window drawdown efficiency should allow Calmar",
  );

  const shortRelativePresentation = buildRelativeMetricPresentation({
    relativeMetrics: {
      overlapStartDate: "2026-01-01",
      overlapEndDate: "2026-03-31",
      overlapReturnObservations: 61,
      cagrSpread: 0.12,
      relativeWealth: 0.03,
      assetMetrics: { totalReturn: 0.08 },
      benchmarkMetrics: { totalReturn: 0.05 },
    },
  });

  assert(
    shortRelativePresentation.relativeWealth.status === METRIC_PRESENTATION.HEADLINE,
    "relative wealth should remain headline-safe",
  );
  assert(
    shortRelativePresentation.annualizedSpread.label === "Annualized Pace Spread",
    "short relative windows should demote CAGR spread label",
  );

  const thinPercentile = buildHistoricalPercentileMetric({
    label: "IV Percentile",
    value: 0.9,
    observations: MIN_CREDIBLE_PERCENTILE_HISTORY - 1,
  });
  const crediblePercentile = buildHistoricalPercentileMetric({
    label: "IV Percentile",
    value: 0.9,
    observations: MIN_CREDIBLE_PERCENTILE_HISTORY,
  });

  assert(
    thinPercentile.status === METRIC_PRESENTATION.SUPPRESSED,
    "thin percentile history should suppress percentile output",
  );
  assert(
    crediblePercentile.exportable === true,
    "credible percentile history should be exportable",
  );

  const drawdownPresentation = buildDrawdownMetricPresentation({
    summary: { episodeCount: 3 },
  });
  assert(
    drawdownPresentation.materialEpisodes.metadata.materialityThreshold ===
      DRAWDOWN_MATERIALITY_THRESHOLD,
    "drawdown presentation should use registry materiality threshold",
  );

  assert(
    buildSipMetricPresentation().cohortXirr.note.includes("Same-terminal"),
    "SIP XIRR registry note should identify same-terminal cohort risk",
  );
  assert(
    buildLumpsumVsSipMetricPresentation().terminalWealth.note.includes("terminal wealth"),
    "lumpsum vs SIP registry note should keep terminal wealth as win criterion",
  );

  const manifest = getMetricRegistryManifest();
  assert(
    manifest.version === METRIC_REGISTRY_VERSION,
    "metric registry manifest should expose the stable registry version",
  );
  assert(
    manifest.statuses[METRIC_PRESENTATION.HEADLINE].includes("Primary"),
    "metric registry manifest should explain headline behavior",
  );
  assert(
    manifest.thresholds.minimumAnnualizedCalendarDays === 365,
    "metric registry manifest should expose annualized calendar threshold",
  );
  assert(
    manifest.thresholds.minimumCrediblePercentileHistory ===
      MIN_CREDIBLE_PERCENTILE_HISTORY,
    "metric registry manifest should expose percentile history threshold",
  );
  assert(
    manifest.issueCodes.includes(METRIC_ISSUE_CODES.EXPORT_UNSAFE),
    "metric registry manifest should expose machine-readable issue codes",
  );

  const ruleIds = new Set(manifest.rules.map((rule) => rule.id));
  Object.values(METRIC_IDS).forEach((metricId) => {
    assert(ruleIds.has(metricId), `metric registry manifest should include ${metricId}`);
  });

  assert(
    getMetricRegistryRule(METRIC_IDS.ANNUALIZED_RETURN).diagnosticWhen.includes(
      "Annualized Pace",
    ),
    "annualized return rule should document short-window demotion",
  );
  assert(
    listMetricRegistryRules({ domain: "relative-performance" }).some(
      (rule) => rule.id === METRIC_IDS.RELATIVE_WEALTH,
    ),
    "registry rule listing should filter by study domain",
  );
  assert(
    listMetricRegistryRules({ status: METRIC_PRESENTATION.SUPPRESSED }).some(
      (rule) => rule.id === METRIC_IDS.HISTORICAL_PERCENTILE,
    ),
    "registry rule listing should filter by default status",
  );

  manifest.rules[0].label = "Mutated outside registry";
  assert(
    getMetricRegistryManifest().rules[0].label !== "Mutated outside registry",
    "registry manifest consumers should receive a defensive copy",
  );

  const safeTotalReturnProposal = validateMetricDecisionProposal({
    metricId: shortRiskPresentation.primaryReturn.id,
    domain: "risk-adjusted-return",
    proposedStatus: METRIC_PRESENTATION.HEADLINE,
    proposedLabel: shortRiskPresentation.primaryReturn.label,
    proposedExportable: true,
    evaluatedDecision: shortRiskPresentation.primaryReturn,
  });
  assert(safeTotalReturnProposal.ok, "safe evaluated total return headline should pass");

  const unsafeAnnualizedProposal = validateMetricDecisionProposal({
    metricId: shortRiskPresentation.secondaryReturn.id,
    domain: "risk-adjusted-return",
    proposedStatus: METRIC_PRESENTATION.HEADLINE,
    proposedLabel: "CAGR",
    proposedExportable: true,
    evaluatedDecision: shortRiskPresentation.secondaryReturn,
  });
  assert(
    unsafeAnnualizedProposal.ok === false &&
      unsafeAnnualizedProposal.errors.some((error) => error.includes("expected diagnostic")),
    "short-window annualized headline proposal should fail",
  );
  assert(
    unsafeAnnualizedProposal.issues.some(
      (issue) => issue.code === METRIC_ISSUE_CODES.STATUS_MISMATCH,
    ),
    "short-window annualized headline proposal should expose a status mismatch code",
  );

  const unsafePercentileExport = validateMetricDecisionProposal({
    metricId: thinPercentile.id,
    domain: "monthly-straddle",
    proposedStatus: METRIC_PRESENTATION.SUPPRESSED,
    proposedLabel: thinPercentile.label,
    proposedExportable: true,
    evaluatedDecision: thinPercentile,
  });
  assert(
    unsafePercentileExport.ok === false &&
      unsafePercentileExport.errors.some((error) => error.includes("not exportable")),
    "suppressed percentile export proposal should fail",
  );
  assert(
    unsafePercentileExport.issues.some(
      (issue) => issue.code === METRIC_ISSUE_CODES.EXPORT_UNSAFE,
    ),
    "suppressed percentile export proposal should expose an export unsafe code",
  );

  const wrongDomainProposal = validateMetricDecisionProposal({
    metricId: METRIC_IDS.RELATIVE_WEALTH,
    domain: "risk-adjusted-return",
    proposedStatus: METRIC_PRESENTATION.HEADLINE,
  });
  assert(
    wrongDomainProposal.ok === false &&
      wrongDomainProposal.errors.some((error) => error.includes("not registered")),
    "metric proposal should fail when used in the wrong domain",
  );
  assert(
    wrongDomainProposal.issues.some(
      (issue) => issue.code === METRIC_ISSUE_CODES.DOMAIN_MISMATCH,
    ),
    "wrong-domain metric proposal should expose a domain mismatch code",
  );

  const unknownMetricProposal = validateMetricDecisionProposal({
    metricId: "not.real_metric",
    domain: "risk-adjusted-return",
    proposedStatus: METRIC_PRESENTATION.HEADLINE,
  });
  assert(
    unknownMetricProposal.ok === false &&
      unknownMetricProposal.errors.some((error) => error.includes("Unknown metricId")),
    "unknown metric proposal should fail",
  );

  const batchProposalResult = validateMetricDecisionProposals({
    domain: "risk-adjusted-return",
    proposals: [
      {
        metricId: shortRiskPresentation.primaryReturn.id,
        proposedStatus: METRIC_PRESENTATION.HEADLINE,
        proposedExportable: true,
        evaluatedDecision: shortRiskPresentation.primaryReturn,
      },
      {
        metricId: shortRiskPresentation.secondaryReturn.id,
        proposedStatus: METRIC_PRESENTATION.HEADLINE,
        proposedExportable: true,
        evaluatedDecision: shortRiskPresentation.secondaryReturn,
      },
    ],
  });
  assert(
    batchProposalResult.ok === false && batchProposalResult.errors.length > 0,
    "batch proposal validation should aggregate unsafe metric errors",
  );
  assert(
    batchProposalResult.issues.some(
      (issue) => issue.code === METRIC_ISSUE_CODES.STATUS_MISMATCH,
    ),
    "batch proposal validation should aggregate structured issues",
  );
  assert(
    checkManifestSync().ok,
    "docs/metric-registry-manifest.json should stay generated from the JS registry",
  );

  return assertionCount;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const checks = runMetricRegistryChecks();
    console.log(`metric registry checks passed (${checks} assertions)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { runMetricRegistryChecks };
