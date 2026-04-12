const DEFAULT_MINIMUM_DTE = 25;
const DEFAULT_CONTRACT_COUNT = 4;

function normalizeContract(rawContract) {
  return {
    ...rawContract,
    daysToExpiry: Number(rawContract.daysToExpiry),
    strike: Number(rawContract.strike),
    callBid: Number(rawContract.callBid),
    callAsk: Number(rawContract.callAsk),
    callLastPrice: Number(rawContract.callLastPrice),
    callMidPrice: Number(rawContract.callMidPrice),
    callOpenInterest: Number(rawContract.callOpenInterest),
    callVolume: Number(rawContract.callVolume),
    callImpliedVolatility: Number(rawContract.callImpliedVolatility),
    callSpread: Number(rawContract.callSpread),
    putBid: Number(rawContract.putBid),
    putAsk: Number(rawContract.putAsk),
    putLastPrice: Number(rawContract.putLastPrice),
    putMidPrice: Number(rawContract.putMidPrice),
    putOpenInterest: Number(rawContract.putOpenInterest),
    putVolume: Number(rawContract.putVolume),
    putImpliedVolatility: Number(rawContract.putImpliedVolatility),
    putSpread: Number(rawContract.putSpread),
    straddleMidPrice: Number(rawContract.straddleMidPrice),
    impliedMovePrice: Number(rawContract.impliedMovePrice),
    impliedMovePercent: Number(rawContract.impliedMovePercent),
    straddleImpliedVolatility: Number(rawContract.straddleImpliedVolatility),
    chainImpliedVolatility: Number(rawContract.chainImpliedVolatility),
    impliedVolatilityGap: Number(rawContract.impliedVolatilityGap),
    historicalVolatility20: Number(rawContract.historicalVolatility20),
    historicalVolatility60: Number(rawContract.historicalVolatility60),
    historicalVolatility120: Number(rawContract.historicalVolatility120),
    ivHv20Ratio: Number(rawContract.ivHv20Ratio),
    ivHv60Ratio: Number(rawContract.ivHv60Ratio),
    ivHv120Ratio: Number(rawContract.ivHv120Ratio),
    ivHv20Spread: Number(rawContract.ivHv20Spread),
    ivHv60Spread: Number(rawContract.ivHv60Spread),
    ivHv120Spread: Number(rawContract.ivHv120Spread),
    combinedOpenInterest: Number(rawContract.combinedOpenInterest),
    combinedVolume: Number(rawContract.combinedVolume),
  };
}

function normalizeFrontHistoryRow(rawRow) {
  return {
    ...rawRow,
    asOfDate: rawRow.asOfDate ? new Date(`${rawRow.asOfDate}T00:00:00`) : null,
    fetchedAt: rawRow.fetchedAt ? new Date(rawRow.fetchedAt) : null,
    daysToExpiry: Number(rawRow.daysToExpiry),
    strike: Number(rawRow.strike),
    spotPrice: Number(rawRow.spotPrice),
    impliedMovePercent: Number(rawRow.impliedMovePercent),
    straddleImpliedVolatility: Number(rawRow.straddleImpliedVolatility),
    chainImpliedVolatility: Number(rawRow.chainImpliedVolatility),
    impliedVolatilityGap: Number(rawRow.impliedVolatilityGap),
    historicalVolatility20: Number(rawRow.historicalVolatility20),
    historicalVolatility60: Number(rawRow.historicalVolatility60),
    historicalVolatility120: Number(rawRow.historicalVolatility120),
    ivHv20Ratio: Number(rawRow.ivHv20Ratio),
    ivHv60Ratio: Number(rawRow.ivHv60Ratio),
    ivHv120Ratio: Number(rawRow.ivHv120Ratio),
    ivHv20Spread: Number(rawRow.ivHv20Spread),
    ivHv60Spread: Number(rawRow.ivHv60Spread),
    ivHv120Spread: Number(rawRow.ivHv120Spread),
    combinedOpenInterest: Number(rawRow.combinedOpenInterest),
    combinedVolume: Number(rawRow.combinedVolume),
  };
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function slopeLabel(firstValue, lastValue) {
  if (!isFiniteNumber(firstValue) || !isFiniteNumber(lastValue)) {
    return "No Read";
  }
  const delta = lastValue - firstValue;
  if (delta >= 0.03) {
    return "Upward";
  }
  if (delta <= -0.03) {
    return "Downward";
  }
  return "Flat";
}

function computePercentileRank(series, currentValue) {
  if (!isFiniteNumber(currentValue)) {
    return null;
  }
  const validValues = series.filter((value) => isFiniteNumber(value));
  if (!validValues.length) {
    return null;
  }

  const lessThanCount = validValues.filter((value) => value < currentValue).length;
  const equalCount = validValues.filter((value) => value === currentValue).length;
  return (lessThanCount + equalCount) / validValues.length;
}

function classifyVolPricing(ratio) {
  if (!isFiniteNumber(ratio)) {
    return {
      label: "No Read",
      toneId: "neutral",
    };
  }
  if (ratio < 0.9) {
    return {
      label: "Cheap",
      toneId: "positive",
    };
  }
  if (ratio <= 1.1) {
    return {
      label: "Fair",
      toneId: "neutral",
    };
  }
  if (ratio <= 1.3) {
    return {
      label: "Mildly Rich",
      toneId: "caution",
    };
  }
  return {
    label: "Rich",
    toneId: "caution",
  };
}

function buildFocusVolComparison(contract) {
  const windows = [
    {
      windowDays: 20,
      historicalVolatility: contract.historicalVolatility20,
      ratio: contract.ivHv20Ratio,
      spread: contract.ivHv20Spread,
    },
    {
      windowDays: 60,
      historicalVolatility: contract.historicalVolatility60,
      ratio: contract.ivHv60Ratio,
      spread: contract.ivHv60Spread,
    },
    {
      windowDays: 120,
      historicalVolatility: contract.historicalVolatility120,
      ratio: contract.ivHv120Ratio,
      spread: contract.ivHv120Spread,
    },
  ].filter(
    (entry) =>
      isFiniteNumber(entry.historicalVolatility) &&
      isFiniteNumber(entry.ratio) &&
      isFiniteNumber(entry.spread),
  );

  if (!windows.length) {
    return null;
  }

  const primary = windows[0];
  const pricing = classifyVolPricing(primary.ratio);
  return {
    ...primary,
    label: pricing.label,
    toneId: pricing.toneId,
    windows,
  };
}

function buildHistorySummary(frontHistory, focusContract) {
  if (!frontHistory.length) {
    return {
      observations: 0,
      startDate: null,
      endDate: null,
      hasEnoughHistory: false,
      ivPercentile: null,
      movePercentile: null,
      ivHv20Percentile: null,
      ivHv60Percentile: null,
    };
  }

  return {
    observations: frontHistory.length,
    startDate: frontHistory[0].asOfDate,
    endDate: frontHistory[frontHistory.length - 1].asOfDate,
    hasEnoughHistory: frontHistory.length >= 20,
    ivPercentile: computePercentileRank(
      frontHistory.map((row) => row.straddleImpliedVolatility),
      focusContract.straddleImpliedVolatility,
    ),
    movePercentile: computePercentileRank(
      frontHistory.map((row) => row.impliedMovePercent),
      focusContract.impliedMovePercent,
    ),
    ivHv20Percentile: computePercentileRank(
      frontHistory.map((row) => row.ivHv20Ratio),
      focusContract.ivHv20Ratio,
    ),
    ivHv60Percentile: computePercentileRank(
      frontHistory.map((row) => row.ivHv60Ratio),
      focusContract.ivHv60Ratio,
    ),
  };
}

function buildWarnings(snapshot, contracts) {
  const warnings = [];
  if (snapshot.note) {
    warnings.push(snapshot.note);
  }
  if (snapshot.storageWarning) {
    warnings.push(snapshot.storageWarning);
  }
  if (snapshot.spotDate && snapshot.asOfDate && snapshot.spotDate !== snapshot.asOfDate) {
    warnings.push(
      `Spot uses the latest close from ${snapshot.spotDate}, while the option chain snapshot is dated ${snapshot.asOfDate}.`,
    );
  }
  if (
    snapshot.realizedVolatility &&
    Number.isFinite(Number(snapshot.realizedVolatility.observations)) &&
    Number(snapshot.realizedVolatility.observations) < 61
  ) {
    warnings.push(
      `Realized-vol context is based on only ${snapshot.realizedVolatility.observations} closes. HV60 and longer windows may be incomplete.`,
    );
  }
  if (
    !contracts.some(
      (contract) =>
        isFiniteNumber(contract.historicalVolatility20) || isFiniteNumber(contract.historicalVolatility60),
    )
  ) {
    warnings.push(
      "No usable historical-volatility context was available for the current snapshot, so IV/HV pricing reads are suppressed.",
    );
  }
  const frontHistoryCount = Array.isArray(snapshot.history?.frontContracts)
    ? snapshot.history.frontContracts.length
    : 0;
  if (frontHistoryCount > 0 && frontHistoryCount < 20) {
    warnings.push(
      `Historical IV percentiles are based on only ${frontHistoryCount} stored front-month snapshots so far. Treat them as provisional.`,
    );
  }
  if (contracts.length < snapshot.maxContracts) {
    warnings.push(
      `Only ${contracts.length} monthly contract${contracts.length === 1 ? "" : "s"} met the minimum ${snapshot.minimumDte}-day filter.`,
    );
  }
  if (contracts.some((contract) => contract.pricingMode !== "bid-ask-mid")) {
    warnings.push(
      "At least one contract fell back to last price on one option leg because a usable bid/ask mid was unavailable.",
    );
  }
  if (contracts.some((contract) => contract.combinedOpenInterest < 1000)) {
    warnings.push(
      "One or more monthly contracts have combined open interest below 1,000. Liquidity may be too thin for a clean ATM read.",
    );
  }
  if (
    contracts.some(
      (contract) =>
        isFiniteNumber(contract.callSpread) &&
        isFiniteNumber(contract.putSpread) &&
        isFiniteNumber(contract.straddleMidPrice) &&
        contract.straddleMidPrice > 0 &&
        (contract.callSpread + contract.putSpread) / contract.straddleMidPrice > 0.12,
    )
  ) {
    warnings.push(
      "One or more monthly straddles have wide combined bid/ask spreads relative to premium. Treat the move estimate as indicative.",
    );
  }
  return warnings;
}

function buildMonthlyStraddleStudyRun(
  snapshot,
  {
    requestedSymbol = snapshot?.symbol || "",
    minimumDte = DEFAULT_MINIMUM_DTE,
    maxContracts = DEFAULT_CONTRACT_COUNT,
    exportedAt = new Date(),
  } = {},
) {
  if (!snapshot?.symbol) {
    throw new Error("The monthly straddle snapshot is missing a symbol.");
  }
  if (!Array.isArray(snapshot.monthlyContracts) || !snapshot.monthlyContracts.length) {
    throw new Error("The monthly straddle snapshot did not return any monthly contracts.");
  }

  const contracts = snapshot.monthlyContracts
    .map(normalizeContract)
    .sort((left, right) => left.daysToExpiry - right.daysToExpiry);
  const focusContract = contracts[0];
  const lastContract = contracts[contracts.length - 1];
  const frontHistory = Array.isArray(snapshot.history?.frontContracts)
    ? snapshot.history.frontContracts
        .map(normalizeFrontHistoryRow)
        .sort((left, right) => left.asOfDate - right.asOfDate)
    : [];
  const curveShape = slopeLabel(
    focusContract.straddleImpliedVolatility,
    lastContract.straddleImpliedVolatility,
  );
  const focusVolComparison = buildFocusVolComparison(focusContract);
  const historySummary = buildHistorySummary(frontHistory, focusContract);

  return {
    studyTitle: "Monthly Straddle Snapshot",
    symbol: snapshot.symbol,
    requestedSymbol,
    provider: snapshot.provider,
    providerName: snapshot.providerName,
    currency: snapshot.currency || "",
    spotPrice: Number(snapshot.spotPrice),
    spotDate: snapshot.spotDate ? new Date(`${snapshot.spotDate}T00:00:00`) : null,
    asOfDate: snapshot.asOfDate ? new Date(`${snapshot.asOfDate}T00:00:00`) : null,
    fetchedAt: snapshot.fetchedAt ? new Date(snapshot.fetchedAt) : new Date(),
    realizedVolatility: {
      seriesType: snapshot.realizedVolatility?.seriesType || "close",
      observations: Number(snapshot.realizedVolatility?.observations),
      startDate: snapshot.realizedVolatility?.startDate
        ? new Date(`${snapshot.realizedVolatility.startDate}T00:00:00`)
        : null,
      endDate: snapshot.realizedVolatility?.endDate
        ? new Date(`${snapshot.realizedVolatility.endDate}T00:00:00`)
        : null,
      hv20: Number(snapshot.realizedVolatility?.hv20),
      hv60: Number(snapshot.realizedVolatility?.hv60),
      hv120: Number(snapshot.realizedVolatility?.hv120),
    },
    minimumDte: Number(minimumDte || snapshot.minimumDte || DEFAULT_MINIMUM_DTE),
    maxContracts: Number(maxContracts || snapshot.maxContracts || DEFAULT_CONTRACT_COUNT),
    contracts,
    focusContract,
    frontHistory,
    historySummary,
    focusVolComparison,
    curveShape,
    curveSlope:
      isFiniteNumber(focusContract.straddleImpliedVolatility) &&
      isFiniteNumber(lastContract.straddleImpliedVolatility)
        ? lastContract.straddleImpliedVolatility - focusContract.straddleImpliedVolatility
        : null,
    warnings: buildWarnings(snapshot, contracts),
    exportedAt,
  };
}

function flattenMonthlyStraddleRows(studyRun) {
  return studyRun.contracts.map((contract, index) => ({
    rank: index + 1,
    symbol: studyRun.symbol,
    providerName: studyRun.providerName,
    currency: studyRun.currency,
    spotPrice: studyRun.spotPrice,
    asOfDate: studyRun.asOfDate,
    expiry: contract.expiry,
    daysToExpiry: contract.daysToExpiry,
    strike: contract.strike,
    callBid: contract.callBid,
    callAsk: contract.callAsk,
    callLastPrice: contract.callLastPrice,
    callMidPrice: contract.callMidPrice,
    callOpenInterest: contract.callOpenInterest,
    callVolume: contract.callVolume,
    callImpliedVolatility: contract.callImpliedVolatility,
    putBid: contract.putBid,
    putAsk: contract.putAsk,
    putLastPrice: contract.putLastPrice,
    putMidPrice: contract.putMidPrice,
    putOpenInterest: contract.putOpenInterest,
    putVolume: contract.putVolume,
    putImpliedVolatility: contract.putImpliedVolatility,
    straddleMidPrice: contract.straddleMidPrice,
    impliedMovePrice: contract.impliedMovePrice,
    impliedMovePercent: contract.impliedMovePercent,
    straddleImpliedVolatility: contract.straddleImpliedVolatility,
    chainImpliedVolatility: contract.chainImpliedVolatility,
    impliedVolatilityGap: contract.impliedVolatilityGap,
    historicalVolatility20: contract.historicalVolatility20,
    historicalVolatility60: contract.historicalVolatility60,
    historicalVolatility120: contract.historicalVolatility120,
    ivHv20Ratio: contract.ivHv20Ratio,
    ivHv60Ratio: contract.ivHv60Ratio,
    ivHv120Ratio: contract.ivHv120Ratio,
    ivHv20Spread: contract.ivHv20Spread,
    ivHv60Spread: contract.ivHv60Spread,
    ivHv120Spread: contract.ivHv120Spread,
    combinedOpenInterest: contract.combinedOpenInterest,
    combinedVolume: contract.combinedVolume,
    pricingMode: contract.pricingMode,
  }));
}

export {
  DEFAULT_CONTRACT_COUNT,
  DEFAULT_MINIMUM_DTE,
  buildMonthlyStraddleStudyRun,
  flattenMonthlyStraddleRows,
};
