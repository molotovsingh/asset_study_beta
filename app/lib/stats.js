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

function ulcerIndex(series) {
  if (!series.length) {
    return null;
  }

  let peak = series[0].value;
  const squaredDrawdowns = [];

  for (const point of series) {
    if (point.value > peak) {
      peak = point.value;
    }

    const drawdown = Math.min(point.value / peak - 1, 0);
    squaredDrawdowns.push(drawdown ** 2);
  }

  return Math.sqrt(mean(squaredDrawdowns) ?? 0);
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
      if (currentDrawdownStartDate !== null && currentDrawdownStartIndex !== null) {
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

    if (currentDrawdownStartDate === null || currentDrawdownStartIndex === null) {
      currentDrawdownStartDate = peakDate;
      currentDrawdownStartIndex = peakIndex;
    }
  }

  if (currentDrawdownStartDate !== null && currentDrawdownStartIndex !== null) {
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

function toPeriodicReturns(series) {
  const returns = [];

  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const simpleReturn = current.value / previous.value - 1;
    returns.push({
      startDate: previous.date,
      endDate: current.date,
      days: (current.date - previous.date) / 86400000,
      value: simpleReturn,
      simpleReturn,
      logReturn: Math.log1p(simpleReturn),
    });
  }

  return returns;
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

function sampleSkewness(values) {
  if (values.length < 3) {
    return null;
  }

  const avg = mean(values);
  const stdDev = sampleStdDev(values);
  if (avg === null || !stdDev) {
    return null;
  }

  const n = values.length;
  const sum = values.reduce(
    (total, value) => total + ((value - avg) / stdDev) ** 3,
    0,
  );

  return (n / ((n - 1) * (n - 2))) * sum;
}

function sampleExcessKurtosis(values) {
  if (values.length < 4) {
    return null;
  }

  const avg = mean(values);
  const stdDev = sampleStdDev(values);
  if (avg === null || !stdDev) {
    return null;
  }

  const n = values.length;
  const sum = values.reduce(
    (total, value) => total + ((value - avg) / stdDev) ** 4,
    0,
  );

  return (
    (n * (n + 1) * sum) / ((n - 1) * (n - 2) * (n - 3)) -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  );
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

function annualRateToPeriodLogReturn(annualRate, days) {
  return Math.log1p(annualRate) * (days / 365);
}

function filterSeriesByDate(series, startDate, endDate) {
  return series.filter(
    (point) => point.date >= startDate && point.date <= endDate,
  );
}

function buildRiskFreeContext(periodicReturns, options = {}) {
  const annualRiskFreeRates = periodicReturns.map((period) =>
    getAnnualRiskFreeRate(
      period,
      options.riskFreeSeries,
      options.constantRiskFreeRate,
    ),
  );
  const averageAnnualRiskFreeRate = mean(annualRiskFreeRates) ?? 0;
  const averageAnnualLogRiskFreeRate =
    mean(annualRiskFreeRates.map((rate) => Math.log1p(rate))) ?? 0;
  const periodRiskFreeLogReturns = periodicReturns.map((period, index) =>
    annualRateToPeriodLogReturn(annualRiskFreeRates[index], period.days),
  );
  const excessLogReturns = periodicReturns.map(
    (period, index) => period.logReturn - periodRiskFreeLogReturns[index],
  );

  return {
    annualRiskFreeRates,
    averageAnnualRiskFreeRate,
    averageAnnualLogRiskFreeRate,
    periodRiskFreeLogReturns,
    excessLogReturns,
  };
}

function buildReturnMetrics(
  indexSeries,
  excessLogReturns,
  periodsPerYear,
  annualizedVolatility,
  averageAnnualRiskFreeRate,
) {
  const startValue = indexSeries[0].value;
  const endValue = indexSeries[indexSeries.length - 1].value;
  const totalReturn = endValue / startValue - 1;
  const elapsedDays =
    (indexSeries[indexSeries.length - 1].date - indexSeries[0].date) / 86400000;
  const annualizedLogReturn = Math.log(endValue / startValue) * (365 / elapsedDays);
  const annualizedReturn = Math.expm1(annualizedLogReturn);
  const annualizedExcessLogReturn =
    (mean(excessLogReturns) ?? 0) * periodsPerYear;
  const downsideDeviation =
    Math.sqrt(
      mean(excessLogReturns.map((value) => Math.min(value, 0) ** 2)) ?? 0,
    ) * Math.sqrt(periodsPerYear);
  const sharpeRatio =
    annualizedVolatility > 0
      ? annualizedExcessLogReturn / annualizedVolatility
      : null;
  const sortinoRatio =
    downsideDeviation > 0
      ? annualizedExcessLogReturn / downsideDeviation
      : null;
  const maxDrawdownValue = maxDrawdown(indexSeries);
  const calmarRatio =
    maxDrawdownValue < 0
      ? annualizedReturn / Math.abs(maxDrawdownValue)
      : null;
  const ulcerIndexValue = ulcerIndex(indexSeries);
  const martinRatio =
    ulcerIndexValue && ulcerIndexValue > 0
      ? (annualizedReturn - averageAnnualRiskFreeRate) / ulcerIndexValue
      : null;

  return {
    annualizedExcessLogReturn,
    annualizedLogReturn,
    annualizedReturn,
    downsideDeviation,
    sharpeRatio,
    sortinoRatio,
    totalReturn,
    maxDrawdown: maxDrawdownValue,
    calmarRatio,
    ulcerIndex: ulcerIndexValue,
    martinRatio,
  };
}

function buildDistributionMetrics(
  periodicReturns,
  logPeriodReturnValues,
  simplePeriodReturnValues,
) {
  const positivePeriods = periodicReturns.filter(
    (period) => period.logReturn > 0,
  ).length;
  const nonPositivePeriods = periodicReturns.length - positivePeriods;
  const winRate =
    periodicReturns.length > 0
      ? positivePeriods / periodicReturns.length
      : null;

  return {
    averagePeriodReturn: mean(logPeriodReturnValues),
    medianPeriodReturn: median(logPeriodReturnValues),
    simpleAveragePeriodReturn: mean(simplePeriodReturnValues),
    simpleMedianPeriodReturn: median(simplePeriodReturnValues),
    positivePeriods,
    nonPositivePeriods,
    winRate,
  };
}

function buildTailMetrics(logPeriodReturnValues) {
  const valueAtRisk95 = percentile(logPeriodReturnValues, 0.05);
  const cvarSample = logPeriodReturnValues.filter(
    (value) => valueAtRisk95 !== null && value <= valueAtRisk95,
  );

  return {
    valueAtRisk95,
    conditionalValueAtRisk95: mean(cvarSample),
    skewness: sampleSkewness(logPeriodReturnValues),
    excessKurtosis: sampleExcessKurtosis(logPeriodReturnValues),
  };
}

function buildPeriodExtremes(periodicReturns) {
  const rankedReturns = [...periodicReturns].sort(
    (left, right) => left.logReturn - right.logReturn,
  );
  const worstPeriod = rankedReturns[0] || null;
  const bestPeriod = rankedReturns[rankedReturns.length - 1] || null;

  return {
    bestPeriod: bestPeriod
      ? {
          ...bestPeriod,
          value: bestPeriod.simpleReturn,
        }
      : null,
    worstPeriod: worstPeriod
      ? {
          ...worstPeriod,
          value: worstPeriod.simpleReturn,
        }
      : null,
  };
}

function computeRiskAdjustedMetrics(indexSeries, options = {}) {
  const periodicReturns = toPeriodicReturns(indexSeries);
  if (!periodicReturns.length) {
    throw new Error("The study needs at least two index observations.");
  }
  const simplePeriodReturnValues = periodicReturns.map(
    (point) => point.simpleReturn,
  );
  const logPeriodReturnValues = periodicReturns.map((point) => point.logReturn);

  const periodsPerYear = inferPeriodsPerYear(indexSeries);
  const annualizedVolatility =
    (sampleStdDev(logPeriodReturnValues) ?? 0) *
    Math.sqrt(periodsPerYear);

  const {
    averageAnnualRiskFreeRate,
    averageAnnualLogRiskFreeRate,
    excessLogReturns,
  } = buildRiskFreeContext(periodicReturns, options);
  const returnMetrics = buildReturnMetrics(
    indexSeries,
    excessLogReturns,
    periodsPerYear,
    annualizedVolatility,
    averageAnnualRiskFreeRate,
  );
  const distributionMetrics = buildDistributionMetrics(
    periodicReturns,
    logPeriodReturnValues,
    simplePeriodReturnValues,
  );
  const tailMetrics = buildTailMetrics(logPeriodReturnValues);
  const {
    maxDrawdownDurationDays,
    maxDrawdownDurationPeriods,
  } = getDrawdownDurationStats(indexSeries);
  const periodExtremes = buildPeriodExtremes(periodicReturns);

  return {
    ...returnMetrics,
    ...distributionMetrics,
    ...tailMetrics,
    ...periodExtremes,
    annualizedVolatility,
    averageAnnualLogRiskFreeRate,
    averageAnnualRiskFreeRate,
    maxDrawdownDurationDays,
    maxDrawdownDurationPeriods,
    periodicReturnMode: "log",
    periodsPerYear,
    observations: indexSeries.length,
    periodicObservations: periodicReturns.length,
  };
}

export {
  computeRiskAdjustedMetrics,
  filterSeriesByDate,
  inferPeriodsPerYear,
  mean,
  sampleStdDev,
  toPeriodicReturns,
};
