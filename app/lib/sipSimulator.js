const DEFAULT_MONTHLY_CONTRIBUTION = 10000;
const DEFAULT_MIN_CONTRIBUTIONS = 12;

const START_MONTH_LABELS = [
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

function formatStartMonthLabel(date) {
  return `${START_MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
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

function buildMonthlyContributionPoints(indexSeries) {
  const monthlyPoints = [];
  let previousKey = null;

  for (const point of indexSeries) {
    const key = `${point.date.getFullYear()}-${point.date.getMonth()}`;
    if (key === previousKey) {
      continue;
    }

    monthlyPoints.push({
      year: point.date.getFullYear(),
      monthNumber: point.date.getMonth() + 1,
      monthLabel: formatStartMonthLabel(point.date),
      date: point.date,
      value: point.value,
    });
    previousKey = key;
  }

  return monthlyPoints;
}

function computeXnpv(rate, cashFlows) {
  if (rate <= -1) {
    return Number.NaN;
  }

  const anchorDate = cashFlows[0]?.date;
  if (!anchorDate) {
    return Number.NaN;
  }

  return cashFlows.reduce((sum, cashFlow) => {
    const years = yearFraction(anchorDate, cashFlow.date);
    return sum + cashFlow.amount / (1 + rate) ** years;
  }, 0);
}

function solveRateByBisection(cashFlows, lower, upper) {
  let low = lower;
  let high = upper;
  let lowValue = computeXnpv(low, cashFlows);
  let highValue = computeXnpv(high, cashFlows);

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (low + high) / 2;
    const midpointValue = computeXnpv(midpoint, cashFlows);

    if (!Number.isFinite(midpointValue)) {
      return null;
    }

    if (Math.abs(midpointValue) < 1e-9) {
      return midpoint;
    }

    if (lowValue * midpointValue <= 0) {
      high = midpoint;
      highValue = midpointValue;
    } else {
      low = midpoint;
      lowValue = midpointValue;
    }

    if (Math.abs(high - low) < 1e-10 || Math.abs(highValue - lowValue) < 1e-12) {
      return (low + high) / 2;
    }
  }

  return (low + high) / 2;
}

function solveXirr(cashFlows) {
  if (cashFlows.length < 2) {
    return null;
  }

  const hasNegative = cashFlows.some((cashFlow) => cashFlow.amount < 0);
  const hasPositive = cashFlows.some((cashFlow) => cashFlow.amount > 0);
  if (!hasNegative || !hasPositive) {
    return null;
  }

  const candidateRates = [
    -0.999,
    -0.99,
    -0.95,
    -0.9,
    -0.8,
    -0.7,
    -0.6,
    -0.5,
    -0.4,
    -0.3,
    -0.2,
    -0.1,
    0,
    0.05,
    0.1,
    0.15,
    0.2,
    0.3,
    0.5,
    0.75,
    1,
    1.5,
    2,
    3,
    5,
    10,
  ];

  let previousRate = candidateRates[0];
  let previousValue = computeXnpv(previousRate, cashFlows);
  if (Math.abs(previousValue) < 1e-9) {
    return previousRate;
  }

  for (let index = 1; index < candidateRates.length; index += 1) {
    const currentRate = candidateRates[index];
    const currentValue = computeXnpv(currentRate, cashFlows);

    if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) {
      previousRate = currentRate;
      previousValue = currentValue;
      continue;
    }

    if (Math.abs(currentValue) < 1e-9) {
      return currentRate;
    }

    if (previousValue * currentValue < 0) {
      return solveRateByBisection(cashFlows, previousRate, currentRate);
    }

    previousRate = currentRate;
    previousValue = currentValue;
  }

  return null;
}

function buildSipCohort(
  monthlyPoints,
  startIndex,
  endPoint,
  monthlyContribution,
  minContributions,
) {
  const contributionPoints = monthlyPoints.slice(startIndex);
  if (contributionPoints.length < minContributions) {
    return null;
  }

  let units = 0;
  let totalInvested = 0;
  const path = [];

  for (const point of contributionPoints) {
    units += monthlyContribution / point.value;
    totalInvested += monthlyContribution;

    path.push({
      date: point.date,
      contributionAmount: monthlyContribution,
      contributionPrice: point.value,
      totalInvested,
      portfolioValue: units * point.value,
      unitsHeld: units,
    });
  }

  const terminalValue = units * endPoint.value;
  if (path.length && path[path.length - 1].date.getTime() !== endPoint.date.getTime()) {
    path.push({
      date: endPoint.date,
      contributionAmount: 0,
      contributionPrice: endPoint.value,
      totalInvested,
      portfolioValue: terminalValue,
      unitsHeld: units,
      terminalOnly: true,
    });
  }

  const cashFlows = [
    ...contributionPoints.map((point) => ({
      date: point.date,
      amount: -monthlyContribution,
    })),
    {
      date: endPoint.date,
      amount: terminalValue,
    },
  ];
  const xirr = solveXirr(cashFlows);
  const startPoint = contributionPoints[0];

  return {
    startDate: startPoint.date,
    startMonthLabel: startPoint.monthLabel,
    startYear: startPoint.year,
    startMonthNumber: startPoint.monthNumber,
    endDate: endPoint.date,
    contributionCount: contributionPoints.length,
    monthlyContribution,
    totalInvested,
    terminalValue,
    gain: terminalValue - totalInvested,
    wealthMultiple:
      totalInvested > 0 ? terminalValue / totalInvested : null,
    xirr,
    durationYears: yearFraction(startPoint.date, endPoint.date),
    unitsHeld: units,
    finalIndexValue: endPoint.value,
    path,
    cashFlows,
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

function buildSipStudySummary(cohorts, monthlyPoints, monthlyContribution, minContributions) {
  const xirrValues = cohorts
    .map((cohort) => cohort.xirr)
    .filter((value) => Number.isFinite(value));

  return {
    monthlyContribution,
    minContributions,
    totalMonthlyAnchors: monthlyPoints.length,
    totalCohorts: cohorts.length,
    firstContributionDate: monthlyPoints[0]?.date ?? null,
    lastContributionDate: monthlyPoints[monthlyPoints.length - 1]?.date ?? null,
    fullWindowCohort: cohorts[0] ?? null,
    shortestIncludedCohort: cohorts[cohorts.length - 1] ?? null,
    averageXirr: mean(xirrValues),
    medianXirr: median(xirrValues),
    percentile25Xirr: percentile(xirrValues, 0.25),
    percentile75Xirr: percentile(xirrValues, 0.75),
    positiveRate:
      cohorts.length > 0
        ? cohorts.filter((cohort) => cohort.xirr > 0).length / cohorts.length
        : null,
    bestCohort: reduceByMetric(cohorts, "xirr", (left, right) => left > right),
    worstCohort: reduceByMetric(cohorts, "xirr", (left, right) => left < right),
    highestTerminalValueCohort: reduceByMetric(
      cohorts,
      "terminalValue",
      (left, right) => left > right,
    ),
    highestWealthMultipleCohort: reduceByMetric(
      cohorts,
      "wealthMultiple",
      (left, right) => left > right,
    ),
  };
}

function buildSipStudy(
  indexSeries,
  {
    monthlyContribution = DEFAULT_MONTHLY_CONTRIBUTION,
    minContributions = DEFAULT_MIN_CONTRIBUTIONS,
  } = {},
) {
  if (indexSeries.length < 2) {
    throw new Error("The study needs at least two index observations.");
  }

  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) {
    throw new Error("Monthly contribution must be greater than zero.");
  }

  if (!Number.isInteger(minContributions) || minContributions < 2) {
    throw new Error("Minimum contributions must be an integer above one.");
  }

  const monthlyPoints = buildMonthlyContributionPoints(indexSeries);
  if (monthlyPoints.length < minContributions) {
    throw new Error(
      `The active window needs at least ${minContributions} monthly anchors for a stable SIP read.`,
    );
  }

  const endPoint = indexSeries[indexSeries.length - 1];
  const cohorts = monthlyPoints
    .map((_, startIndex) =>
      buildSipCohort(
        monthlyPoints,
        startIndex,
        endPoint,
        monthlyContribution,
        minContributions,
      ),
    )
    .filter(Boolean);

  if (!cohorts.length) {
    throw new Error(
      "The active window is too short to form any SIP cohort with the current minimum contribution count.",
    );
  }

  return {
    monthlyPoints,
    cohorts,
    summary: buildSipStudySummary(
      cohorts,
      monthlyPoints,
      monthlyContribution,
      minContributions,
    ),
  };
}

export {
  DEFAULT_MIN_CONTRIBUTIONS,
  DEFAULT_MONTHLY_CONTRIBUTION,
  buildMonthlyContributionPoints,
  buildSipStudy,
  solveXirr,
};
