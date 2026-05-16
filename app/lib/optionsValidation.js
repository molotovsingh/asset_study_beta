const OPTIONS_VALIDATION_HORIZON_DEFINITIONS = [
  { days: 1, label: "1D" },
  { days: 5, label: "5D" },
  { days: 10, label: "10D" },
  { days: 20, label: "20D" },
  { days: 21, label: "1M" },
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
    impliedMovePercent: Number(rawObservation.impliedMovePercent),
    directionScore: Number(rawObservation.directionScore),
    executionScore: Number(rawObservation.executionScore),
    confidenceScore: Number(rawObservation.confidenceScore),
    ivHv20Ratio: Number(rawObservation.ivHv20Ratio),
    ivHv60Ratio: Number(rawObservation.ivHv60Ratio),
    ivPercentile: Number(rawObservation.ivPercentile),
    forwardReturn: Number(rawObservation.forwardReturn),
    absoluteMove: Number(rawObservation.absoluteMove),
    moveEdge: Number(rawObservation.moveEdge),
    realizedBeatImplied:
      typeof rawObservation.realizedBeatImplied === "boolean"
        ? rawObservation.realizedBeatImplied
        : null,
    availableTradingDays: Number(rawObservation.availableTradingDays),
    matured: Boolean(rawObservation.matured),
    directionBucket: String(rawObservation.directionBucket || "none"),
    candidateBucket: String(rawObservation.candidateBucket || "watch"),
    pricingBucket: String(rawObservation.pricingBucket || "none"),
    primaryTradeIdea: String(rawObservation.primaryTradeIdea || "No Preset Match"),
  };
}

function buildObservationDedupKey(observation) {
  return [
    observation.universeId || "",
    observation.symbol || "",
    observation.asOfDate?.toISOString?.().slice(0, 10) || "",
    observation.expiry || "",
    Number.isFinite(observation.daysToExpiry) ? observation.daysToExpiry : "",
    observation.pricingBucket || "",
    observation.candidateBucket || "",
    observation.directionBucket || "",
    observation.primaryTradeIdea || "",
    Number.isFinite(observation.impliedMovePercent)
      ? observation.impliedMovePercent.toFixed(6)
      : "",
  ].join("|");
}

function dedupeObservations(observations) {
  const deduped = new Map();

  observations.forEach((observation) => {
    const dedupKey = buildObservationDedupKey(observation);
    const current = deduped.get(dedupKey);
    if (!current) {
      deduped.set(dedupKey, {
        ...observation,
        duplicateCount: 1,
      });
      return;
    }

    const currentRunId = Number.isFinite(current.runId) ? current.runId : -Infinity;
    const nextRunId = Number.isFinite(observation.runId) ? observation.runId : -Infinity;
    const shouldReplace =
      nextRunId > currentRunId ||
      (nextRunId === currentRunId &&
        observation.createdAt &&
        (!current.createdAt || observation.createdAt > current.createdAt));

    deduped.set(dedupKey, {
      ...(shouldReplace ? observation : current),
      duplicateCount: Number(current.duplicateCount || 1) + 1,
    });
  });

  return [...deduped.values()].sort((left, right) => {
    const leftDate = left.asOfDate?.getTime?.() || 0;
    const rightDate = right.asOfDate?.getTime?.() || 0;
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    if ((right.runId || 0) !== (left.runId || 0)) {
      return (right.runId || 0) - (left.runId || 0);
    }
    return String(left.symbol || "").localeCompare(String(right.symbol || ""));
  });
}

function sampleQuality(maturedCount) {
  const count = Number(maturedCount) || 0;
  if (count >= 60) {
    return {
      label: "Usable",
      toneId: "positive",
      note: "Enough matured rows exist to start trusting bucket separation directionally.",
    };
  }
  if (count >= 20) {
    return {
      label: "Developing",
      toneId: "neutral",
      note: "The archive is starting to form, but the sample is still modest.",
    };
  }
  return {
    label: "Thin",
    toneId: "caution",
    note: "This is still an early sample. Treat bucket differences as provisional.",
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
      const moveEdges = groupRows.map((row) => row.moveEdge);
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
      const beatImpliedCount = groupRows.filter(
        (row) => row.realizedBeatImplied === true,
      ).length;
      const impliedComparables = groupRows.filter(
        (row) => row.realizedBeatImplied !== null,
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
        averageMoveEdge: average(moveEdges),
        beatImpliedRate: impliedComparables
          ? beatImpliedCount / impliedComparables
          : null,
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

function findGroup(groupedResults, key) {
  return groupedResults.find((group) => group.key === key) || null;
}

function buildPrimaryComparison(groupedResults, groupKey) {
  let leftKey = null;
  let rightKey = null;
  if (groupKey === "pricingBucket") {
    leftKey = "cheap";
    rightKey = "rich";
  } else if (groupKey === "candidateBucket") {
    leftKey = "long-premium";
    rightKey = "short-premium";
  } else if (groupKey === "directionBucket") {
    leftKey = "long";
    rightKey = "short";
  }

  if (!leftKey || !rightKey) {
    return null;
  }

  const leftGroup = findGroup(groupedResults, leftKey);
  const rightGroup = findGroup(groupedResults, rightKey);
  if (!leftGroup || !rightGroup) {
    return null;
  }

  const leftReturn = leftGroup.averageForwardReturn;
  const rightReturn = rightGroup.averageForwardReturn;
  return {
    leftKey,
    rightKey,
    leftLabel: leftGroup.label,
    rightLabel: rightGroup.label,
    leftCount: leftGroup.count,
    rightCount: rightGroup.count,
    leftReturn,
    rightReturn,
    spread:
      isFiniteNumber(leftReturn) && isFiniteNumber(rightReturn)
        ? leftReturn - rightReturn
        : null,
    leaderLabel:
      isFiniteNumber(leftReturn) && isFiniteNumber(rightReturn)
        ? leftReturn >= rightReturn
          ? leftGroup.label
          : rightGroup.label
        : null,
  };
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
  const rawObservations = validationPayload.observations.map(normalizeObservation);
  const observations = dedupeObservations(rawObservations);
  const maturedObservations = observations.filter((row) => row.matured);
  const pendingObservations = observations.filter((row) => !row.matured);
  const groupedResults = groupObservations(maturedObservations, normalizedGroupKey);
  const primaryComparison = buildPrimaryComparison(
    groupedResults,
    normalizedGroupKey,
  );
  const quality = sampleQuality(maturedObservations.length);
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
    observationCount: observations.length,
    maturedCount: maturedObservations.length,
    pendingCount: pendingObservations.length,
    rerunCountCollapsed: Math.max(
      Number(validationPayload.rerunCountCollapsed) || 0,
      rawObservations.length - observations.length,
    ),
    latestAsOfDate,
    observations,
    maturedObservations,
    pendingObservations,
    groupedResults,
    primaryComparison,
    bestGroup: groupedResults[0] || null,
    weakestGroup: groupedResults[groupedResults.length - 1] || null,
    latestMaturedObservation: maturedObservations[0] || null,
    latestPendingObservation: pendingObservations[0] || null,
    sampleQualityLabel: quality.label,
    sampleQualityToneId: quality.toneId,
    sampleQualityNote: quality.note,
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
    averageMoveEdge: group.averageMoveEdge,
    beatImpliedRate: group.beatImpliedRate,
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
    impliedMovePercent: row.impliedMovePercent,
    moveEdge: row.moveEdge,
    realizedBeatImplied: row.realizedBeatImplied,
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
