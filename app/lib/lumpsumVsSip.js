import {
  buildMonthlyContributionPoints,
  solveXirr,
} from "./sipSimulator.js";

const DEFAULT_TOTAL_INVESTMENT = 600000;
const DEFAULT_HORIZON_YEARS = 3;
const DEFAULT_HORIZON_OPTIONS = [1, 3, 5];
const END_TOLERANCE_DAYS = 10;

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

function percentile(values, quantile) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const boundedQuantile = Math.min(Math.max(quantile, 0), 1);
  const index = (sorted.length - 1) * boundedQuantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function yearFraction(startDate, endDate) {
  return (endDate - startDate) / 86400000 / 365;
}

function shiftDateForwardByYears(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() + years);
  return nextDate;
}

function computeAnnualizedReturn(startValue, endValue, elapsedDays) {
  if (
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue) ||
    startValue <= 0 ||
    endValue <= 0 ||
    elapsedDays <= 0
  ) {
    return null;
  }

  return Math.expm1(Math.log(endValue / startValue) * (365 / elapsedDays));
}

function findLatestPointOnOrBefore(indexSeries, targetDate) {
  let low = 0;
  let high = indexSeries.length - 1;
  let best = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = indexSeries[middle];

    if (point.date <= targetDate) {
      best = point;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

function buildSipPath(contributionPoints, endPoint, monthlyContribution) {
  let units = 0;
  let totalInvested = 0;

  const path = contributionPoints.map((point) => {
    units += monthlyContribution / point.value;
    totalInvested += monthlyContribution;

    return {
      date: point.date,
      contributionAmount: monthlyContribution,
      contributionPrice: point.value,
      totalInvested,
      portfolioValue: units * point.value,
      unitsHeld: units,
    };
  });

  const terminalValue = units * endPoint.value;
  path.push({
    date: endPoint.date,
    contributionAmount: 0,
    contributionPrice: endPoint.value,
    totalInvested,
    portfolioValue: terminalValue,
    unitsHeld: units,
    terminalOnly: true,
  });

  return {
    path,
    unitsHeld: units,
    totalInvested,
    terminalValue,
  };
}

function buildComparisonCohort({
  indexSeries,
  monthlyPoints,
  startIndex,
  totalInvestment,
  horizonYears,
}) {
  const startPoint = monthlyPoints[startIndex];
  const targetEndDate = shiftDateForwardByYears(startPoint.date, horizonYears);
  const endPoint = findLatestPointOnOrBefore(indexSeries, targetEndDate);

  if (!endPoint || endPoint.date <= startPoint.date) {
    return null;
  }

  const endGapDays = (targetEndDate - endPoint.date) / 86400000;
  if (endGapDays > END_TOLERANCE_DAYS) {
    return null;
  }

  const contributionPoints = monthlyPoints
    .slice(startIndex)
    .filter((point) => point.date < endPoint.date);
  const minimumContributionCount = Math.max(2, horizonYears * 12 - 1);
  if (contributionPoints.length < minimumContributionCount) {
    return null;
  }

  const elapsedDays = (endPoint.date - startPoint.date) / 86400000;
  const monthlyContribution = totalInvestment / contributionPoints.length;
  const lumpsumUnits = totalInvestment / startPoint.value;
  const lumpsumTerminalValue = lumpsumUnits * endPoint.value;
  const sip = buildSipPath(contributionPoints, endPoint, monthlyContribution);
  const sipCashFlows = [
    ...contributionPoints.map((point) => ({
      date: point.date,
      amount: -monthlyContribution,
    })),
    {
      date: endPoint.date,
      amount: sip.terminalValue,
    },
  ];
  const lumpsumReturn = lumpsumTerminalValue / totalInvestment - 1;
  const sipReturn = sip.terminalValue / totalInvestment - 1;
  const advantageAmount = lumpsumTerminalValue - sip.terminalValue;
  const advantageRate = advantageAmount / totalInvestment;
  const winner =
    Math.abs(advantageAmount) < 1e-8
      ? "tie"
      : advantageAmount > 0
        ? "lumpsum"
        : "sip";

  return {
    startDate: startPoint.date,
    startMonthLabel: startPoint.monthLabel,
    startYear: startPoint.year,
    startMonthNumber: startPoint.monthNumber,
    targetEndDate,
    endDate: endPoint.date,
    elapsedDays,
    durationYears: yearFraction(startPoint.date, endPoint.date),
    horizonYears,
    totalInvestment,
    contributionCount: contributionPoints.length,
    monthlyContribution,
    startIndexValue: startPoint.value,
    endIndexValue: endPoint.value,
    lumpsumUnits,
    lumpsumTerminalValue,
    lumpsumReturn,
    lumpsumCagr: computeAnnualizedReturn(
      totalInvestment,
      lumpsumTerminalValue,
      elapsedDays,
    ),
    sipTerminalValue: sip.terminalValue,
    sipReturn,
    sipXirr: solveXirr(sipCashFlows),
    sipUnitsHeld: sip.unitsHeld,
    advantageAmount,
    advantageRate,
    advantageOfSipValue:
      sip.terminalValue > 0 ? advantageAmount / sip.terminalValue : null,
    winner,
    sipPath: sip.path,
    sipCashFlows,
  };
}

function reduceByMetric(items, metricKey, compare) {
  return items.reduce((best, item) => {
    if (!Number.isFinite(item?.[metricKey])) {
      return best;
    }

    if (!best || compare(item[metricKey], best[metricKey])) {
      return item;
    }

    return best;
  }, null);
}

function buildStudySummary(cohorts, monthlyPoints, totalInvestment, horizonYears) {
  const advantageRates = cohorts.map((cohort) => cohort.advantageRate);
  const lumpsumCagrs = cohorts
    .map((cohort) => cohort.lumpsumCagr)
    .filter((value) => Number.isFinite(value));
  const sipXirrs = cohorts
    .map((cohort) => cohort.sipXirr)
    .filter((value) => Number.isFinite(value));
  const lumpsumWins = cohorts.filter((cohort) => cohort.winner === "lumpsum").length;
  const sipWins = cohorts.filter((cohort) => cohort.winner === "sip").length;
  const ties = cohorts.filter((cohort) => cohort.winner === "tie").length;

  return {
    totalInvestment,
    horizonYears,
    totalMonthlyAnchors: monthlyPoints.length,
    totalCohorts: cohorts.length,
    firstStartDate: cohorts[0]?.startDate ?? null,
    lastStartDate: cohorts[cohorts.length - 1]?.startDate ?? null,
    firstCohort: cohorts[0] ?? null,
    lastCohort: cohorts[cohorts.length - 1] ?? null,
    lumpsumWins,
    sipWins,
    ties,
    lumpsumWinRate: cohorts.length > 0 ? lumpsumWins / cohorts.length : null,
    sipWinRate: cohorts.length > 0 ? sipWins / cohorts.length : null,
    tieRate: cohorts.length > 0 ? ties / cohorts.length : null,
    averageAdvantageRate: mean(advantageRates),
    medianAdvantageRate: median(advantageRates),
    percentile25AdvantageRate: percentile(advantageRates, 0.25),
    percentile75AdvantageRate: percentile(advantageRates, 0.75),
    averageLumpsumCagr: mean(lumpsumCagrs),
    medianLumpsumCagr: median(lumpsumCagrs),
    averageSipXirr: mean(sipXirrs),
    medianSipXirr: median(sipXirrs),
    bestLumpsumAdvantage: reduceByMetric(
      cohorts,
      "advantageRate",
      (left, right) => left > right,
    ),
    bestSipAdvantage: reduceByMetric(
      cohorts,
      "advantageRate",
      (left, right) => left < right,
    ),
    biggestTerminalGap: reduceByMetric(
      cohorts,
      "advantageAmount",
      (left, right) => Math.abs(left) > Math.abs(right),
    ),
  };
}

function buildLumpsumVsSipStudy(
  indexSeries,
  {
    totalInvestment = DEFAULT_TOTAL_INVESTMENT,
    horizonYears = DEFAULT_HORIZON_YEARS,
  } = {},
) {
  if (indexSeries.length < 2) {
    throw new Error("The study needs at least two index observations.");
  }

  if (!Number.isFinite(totalInvestment) || totalInvestment <= 0) {
    throw new Error("Total investment must be greater than zero.");
  }

  if (!Number.isFinite(horizonYears) || horizonYears <= 0) {
    throw new Error("Horizon must be greater than zero.");
  }

  const monthlyPoints = buildMonthlyContributionPoints(indexSeries);
  const cohorts = monthlyPoints
    .map((_, startIndex) =>
      buildComparisonCohort({
        indexSeries,
        monthlyPoints,
        startIndex,
        totalInvestment,
        horizonYears,
      }),
    )
    .filter(Boolean);

  if (!cohorts.length) {
    throw new Error(
      "The active window is too short to form any full Lumpsum vs SIP comparison cohort.",
    );
  }

  return {
    monthlyPoints,
    cohorts,
    summary: buildStudySummary(
      cohorts,
      monthlyPoints,
      totalInvestment,
      horizonYears,
    ),
  };
}

export {
  DEFAULT_HORIZON_OPTIONS,
  DEFAULT_HORIZON_YEARS,
  DEFAULT_TOTAL_INVESTMENT,
  buildLumpsumVsSipStudy,
};
