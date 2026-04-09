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

function buildMonthId(year, monthNumber) {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function getMonthLabel(monthNumber) {
  return MONTH_LABELS[monthNumber - 1] || `M${monthNumber}`;
}

function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}

function endOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function buildMonthAnchors(indexSeries) {
  if (!indexSeries.length) {
    return [];
  }

  const anchors = [];
  let activeMonthId = null;
  let activeAnchor = null;

  for (const point of indexSeries) {
    const year = point.date.getFullYear();
    const monthIndex = point.date.getMonth();
    const monthNumber = monthIndex + 1;
    const monthId = buildMonthId(year, monthNumber);

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
        monthLabel: getMonthLabel(monthNumber),
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

function shouldIncludeMonthlyRow(
  row,
  startDate,
  endDate,
  includePartialBoundaryMonths,
) {
  if (includePartialBoundaryMonths) {
    return row.endDate >= startDate && row.endDate <= endDate;
  }

  return startDate <= row.monthStart && endDate >= row.monthEnd;
}

function buildMonthlyRows(
  indexSeries,
  { startDate, endDate, includePartialBoundaryMonths = false } = {},
) {
  const anchors = buildMonthAnchors(indexSeries);
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
      monthIndex: current.monthIndex,
      monthNumber: current.monthNumber,
      monthLabel: current.monthLabel,
      monthId: current.monthId,
      monthStart,
      monthEnd,
      startDate: previous.date,
      endDate: current.date,
      startValue: previous.value,
      endValue: current.value,
      simpleReturn,
      logReturn,
      isPositive: logReturn > 0,
      isBoundaryPartial:
        startDate > monthStart || endDate < monthEnd,
    };

    if (
      shouldIncludeMonthlyRow(
        row,
        startDate,
        endDate,
        includePartialBoundaryMonths,
      )
    ) {
      monthlyRows.push(row);
    }
  }

  return {
    anchors,
    monthlyRows,
    skippedTransitions,
  };
}

function buildBucketStats(monthlyRows) {
  return MONTH_LABELS.map((monthLabel, monthIndex) => {
    const monthNumber = monthIndex + 1;
    const rows = monthlyRows.filter((row) => row.monthNumber === monthNumber);
    const logReturns = rows.map((row) => row.logReturn);
    const simpleReturns = rows.map((row) => row.simpleReturn);
    const bestRow =
      rows.length > 0
        ? rows.reduce((best, row) => (row.logReturn > best.logReturn ? row : best))
        : null;
    const worstRow =
      rows.length > 0
        ? rows.reduce((worst, row) =>
            row.logReturn < worst.logReturn ? row : worst,
          )
        : null;
    const positiveObservations = rows.filter((row) => row.isPositive).length;

    return {
      monthIndex,
      monthNumber,
      monthLabel,
      observations: rows.length,
      winRate:
        rows.length > 0 ? positiveObservations / rows.length : null,
      positiveYearsPct:
        rows.length > 0 ? positiveObservations / rows.length : null,
      positiveObservations,
      averageLogReturn: mean(logReturns),
      medianLogReturn: median(logReturns),
      averageSimpleReturn: mean(simpleReturns),
      medianSimpleReturn: median(simpleReturns),
      volatility: sampleStdDev(logReturns),
      bestLogReturn: bestRow?.logReturn ?? null,
      worstLogReturn: worstRow?.logReturn ?? null,
      bestSimpleReturn: bestRow?.simpleReturn ?? null,
      worstSimpleReturn: worstRow?.simpleReturn ?? null,
      bestYear: bestRow?.year ?? null,
      worstYear: worstRow?.year ?? null,
      rows,
    };
  });
}

function pickBucket(bucketStats, selector, direction = "max") {
  const populated = bucketStats.filter(
    (bucket) => bucket.observations > 0 && Number.isFinite(selector(bucket)),
  );

  if (!populated.length) {
    return null;
  }

  return populated.reduce((currentBest, bucket) => {
    if (!currentBest) {
      return bucket;
    }

    const currentValue = selector(currentBest);
    const nextValue = selector(bucket);
    const shouldReplace =
      direction === "min" ? nextValue < currentValue : nextValue > currentValue;

    return shouldReplace ? bucket : currentBest;
  }, null);
}

function buildHeatmap(monthlyRows) {
  const years = [...new Set(monthlyRows.map((row) => row.year))].sort(
    (left, right) => left - right,
  );
  const byMonthId = new Map(monthlyRows.map((row) => [row.monthId, row]));
  const values = monthlyRows.map((row) => row.logReturn);
  const maxAbsValue = values.length
    ? Math.max(...values.map((value) => Math.abs(value)))
    : 0;

  return {
    years,
    maxAbsValue,
    rows: years.map((year) => ({
      year,
      cells: MONTH_LABELS.map((monthLabel, monthIndex) => {
        const monthNumber = monthIndex + 1;
        const monthId = buildMonthId(year, monthNumber);
        const row = byMonthId.get(monthId) || null;

        return {
          year,
          monthIndex,
          monthNumber,
          monthLabel,
          monthId,
          row,
          value: row?.logReturn ?? null,
          simpleReturn: row?.simpleReturn ?? null,
        };
      }),
    })),
  };
}

function buildSeasonalitySummary(bucketStats, monthlyRows, skippedTransitions) {
  const strongestMonth = pickBucket(
    bucketStats,
    (bucket) => bucket.averageLogReturn,
    "max",
  );
  const weakestMonth = pickBucket(
    bucketStats,
    (bucket) => bucket.averageLogReturn,
    "min",
  );
  const bestHitRateMonth = pickBucket(bucketStats, (bucket) => bucket.winRate, "max");
  const mostVolatileMonth = pickBucket(
    bucketStats,
    (bucket) => bucket.volatility,
    "max",
  );

  return {
    strongestMonth,
    weakestMonth,
    bestHitRateMonth,
    mostVolatileMonth,
    seasonalitySpread:
      strongestMonth && weakestMonth
        ? strongestMonth.averageLogReturn - weakestMonth.averageLogReturn
        : null,
    monthsUsed: monthlyRows.length,
    yearsObserved: new Set(monthlyRows.map((row) => row.year)).size,
    skippedTransitions,
  };
}

function buildSeasonalityStudy(indexSeries, options = {}) {
  const startDate = options.startDate || indexSeries[0]?.date;
  const endDate = options.endDate || indexSeries[indexSeries.length - 1]?.date;
  const includePartialBoundaryMonths =
    options.includePartialBoundaryMonths || false;

  if (!startDate || !endDate || indexSeries.length < 2) {
    throw new Error("The study needs at least two index observations.");
  }

  const { anchors, monthlyRows, skippedTransitions } = buildMonthlyRows(
    indexSeries,
    {
      startDate,
      endDate,
      includePartialBoundaryMonths,
    },
  );

  if (!monthlyRows.length) {
    throw new Error(
      "The selected window did not produce any monthly seasonality observations.",
    );
  }

  const bucketStats = buildBucketStats(monthlyRows);
  const summary = buildSeasonalitySummary(
    bucketStats,
    monthlyRows,
    skippedTransitions,
  );
  const heatmap = buildHeatmap(monthlyRows);

  return {
    anchors,
    monthlyRows,
    bucketStats,
    heatmap,
    summary,
    monthlyReturnMode: "log",
    includePartialBoundaryMonths,
  };
}

export {
  MONTH_LABELS,
  buildSeasonalityStudy,
  getMonthLabel,
};
