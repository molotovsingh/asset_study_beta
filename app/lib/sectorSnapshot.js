import { computeRelativeMetrics } from "./relativeStats.js";
import { computeRiskAdjustedMetrics, filterSeriesByDate } from "./stats.js";

const SECTOR_FOCUS_METRIC_DEFINITIONS = [
  {
    key: "annualizedReturn",
    label: "CAGR",
    styleId: "percent",
    category: "absolute",
    better: "higher",
  },
  {
    key: "sharpeRatio",
    label: "Sharpe",
    styleId: "number2",
    category: "absolute",
    better: "higher",
  },
  {
    key: "calmarRatio",
    label: "Calmar",
    styleId: "number2",
    category: "absolute",
    better: "higher",
  },
  {
    key: "annualizedVolatility",
    label: "Volatility",
    styleId: "percent",
    category: "absolute",
    better: "lower",
  },
  {
    key: "maxDrawdown",
    label: "Max Drawdown",
    styleId: "percent",
    category: "absolute",
    better: "higher",
  },
  {
    key: "relativeWealth",
    label: "Relative Wealth",
    styleId: "percent",
    category: "relative",
    better: "higher",
  },
  {
    key: "cagrSpread",
    label: "CAGR Spread",
    styleId: "percent",
    category: "relative",
    better: "higher",
  },
  {
    key: "trackingError",
    label: "Tracking Error",
    styleId: "percent",
    category: "relative",
    better: "lower",
  },
  {
    key: "informationRatio",
    label: "Information Ratio",
    styleId: "number2",
    category: "relative",
    better: "higher",
  },
];

const DEFAULT_FOCUS_METRIC_KEY = "relativeWealth";
const DEFAULT_FOCUS_HORIZON_YEARS = 5;
const COVERAGE_TOLERANCE_DAYS = 10;

function getMetricDefinition(metricKey) {
  return (
    SECTOR_FOCUS_METRIC_DEFINITIONS.find((metric) => metric.key === metricKey) ||
    SECTOR_FOCUS_METRIC_DEFINITIONS[0]
  );
}

function getMetricValue(row, metricKey) {
  if (!row?.available) {
    return null;
  }

  if (row.metrics && metricKey in row.metrics) {
    return row.metrics[metricKey];
  }

  if (row.relativeMetrics && metricKey in row.relativeMetrics) {
    return row.relativeMetrics[metricKey];
  }

  return null;
}

function compareRowsByMetric(leftRow, rightRow, metricKey) {
  const metric = getMetricDefinition(metricKey);
  const leftValue = getMetricValue(leftRow, metric.key);
  const rightValue = getMetricValue(rightRow, metric.key);

  if (leftValue === null && rightValue === null) {
    return leftRow.label.localeCompare(rightRow.label);
  }
  if (leftValue === null) {
    return 1;
  }
  if (rightValue === null) {
    return -1;
  }

  if (metric.better === "lower") {
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  } else if (leftValue !== rightValue) {
    return rightValue - leftValue;
  }

  return leftRow.label.localeCompare(rightRow.label);
}

function sortRowsByMetric(rows, metricKey) {
  return [...rows].sort((leftRow, rightRow) =>
    compareRowsByMetric(leftRow, rightRow, metricKey),
  );
}

function shiftYears(date, years) {
  const shifted = new Date(date);
  shifted.setFullYear(shifted.getFullYear() - years);
  return shifted;
}

function daysBetween(leftDate, rightDate) {
  return Math.round((leftDate - rightDate) / 86400000);
}

function buildHorizonSlice(series, endDate, years) {
  const requestedStartDate = shiftYears(endDate, years);
  const clippedSeries = series.filter((point) => point.date <= endDate);
  const windowSeries = filterSeriesByDate(
    clippedSeries,
    requestedStartDate,
    endDate,
  );

  if (windowSeries.length < 2) {
    return {
      available: false,
      requestedStartDate,
      actualStartDate: null,
      actualEndDate: clippedSeries[clippedSeries.length - 1]?.date || null,
      series: [],
      reason: "Not enough observations in this trailing window.",
    };
  }

  const actualStartDate = windowSeries[0].date;
  const coverageLagDays = daysBetween(actualStartDate, requestedStartDate);
  if (coverageLagDays > COVERAGE_TOLERANCE_DAYS) {
    return {
      available: false,
      requestedStartDate,
      actualStartDate,
      actualEndDate: windowSeries[windowSeries.length - 1].date,
      series: [],
      reason: `History begins ${coverageLagDays} days after the requested start date.`,
    };
  }

  return {
    available: true,
    requestedStartDate,
    actualStartDate,
    actualEndDate: windowSeries[windowSeries.length - 1].date,
    series: windowSeries,
    reason: null,
  };
}

function buildProviderSummary(loadedEntries) {
  const counts = new Map();
  loadedEntries.forEach(({ snapshot }) => {
    const provider = snapshot?.provider || "local";
    const providerName = snapshot?.providerName || "Local market data";
    const key = `${provider}::${providerName}`;
    const existing = counts.get(key) || {
      provider,
      providerName,
      count: 0,
    };
    existing.count += 1;
    counts.set(key, existing);
  });

  return [...counts.values()].sort((left, right) => right.count - left.count);
}

function buildHorizonLeaders(rows) {
  return {
    annualizedReturn: sortRowsByMetric(rows, "annualizedReturn")[0] || null,
    sharpeRatio: sortRowsByMetric(rows, "sharpeRatio")[0] || null,
    relativeWealth: sortRowsByMetric(rows, "relativeWealth")[0] || null,
    maxDrawdown: sortRowsByMetric(rows, "maxDrawdown")[0] || null,
  };
}

function buildSectorSnapshotStudyRun({
  market,
  benchmarkEntry,
  benchmarkSnapshot,
  benchmarkSeries,
  sectorEntries,
  riskFreeRate,
  focusHorizonYears = DEFAULT_FOCUS_HORIZON_YEARS,
  focusMetricKey = DEFAULT_FOCUS_METRIC_KEY,
  exportedAt = new Date(),
  warnings = [],
}) {
  const loadedEntries = [
    { entry: benchmarkEntry, snapshot: benchmarkSnapshot, series: benchmarkSeries },
    ...sectorEntries,
  ];
  const commonEndDate = loadedEntries.reduce((earliest, current) => {
    const candidate = current.series[current.series.length - 1]?.date || null;
    if (!candidate) {
      return earliest;
    }
    if (!earliest || candidate < earliest) {
      return candidate;
    }
    return earliest;
  }, null);

  if (!commonEndDate) {
    throw new Error("The sector universe did not return usable observations.");
  }

  const providerSummary = buildProviderSummary(loadedEntries);
  const horizonYearsList = market.horizons || [1, 5, 10, 20];
  const horizonResults = horizonYearsList.map((years) => {
    const benchmarkWindow = buildHorizonSlice(benchmarkSeries, commonEndDate, years);
    const benchmarkMetrics = benchmarkWindow.available
      ? computeRiskAdjustedMetrics(benchmarkWindow.series, {
          constantRiskFreeRate: riskFreeRate,
        })
      : null;

    const rows = sectorEntries.map(({ entry, snapshot, series }) => {
      const sectorWindow = buildHorizonSlice(series, commonEndDate, years);
      if (!sectorWindow.available || !benchmarkWindow.available) {
        return {
          id: entry.id,
          label: entry.label,
          symbol: entry.symbol,
          providerName: snapshot.providerName,
          provider: snapshot.provider,
          snapshot,
          available: false,
          reason:
            sectorWindow.reason ||
            benchmarkWindow.reason ||
            "No comparable trailing window was available.",
          metrics: null,
          relativeMetrics: null,
          requestedStartDate: sectorWindow.requestedStartDate,
          actualStartDate: sectorWindow.actualStartDate,
          actualEndDate: sectorWindow.actualEndDate,
          observations: 0,
        };
      }

      const metrics = computeRiskAdjustedMetrics(sectorWindow.series, {
        constantRiskFreeRate: riskFreeRate,
      });
      const relativeMetrics = computeRelativeMetrics(
        sectorWindow.series,
        benchmarkWindow.series,
        {
          constantRiskFreeRate: riskFreeRate,
        },
      );

      return {
        id: entry.id,
        label: entry.label,
        symbol: entry.symbol,
        providerName: snapshot.providerName,
        provider: snapshot.provider,
        snapshot,
        available: true,
        reason: null,
        metrics,
        relativeMetrics,
        requestedStartDate: sectorWindow.requestedStartDate,
        actualStartDate: sectorWindow.actualStartDate,
        actualEndDate: sectorWindow.actualEndDate,
        observations: sectorWindow.series.length,
      };
    });

    const availableRows = rows.filter((row) => row.available);
    return {
      years,
      benchmarkWindow,
      benchmarkMetrics,
      rows,
      availableRows,
      availableCount: availableRows.length,
      unavailableCount: rows.length - availableRows.length,
      leaders: buildHorizonLeaders(availableRows),
      requestedStartDate: benchmarkWindow.requestedStartDate,
      actualStartDate: benchmarkWindow.actualStartDate,
      endDate: benchmarkWindow.actualEndDate || commonEndDate,
    };
  });

  const focusHorizonResult =
    horizonResults.find((result) => result.years === Number(focusHorizonYears)) ||
    horizonResults[0];
  const focusRows = sortRowsByMetric(
    focusHorizonResult?.availableRows || [],
    focusMetricKey,
  );

  return {
    studyTitle: "Sector Snapshot",
    market,
    benchmark: {
      ...benchmarkEntry,
      snapshot: benchmarkSnapshot,
    },
    benchmarkSeries,
    commonEndDate,
    riskFreeRate,
    focusHorizonYears: Number(focusHorizonYears),
    focusMetricKey,
    providerSummary,
    warnings,
    exportedAt,
    sectors: sectorEntries,
    horizonResults,
    focusHorizonResult,
    focusRows,
  };
}

function flattenSectorSnapshotRows(studyRun) {
  return studyRun.horizonResults.flatMap((horizonResult) =>
    horizonResult.rows.map((row) => ({
      market: studyRun.market.label,
      universe: studyRun.market.universeLabel,
      benchmark: studyRun.benchmark.label,
      benchmarkSymbol: studyRun.benchmark.symbol,
      horizonYears: horizonResult.years,
      requestedStartDate: horizonResult.requestedStartDate,
      endDate: horizonResult.endDate,
      sector: row.label,
      symbol: row.symbol,
      providerName: row.providerName,
      available: row.available,
      availabilityReason: row.reason,
      observations: row.observations,
      annualizedReturn: row.metrics?.annualizedReturn ?? null,
      annualizedVolatility: row.metrics?.annualizedVolatility ?? null,
      maxDrawdown: row.metrics?.maxDrawdown ?? null,
      sharpeRatio: row.metrics?.sharpeRatio ?? null,
      calmarRatio: row.metrics?.calmarRatio ?? null,
      relativeWealth: row.relativeMetrics?.relativeWealth ?? null,
      cagrSpread: row.relativeMetrics?.cagrSpread ?? null,
      trackingError: row.relativeMetrics?.trackingError ?? null,
      informationRatio: row.relativeMetrics?.informationRatio ?? null,
      outperformanceRate: row.relativeMetrics?.outperformanceRate ?? null,
      upsideCapture: row.relativeMetrics?.upsideCapture ?? null,
      downsideCapture: row.relativeMetrics?.downsideCapture ?? null,
    })),
  );
}

export {
  DEFAULT_FOCUS_HORIZON_YEARS,
  DEFAULT_FOCUS_METRIC_KEY,
  SECTOR_FOCUS_METRIC_DEFINITIONS,
  buildSectorSnapshotStudyRun,
  compareRowsByMetric,
  flattenSectorSnapshotRows,
  getMetricDefinition,
  getMetricValue,
  sortRowsByMetric,
};
