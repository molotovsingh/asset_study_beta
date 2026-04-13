const OPTIONS_VALIDATION_HORIZON_DEFINITIONS = [
  { days: 1, label: "1D" },
  { days: 5, label: "5D" },
  { days: 20, label: "20D" },
  { days: 63, label: "63D" },
];

const OPTIONS_VALIDATION_GROUP_DEFINITIONS = [
  {
    key: "candidateBucket",
    label: "Candidate",
  },
  {
    key: "pricingBucket",
    label: "Pricing",
  },
  {
    key: "directionBucket",
    label: "Direction",
  },
];

const DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS = 5;
const DEFAULT_OPTIONS_VALIDATION_GROUP_KEY = "candidateBucket";

function getHorizonDefinition(days) {
  return (
    OPTIONS_VALIDATION_HORIZON_DEFINITIONS.find(
      (definition) => definition.days === Number(days),
    ) || OPTIONS_VALIDATION_HORIZON_DEFINITIONS[0]
  );
}

function getGroupDefinition(groupKey) {
  return (
    OPTIONS_VALIDATION_GROUP_DEFINITIONS.find(
      (definition) => definition.key === groupKey,
    ) || OPTIONS_VALIDATION_GROUP_DEFINITIONS[0]
  );
}

function normalizeGroupKey(value) {
  return getGroupDefinition(value).key;
}

function normalizeHorizonDays(value) {
  return getHorizonDefinition(value).days;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function average(values) {
  const validValues = values.filter(isFiniteNumber);
  if (!validValues.length) {
    return null;
  }
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function median(values) {
  const validValues = values.filter(isFiniteNumber).sort((left, right) => left - right);
  if (!validValues.length) {
    return null;
  }
  const middleIndex = Math.floor(validValues.length / 2);
  if (validValues.length % 2 === 0) {
    return (validValues[middleIndex - 1] + validValues[middleIndex]) / 2;
  }
  return validValues[middleIndex];
}

function normalizeBucketLabel(groupKey, bucket) {
  const text = String(bucket || "").trim().toLowerCase();
  if (groupKey === "candidateBucket") {
    if (text === "long-premium") {
      return "Long Premium";
    }
    if (text === "short-premium") {
      return "Short Premium";
    }
    if (text === "low-confidence") {
      return "Low Confidence";
    }
    if (text === "watch") {
      return "No Vol Edge";
    }
    return "Unknown";
  }
  if (groupKey === "pricingBucket") {
    if (text === "cheap") {
      return "Cheap";
    }
    if (text === "rich") {
      return "Rich";
    }
    if (text === "fair") {
      return "Fair";
    }
    if (text === "none") {
      return "No Read";
    }
    return "Unknown";
  }
  if (groupKey === "directionBucket") {
    if (text === "long") {
      return "Long Bias";
    }
    if (text === "short") {
      return "Short Bias";
    }
    if (text === "neutral") {
      return "Neutral";
    }
    if (text === "none") {
      return "No Read";
    }
    return "Unknown";
  }
  return String(bucket || "Unknown");
}

function normalizeObservation(rawObservation) {
  return {
    ...rawObservation,
    createdAt: rawObservation.createdAt ? new Date(rawObservation.createdAt) : null,
    asOfDate: rawObservation.asOfDate ? new Date(`${rawObservation.asOfDate}T00:00:00`) : null,
    baseDate: rawObservation.baseDate ? new Date(`${rawObservation.baseDate}T00:00:00`) : null,
    forwardDate: rawObservation.forwardDate
      ? new Date(`${rawObservation.forwardDate}T00:00:00`)
      : null,
    runId: Number(rawObservation.runId),
    horizonDays: Number(rawObservation.horizonDays),
    daysToExpiry: Number(rawObservation.daysToExpiry),
    spotPrice: Number(rawObservation.spotPrice),
    basePrice: Number(rawObservation.basePrice),
    forwardPrice: Number(rawObservation.forwardPrice),
    directionScore: Number(rawObservation.directionScore),
    executionScore: Number(rawObservation.executionScore),
    confidenceScore: Number(rawObservation.confidenceScore),
    ivHv20Ratio: Number(rawObservation.ivHv20Ratio),
    ivHv60Ratio: Number(rawObservation.ivHv60Ratio),
    ivPercentile: Number(rawObservation.ivPercentile),
    forwardReturn: Number(rawObservation.forwardReturn),
    absoluteMove: Number(rawObservation.absoluteMove),
    availableTradingDays: Number(rawObservation.availableTradingDays),
    matured: Boolean(rawObservation.matured),
    directionBucket: String(rawObservation.directionBucket || "none"),
    candidateBucket: String(rawObservation.candidateBucket || "watch"),
    pricingBucket: String(rawObservation.pricingBucket || "none"),
  };
}

function groupObservations(observations, groupKey) {
  const groups = new Map();
  observations.forEach((observation) => {
    const key = String(observation[groupKey] || "unknown");
    const current = groups.get(key) || [];
    current.push(observation);
    groups.set(key, current);
  });

  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const forwardReturns = groupRows.map((row) => row.forwardReturn);
      const absoluteMoves = groupRows.map((row) => row.absoluteMove);
      const ivHv20Ratios = groupRows.map((row) => row.ivHv20Ratio);
      const directionScores = groupRows.map((row) => row.directionScore);
      const latestAsOfDate = groupRows.reduce((latest, row) => {
        if (!row.asOfDate) {
          return latest;
        }
        if (!latest || row.asOfDate > latest) {
          return row.asOfDate;
        }
        return latest;
      }, null);
      const positiveCount = groupRows.filter(
        (row) => isFiniteNumber(row.forwardReturn) && row.forwardReturn > 0,
      ).length;

      return {
        key,
        label: normalizeBucketLabel(groupKey, key),
        count: groupRows.length,
        latestAsOfDate,
        averageForwardReturn: average(forwardReturns),
        medianForwardReturn: median(forwardReturns),
        winRate: groupRows.length ? positiveCount / groupRows.length : null,
        averageAbsoluteMove: average(absoluteMoves),
        averageIvHv20Ratio: average(ivHv20Ratios),
        averageDirectionScore: average(directionScores),
        rows: groupRows,
      };
    })
    .sort((left, right) => {
      const leftValue = isFiniteNumber(left.averageForwardReturn)
        ? left.averageForwardReturn
        : -Infinity;
      const rightValue = isFiniteNumber(right.averageForwardReturn)
        ? right.averageForwardReturn
        : -Infinity;
      if (leftValue !== rightValue) {
        return rightValue - leftValue;
      }
      return left.label.localeCompare(right.label);
    });
}

function buildOptionsValidationStudyRun({
  universe,
  validationPayload,
  horizonDays = DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS,
  groupKey = DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
  exportedAt = new Date(),
}) {
  if (!universe?.id) {
    throw new Error("Options validation universe is missing.");
  }
  if (!Array.isArray(validationPayload?.observations)) {
    throw new Error("Options validation payload is invalid.");
  }

  const normalizedGroupKey = normalizeGroupKey(groupKey);
  const normalizedHorizonDays = normalizeHorizonDays(horizonDays);
  const observations = validationPayload.observations.map(normalizeObservation);
  const maturedObservations = observations.filter((row) => row.matured);
  const pendingObservations = observations.filter((row) => !row.matured);
  const groupedResults = groupObservations(maturedObservations, normalizedGroupKey);
  const latestAsOfDate = observations.reduce((latest, row) => {
    if (!row.asOfDate) {
      return latest;
    }
    if (!latest || row.asOfDate > latest) {
      return row.asOfDate;
    }
    return latest;
  }, null);

  return {
    studyTitle: "Options Validation",
    universe,
    horizonDays: normalizedHorizonDays,
    horizonLabel: getHorizonDefinition(normalizedHorizonDays).label,
    groupKey: normalizedGroupKey,
    groupDefinition: getGroupDefinition(normalizedGroupKey),
    runCount: Number(validationPayload.runCount) || 0,
    observationCount: Number(validationPayload.observationCount) || observations.length,
    maturedCount: Number(validationPayload.maturedCount) || maturedObservations.length,
    pendingCount: Number(validationPayload.pendingCount) || pendingObservations.length,
    latestAsOfDate,
    observations,
    maturedObservations,
    pendingObservations,
    groupedResults,
    bestGroup: groupedResults[0] || null,
    weakestGroup: groupedResults[groupedResults.length - 1] || null,
    latestMaturedObservation: maturedObservations[0] || null,
    latestPendingObservation: pendingObservations[0] || null,
    exportedAt,
  };
}

function flattenOptionsValidationGroups(studyRun) {
  return studyRun.groupedResults.map((group, index) => ({
    rank: index + 1,
    group: group.label,
    count: group.count,
    latestAsOfDate: group.latestAsOfDate,
    averageForwardReturn: group.averageForwardReturn,
    medianForwardReturn: group.medianForwardReturn,
    winRate: group.winRate,
    averageAbsoluteMove: group.averageAbsoluteMove,
    averageIvHv20Ratio: group.averageIvHv20Ratio,
    averageDirectionScore: group.averageDirectionScore,
  }));
}

function flattenOptionsValidationObservations(studyRun) {
  return studyRun.observations.map((row) => ({
    runId: row.runId,
    symbol: row.symbol,
    asOfDate: row.asOfDate,
    baseDate: row.baseDate,
    forwardDate: row.forwardDate,
    matured: row.matured,
    basePrice: row.basePrice,
    forwardPrice: row.forwardPrice,
    forwardReturn: row.forwardReturn,
    absoluteMove: row.absoluteMove,
    availableTradingDays: row.availableTradingDays,
    pricingLabel: row.pricingLabel,
    candidateAdvisory: row.candidateAdvisory,
    directionLabel: row.directionLabel,
    ivHv20Ratio: row.ivHv20Ratio,
    directionScore: row.directionScore,
    executionScore: row.executionScore,
    confidenceScore: row.confidenceScore,
    reason: row.reason || "",
  }));
}

export {
  DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
  DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS,
  OPTIONS_VALIDATION_GROUP_DEFINITIONS,
  OPTIONS_VALIDATION_HORIZON_DEFINITIONS,
  buildOptionsValidationStudyRun,
  flattenOptionsValidationGroups,
  flattenOptionsValidationObservations,
  getGroupDefinition,
  getHorizonDefinition,
  normalizeGroupKey,
  normalizeHorizonDays,
};
