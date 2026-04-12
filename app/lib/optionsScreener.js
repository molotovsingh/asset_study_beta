import { buildMonthlyStraddleStudyRun } from "./monthlyStraddle.js";

const OPTIONS_SCREENER_SORT_DEFINITIONS = [
  {
    key: "directionScore",
    label: "Direction Score",
    styleId: "number2",
  },
  {
    key: "ivHv20Ratio",
    label: "IV/HV20",
    styleId: "number2",
  },
  {
    key: "ivHv60Ratio",
    label: "IV/HV60",
    styleId: "number2",
  },
  {
    key: "straddleImpliedVolatility",
    label: "Straddle IV",
    styleId: "percent",
  },
  {
    key: "ivPercentile",
    label: "IV Percentile",
    styleId: "percent",
  },
  {
    key: "combinedOpenInterest",
    label: "Combined OI",
    styleId: "integer",
  },
  {
    key: "executionScore",
    label: "Execution Score",
    styleId: "number2",
  },
  {
    key: "confidenceScore",
    label: "Confidence Score",
    styleId: "number2",
  },
];

const DEFAULT_OPTIONS_SCREENER_SORT_KEY = "ivHv20Ratio";
const DEFAULT_OPTIONS_SCREENER_BIAS = "all";
const DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER = "all";

function getSortDefinition(sortKey) {
  return (
    OPTIONS_SCREENER_SORT_DEFINITIONS.find((definition) => definition.key === sortKey) ||
    OPTIONS_SCREENER_SORT_DEFINITIONS[0]
  );
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function clamp(value, lower, upper) {
  return Math.min(Math.max(value, lower), upper);
}

function average(values) {
  const validValues = values.filter(isFiniteNumber);
  if (!validValues.length) {
    return null;
  }
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function normalizeBias(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "rich" || text === "cheap") {
    return text;
  }
  return DEFAULT_OPTIONS_SCREENER_BIAS;
}

function normalizeCandidateFilter(value) {
  const text = String(value || "").trim().toLowerCase();
  if (
    text === "long-premium" ||
    text === "short-premium" ||
    text === "low-confidence" ||
    text === "watch"
  ) {
    return text;
  }
  return DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER;
}

function pricingBucket(label) {
  if (label === "Cheap") {
    return "cheap";
  }
  if (label === "Rich" || label === "Mildly Rich") {
    return "rich";
  }
  if (label === "Fair") {
    return "fair";
  }
  return "none";
}

function liquidityLabel(openInterest, volume) {
  if (openInterest >= 15000 || volume >= 3000) {
    return "Deep";
  }
  if (openInterest >= 5000 || volume >= 1000) {
    return "Usable";
  }
  return "Thin";
}

function spreadQuality(spreadShare) {
  if (!isFiniteNumber(spreadShare)) {
    return "No Read";
  }
  if (spreadShare <= 0.04) {
    return "Tight";
  }
  if (spreadShare <= 0.08) {
    return "Usable";
  }
  return "Wide";
}

function directionBucket(label) {
  if (label === "Long Bias") {
    return "long";
  }
  if (label === "Short Bias") {
    return "short";
  }
  if (label === "Neutral") {
    return "neutral";
  }
  return "none";
}

function normalizeDirectionContext(rawContext = {}) {
  const trend = rawContext?.trend || {};
  const seasonality = rawContext?.seasonality || {};
  return {
    asOfDate: rawContext?.asOfDate || "",
    historyStartDate: rawContext?.historyStartDate || "",
    historyEndDate: rawContext?.historyEndDate || "",
    observations: Number(rawContext?.observations),
    directionScore: Number(rawContext?.directionScore),
    directionLabel: String(rawContext?.directionLabel || "No Read"),
    trend: {
      score: Number(trend.score),
      label: String(trend.label || "No Read"),
      spotAboveSma50:
        typeof trend.spotAboveSma50 === "boolean" ? trend.spotAboveSma50 : null,
      sma50AboveSma200:
        typeof trend.sma50AboveSma200 === "boolean" ? trend.sma50AboveSma200 : null,
      return63: Number(trend.return63),
      return252: Number(trend.return252),
      sma50: Number(trend.sma50),
      sma200: Number(trend.sma200),
    },
    seasonality: {
      calendarMonth: Number(seasonality.calendarMonth),
      calendarMonthLabel: String(seasonality.calendarMonthLabel || ""),
      observations: Number(seasonality.observations),
      meanReturn: Number(seasonality.meanReturn),
      medianReturn: Number(seasonality.medianReturn),
      winRate: Number(seasonality.winRate),
      averageAbsoluteReturn: Number(seasonality.averageAbsoluteReturn),
      score: Number(seasonality.score),
      label: String(seasonality.label || "No Read"),
      sampleQuality: String(seasonality.sampleQuality || "none"),
    },
  };
}

function computeVolPricingScore({
  ivHv20Ratio,
  ivHv60Ratio,
  ivPercentile,
  ivHv20Percentile,
}) {
  const ratioValue = isFiniteNumber(ivHv20Ratio) ? ivHv20Ratio : ivHv60Ratio;
  const ratioScore = isFiniteNumber(ratioValue)
    ? clamp(((ratioValue - 0.8) / 0.7) * 100, 0, 100)
    : null;
  const percentileScore = isFiniteNumber(ivPercentile)
    ? clamp(ivPercentile * 100, 0, 100)
    : null;
  const ratioPercentileScore = isFiniteNumber(ivHv20Percentile)
    ? clamp(ivHv20Percentile * 100, 0, 100)
    : null;
  return average([ratioScore, percentileScore, ratioPercentileScore]);
}

function computeExecutionScore({
  combinedOpenInterest,
  combinedVolume,
  spreadShare,
}) {
  const openInterestScore = isFiniteNumber(combinedOpenInterest)
    ? clamp((combinedOpenInterest / 20000) * 100, 0, 100)
    : null;
  const volumeScore = isFiniteNumber(combinedVolume)
    ? clamp((combinedVolume / 3000) * 100, 0, 100)
    : null;
  const spreadScore = isFiniteNumber(spreadShare)
    ? clamp((1 - spreadShare / 0.12) * 100, 0, 100)
    : null;
  return average([openInterestScore, volumeScore, spreadScore]);
}

function computeConfidenceScore({
  historyObservations,
  seasonalityObservations,
  executionScore,
}) {
  const historyScore = isFiniteNumber(historyObservations)
    ? clamp((historyObservations / 20) * 100, 0, 100)
    : null;
  const seasonalityScore = isFiniteNumber(seasonalityObservations)
    ? clamp((seasonalityObservations / 10) * 100, 0, 100)
    : null;
  return average([historyScore, seasonalityScore, executionScore]);
}

function buildCandidateAdvisory({
  pricingBucket,
  executionScore,
  confidenceScore,
}) {
  if (
    (isFiniteNumber(executionScore) && executionScore < 45) ||
    (isFiniteNumber(confidenceScore) && confidenceScore < 40)
  ) {
    return {
      label: "Low Confidence",
      bucket: "low-confidence",
    };
  }

  if (pricingBucket === "cheap") {
    return {
      label: "Long Premium Candidate",
      bucket: "long-premium",
    };
  }

  if (pricingBucket === "rich") {
    return {
      label: "Short Premium Candidate",
      bucket: "short-premium",
    };
  }

  return {
    label: "No Vol Edge",
    bucket: "watch",
  };
}

function buildScreenerRow(snapshot, options) {
  const studyRun = buildMonthlyStraddleStudyRun(snapshot, {
    requestedSymbol: snapshot.symbol,
    minimumDte: options.minimumDte,
    maxContracts: options.maxContracts,
  });
  const focus = studyRun.focusContract;
  const spreadShare =
    isFiniteNumber(focus.callSpread) &&
    isFiniteNumber(focus.putSpread) &&
    isFiniteNumber(focus.straddleMidPrice) &&
    focus.straddleMidPrice > 0
      ? (focus.callSpread + focus.putSpread) / focus.straddleMidPrice
      : null;
  const pricingLabel = studyRun.focusVolComparison?.label || "No Read";
  const bucket = pricingBucket(pricingLabel);
  const directionContext = normalizeDirectionContext(snapshot.directionContext);
  const executionScore = computeExecutionScore({
    combinedOpenInterest: focus.combinedOpenInterest,
    combinedVolume: focus.combinedVolume,
    spreadShare,
  });
  const confidenceScore = computeConfidenceScore({
    historyObservations: studyRun.historySummary.observations,
    seasonalityObservations: directionContext.seasonality.observations,
    executionScore,
  });
  const candidateAdvisory = buildCandidateAdvisory({
    pricingBucket: bucket,
    executionScore,
    confidenceScore,
  });
  const volPricingScore = computeVolPricingScore({
    ivHv20Ratio: focus.ivHv20Ratio,
    ivHv60Ratio: focus.ivHv60Ratio,
    ivPercentile: studyRun.historySummary.ivPercentile,
    ivHv20Percentile: studyRun.historySummary.ivHv20Percentile,
  });

  return {
    id: studyRun.symbol,
    symbol: studyRun.symbol,
    label: studyRun.symbol,
    providerName: studyRun.providerName,
    provider: studyRun.provider,
    asOfDate: studyRun.asOfDate,
    spotPrice: studyRun.spotPrice,
    currency: studyRun.currency,
    expiry: focus.expiry,
    daysToExpiry: focus.daysToExpiry,
    strike: focus.strike,
    straddleMidPrice: focus.straddleMidPrice,
    impliedMovePercent: focus.impliedMovePercent,
    straddleImpliedVolatility: focus.straddleImpliedVolatility,
    chainImpliedVolatility: focus.chainImpliedVolatility,
    historicalVolatility20: focus.historicalVolatility20,
    historicalVolatility60: focus.historicalVolatility60,
    ivHv20Ratio: focus.ivHv20Ratio,
    ivHv60Ratio: focus.ivHv60Ratio,
    ivPercentile: studyRun.historySummary.ivPercentile,
    ivHv20Percentile: studyRun.historySummary.ivHv20Percentile,
    combinedOpenInterest: focus.combinedOpenInterest,
    combinedVolume: focus.combinedVolume,
    liquidityLabel: liquidityLabel(focus.combinedOpenInterest, focus.combinedVolume),
    spreadShare,
    spreadQuality: spreadQuality(spreadShare),
    pricingLabel,
    pricingBucket: bucket,
    volPricingScore,
    executionScore,
    confidenceScore,
    directionContext,
    directionScore: directionContext.directionScore,
    directionLabel: directionContext.directionLabel,
    directionBucket: directionBucket(directionContext.directionLabel),
    trendScore: directionContext.trend.score,
    trendLabel: directionContext.trend.label,
    seasonalityScore: directionContext.seasonality.score,
    seasonalityLabel: directionContext.seasonality.label,
    seasonalityMeanReturn: directionContext.seasonality.meanReturn,
    seasonalityMedianReturn: directionContext.seasonality.medianReturn,
    seasonalityWinRate: directionContext.seasonality.winRate,
    seasonalityAverageAbsoluteReturn:
      directionContext.seasonality.averageAbsoluteReturn,
    seasonalityObservations: directionContext.seasonality.observations,
    seasonalityMonthLabel: directionContext.seasonality.calendarMonthLabel,
    candidateAdvisory: candidateAdvisory.label,
    candidateBucket: candidateAdvisory.bucket,
    curveShape: studyRun.curveShape,
    warnings: studyRun.warnings,
    studyRun,
  };
}

function rowSortValue(row, sortKey) {
  return row?.[sortKey] ?? null;
}

function compareRows(leftRow, rightRow, sortKey, bias) {
  const leftValue = rowSortValue(leftRow, sortKey);
  const rightValue = rowSortValue(rightRow, sortKey);

  if (!isFiniteNumber(leftValue) && !isFiniteNumber(rightValue)) {
    return leftRow.symbol.localeCompare(rightRow.symbol);
  }
  if (!isFiniteNumber(leftValue)) {
    return 1;
  }
  if (!isFiniteNumber(rightValue)) {
    return -1;
  }

  const ascendingForCheap =
    bias === "cheap" &&
    (
      sortKey === "ivHv20Ratio" ||
      sortKey === "ivHv60Ratio" ||
      sortKey === "ivPercentile"
    );
  if (leftValue !== rightValue) {
    return ascendingForCheap ? leftValue - rightValue : rightValue - leftValue;
  }
  return leftRow.symbol.localeCompare(rightRow.symbol);
}

function buildOptionsScreenerStudyRun({
  universe,
  screenerPayload,
  minimumDte = universe.defaultMinimumDte || 25,
  maxContracts = universe.maxContracts || 1,
  sortKey = DEFAULT_OPTIONS_SCREENER_SORT_KEY,
  bias = DEFAULT_OPTIONS_SCREENER_BIAS,
  candidateFilter = DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER,
  exportedAt = new Date(),
}) {
  if (!universe?.id) {
    throw new Error("Options screener universe is missing.");
  }
  if (!Array.isArray(screenerPayload?.snapshots) || !screenerPayload.snapshots.length) {
    throw new Error("Options screener payload did not include usable snapshots.");
  }

  const normalizedBias = normalizeBias(bias);
  const normalizedCandidateFilter = normalizeCandidateFilter(candidateFilter);
  const rows = screenerPayload.snapshots.map((snapshot) =>
    buildScreenerRow(snapshot, {
      minimumDte,
      maxContracts,
    }),
  );
  const filteredRows = rows.filter((row) => {
    const biasMatches =
      normalizedBias === "all" ? true : row.pricingBucket === normalizedBias;
    const candidateMatches =
      normalizedCandidateFilter === "all"
        ? true
        : row.candidateBucket === normalizedCandidateFilter;
    return biasMatches && candidateMatches;
  });
  const sortedRows = [...filteredRows].sort((leftRow, rightRow) =>
    compareRows(leftRow, rightRow, sortKey, normalizedBias),
  );
  const richRows = rows.filter((row) => row.pricingBucket === "rich");
  const cheapRows = rows.filter((row) => row.pricingBucket === "cheap");
  const failures = Array.isArray(screenerPayload.failures)
    ? screenerPayload.failures.map((failure) => ({
        symbol: String(failure.symbol || "").trim().toUpperCase(),
        error: String(failure.error || "").trim() || "Unknown error",
      }))
    : [];
  const providerSummary = rows.reduce((summary, row) => {
    const key = `${row.provider}::${row.providerName}`;
    const current = summary.get(key) || {
      provider: row.provider,
      providerName: row.providerName,
      count: 0,
    };
    current.count += 1;
    summary.set(key, current);
    return summary;
  }, new Map());
  const asOfDate = rows.reduce((latest, row) => {
    if (!row.asOfDate) {
      return latest;
    }
    if (!latest || row.asOfDate > latest) {
      return row.asOfDate;
    }
    return latest;
  }, null);

  return {
    studyTitle: "Options Screener",
    universe,
    minimumDte,
    maxContracts,
    sortKey: getSortDefinition(sortKey).key,
    bias: normalizedBias,
    candidateFilter: normalizedCandidateFilter,
    asOfDate,
    rows,
    filteredRows: sortedRows,
    richCount: richRows.length,
    cheapCount: cheapRows.length,
    failures,
    topDirectionRow: [...rows].sort((leftRow, rightRow) =>
      compareRows(leftRow, rightRow, "directionScore", "all"),
    )[0] || null,
    bestExecutionRow: [...rows].sort((leftRow, rightRow) =>
      compareRows(leftRow, rightRow, "executionScore", "all"),
    )[0] || null,
    topRichRow: [...richRows].sort((leftRow, rightRow) =>
      compareRows(leftRow, rightRow, "ivHv20Ratio", "all"),
    )[0] || null,
    topCheapRow: [...cheapRows].sort((leftRow, rightRow) =>
      compareRows(leftRow, rightRow, "ivHv20Ratio", "cheap"),
    )[0] || null,
    providerSummary: [...providerSummary.values()].sort(
      (left, right) => right.count - left.count,
    ),
    storage: screenerPayload.storage || null,
    storageWarning: screenerPayload.storageWarning || "",
    exportedAt,
  };
}

function flattenOptionsScreenerRows(studyRun) {
  return studyRun.filteredRows.map((row, index) => ({
    rank: index + 1,
    symbol: row.symbol,
    providerName: row.providerName,
    asOfDate: row.asOfDate,
    spotPrice: row.spotPrice,
    currency: row.currency,
    expiry: row.expiry,
    daysToExpiry: row.daysToExpiry,
    strike: row.strike,
    straddleMidPrice: row.straddleMidPrice,
    impliedMovePercent: row.impliedMovePercent,
    straddleImpliedVolatility: row.straddleImpliedVolatility,
    historicalVolatility20: row.historicalVolatility20,
    historicalVolatility60: row.historicalVolatility60,
    ivHv20Ratio: row.ivHv20Ratio,
    ivHv60Ratio: row.ivHv60Ratio,
    ivPercentile: row.ivPercentile,
    ivHv20Percentile: row.ivHv20Percentile,
    combinedOpenInterest: row.combinedOpenInterest,
    combinedVolume: row.combinedVolume,
    liquidityLabel: row.liquidityLabel,
    spreadShare: row.spreadShare,
    spreadQuality: row.spreadQuality,
    pricingLabel: row.pricingLabel,
    directionScore: row.directionScore,
    directionLabel: row.directionLabel,
    trendScore: row.trendScore,
    seasonalityScore: row.seasonalityScore,
    seasonalityMonthLabel: row.seasonalityMonthLabel,
    seasonalityMeanReturn: row.seasonalityMeanReturn,
    seasonalityWinRate: row.seasonalityWinRate,
    seasonalityObservations: row.seasonalityObservations,
    volPricingScore: row.volPricingScore,
    executionScore: row.executionScore,
    confidenceScore: row.confidenceScore,
    candidateAdvisory: row.candidateAdvisory,
  }));
}

export {
  DEFAULT_OPTIONS_SCREENER_BIAS,
  DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER,
  DEFAULT_OPTIONS_SCREENER_SORT_KEY,
  OPTIONS_SCREENER_SORT_DEFINITIONS,
  buildOptionsScreenerStudyRun,
  flattenOptionsScreenerRows,
  getSortDefinition,
  normalizeCandidateFilter,
};
