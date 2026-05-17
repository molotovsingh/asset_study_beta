const RETURN_BASIS = Object.freeze({
  PRICE: "price",
  TOTAL_RETURN: "total_return",
  PROXY: "proxy",
});

const TOTAL_RETURN_SERIES_TYPES = new Set(["tri", "total_return", "total return"]);
const SOURCE_POLICY = Object.freeze({
  PRICE_ONLY: "price_only",
  APPROVED_TOTAL_RETURN: "approved_total_return",
  BLOCKED_PROXY_TRI: "blocked_proxy_tri",
});
const SOURCE_POLICY_VALUES = new Set(Object.values(SOURCE_POLICY));

function normalizeSeriesType(value) {
  return String(value || "").trim();
}

function isTotalReturnSeriesType(value) {
  return TOTAL_RETURN_SERIES_TYPES.has(normalizeSeriesType(value).toLowerCase());
}

function normalizeReturnBasisValue(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizePolicyValue(value) {
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

function deriveSourcePolicy({
  returnBasis,
  targetSeriesType,
  sourceSeriesType,
}) {
  const normalizedReturnBasis = normalizeReturnBasis({
    returnBasis,
    targetSeriesType,
    sourceSeriesType,
  });
  if (
    normalizedReturnBasis === RETURN_BASIS.PROXY &&
    isTotalReturnSeriesType(targetSeriesType)
  ) {
    return SOURCE_POLICY.BLOCKED_PROXY_TRI;
  }
  if (
    normalizedReturnBasis === RETURN_BASIS.TOTAL_RETURN &&
    isTotalReturnSeriesType(targetSeriesType)
  ) {
    return SOURCE_POLICY.APPROVED_TOTAL_RETURN;
  }
  return SOURCE_POLICY.PRICE_ONLY;
}

function normalizeSourcePolicy({
  sourcePolicy,
  returnBasis,
  targetSeriesType,
  sourceSeriesType,
}) {
  const normalized = normalizePolicyValue(sourcePolicy);
  const derivedPolicy = deriveSourcePolicy({
    returnBasis,
    targetSeriesType,
    sourceSeriesType,
  });
  if (!normalized) {
    return derivedPolicy === SOURCE_POLICY.APPROVED_TOTAL_RETURN
      ? ""
      : derivedPolicy;
  }
  if (!SOURCE_POLICY_VALUES.has(normalized) || normalized !== derivedPolicy) {
    return "";
  }
  return normalized;
}

function getSourcePolicyLabel(sourcePolicy) {
  switch (normalizePolicyValue(sourcePolicy)) {
    case SOURCE_POLICY.APPROVED_TOTAL_RETURN:
      return "Approved total return";
    case SOURCE_POLICY.BLOCKED_PROXY_TRI:
      return "Blocked proxy TRI";
    case SOURCE_POLICY.PRICE_ONLY:
      return "Price only";
    default:
      return "Unknown source policy";
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

function buildStrictTotalReturnBlockMessage({
  returnBasis,
  targetSeriesType,
  sourceSeriesType,
}) {
  if (!isTotalReturnSeriesType(targetSeriesType)) {
    return "";
  }

  const normalized = normalizeReturnBasis({
    returnBasis,
    targetSeriesType,
    sourceSeriesType,
  });
  if (normalized === RETURN_BASIS.TOTAL_RETURN) {
    return "";
  }

  const target = normalizeSeriesType(targetSeriesType) || "the requested series";
  const source = normalizeSeriesType(sourceSeriesType) || "the loaded source";
  const basisLabel = getReturnBasisLabel(normalized).toLowerCase();
  return `Strict TRI policy requires approved true total-return data for ${target}. Loaded ${source} data is marked as ${basisLabel}, so this TRI-labeled run is blocked.`;
}

export {
  RETURN_BASIS,
  SOURCE_POLICY,
  buildStrictTotalReturnBlockMessage,
  buildReturnBasisWarning,
  deriveReturnBasis,
  deriveSourcePolicy,
  getReturnBasisLabel,
  getSourcePolicyLabel,
  isTotalReturnSeriesType,
  isReturnBasisProxy,
  normalizeReturnBasis,
  normalizeSourcePolicy,
};
