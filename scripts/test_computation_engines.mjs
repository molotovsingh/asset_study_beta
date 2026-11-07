import { buildDrawdownStudy } from "../app/lib/drawdownStudy.js";
import { buildRollingReturnsStudy } from "../app/lib/rollingReturns.js";
import { buildSeasonalityStudy } from "../app/lib/seasonality.js";
import { sortRowsByMetric } from "../app/lib/sectorSnapshot.js";
import { buildSipStudy } from "../app/lib/sipSimulator.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function assertNear(actual, expected, tolerance, message) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

function point(date, value) {
  return {
    date: new Date(`${date}T00:00:00`),
    value,
  };
}

function buildMonthlySeries(startYear, startMonth, count, initialValue, monthlyReturn) {
  const rows = [];
  let value = initialValue;
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + index + 1, 0));
    value *= 1 + monthlyReturn;
    rows.push({
      date: new Date(`${date.toISOString().slice(0, 10)}T00:00:00`),
      value,
    });
  }
  return rows;
}

function testSeasonalityEngineBuildsMonthlyBuckets() {
  const series = buildMonthlySeries(2024, 1, 25, 100, 0.01);
  const study = buildSeasonalityStudy(series, {
    includePartialBoundaryMonths: true,
  });

  assert(study.monthlyRows.length >= 20, "seasonality should produce monthly transition rows");
  assert(study.bucketStats.length === 12, "seasonality should keep all month buckets");
  assert(study.summary.observedBucketCount === 12, "seasonality should observe all calendar buckets");
  assert(study.summary.monthsUsed === study.monthlyRows.length, "seasonality summary should expose monthly row count");
  assert(
    study.bucketStats.every((bucket) => bucket.observations >= 1),
    "seasonality bucket stats should carry observation counts",
  );
}

function testRollingReturnsEngineUsesFullWindowsOnly() {
  const series = buildMonthlySeries(2022, 1, 37, 100, 0.01);
  const study = buildRollingReturnsStudy(series, {
    windowYears: [1, 3, 5],
  });
  const oneYear = study.windowSummaries.find((summary) => summary.windowYears === 1);
  const threeYear = study.windowSummaries.find((summary) => summary.windowYears === 3);
  const fiveYear = study.windowSummaries.find((summary) => summary.windowYears === 5);

  assert(oneYear.observations > 0, "rolling returns should form 1Y windows when data exists");
  assert(threeYear.observations > 0, "rolling returns should form 3Y windows when data exists");
  assert(fiveYear.observations === 0, "rolling returns should not fake unavailable 5Y windows");
  assert(study.availableWindowSummaries.length === 2, "rolling returns should separate available windows");
  assert(study.unavailableWindowSummaries.length === 1, "rolling returns should expose unavailable windows");
}

function testSipEngineBuildsFixedContributionCohorts() {
  const series = buildMonthlySeries(2025, 1, 8, 100, 0.02);
  const study = buildSipStudy(series, {
    monthlyContribution: 1000,
    minContributions: 3,
  });

  assert(study.monthlyPoints.length === 8, "SIP should create one anchor per month");
  assert(study.cohorts.length === 6, "SIP should form every cohort with enough contributions");
  assert(study.summary.monthlyContribution === 1000, "SIP summary should preserve contribution amount");
  assert(study.summary.bestCohort, "SIP summary should identify a best cohort");
  assert(
    study.cohorts.every(
      (cohort) =>
        study.summary.highestTerminalValueCohort.terminalValue >= cohort.terminalValue,
    ),
    "SIP terminal-value ordering should be internally consistent",
  );
}

function testDrawdownEngineIgnoresMicroscopicEpisodes() {
  const study = buildDrawdownStudy([
    point("2026-01-01", 100),
    point("2026-01-02", 99.95),
    point("2026-01-03", 98),
    point("2026-01-04", 105),
  ]);

  assert(study.summary.totalEpisodes === 1, "drawdown should ignore sub-threshold noise episodes");
  assert(study.summary.recoveredEpisodes === 1, "drawdown should mark recovered material episodes");
  assertNear(study.summary.maxDrawdownEpisode.maxDepth, -0.02, 1e-9, "drawdown should measure peak-to-trough depth");
  assert(study.summary.latestDepth === 0, "drawdown should clear latest depth after recovery");
}

function testSectorSnapshotMetricSortsUnavailableRowsLast() {
  const rows = sortRowsByMetric(
    [
      {
        label: "Unavailable",
        available: false,
        relativeMetrics: {},
      },
      {
        label: "Leader",
        available: true,
        relativeMetrics: { relativeWealth: 0.25 },
      },
      {
        label: "Laggard",
        available: true,
        relativeMetrics: { relativeWealth: -0.05 },
      },
    ],
    "relativeWealth",
  );

  assert(rows[0].label === "Leader", "sector snapshot should rank stronger relative wealth first");
  assert(rows[1].label === "Laggard", "sector snapshot should keep weaker available rows before unavailable rows");
  assert(rows[2].label === "Unavailable", "sector snapshot should put unavailable rows last");
}

testSeasonalityEngineBuildsMonthlyBuckets();
testRollingReturnsEngineUsesFullWindowsOnly();
testSipEngineBuildsFixedContributionCohorts();
testDrawdownEngineIgnoresMicroscopicEpisodes();
testSectorSnapshotMetricSortsUnavailableRowsLast();

console.log(`computation engine checks passed (${assertionCount} assertions)`);
