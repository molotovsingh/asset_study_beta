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
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median > 270) {
    return 1;
  }
  if (median > 80) {
    return 4;
  }
  if (median > 25) {
    return 12;
  }
  if (median > 5) {
    return 52;
  }
  return 252;
}

function mean(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values) {
  if (values.length < 2) {
    return null;
  }

  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdown(series) {
  let peak = series[0].value;
  let maxDepth = 0;

  for (const point of series) {
    if (point.value > peak) {
      peak = point.value;
    }

    const drawdown = point.value / peak - 1;
    if (drawdown < maxDepth) {
      maxDepth = drawdown;
    }
  }

  return maxDepth;
}

function toPeriodicReturns(series) {
  const returns = [];

  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    returns.push({
      startDate: previous.date,
      endDate: current.date,
      days: (current.date - previous.date) / 86400000,
      value: current.value / previous.value - 1,
    });
  }

  return returns;
}

function getAnnualRiskFreeRate(period, riskFreeSeries, fallbackRate) {
  if (!riskFreeSeries?.length) {
    return fallbackRate ?? 0;
  }

  let chosen = null;
  for (const point of riskFreeSeries) {
    if (point.date <= period.endDate) {
      chosen = point;
    } else {
      break;
    }
  }

  if (!chosen) {
    chosen = riskFreeSeries[0];
  }

  return chosen.value / 100;
}

function annualRateToPeriodReturn(annualRate, days) {
  return (1 + annualRate) ** (days / 365) - 1;
}

function filterSeriesByDate(series, startDate, endDate) {
  return series.filter(
    (point) => point.date >= startDate && point.date <= endDate,
  );
}

function computeRiskAdjustedMetrics(indexSeries, options = {}) {
  const periodicReturns = toPeriodicReturns(indexSeries);
  if (!periodicReturns.length) {
    throw new Error("The study needs at least two index observations.");
  }

  const periodsPerYear = inferPeriodsPerYear(indexSeries);
  const annualizedVolatility =
    (sampleStdDev(periodicReturns.map((point) => point.value)) ?? 0) *
    Math.sqrt(periodsPerYear);

  const annualRiskFreeRates = periodicReturns.map((period) =>
    getAnnualRiskFreeRate(period, options.riskFreeSeries, options.constantRiskFreeRate),
  );
  const periodRiskFreeReturns = periodicReturns.map((period, index) =>
    annualRateToPeriodReturn(annualRiskFreeRates[index], period.days),
  );
  const excessReturns = periodicReturns.map(
    (period, index) => period.value - periodRiskFreeReturns[index],
  );
  const downsideDeviation =
    Math.sqrt(
      mean(excessReturns.map((value) => Math.min(value, 0) ** 2)) ?? 0,
    ) * Math.sqrt(periodsPerYear);

  const startValue = indexSeries[0].value;
  const endValue = indexSeries[indexSeries.length - 1].value;
  const totalReturn = endValue / startValue - 1;
  const elapsedDays =
    (indexSeries[indexSeries.length - 1].date - indexSeries[0].date) / 86400000;
  const annualizedReturn = (1 + totalReturn) ** (365 / elapsedDays) - 1;
  const averageAnnualRiskFreeRate = mean(annualRiskFreeRates) ?? 0;
  const sharpeRatio =
    annualizedVolatility > 0
      ? (annualizedReturn - averageAnnualRiskFreeRate) / annualizedVolatility
      : null;
  const sortinoRatio =
    downsideDeviation > 0
      ? (annualizedReturn - averageAnnualRiskFreeRate) / downsideDeviation
      : null;

  const rankedReturns = [...periodicReturns].sort((left, right) => left.value - right.value);
  const worstPeriod = rankedReturns[0] || null;
  const bestPeriod = rankedReturns[rankedReturns.length - 1] || null;

  return {
    annualizedReturn,
    annualizedVolatility,
    averageAnnualRiskFreeRate,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDrawdown(indexSeries),
    totalReturn,
    periodsPerYear,
    observations: indexSeries.length,
    periodicObservations: periodicReturns.length,
    bestPeriod,
    worstPeriod,
  };
}

export { filterSeriesByDate, computeRiskAdjustedMetrics };
