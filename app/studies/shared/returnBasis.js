const RETURN_BASIS = Object.freeze({
  PRICE: "price",
  TOTAL_RETURN: "total_return",
  PROXY: "proxy",
});

function normalizeSeriesType(value) {
  return String(value || "").trim();
}

function normalizeReturnBasisValue(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function deriveReturnBasis({ targetSeriesType, sourceSeriesType }) {
  const target = normalizeSeriesType(targetSeriesType).toLowerCase();
  const source = normalizeSeriesType(sourceSeriesType || targetSeriesType).toLowerCase();

  if (target && source && target !== source) {
    return RETURN_BASIS.PROXY;
  }
  if (["tri", "total_return", "total return"].includes(target)) {
    return RETURN_BASIS.TOTAL_RETURN;
  }
  return RETURN_BASIS.PRICE;
}

function normalizeReturnBasis({ returnBasis, targetSeriesType, sourceSeriesType }) {
  const normalized = normalizeReturnBasisValue(returnBasis);
  if (Object.values(RETURN_BASIS).includes(normalized)) {
    return normalized;
  }
  return deriveReturnBasis({ targetSeriesType, sourceSeriesType });
}

function getReturnBasisLabel(returnBasis) {
  switch (normalizeReturnBasisValue(returnBasis)) {
    case RETURN_BASIS.TOTAL_RETURN:
      return "Total return";
    case RETURN_BASIS.PROXY:
      return "Proxy";
    case RETURN_BASIS.PRICE:
      return "Price";
    default:
      return "Unknown";
  }
}

function buildReturnBasisWarning({
  returnBasis,
  targetSeriesType,
  sourceSeriesType,
}) {
  const normalized = normalizeReturnBasis({
    returnBasis,
    targetSeriesType,
    sourceSeriesType,
  });
  if (normalized !== RETURN_BASIS.PROXY) {
    return "";
  }

  const target = normalizeSeriesType(targetSeriesType) || "the requested series";
  const source = normalizeSeriesType(sourceSeriesType) || "the loaded source";
  return `Loaded data is marked as a ${source} proxy for ${target}. Do not treat it as true total-return evidence.`;
}

export {
  RETURN_BASIS,
  buildReturnBasisWarning,
  deriveReturnBasis,
  getReturnBasisLabel,
  normalizeReturnBasis,
};
