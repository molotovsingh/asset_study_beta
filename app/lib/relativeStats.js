import {
  computeRiskAdjustedMetrics,
  inferPeriodsPerYear,
  toPeriodicReturns,
} from "./stats.js";

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

function buildDateMap(series) {
  return new Map(
    series.map((point) => [point.date.toISOString().slice(0, 10), point]),
  );
}

function alignSeriesByDate(assetSeries, benchmarkSeries) {
  const assetByDate = buildDateMap(assetSeries);
  const benchmarkByDate = buildDateMap(benchmarkSeries);
  const alignedDates = [...assetByDate.keys()]
    .filter((date) => benchmarkByDate.has(date))
    .sort();

  const alignedAssetSeries = alignedDates.map((date) => assetByDate.get(date));
  const alignedBenchmarkSeries = alignedDates.map((date) =>
    benchmarkByDate.get(date),
  );

  return {
    alignedAssetSeries,
    alignedBenchmarkSeries,
  };
}

function buildCaptureRatio(assetPeriods, benchmarkPeriods, direction) {
  const filtered = assetPeriods.filter((period, index) =>
    direction === "up"
      ? benchmarkPeriods[index].logReturn > 0
      : benchmarkPeriods[index].logReturn < 0,
  );

  if (!filtered.length) {
    return null;
  }

  const benchmarkFiltered = benchmarkPeriods.filter((period) =>
    direction === "up" ? period.logReturn > 0 : period.logReturn < 0,
  );
  const assetCumulative = Math.expm1(
    filtered.reduce((sum, period) => sum + period.logReturn, 0),
  );
  const benchmarkCumulative = Math.expm1(
    benchmarkFiltered.reduce((sum, period) => sum + period.logReturn, 0),
  );

  if (!benchmarkCumulative) {
    return null;
  }

  return assetCumulative / benchmarkCumulative;
}

function buildRelativeWealthSeries(alignedAssetSeries, alignedBenchmarkSeries) {
  const assetBase = alignedAssetSeries[0]?.value ?? null;
  const benchmarkBase = alignedBenchmarkSeries[0]?.value ?? null;

  if (!assetBase || !benchmarkBase) {
    return [];
  }

  return alignedAssetSeries.map((point, index) => ({
    date: point.date,
    value:
      (point.value / assetBase) / (alignedBenchmarkSeries[index].value / benchmarkBase) -
      1,
  }));
}

function maxRelativeDrawdown(relativeWealthSeries) {
  if (!relativeWealthSeries.length) {
    return null;
  }

  let peak = 1 + relativeWealthSeries[0].value;
  let maxDrawdown = 0;

  relativeWealthSeries.forEach((point) => {
    const wealth = 1 + point.value;
    peak = Math.max(peak, wealth);
    maxDrawdown = Math.min(maxDrawdown, wealth / peak - 1);
  });

  return maxDrawdown;
}

function computeRelativeMetrics(
  assetSeries,
  benchmarkSeries,
  options = {},
) {
  const { alignedAssetSeries, alignedBenchmarkSeries } = alignSeriesByDate(
    assetSeries,
    benchmarkSeries,
  );

  if (alignedAssetSeries.length < 2) {
    throw new Error(
      "The selected asset and benchmark do not have enough overlapping dates to compare.",
    );
  }

  const periodsPerYear = inferPeriodsPerYear(alignedAssetSeries);
  const assetMetrics = computeRiskAdjustedMetrics(alignedAssetSeries, options);
  const benchmarkMetrics = computeRiskAdjustedMetrics(
    alignedBenchmarkSeries,
    options,
  );
  const assetPeriods = toPeriodicReturns(alignedAssetSeries);
  const benchmarkPeriods = toPeriodicReturns(alignedBenchmarkSeries);
  const assetLogReturns = assetPeriods.map((period) => period.logReturn);
  const benchmarkLogReturns = benchmarkPeriods.map((period) => period.logReturn);
  const excessLogReturns = assetLogReturns.map(
    (value, index) => value - benchmarkLogReturns[index],
  );
  const covariance = sampleCovariance(assetLogReturns, benchmarkLogReturns);
  const benchmarkVariance =
    sampleStdDev(benchmarkLogReturns) !== null
      ? sampleStdDev(benchmarkLogReturns) ** 2
      : null;
  const correlation =
    covariance !== null &&
    sampleStdDev(assetLogReturns) &&
    sampleStdDev(benchmarkLogReturns)
      ? covariance /
        (sampleStdDev(assetLogReturns) * sampleStdDev(benchmarkLogReturns))
      : null;
  const beta =
    covariance !== null && benchmarkVariance
      ? covariance / benchmarkVariance
      : null;
  const trackingError =
    (sampleStdDev(excessLogReturns) ?? 0) * Math.sqrt(periodsPerYear);
  const annualizedExcessLogReturn =
    (mean(excessLogReturns) ?? 0) * periodsPerYear;
  const informationRatio =
    trackingError > 0 ? annualizedExcessLogReturn / trackingError : null;
  const outperformanceRate =
    assetPeriods.length > 0
      ? assetPeriods.filter(
          (period, index) => period.logReturn > benchmarkPeriods[index].logReturn,
        ).length / assetPeriods.length
      : null;
  const upsideCapture = buildCaptureRatio(assetPeriods, benchmarkPeriods, "up");
  const downsideCapture = buildCaptureRatio(
    assetPeriods,
    benchmarkPeriods,
    "down",
  );
  const relativeWealthSeries = buildRelativeWealthSeries(
    alignedAssetSeries,
    alignedBenchmarkSeries,
  );

  return {
    alignedAssetSeries,
    alignedBenchmarkSeries,
    relativeWealthSeries,
    periodsPerYear,
    overlapObservations: alignedAssetSeries.length,
    overlapReturnObservations: assetPeriods.length,
    overlapStartDate: alignedAssetSeries[0].date,
    overlapEndDate: alignedAssetSeries[alignedAssetSeries.length - 1].date,
    assetMetrics,
    benchmarkMetrics,
    annualizedExcessLogReturn,
    correlation,
    beta,
    trackingError,
    informationRatio,
    outperformanceRate,
    upsideCapture,
    downsideCapture,
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
      excessLogReturn: excessLogReturns[index],
      excessSimpleReturn:
        assetPeriod.simpleReturn - benchmarkPeriods[index].simpleReturn,
    })),
  };
}

export { alignSeriesByDate, computeRelativeMetrics };
