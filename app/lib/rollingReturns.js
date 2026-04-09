const DEFAULT_ROLLING_WINDOWS_YEARS = [1, 3, 5, 10];

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

function shiftDateByYears(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() - years);
  return nextDate;
}

function computeAnnualizedGrowth(startValue, endValue, elapsedDays) {
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || elapsedDays <= 0) {
    return {
      annualizedLogReturn: null,
      annualizedReturn: null,
      totalReturn: null,
    };
  }

  const totalReturn = endValue / startValue - 1;
  const annualizedLogReturn = Math.log(endValue / startValue) * (365 / elapsedDays);

  return {
    totalReturn,
    annualizedLogReturn,
    annualizedReturn: Math.expm1(annualizedLogReturn),
  };
}

function buildWindowLabel(windowYears) {
  return `${windowYears}Y`;
}

function buildRollingWindowRows(indexSeries, windowYears) {
  if (indexSeries.length < 2) {
    return [];
  }

  const rows = [];
  let startIndex = 0;

  for (let endIndex = 0; endIndex < indexSeries.length; endIndex += 1) {
    const endPoint = indexSeries[endIndex];
    const targetStartDate = shiftDateByYears(endPoint.date, windowYears);

    while (
      startIndex + 1 < endIndex &&
      indexSeries[startIndex + 1].date <= targetStartDate
    ) {
      startIndex += 1;
    }

    const startPoint = indexSeries[startIndex];
    if (!startPoint || startPoint.date > targetStartDate) {
      continue;
    }

    const elapsedDays = (endPoint.date - startPoint.date) / 86400000;
    if (elapsedDays <= 0) {
      continue;
    }

    const growth = computeAnnualizedGrowth(
      startPoint.value,
      endPoint.value,
      elapsedDays,
    );
    rows.push({
      windowYears,
      windowLabel: buildWindowLabel(windowYears),
      startDate: startPoint.date,
      endDate: endPoint.date,
      startValue: startPoint.value,
      endValue: endPoint.value,
      elapsedDays,
      targetStartDate,
      ...growth,
    });
  }

  return rows;
}

function buildWindowSummary(windowYears, windowRows) {
  const annualizedReturns = windowRows.map((row) => row.annualizedReturn);
  const positiveWindows = windowRows.filter(
    (row) => row.annualizedReturn > 0,
  ).length;
  const latestWindow = windowRows[windowRows.length - 1] || null;
  const bestWindow = windowRows.reduce(
    (best, row) =>
      !best || row.annualizedReturn > best.annualizedReturn ? row : best,
    null,
  );
  const worstWindow = windowRows.reduce(
    (worst, row) =>
      !worst || row.annualizedReturn < worst.annualizedReturn ? row : worst,
    null,
  );

  return {
    windowYears,
    windowLabel: buildWindowLabel(windowYears),
    observations: windowRows.length,
    windowRows,
    latestWindow,
    latestCagr: latestWindow?.annualizedReturn ?? null,
    latestTotalReturn: latestWindow?.totalReturn ?? null,
    earliestStartDate: windowRows[0]?.startDate ?? null,
    earliestEndDate: windowRows[0]?.endDate ?? null,
    latestEndDate: latestWindow?.endDate ?? null,
    medianCagr: median(annualizedReturns),
    percentile25Cagr: percentile(annualizedReturns, 0.25),
    percentile75Cagr: percentile(annualizedReturns, 0.75),
    positiveRate:
      windowRows.length > 0 ? positiveWindows / windowRows.length : null,
    bestWindow,
    bestCagr: bestWindow?.annualizedReturn ?? null,
    worstWindow,
    worstCagr: worstWindow?.annualizedReturn ?? null,
    cagrRange:
      bestWindow && worstWindow
        ? bestWindow.annualizedReturn - worstWindow.annualizedReturn
        : null,
    averageCagr: mean(annualizedReturns),
  };
}

function buildStudySummary(windowSummaries, fullPeriodCagr) {
  const availableWindowSummaries = windowSummaries.filter(
    (windowSummary) => windowSummary.observations > 0,
  );

  return {
    fullPeriodCagr,
    availableWindowCount: availableWindowSummaries.length,
    totalRollingObservations: availableWindowSummaries.reduce(
      (sum, windowSummary) => sum + windowSummary.observations,
      0,
    ),
    latestLeader: availableWindowSummaries.reduce(
      (best, windowSummary) =>
        !best || windowSummary.latestCagr > best.latestCagr
          ? windowSummary
          : best,
      null,
    ),
    strongestMedianWindow: availableWindowSummaries.reduce(
      (best, windowSummary) =>
        !best || windowSummary.medianCagr > best.medianCagr
          ? windowSummary
          : best,
      null,
    ),
    highestPositiveRateWindow: availableWindowSummaries.reduce(
      (best, windowSummary) =>
        !best || windowSummary.positiveRate > best.positiveRate
          ? windowSummary
          : best,
      null,
    ),
    widestRangeWindow: availableWindowSummaries.reduce(
      (best, windowSummary) =>
        !best || windowSummary.cagrRange > best.cagrRange
          ? windowSummary
          : best,
      null,
    ),
  };
}

function buildRollingReturnsStudy(
  indexSeries,
  {
    windowYears = DEFAULT_ROLLING_WINDOWS_YEARS,
  } = {},
) {
  if (indexSeries.length < 2) {
    throw new Error("The study needs at least two index observations.");
  }

  const elapsedDays =
    (indexSeries[indexSeries.length - 1].date - indexSeries[0].date) / 86400000;
  if (elapsedDays <= 0) {
    throw new Error("The selected series does not span enough time to study.");
  }

  const fullPeriodGrowth = computeAnnualizedGrowth(
    indexSeries[0].value,
    indexSeries[indexSeries.length - 1].value,
    elapsedDays,
  );

  const windowSummaries = windowYears
    .map((years) =>
      buildWindowSummary(years, buildRollingWindowRows(indexSeries, years)),
    )
    .sort((left, right) => left.windowYears - right.windowYears);

  const availableWindowSummaries = windowSummaries.filter(
    (windowSummary) => windowSummary.observations > 0,
  );
  const unavailableWindowSummaries = windowSummaries.filter(
    (windowSummary) => windowSummary.observations === 0,
  );

  if (!availableWindowSummaries.length) {
    throw new Error(
      "The selected window is too short for any full rolling-return horizon.",
    );
  }

  return {
    fullPeriodCagr: fullPeriodGrowth.annualizedReturn,
    fullPeriodTotalReturn: fullPeriodGrowth.totalReturn,
    windowSummaries,
    availableWindowSummaries,
    unavailableWindowSummaries,
    summary: buildStudySummary(
      windowSummaries,
      fullPeriodGrowth.annualizedReturn,
    ),
  };
}

export {
  DEFAULT_ROLLING_WINDOWS_YEARS,
  buildRollingReturnsStudy,
  buildWindowLabel,
};
