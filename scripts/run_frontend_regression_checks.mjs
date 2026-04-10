import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLumpsumVsSipStudy } from "../app/lib/lumpsumVsSip.js";
import {
  buildStudyViewHash,
  parseStudyViewHash,
} from "../app/studies/studyShell.js";
import {
  DEFAULT_ACTIVE_SUBJECT_QUERY,
  adoptActiveSubjectQuery,
  getActiveSubjectQuery,
  setActiveSubjectQuery,
  subscribeActiveSubject,
} from "../app/studies/shared/activeSubject.js";
import {
  MAX_RUN_HISTORY_ITEMS,
  clearRunHistory,
  getRecentRuns,
  recordStudyRun,
  subscribeRunHistory,
} from "../app/studies/shared/runHistory.js";
import {
  buildCommonIndexParams,
  readCommonIndexParams,
} from "../app/studies/shared/shareableInputs.js";
import {
  renderRiskInterpretation,
  renderSeasonalityInterpretation,
} from "../app/studies/shared/interpretation.js";
import { renderResults as renderRiskResults } from "../app/studies/riskAdjustedReturnView.js";
import { renderRelativeResults } from "../app/studies/riskAdjustedReturnRelative.js";
import { renderSeasonalityResults } from "../app/studies/seasonalityView.js";
import { renderRollingReturnsResults } from "../app/studies/rollingReturnsView.js";
import { renderSipSimulatorResults } from "../app/studies/sipSimulatorView.js";
import { renderLumpsumVsSipResults } from "../app/studies/lumpsumVsSipView.js";
import {
  buildCsvRows as buildLumpsumVsSipCsvRows,
  buildWorkbookXml as buildLumpsumVsSipWorkbookXml,
} from "../app/lib/lumpsumVsSipExport.js";
import { buildRollingReturnsStudy } from "../app/lib/rollingReturns.js";
import { computeRelativeMetrics } from "../app/lib/relativeStats.js";
import {
  buildCsvRows as buildRollingCsvRows,
  buildWorkbookXml as buildRollingWorkbookXml,
} from "../app/lib/rollingReturnsExport.js";
import { buildSeasonalityStudy } from "../app/lib/seasonality.js";
import { buildSipStudy } from "../app/lib/sipSimulator.js";
import {
  buildCsvRows as buildSipCsvRows,
  buildWorkbookXml as buildSipWorkbookXml,
} from "../app/lib/sipSimulatorExport.js";
import {
  buildCsvRows as buildRelativeCsvRows,
  buildWorkbookXml as buildRelativeWorkbookXml,
} from "../app/lib/relativeStudyExport.js";
import {
  buildCsvRows as buildSeasonalityCsvRows,
  buildWorkbookXml as buildSeasonalityWorkbookXml,
} from "../app/lib/seasonalityExport.js";
import {
  buildCsvRows as buildStudyCsvRows,
  buildWorkbookXml as buildStudyWorkbookXml,
  serializeCsv,
  toIsoDate,
} from "../app/lib/studyExport.js";
import { computeRiskAdjustedMetrics } from "../app/lib/stats.js";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(REPO_ROOT, "data", "snapshots", "yfinance", "index");
const FIXED_END = new Date("2026-04-09T00:00:00");
const FIVE_YEAR_START = new Date("2021-04-09T00:00:00");
const ONE_YEAR_START = new Date("2025-04-09T00:00:00");
const CONSTANT_RISK_FREE_RATE = 0.055;
const EXPORTED_AT = new Date("2026-04-09T12:00:00");
const TOLERANCE = 1e-10;

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  assertionCount += 1;
}

function assertClose(actual, expected, label, tolerance = TOLERANCE) {
  if (actual === null || expected === null) {
    assert(actual === expected, `${label}: expected ${expected}, received ${actual}`);
    return;
  }

  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    assert(
      Object.is(actual, expected),
      `${label}: expected ${expected}, received ${actual}`,
    );
    return;
  }

  const delta = Math.abs(actual - expected);
  assert(
    delta <= tolerance,
    `${label}: expected ${expected}, received ${actual} (delta ${delta})`,
  );
}

function assertDateEqual(actual, expected, label) {
  assert(
    toIsoDate(actual) === toIsoDate(expected),
    `${label}: expected ${toIsoDate(expected)}, received ${toIsoDate(actual)}`,
  );
}

function testActiveSubjectStore() {
  assert(
    getActiveSubjectQuery() === DEFAULT_ACTIVE_SUBJECT_QUERY,
    "active subject should default to Nifty 50",
  );
  assert(
    setActiveSubjectQuery("AAPL") === true,
    "active subject should update when changed",
  );
  assert(
    getActiveSubjectQuery() === "AAPL",
    "active subject should return the latest query",
  );
  assert(
    setActiveSubjectQuery("AAPL") === false,
    "active subject should not report unchanged writes",
  );

  const session = { indexQuery: "Nifty 50" };
  assert(
    adoptActiveSubjectQuery(session) === true,
    "study session should adopt the active subject",
  );
  assert(
    session.indexQuery === "AAPL",
    "study session should receive the active subject query",
  );
  let observedSubject = "";
  const unsubscribe = subscribeActiveSubject((query) => {
    observedSubject = query;
  });
  setActiveSubjectQuery("Sensex");
  assert(
    observedSubject === "Sensex",
    "active subject listeners should observe changes",
  );
  unsubscribe();

  setActiveSubjectQuery(DEFAULT_ACTIVE_SUBJECT_QUERY);
  console.log("ok active subject");
}

function testRunHistoryStore() {
  clearRunHistory();
  let observedRunCount = null;
  const unsubscribe = subscribeRunHistory((runs) => {
    observedRunCount = runs.length;
  });

  assert(
    recordStudyRun({
      studyId: "risk-adjusted-return",
      studyTitle: "Risk-Adjusted Return",
      subjectQuery: "AAPL",
      selectionLabel: "Apple Inc.",
      symbol: "AAPL",
      requestedStartDate: new Date("2021-01-01T00:00:00"),
      requestedEndDate: "2026-01-01",
      completedAt: "2026-04-10T07:30:00.000Z",
    }) === true,
    "run history should accept a valid run",
  );
  assert(observedRunCount === 1, "run history listener should observe writes");
  assert(
    getRecentRuns()[0].requestedStartDate === "2021-01-01",
    "run history should normalize start dates",
  );

  for (let index = 0; index < MAX_RUN_HISTORY_ITEMS + 2; index += 1) {
    recordStudyRun({
      studyId: "rolling-returns",
      studyTitle: "Rolling Returns",
      subjectQuery: `SYM${index}`,
      completedAt: `2026-04-10T07:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
  assert(
    getRecentRuns().length === MAX_RUN_HISTORY_ITEMS,
    "run history should cap retained runs",
  );

  unsubscribe();
  clearRunHistory();
  console.log("ok run history");
}

function testShareableInputUrls() {
  const hash = buildStudyViewHash("sip-simulator", "overview", {
    subject: "AAPL",
    start: "2021-01-01",
    end: "2026-01-01",
    contribution: "25000",
  });
  const route = parseStudyViewHash(hash);
  assert(route.studyId === "sip-simulator", "share URL study id mismatch");
  assert(route.viewId === "overview", "share URL view id mismatch");
  assert(
    route.params.get("subject") === "AAPL",
    "share URL subject param mismatch",
  );
  assert(
    route.params.get("contribution") === "25000",
    "share URL contribution param mismatch",
  );

  const session = {
    indexQuery: "Nifty 50",
    startDateValue: "2020-01-01",
    endDateValue: "2025-01-01",
  };
  const applied = readCommonIndexParams(session, route.params);
  assert(applied.changed === true, "share URL params should change session");
  assert(applied.subject === true, "share URL should mark subject as present");
  assert(session.indexQuery === "AAPL", "share URL should restore subject");
  assert(session.startDateValue === "2021-01-01", "share URL should restore start");
  assert(session.endDateValue === "2026-01-01", "share URL should restore end");

  const unchanged = readCommonIndexParams(session, route.params);
  assert(
    unchanged.changed === false && unchanged.subject === true,
    "share URL should preserve subject presence even when unchanged",
  );
  assert(
    buildCommonIndexParams(session).subject === "AAPL",
    "share URL common params should serialize subject",
  );
  console.log("ok shareable inputs");
}

function testInterpretationPanels() {
  const riskHtml = renderRiskInterpretation({
    annualizedReturn: 0.11,
    totalReturn: 0.68,
    annualizedVolatility: 0.18,
    maxDrawdown: -0.22,
    maxDrawdownDurationDays: 180,
    sharpeRatio: 0.74,
    sortinoRatio: 1.08,
  });
  assert(
    riskHtml.includes("What This Means"),
    "risk interpretation should render the shared panel heading",
  );
  assert(
    riskHtml.includes("not a forecast or recommendation"),
    "interpretation copy should retain the non-advisory framing",
  );

  const seasonalityHtml = renderSeasonalityInterpretation({
    seasonalitySpread: 0.044,
    yearsObserved: 5,
    monthsUsed: 60,
    thinMonthCount: 0,
    mostConsistentMonth: {
      monthLabel: "Apr",
      consistencyScore: 0.8,
    },
    clearSignalCount: 2,
  });
  assert(
    seasonalityHtml.includes("Seasonality Spread"),
    "seasonality interpretation should include spread context",
  );
  assert(
    seasonalityHtml.includes("confidence bands"),
    "seasonality interpretation should explain confidence bands",
  );

  console.log("ok interpretation panels");
}

function mean(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleStdDev(values) {
  if (values.length < 2) {
    return null;
  }

  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(values, quantile) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const bounded = Math.min(Math.max(quantile, 0), 1);
  const index = (sorted.length - 1) * bounded;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function sampleSkewness(values) {
  if (values.length < 3) {
    return null;
  }

  const average = mean(values);
  const stdDev = sampleStdDev(values);
  if (average === null || !stdDev) {
    return null;
  }

  const sampleSize = values.length;
  const sum = values.reduce(
    (total, value) => total + ((value - average) / stdDev) ** 3,
    0,
  );

  return (sampleSize / ((sampleSize - 1) * (sampleSize - 2))) * sum;
}

function sampleExcessKurtosis(values) {
  if (values.length < 4) {
    return null;
  }

  const average = mean(values);
  const stdDev = sampleStdDev(values);
  if (average === null || !stdDev) {
    return null;
  }

  const sampleSize = values.length;
  const sum = values.reduce(
    (total, value) => total + ((value - average) / stdDev) ** 4,
    0,
  );

  return (
    (sampleSize * (sampleSize + 1) * sum) /
      ((sampleSize - 1) * (sampleSize - 2) * (sampleSize - 3)) -
    (3 * (sampleSize - 1) ** 2) / ((sampleSize - 2) * (sampleSize - 3))
  );
}

function inferPeriodsPerYear(series) {
  if (series.length < 3) {
    return 12;
  }

  const gaps = [];
  for (let index = 1; index < series.length; index += 1) {
    const days = (series[index].date - series[index - 1].date) / 86400000;
    if (days > 0) {
      gaps.push(days);
    }
  }

  if (!gaps.length) {
    return 12;
  }

  const sorted = [...gaps].sort((left, right) => left - right);
  const medianGap = sorted[Math.floor(sorted.length / 2)];
  if (medianGap > 270) {
    return 1;
  }
  if (medianGap > 80) {
    return 4;
  }
  if (medianGap > 25) {
    return 12;
  }
  if (medianGap > 5) {
    return 52;
  }
  return 252;
}

function annualRateToPeriodLogReturn(annualRate, days) {
  return Math.log1p(annualRate) * (days / 365);
}

function shiftDateByYears(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() - years);
  return nextDate;
}

function filterSeriesByDate(series, startDate, endDate) {
  return series.filter((point) => point.date >= startDate && point.date <= endDate);
}

function toPeriodicReturns(series) {
  const rows = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const simpleReturn = current.value / previous.value - 1;
    rows.push({
      startDate: previous.date,
      endDate: current.date,
      days: (current.date - previous.date) / 86400000,
      simpleReturn,
      logReturn: Math.log1p(simpleReturn),
    });
  }
  return rows;
}

function maxDrawdown(series) {
  let peak = series[0].value;
  let maxDepth = 0;

  for (const point of series) {
    peak = Math.max(peak, point.value);
    maxDepth = Math.min(maxDepth, point.value / peak - 1);
  }

  return maxDepth;
}

function ulcerIndex(series) {
  let peak = series[0].value;
  const squared = [];

  for (const point of series) {
    peak = Math.max(peak, point.value);
    squared.push(Math.min(point.value / peak - 1, 0) ** 2);
  }

  return Math.sqrt(mean(squared) ?? 0);
}

function getDrawdownDurationStats(series) {
  if (series.length < 2) {
    return {
      maxDrawdownDurationDays: 0,
      maxDrawdownDurationPeriods: 0,
    };
  }

  let peakValue = series[0].value;
  let peakDate = series[0].date;
  let peakIndex = 0;
  let currentDrawdownStartDate = null;
  let currentDrawdownStartIndex = null;
  let maxDrawdownDurationDays = 0;
  let maxDrawdownDurationPeriods = 0;

  for (let index = 1; index < series.length; index += 1) {
    const point = series[index];
    if (point.value >= peakValue) {
      if (currentDrawdownStartDate !== null) {
        maxDrawdownDurationDays = Math.max(
          maxDrawdownDurationDays,
          (point.date - currentDrawdownStartDate) / 86400000,
        );
        maxDrawdownDurationPeriods = Math.max(
          maxDrawdownDurationPeriods,
          index - currentDrawdownStartIndex,
        );
      }

      peakValue = point.value;
      peakDate = point.date;
      peakIndex = index;
      currentDrawdownStartDate = null;
      currentDrawdownStartIndex = null;
      continue;
    }

    if (currentDrawdownStartDate === null) {
      currentDrawdownStartDate = peakDate;
      currentDrawdownStartIndex = peakIndex;
    }
  }

  if (currentDrawdownStartDate !== null) {
    const lastPoint = series[series.length - 1];
    maxDrawdownDurationDays = Math.max(
      maxDrawdownDurationDays,
      (lastPoint.date - currentDrawdownStartDate) / 86400000,
    );
    maxDrawdownDurationPeriods = Math.max(
      maxDrawdownDurationPeriods,
      series.length - 1 - currentDrawdownStartIndex,
    );
  }

  return {
    maxDrawdownDurationDays,
    maxDrawdownDurationPeriods,
  };
}

function computeRiskMetricsIndependent(series, annualRiskFreeRate) {
  const periodicReturns = toPeriodicReturns(series);
  const periodsPerYear = inferPeriodsPerYear(series);
  const logReturns = periodicReturns.map((period) => period.logReturn);
  const simpleReturns = periodicReturns.map((period) => period.simpleReturn);
  const annualizedVolatility =
    (sampleStdDev(logReturns) ?? 0) * Math.sqrt(periodsPerYear);
  const annualizedLogRiskFreeRate = Math.log1p(annualRiskFreeRate);
  const excessLogReturns = periodicReturns.map(
    (period) =>
      period.logReturn -
      annualRateToPeriodLogReturn(annualRiskFreeRate, period.days),
  );
  const startValue = series[0].value;
  const endValue = series[series.length - 1].value;
  const elapsedDays =
    (series[series.length - 1].date - series[0].date) / 86400000;
  const totalReturn = endValue / startValue - 1;
  const annualizedLogReturn = Math.log(endValue / startValue) * (365 / elapsedDays);
  const annualizedReturn = Math.expm1(annualizedLogReturn);
  const annualizedExcessLogReturn = (mean(excessLogReturns) ?? 0) * periodsPerYear;
  const downsideDeviation =
    Math.sqrt(mean(excessLogReturns.map((value) => Math.min(value, 0) ** 2)) ?? 0) *
    Math.sqrt(periodsPerYear);
  const maxDrawdownValue = maxDrawdown(series);
  const ulcerIndexValue = ulcerIndex(series);
  const valueAtRisk95 = percentile(logReturns, 0.05);
  const cvarSample = logReturns.filter(
    (value) => valueAtRisk95 !== null && value <= valueAtRisk95,
  );
  const rankedPeriods = [...periodicReturns].sort(
    (left, right) => left.logReturn - right.logReturn,
  );
  const drawdownDurations = getDrawdownDurationStats(series);
  const positivePeriods = periodicReturns.filter((period) => period.logReturn > 0).length;

  return {
    totalReturn,
    annualizedLogReturn,
    annualizedReturn,
    annualizedExcessLogReturn,
    annualizedVolatility,
    downsideDeviation,
    maxDrawdown: maxDrawdownValue,
    ulcerIndex: ulcerIndexValue,
    sharpeRatio:
      annualizedVolatility > 0
        ? annualizedExcessLogReturn / annualizedVolatility
        : null,
    sortinoRatio:
      downsideDeviation > 0
        ? annualizedExcessLogReturn / downsideDeviation
        : null,
    calmarRatio:
      maxDrawdownValue < 0
        ? annualizedReturn / Math.abs(maxDrawdownValue)
        : null,
    martinRatio:
      ulcerIndexValue > 0
        ? (annualizedReturn - annualRiskFreeRate) / ulcerIndexValue
        : null,
    averageAnnualRiskFreeRate: annualRiskFreeRate,
    averageAnnualLogRiskFreeRate: annualizedLogRiskFreeRate,
    averagePeriodReturn: mean(logReturns),
    medianPeriodReturn: median(logReturns),
    simpleAveragePeriodReturn: mean(simpleReturns),
    simpleMedianPeriodReturn: median(simpleReturns),
    valueAtRisk95,
    conditionalValueAtRisk95: mean(cvarSample),
    skewness: sampleSkewness(logReturns),
    excessKurtosis: sampleExcessKurtosis(logReturns),
    periodsPerYear,
    observations: series.length,
    periodicObservations: periodicReturns.length,
    positivePeriods,
    nonPositivePeriods: periodicReturns.length - positivePeriods,
    winRate:
      periodicReturns.length > 0 ? positivePeriods / periodicReturns.length : null,
    bestPeriod: rankedPeriods.length
      ? {
          ...rankedPeriods[rankedPeriods.length - 1],
          value: rankedPeriods[rankedPeriods.length - 1].simpleReturn,
        }
      : null,
    worstPeriod: rankedPeriods.length
      ? {
          ...rankedPeriods[0],
          value: rankedPeriods[0].simpleReturn,
        }
      : null,
    ...drawdownDurations,
  };
}

function sampleCovariance(leftValues, rightValues) {
  if (leftValues.length !== rightValues.length || leftValues.length < 2) {
    return null;
  }

  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  return (
    leftValues.reduce(
      (sum, value, index) =>
        sum + (value - leftMean) * (rightValues[index] - rightMean),
      0,
    ) /
    (leftValues.length - 1)
  );
}

function toDateKey(date) {
  return toIsoDate(date);
}

function alignSeries(assetSeries, benchmarkSeries) {
  const assetByDate = new Map(assetSeries.map((point) => [toDateKey(point.date), point]));
  const benchmarkByDate = new Map(
    benchmarkSeries.map((point) => [toDateKey(point.date), point]),
  );
  const alignedKeys = [...assetByDate.keys()]
    .filter((dateKey) => benchmarkByDate.has(dateKey))
    .sort();

  return {
    alignedAssetSeries: alignedKeys.map((key) => assetByDate.get(key)),
    alignedBenchmarkSeries: alignedKeys.map((key) => benchmarkByDate.get(key)),
  };
}

function buildCaptureRatio(assetPeriods, benchmarkPeriods, direction) {
  const indexedPairs = assetPeriods
    .map((period, index) => ({ assetPeriod: period, benchmarkPeriod: benchmarkPeriods[index] }))
    .filter(({ benchmarkPeriod }) =>
      direction === "up"
        ? benchmarkPeriod.logReturn > 0
        : benchmarkPeriod.logReturn < 0,
    );

  if (!indexedPairs.length) {
    return null;
  }

  const assetCumulative = Math.expm1(
    indexedPairs.reduce((sum, pair) => sum + pair.assetPeriod.logReturn, 0),
  );
  const benchmarkCumulative = Math.expm1(
    indexedPairs.reduce((sum, pair) => sum + pair.benchmarkPeriod.logReturn, 0),
  );

  if (!benchmarkCumulative) {
    return null;
  }

  return assetCumulative / benchmarkCumulative;
}

function buildRelativeWealthSeries(assetSeries, benchmarkSeries) {
  const assetBase = assetSeries[0]?.value ?? null;
  const benchmarkBase = benchmarkSeries[0]?.value ?? null;

  if (!assetBase || !benchmarkBase) {
    return [];
  }

  return assetSeries.map((point, index) => ({
    date: point.date,
    value:
      point.value / assetBase / (benchmarkSeries[index].value / benchmarkBase) - 1,
  }));
}

function maxRelativeDrawdown(relativeWealthSeries) {
  let peak = 1 + (relativeWealthSeries[0]?.value ?? 0);
  let maxValue = 0;

  for (const point of relativeWealthSeries) {
    const wealth = 1 + point.value;
    peak = Math.max(peak, wealth);
    maxValue = Math.min(maxValue, wealth / peak - 1);
  }

  return maxValue;
}

function computeAnnualizedGrowth(startValue, endValue, elapsedDays) {
  const totalReturn = endValue / startValue - 1;
  const annualizedLogReturn = Math.log(endValue / startValue) * (365 / elapsedDays);

  return {
    totalReturn,
    annualizedLogReturn,
    annualizedReturn: Math.expm1(annualizedLogReturn),
  };
}

function buildRollingWindowRowsIndependent(series, windowYears) {
  const rows = [];
  let startIndex = 0;

  for (let endIndex = 0; endIndex < series.length; endIndex += 1) {
    const endPoint = series[endIndex];
    const targetStartDate = shiftDateByYears(endPoint.date, windowYears);

    while (
      startIndex + 1 < endIndex &&
      series[startIndex + 1].date <= targetStartDate
    ) {
      startIndex += 1;
    }

    const startPoint = series[startIndex];
    if (!startPoint || startPoint.date > targetStartDate) {
      continue;
    }

    const elapsedDays = (endPoint.date - startPoint.date) / 86400000;
    if (elapsedDays <= 0) {
      continue;
    }

    rows.push({
      windowYears,
      windowLabel: `${windowYears}Y`,
      startDate: startPoint.date,
      endDate: endPoint.date,
      elapsedDays,
      ...computeAnnualizedGrowth(startPoint.value, endPoint.value, elapsedDays),
    });
  }

  return rows;
}

function buildRollingSummaryIndependent(windowYears, rows) {
  const annualizedReturns = rows.map((row) => row.annualizedReturn);
  const latestWindow = rows[rows.length - 1] || null;
  const bestWindow = rows.reduce(
    (best, row) =>
      !best || row.annualizedReturn > best.annualizedReturn ? row : best,
    null,
  );
  const worstWindow = rows.reduce(
    (worst, row) =>
      !worst || row.annualizedReturn < worst.annualizedReturn ? row : worst,
    null,
  );
  const positiveWindows = rows.filter((row) => row.annualizedReturn > 0).length;

  return {
    windowYears,
    windowLabel: `${windowYears}Y`,
    observations: rows.length,
    latestCagr: latestWindow?.annualizedReturn ?? null,
    medianCagr: median(annualizedReturns),
    percentile25Cagr: percentile(annualizedReturns, 0.25),
    percentile75Cagr: percentile(annualizedReturns, 0.75),
    bestCagr: bestWindow?.annualizedReturn ?? null,
    worstCagr: worstWindow?.annualizedReturn ?? null,
    positiveRate: rows.length ? positiveWindows / rows.length : null,
    cagrRange:
      bestWindow && worstWindow
        ? bestWindow.annualizedReturn - worstWindow.annualizedReturn
        : null,
  };
}

function buildRollingStudyIndependent(series, windowYears = [1, 3, 5, 10]) {
  const elapsedDays = (series.at(-1).date - series[0].date) / 86400000;
  const fullPeriodGrowth = computeAnnualizedGrowth(
    series[0].value,
    series.at(-1).value,
    elapsedDays,
  );
  const windowSummaries = windowYears.map((windowYearsValue) =>
    buildRollingSummaryIndependent(
      windowYearsValue,
      buildRollingWindowRowsIndependent(series, windowYearsValue),
    ),
  );

  return {
    fullPeriodCagr: fullPeriodGrowth.annualizedReturn,
    fullPeriodTotalReturn: fullPeriodGrowth.totalReturn,
    windowSummaries,
    availableWindowSummaries: windowSummaries.filter(
      (windowSummary) => windowSummary.observations > 0,
    ),
    unavailableWindowSummaries: windowSummaries.filter(
      (windowSummary) => windowSummary.observations === 0,
    ),
  };
}

function computeRelativeMetricsIndependent(assetSeries, benchmarkSeries, annualRiskFreeRate) {
  const { alignedAssetSeries, alignedBenchmarkSeries } = alignSeries(
    assetSeries,
    benchmarkSeries,
  );
  const assetMetrics = computeRiskMetricsIndependent(
    alignedAssetSeries,
    annualRiskFreeRate,
  );
  const benchmarkMetrics = computeRiskMetricsIndependent(
    alignedBenchmarkSeries,
    annualRiskFreeRate,
  );
  const assetPeriods = toPeriodicReturns(alignedAssetSeries);
  const benchmarkPeriods = toPeriodicReturns(alignedBenchmarkSeries);
  const assetLogReturns = assetPeriods.map((period) => period.logReturn);
  const benchmarkLogReturns = benchmarkPeriods.map((period) => period.logReturn);
  const excessLogReturns = assetLogReturns.map(
    (value, index) => value - benchmarkLogReturns[index],
  );
  const covariance = sampleCovariance(assetLogReturns, benchmarkLogReturns);
  const benchmarkStdDev = sampleStdDev(benchmarkLogReturns);
  const benchmarkVariance =
    benchmarkStdDev !== null ? benchmarkStdDev ** 2 : null;
  const assetStdDev = sampleStdDev(assetLogReturns);
  const trackingError = (sampleStdDev(excessLogReturns) ?? 0) * Math.sqrt(
    assetMetrics.periodsPerYear,
  );
  const annualizedExcessLogReturn =
    (mean(excessLogReturns) ?? 0) * assetMetrics.periodsPerYear;
  const relativeWealthSeries = buildRelativeWealthSeries(
    alignedAssetSeries,
    alignedBenchmarkSeries,
  );

  return {
    overlapObservations: alignedAssetSeries.length,
    overlapReturnObservations: assetPeriods.length,
    overlapStartDate: alignedAssetSeries[0].date,
    overlapEndDate: alignedAssetSeries[alignedAssetSeries.length - 1].date,
    periodsPerYear: assetMetrics.periodsPerYear,
    annualizedExcessLogReturn,
    correlation:
      covariance !== null && assetStdDev && benchmarkStdDev
        ? covariance / (assetStdDev * benchmarkStdDev)
        : null,
    beta:
      covariance !== null && benchmarkVariance
        ? covariance / benchmarkVariance
        : null,
    trackingError,
    informationRatio:
      trackingError > 0 ? annualizedExcessLogReturn / trackingError : null,
    outperformanceRate:
      assetPeriods.length > 0
        ? assetPeriods.filter(
            (period, index) =>
              period.logReturn > benchmarkPeriods[index].logReturn,
          ).length / assetPeriods.length
        : null,
    upsideCapture: buildCaptureRatio(assetPeriods, benchmarkPeriods, "up"),
    downsideCapture: buildCaptureRatio(assetPeriods, benchmarkPeriods, "down"),
    relativeWealth:
      (1 + assetMetrics.totalReturn) / (1 + benchmarkMetrics.totalReturn) - 1,
    cagrSpread:
      assetMetrics.annualizedReturn - benchmarkMetrics.annualizedReturn,
    relativeDrawdown: maxRelativeDrawdown(relativeWealthSeries),
    alignedPeriods: assetPeriods.map((assetPeriod, index) => ({
      startDate: assetPeriod.startDate,
      endDate: assetPeriod.endDate,
      days: assetPeriod.days,
      assetSimpleReturn: assetPeriod.simpleReturn,
      assetLogReturn: assetPeriod.logReturn,
      benchmarkSimpleReturn: benchmarkPeriods[index].simpleReturn,
      benchmarkLogReturn: benchmarkPeriods[index].logReturn,
      excessSimpleReturn:
        assetPeriod.simpleReturn - benchmarkPeriods[index].simpleReturn,
      excessLogReturn: assetPeriod.logReturn - benchmarkPeriods[index].logReturn,
    })),
    assetMetrics,
    benchmarkMetrics,
  };
}

function monthLabel(monthNumber) {
  return MONTH_LABELS[monthNumber - 1];
}

function buildMonthAnchors(series) {
  const anchors = [];
  let activeMonthId = null;
  let activeAnchor = null;

  for (const point of series) {
    const year = point.date.getFullYear();
    const monthIndex = point.date.getMonth();
    const monthNumber = monthIndex + 1;
    const monthId = `${year}-${String(monthNumber).padStart(2, "0")}`;

    if (monthId !== activeMonthId) {
      if (activeAnchor) {
        anchors.push(activeAnchor);
      }

      activeMonthId = monthId;
      activeAnchor = {
        monthId,
        year,
        monthIndex,
        monthNumber,
        monthLabel: monthLabel(monthNumber),
        date: point.date,
        value: point.value,
      };
      continue;
    }

    activeAnchor = {
      ...activeAnchor,
      date: point.date,
      value: point.value,
    };
  }

  if (activeAnchor) {
    anchors.push(activeAnchor);
  }

  return anchors;
}

function monthDistance(leftAnchor, rightAnchor) {
  return (
    (rightAnchor.year - leftAnchor.year) * 12 +
    (rightAnchor.monthIndex - leftAnchor.monthIndex)
  );
}

function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}

function endOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function shouldIncludeMonthlyRow(row, startDate, endDate, includePartialBoundaryMonths) {
  if (includePartialBoundaryMonths) {
    return row.endDate >= startDate && row.endDate <= endDate;
  }

  return startDate <= row.monthStart && endDate >= row.monthEnd;
}

function buildSeasonalityIndependent(series, startDate, endDate, includePartialBoundaryMonths) {
  const anchors = buildMonthAnchors(series);
  const monthlyRows = [];
  let skippedTransitions = 0;

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (monthDistance(previous, current) !== 1) {
      skippedTransitions += 1;
      continue;
    }

    const monthStart = startOfMonth(current.year, current.monthIndex);
    const monthEnd = endOfMonth(current.year, current.monthIndex);
    const simpleReturn = current.value / previous.value - 1;
    const logReturn = Math.log1p(simpleReturn);
    const row = {
      year: current.year,
      monthNumber: current.monthNumber,
      monthLabel: current.monthLabel,
      monthStart,
      monthEnd,
      startDate: previous.date,
      endDate: current.date,
      simpleReturn,
      logReturn,
      isBoundaryPartial: startDate > monthStart || endDate < monthEnd,
      isPositive: logReturn > 0,
    };

    if (
      shouldIncludeMonthlyRow(row, startDate, endDate, includePartialBoundaryMonths)
    ) {
      monthlyRows.push(row);
    }
  }

  const bucketStats = MONTH_LABELS.map((label, monthIndex) => {
    const monthNumber = monthIndex + 1;
    const rows = monthlyRows.filter((row) => row.monthNumber === monthNumber);
    const logReturns = rows.map((row) => row.logReturn);
    return {
      monthLabel: label,
      monthNumber,
      observations: rows.length,
      averageLogReturn: mean(logReturns),
      winRate:
        rows.length > 0 ? rows.filter((row) => row.isPositive).length / rows.length : null,
      volatility: sampleStdDev(logReturns),
    };
  });

  const populated = bucketStats.filter((bucket) => bucket.observations > 0);
  const strongestMonth = populated.reduce(
    (best, bucket) =>
      !best || bucket.averageLogReturn > best.averageLogReturn ? bucket : best,
    null,
  );
  const weakestMonth = populated.reduce(
    (worst, bucket) =>
      !worst || bucket.averageLogReturn < worst.averageLogReturn ? bucket : worst,
    null,
  );
  const bestHitRateMonth = populated.reduce(
    (best, bucket) => (!best || bucket.winRate > best.winRate ? bucket : best),
    null,
  );
  const mostVolatileMonth = populated.reduce(
    (best, bucket) =>
      !best || bucket.volatility > best.volatility ? bucket : best,
    null,
  );

  return {
    monthlyRows,
    bucketStats,
    skippedTransitions,
    summary: {
      monthsUsed: monthlyRows.length,
      yearsObserved: new Set(monthlyRows.map((row) => row.year)).size,
      seasonalitySpread:
        strongestMonth && weakestMonth
          ? strongestMonth.averageLogReturn - weakestMonth.averageLogReturn
          : null,
      strongestMonth,
      weakestMonth,
      bestHitRateMonth,
      mostVolatileMonth,
    },
  };
}

async function loadSnapshot(datasetId) {
  const snapshotPath = path.join(SNAPSHOT_DIR, `${datasetId}.json`);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const series = snapshot.points.map(([date, value]) => ({
    date: new Date(`${date}T00:00:00`),
    value,
  }));

  return { snapshot, series };
}

function buildSelection(snapshot, currency = "INR") {
  return {
    label: snapshot.label,
    symbol: snapshot.symbol,
    providerName: snapshot.providerName,
    targetSeriesType: snapshot.targetSeriesType,
    currency,
  };
}

function buildRiskPayload(snapshot, series, metrics) {
  return {
    studyTitle: "Risk-Adjusted Return",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    metrics,
    warnings: [],
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    annualRiskFreeRate: CONSTANT_RISK_FREE_RATE,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    useDemoData: false,
    exportedAt: EXPORTED_AT,
  };
}

function buildSeasonalityPayload(snapshot, series, seasonalityModel, warnings = []) {
  return {
    studyTitle: "Seasonality",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    bucketStats: seasonalityModel.bucketStats,
    monthlyRows: seasonalityModel.monthlyRows,
    heatmap: seasonalityModel.heatmap,
    summary: seasonalityModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    includePartialBoundaryMonths: false,
    monthlyReturnMode: seasonalityModel.monthlyReturnMode,
    confidenceLevel: seasonalityModel.confidenceLevel,
    exportedAt: EXPORTED_AT,
  };
}

function buildSipPayload(snapshot, series, sipModel, monthlyContribution, warnings = []) {
  return {
    studyTitle: "SIP Simulator",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    monthlyPoints: sipModel.monthlyPoints,
    cohorts: sipModel.cohorts,
    summary: sipModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    monthlyContribution,
    minContributions: sipModel.summary.minContributions,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    endMonthLabel:
      sipModel.monthlyPoints[sipModel.monthlyPoints.length - 1]?.monthLabel ?? null,
    exportedAt: EXPORTED_AT,
  };
}

function buildLumpsumVsSipPayload(
  snapshot,
  series,
  comparisonModel,
  totalInvestment,
  horizonYears,
  warnings = [],
) {
  return {
    studyTitle: "Lumpsum vs SIP",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    monthlyPoints: comparisonModel.monthlyPoints,
    cohorts: comparisonModel.cohorts,
    summary: comparisonModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    totalInvestment,
    horizonYears,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    exportedAt: EXPORTED_AT,
  };
}

function buildRelativePayload(assetSnapshot, benchmarkSnapshot, relativeMetrics) {
  return {
    studyTitle: "Risk-Adjusted Relative Performance",
    assetSelection: buildSelection(assetSnapshot),
    assetLabel: assetSnapshot.label,
    assetMethodLabel: `Bundled snapshot using ${assetSnapshot.symbol}`,
    benchmarkSelection: buildSelection(benchmarkSnapshot),
    benchmarkLabel: benchmarkSnapshot.label,
    benchmarkMethodLabel: `Bundled snapshot using ${benchmarkSnapshot.symbol}`,
    comparisonBasis: "local",
    comparisonBasisLabel: "Local currency",
    baseCurrency: null,
    assetCurrencyPath: "INR local",
    benchmarkCurrencyPath: "INR local",
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    overlapStartDate: relativeMetrics.overlapStartDate,
    overlapEndDate: relativeMetrics.overlapEndDate,
    relativeMetrics,
    warnings: [],
    exportedAt: EXPORTED_AT,
  };
}

function extractWorksheetNames(workbookXml) {
  return [...workbookXml.matchAll(/<Worksheet ss:Name="([^"]+)">/g)].map(
    (match) => match[1],
  );
}

function compareRiskMetrics(label, actual, expected) {
  const numericKeys = [
    "totalReturn",
    "annualizedLogReturn",
    "annualizedReturn",
    "annualizedExcessLogReturn",
    "annualizedVolatility",
    "downsideDeviation",
    "maxDrawdown",
    "ulcerIndex",
    "sharpeRatio",
    "sortinoRatio",
    "calmarRatio",
    "martinRatio",
    "averageAnnualRiskFreeRate",
    "averageAnnualLogRiskFreeRate",
    "averagePeriodReturn",
    "medianPeriodReturn",
    "simpleAveragePeriodReturn",
    "simpleMedianPeriodReturn",
    "valueAtRisk95",
    "conditionalValueAtRisk95",
    "skewness",
    "excessKurtosis",
    "winRate",
  ];
  const integerKeys = [
    "periodsPerYear",
    "observations",
    "periodicObservations",
    "positivePeriods",
    "nonPositivePeriods",
    "maxDrawdownDurationDays",
    "maxDrawdownDurationPeriods",
  ];

  for (const key of numericKeys) {
    assertClose(actual[key], expected[key], `${label} ${key}`);
  }

  for (const key of integerKeys) {
    assert(actual[key] === expected[key], `${label} ${key}: expected ${expected[key]}, received ${actual[key]}`);
  }

  assertDateEqual(actual.bestPeriod.startDate, expected.bestPeriod.startDate, `${label} bestPeriod start`);
  assertDateEqual(actual.bestPeriod.endDate, expected.bestPeriod.endDate, `${label} bestPeriod end`);
  assertClose(actual.bestPeriod.value, expected.bestPeriod.value, `${label} bestPeriod value`);
  assertDateEqual(actual.worstPeriod.startDate, expected.worstPeriod.startDate, `${label} worstPeriod start`);
  assertDateEqual(actual.worstPeriod.endDate, expected.worstPeriod.endDate, `${label} worstPeriod end`);
  assertClose(actual.worstPeriod.value, expected.worstPeriod.value, `${label} worstPeriod value`);
  assert(actual.periodicReturnMode === "log", `${label} periodicReturnMode should be log`);
}

function compareRelativeMetrics(label, actual, expected) {
  const keys = [
    "annualizedExcessLogReturn",
    "correlation",
    "beta",
    "trackingError",
    "informationRatio",
    "outperformanceRate",
    "upsideCapture",
    "downsideCapture",
    "relativeWealth",
    "cagrSpread",
    "relativeDrawdown",
  ];

  for (const key of keys) {
    assertClose(actual[key], expected[key], `${label} ${key}`);
  }

  assert(actual.overlapObservations === expected.overlapObservations, `${label} overlapObservations mismatch`);
  assert(actual.overlapReturnObservations === expected.overlapReturnObservations, `${label} overlapReturnObservations mismatch`);
  assert(actual.periodsPerYear === expected.periodsPerYear, `${label} periodsPerYear mismatch`);
  assertDateEqual(actual.overlapStartDate, expected.overlapStartDate, `${label} overlapStartDate`);
  assertDateEqual(actual.overlapEndDate, expected.overlapEndDate, `${label} overlapEndDate`);
  assert(actual.alignedPeriods.length === expected.alignedPeriods.length, `${label} alignedPeriods length mismatch`);
}

async function runRiskRegressionChecks() {
  const datasets = ["nifty-50", "sensex"];
  const windows = [
    { label: "5y", startDate: FIVE_YEAR_START, endDate: FIXED_END },
    { label: "1y", startDate: ONE_YEAR_START, endDate: FIXED_END },
  ];

  for (const datasetId of datasets) {
    const { snapshot, series } = await loadSnapshot(datasetId);

    for (const window of windows) {
      const filteredSeries = filterSeriesByDate(series, window.startDate, window.endDate);
      const actual = computeRiskAdjustedMetrics(filteredSeries, {
        constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
      });
      const expected = computeRiskMetricsIndependent(
        filteredSeries,
        CONSTANT_RISK_FREE_RATE,
      );
      compareRiskMetrics(`${datasetId} ${window.label}`, actual, expected);

      if (datasetId === "nifty-50" && window.label === "5y") {
        const html = renderRiskResults({
          metrics: actual,
          startDate: filteredSeries[0].date,
          endDate: filteredSeries.at(-1).date,
          methodLabel: "Regression snapshot",
          warnings: [],
        });
        assert(
          html.includes("What This Means"),
          "risk result view should include interpretation panel",
        );
      }
    }
  }

  console.log("ok risk metrics");
}

async function runSeasonalityRegressionChecks() {
  const { snapshot, series } = await loadSnapshot("nifty-50");
  const filteredSeries = filterSeriesByDate(series, FIVE_YEAR_START, FIXED_END);
  const modelWithoutPartials = buildSeasonalityStudy(series, {
    startDate: FIVE_YEAR_START,
    endDate: FIXED_END,
    includePartialBoundaryMonths: false,
  });
  const expectedWithoutPartials = buildSeasonalityIndependent(
    filteredSeries,
    FIVE_YEAR_START,
    FIXED_END,
    false,
  );
  const modelWithPartials = buildSeasonalityStudy(series, {
    startDate: FIVE_YEAR_START,
    endDate: FIXED_END,
    includePartialBoundaryMonths: true,
  });
  const expectedWithPartials = buildSeasonalityIndependent(
    filteredSeries,
    FIVE_YEAR_START,
    FIXED_END,
    true,
  );

  assert(
    modelWithoutPartials.monthlyRows.length ===
      expectedWithoutPartials.monthlyRows.length,
    "seasonality monthlyRows length mismatch without partials",
  );
  assert(
    modelWithPartials.monthlyRows.length === expectedWithPartials.monthlyRows.length,
    "seasonality monthlyRows length mismatch with partials",
  );
  assert(
    modelWithPartials.monthlyRows.length - modelWithoutPartials.monthlyRows.length === 1,
    "seasonality partial boundary toggle should add one row for the fixed regression window",
  );
  assert(
    modelWithoutPartials.summary.monthsUsed === modelWithoutPartials.monthlyRows.length,
    "seasonality summary monthsUsed should equal monthlyRows length",
  );
  assert(
    modelWithoutPartials.summary.monthsUsed === expectedWithoutPartials.summary.monthsUsed,
    "seasonality monthsUsed mismatch",
  );
  assert(
    modelWithoutPartials.summary.yearsObserved === expectedWithoutPartials.summary.yearsObserved,
    "seasonality yearsObserved mismatch",
  );
  assert(
    modelWithoutPartials.summary.skippedTransitions ===
      expectedWithoutPartials.skippedTransitions,
    "seasonality skippedTransitions mismatch",
  );
  assert(
    modelWithoutPartials.summary.strongestMonth.monthLabel ===
      expectedWithoutPartials.summary.strongestMonth.monthLabel,
    "seasonality strongestMonth mismatch",
  );
  assert(
    modelWithoutPartials.summary.weakestMonth.monthLabel ===
      expectedWithoutPartials.summary.weakestMonth.monthLabel,
    "seasonality weakestMonth mismatch",
  );
  assert(
    modelWithoutPartials.summary.bestHitRateMonth.monthLabel ===
      expectedWithoutPartials.summary.bestHitRateMonth.monthLabel,
    "seasonality bestHitRateMonth mismatch",
  );
  assert(
    modelWithoutPartials.summary.mostVolatileMonth.monthLabel ===
      expectedWithoutPartials.summary.mostVolatileMonth.monthLabel,
    "seasonality mostVolatileMonth mismatch",
  );
  assertClose(
    modelWithoutPartials.summary.seasonalitySpread,
    expectedWithoutPartials.summary.seasonalitySpread,
    "seasonality spread",
  );

  for (const expectedBucket of expectedWithoutPartials.bucketStats) {
    const actualBucket = modelWithoutPartials.bucketStats.find(
      (bucket) => bucket.monthNumber === expectedBucket.monthNumber,
    );
    assert(actualBucket, `seasonality bucket missing for ${expectedBucket.monthLabel}`);
    assert(
      actualBucket.observations === expectedBucket.observations,
      `seasonality bucket observations mismatch for ${expectedBucket.monthLabel}`,
    );
    assertClose(
      actualBucket.averageLogReturn,
      expectedBucket.averageLogReturn,
      `seasonality bucket averageLogReturn ${expectedBucket.monthLabel}`,
    );
  }

  assert(
    modelWithoutPartials.heatmap.rows.length === modelWithoutPartials.summary.yearsObserved,
    "seasonality heatmap row count should equal yearsObserved",
  );

  const payload = buildSeasonalityPayload(
    snapshot,
    filteredSeries,
    modelWithoutPartials,
  );
  const resultHtml = renderSeasonalityResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "seasonality result view should include interpretation panel",
  );
  const csvRows = buildSeasonalityCsvRows(payload);
  const workbookXml = buildSeasonalityWorkbookXml(payload);
  assert(
    csvRows.length === modelWithoutPartials.monthlyRows.length + 1,
    "seasonality CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") ===
      "Summary|Month Buckets|Year-Month Heatmap|Monthly Rows|Warnings",
    `seasonality worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  console.log("ok seasonality");
}

async function runRelativeRegressionChecks() {
  const { snapshot: assetSnapshot, series: assetSeriesAll } = await loadSnapshot(
    "nifty-50",
  );
  const { snapshot: benchmarkSnapshot, series: benchmarkSeriesAll } =
    await loadSnapshot("sensex");
  const assetSeries = filterSeriesByDate(assetSeriesAll, FIVE_YEAR_START, FIXED_END);
  const benchmarkSeries = filterSeriesByDate(
    benchmarkSeriesAll,
    FIVE_YEAR_START,
    FIXED_END,
  );
  const actual = computeRelativeMetrics(assetSeries, benchmarkSeries, {
    constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
  });
  const expected = computeRelativeMetricsIndependent(
    assetSeries,
    benchmarkSeries,
    CONSTANT_RISK_FREE_RATE,
  );

  compareRelativeMetrics("relative 5y", actual, expected);

  const payload = buildRelativePayload(assetSnapshot, benchmarkSnapshot, actual);
  const resultHtml = renderRelativeResults(payload);
  assert(
    resultHtml.includes("Relative Read"),
    "relative result view should include interpretation panel",
  );
  const csvRows = buildRelativeCsvRows(payload);
  const workbookXml = buildRelativeWorkbookXml(payload);
  assert(
    csvRows.length === actual.alignedPeriods.length + 1,
    "relative CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Metrics|Aligned Periods|Warnings",
    `relative worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  console.log("ok relative");
}

async function runRollingRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const actual = buildRollingReturnsStudy(series);
  const expected = buildRollingStudyIndependent(series);

  assertClose(actual.fullPeriodCagr, expected.fullPeriodCagr, "rolling fullPeriodCagr");
  assertClose(actual.fullPeriodTotalReturn, expected.fullPeriodTotalReturn, "rolling fullPeriodTotalReturn");
  assert(
    actual.availableWindowSummaries.length === expected.availableWindowSummaries.length,
    "rolling availableWindowSummaries length mismatch",
  );
  assert(
    actual.unavailableWindowSummaries.length === expected.unavailableWindowSummaries.length,
    "rolling unavailableWindowSummaries length mismatch",
  );

  for (const expectedSummary of expected.windowSummaries) {
    const actualSummary = actual.windowSummaries.find(
      (windowSummary) => windowSummary.windowYears === expectedSummary.windowYears,
    );
    assert(actualSummary, `rolling summary missing for ${expectedSummary.windowLabel}`);
    assert(
      actualSummary.observations === expectedSummary.observations,
      `rolling observations mismatch for ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.latestCagr,
      expectedSummary.latestCagr,
      `rolling latestCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.medianCagr,
      expectedSummary.medianCagr,
      `rolling medianCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.percentile25Cagr,
      expectedSummary.percentile25Cagr,
      `rolling percentile25Cagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.percentile75Cagr,
      expectedSummary.percentile75Cagr,
      `rolling percentile75Cagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.bestCagr,
      expectedSummary.bestCagr,
      `rolling bestCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.worstCagr,
      expectedSummary.worstCagr,
      `rolling worstCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.positiveRate,
      expectedSummary.positiveRate,
      `rolling positiveRate ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.cagrRange,
      expectedSummary.cagrRange,
      `rolling cagrRange ${expectedSummary.windowLabel}`,
    );
  }

  const payload = {
    studyTitle: "Rolling Returns",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series.at(-1).date,
    warnings: [],
    exportedAt: EXPORTED_AT,
    ...actual,
  };
  const resultHtml = renderRollingReturnsResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "rolling result view should include interpretation panel",
  );
  const csvRows = buildRollingCsvRows(payload);
  const workbookXml = buildRollingWorkbookXml(payload);
  assert(
    csvRows.length ===
      actual.availableWindowSummaries.reduce(
        (sum, windowSummary) => sum + windowSummary.observations,
        0,
      ) + 1,
    "rolling CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Window Stats|Rolling Rows|Warnings",
    `rolling worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  console.log("ok rolling returns");
}

async function runSipRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const monthlyContribution = 10000;
  const actual = buildSipStudy(series, {
    monthlyContribution,
    minContributions: 12,
  });

  assert(
    actual.monthlyPoints.length === 61,
    `sip monthly anchor count mismatch: ${actual.monthlyPoints.length}`,
  );
  assert(
    actual.cohorts.length === 50,
    `sip cohort count mismatch: ${actual.cohorts.length}`,
  );
  assert(
    actual.summary.totalCohorts === actual.cohorts.length,
    "sip total cohort summary mismatch",
  );
  assert(
    actual.summary.fullWindowCohort.contributionCount === actual.monthlyPoints.length,
    "sip full-window contribution count mismatch",
  );
  assertClose(
    actual.summary.fullWindowCohort.totalInvested,
    actual.monthlyPoints.length * monthlyContribution,
    "sip full-window total invested",
  );
  assertClose(
    actual.summary.fullWindowCohort.path.at(-1).portfolioValue,
    actual.summary.fullWindowCohort.terminalValue,
    "sip full-window terminal path value",
  );
  assert(
    actual.cohorts[1].path === undefined &&
      actual.cohorts[1].cashFlows === undefined,
    "sip should trim detailed paths from non-representative cohorts",
  );
  assertDateEqual(
    actual.summary.fullWindowCohort.startDate,
    actual.monthlyPoints[0].date,
    "sip full-window start date",
  );
  assertDateEqual(
    actual.summary.shortestIncludedCohort.startDate,
    actual.monthlyPoints[actual.monthlyPoints.length - 12].date,
    "sip shortest included cohort start date",
  );
  assert(
    actual.summary.bestCohort.xirr >= actual.summary.worstCohort.xirr,
    "sip best cohort should beat worst cohort",
  );
  assert(
    actual.summary.positiveRate >= 0 && actual.summary.positiveRate <= 1,
    "sip positive rate should be bounded",
  );
  assert(
    actual.summary.percentile25Xirr <= actual.summary.percentile75Xirr,
    "sip XIRR percentiles should be ordered",
  );

  const payload = buildSipPayload(
    snapshot,
    series,
    actual,
    monthlyContribution,
  );
  const resultHtml = renderSipSimulatorResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "sip result view should include interpretation panel",
  );
  const csvRows = buildSipCsvRows(payload);
  const workbookXml = buildSipWorkbookXml(payload);
  assert(
    csvRows.length === actual.cohorts.length + 1,
    "sip CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") ===
      "Summary|Cohorts|Full Window Path|Cash Flows|Warnings",
    `sip worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  console.log("ok sip simulator");
}

async function runLumpsumVsSipRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const totalInvestment = 600000;
  const horizonYears = 3;
  const actual = buildLumpsumVsSipStudy(series, {
    totalInvestment,
    horizonYears,
  });

  assert(
    actual.monthlyPoints.length === 61,
    `lumpsum vs sip monthly anchor count mismatch: ${actual.monthlyPoints.length}`,
  );
  assert(
    actual.cohorts.length === 25,
    `lumpsum vs sip cohort count mismatch: ${actual.cohorts.length}`,
  );
  assert(
    actual.summary.totalCohorts === actual.cohorts.length,
    "lumpsum vs sip total cohort summary mismatch",
  );
  assertClose(
    actual.summary.lumpsumWinRate + actual.summary.sipWinRate + actual.summary.tieRate,
    1,
    "lumpsum vs sip win rates should sum to one",
  );
  assert(
    actual.summary.medianAdvantageRate >= actual.summary.percentile25AdvantageRate &&
      actual.summary.medianAdvantageRate <= actual.summary.percentile75AdvantageRate,
    "lumpsum vs sip median advantage should sit inside IQR",
  );

  const firstCohort = actual.summary.firstCohort;
  assertDateEqual(
    firstCohort.startDate,
    actual.monthlyPoints[0].date,
    "lumpsum vs sip first cohort start date",
  );
  assertClose(
    firstCohort.lumpsumTerminalValue,
    (totalInvestment / firstCohort.startIndexValue) * firstCohort.endIndexValue,
    "lumpsum vs sip first cohort terminal value",
  );
  assertClose(
    firstCohort.sipPath.at(-1).portfolioValue,
    firstCohort.sipTerminalValue,
    "lumpsum vs sip first cohort terminal SIP path value",
  );
  assertClose(
    firstCohort.sipPath
      .filter((row) => !row.terminalOnly)
      .reduce((sum, row) => sum + row.contributionAmount, 0),
    totalInvestment,
    "lumpsum vs sip SIP deployed capital should equal total investment",
  );
  assert(
    actual.cohorts[1].sipPath === undefined &&
      actual.cohorts[1].sipCashFlows === undefined,
    "lumpsum vs sip should trim detailed paths from non-representative cohorts",
  );
  assert(
    actual.summary.bestLumpsumAdvantage.advantageRate >=
      actual.summary.bestSipAdvantage.advantageRate,
    "lumpsum vs sip best/worst advantage ordering mismatch",
  );

  const payload = buildLumpsumVsSipPayload(
    snapshot,
    series,
    actual,
    totalInvestment,
    horizonYears,
  );
  const resultHtml = renderLumpsumVsSipResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "lumpsum vs sip result view should include interpretation panel",
  );
  const csvRows = buildLumpsumVsSipCsvRows(payload);
  const workbookXml = buildLumpsumVsSipWorkbookXml(payload);
  assert(
    csvRows.length === actual.cohorts.length + 1,
    "lumpsum vs sip CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") ===
      "Summary|Cohorts|Representative SIP Path|Warnings",
    `lumpsum vs sip worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  console.log("ok lumpsum vs sip");
}

async function runExportRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const metrics = computeRiskAdjustedMetrics(series, {
    constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
  });
  const payload = buildRiskPayload(snapshot, series, metrics);
  const csvRows = buildStudyCsvRows(payload);
  const serializedCsv = serializeCsv(csvRows);
  const workbookXml = buildStudyWorkbookXml(payload);

  assert(
    csvRows.length === series.length + 1,
    "risk-adjusted CSV row count mismatch",
  );
  assert(
    csvRows[0].includes("period_log_return_decimal"),
    "risk-adjusted CSV header should include period_log_return_decimal",
  );
  assert(
    serializedCsv.startsWith("\uFEFFstudy,selection_label"),
    "risk-adjusted serialized CSV should start with a UTF-8 BOM and header row",
  );

  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Metrics|Series|Periods|Warnings",
    `risk-adjusted worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );
  assert(
    workbookXml.includes("Annualized Log Return"),
    "risk-adjusted workbook should include Annualized Log Return",
  );
  assert(
    workbookXml.includes("Period Risk-Free Log Return"),
    "risk-adjusted workbook should include log risk-free columns",
  );

  console.log("ok exports");
}

async function main() {
  testActiveSubjectStore();
  testRunHistoryStore();
  testShareableInputUrls();
  testInterpretationPanels();
  await runRiskRegressionChecks();
  await runSeasonalityRegressionChecks();
  await runRelativeRegressionChecks();
  await runRollingRegressionChecks();
  await runSipRegressionChecks();
  await runLumpsumVsSipRegressionChecks();
  await runExportRegressionChecks();

  console.log(`frontend regression checks passed (${assertionCount} assertions)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
