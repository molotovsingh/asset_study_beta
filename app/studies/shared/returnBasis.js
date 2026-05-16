const RETURN_BASIS = Object.freeze({
  PRICE: "price",
  TOTAL_RETURN: "total_return",
  PROXY: "proxy",
});

const TOTAL_RETURN_SERIES_TYPES = new Set(["tri", "total_return", "total return"]);

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
  if (TOTAL_RETURN_SERIES_TYPES.has(target)) {
    return RETURN_BASIS.TOTAL_RETURN;
  }
  return RETURN_BASIS.PRICE;
}

function normalizeReturnBasis({ returnBasis, targetSeriesType, sourceSeriesType }) {
  const normalized = normalizeReturnBasisValue(returnBasis);
  const derived = deriveReturnBasis({ targetSeriesType, sourceSeriesType });
  if (normalized === RETURN_BASIS.PROXY) {
    return normalized;
  }
  if (normalized === derived) {
    return normalized;
  }
  return derived;
}

function isReturnBasisProxy({ returnBasis, targetSeriesType, sourceSeriesType }) {
  return (
    normalizeReturnBasis({ returnBasis, targetSeriesType, sourceSeriesType }) ===
    RETURN_BASIS.PROXY
  );
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
  isReturnBasisProxy,
  normalizeReturnBasis,
};
