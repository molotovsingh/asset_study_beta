function normalizeDiscoveryText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function compactDiscoveryText(value) {
  return normalizeDiscoveryText(value).replace(/[^a-z0-9]+/g, "");
}

function parseManualSelectionInput(query) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) {
    return null;
  }

  const separators = ["::", "|"];
  for (const separator of separators) {
    const parts = rawQuery.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) {
      continue;
    }

    const [left, right] = parts;
    const leftIsSymbol = isExplicitMarketSymbol(left);
    const rightIsSymbol = isExplicitMarketSymbol(right);
    if (leftIsSymbol === rightIsSymbol) {
      continue;
    }

    return leftIsSymbol
      ? { symbol: left, label: right, separator }
      : { symbol: right, label: left, separator };
  }

  return null;
}

function isExplicitMarketSymbol(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return false;
  }

  if (/^\^/.test(trimmedQuery) || /[=/.]/.test(trimmedQuery)) {
    return true;
  }

  return /^[A-Z0-9-]{1,10}$/.test(trimmedQuery);
}

function shouldSearchRemoteSymbols(query) {
  const trimmedQuery = String(query || "").trim();
  if (trimmedQuery.length < 2) {
    return false;
  }

  if (parseManualSelectionInput(trimmedQuery)) {
    return false;
  }

  if (/^\^/.test(trimmedQuery) || /[=/]/.test(trimmedQuery)) {
    return false;
  }

  return true;
}

function chooseAutoResolvedSuggestion(query, suggestions) {
  if (!Array.isArray(suggestions) || !suggestions.length) {
    return null;
  }

  const normalizedQuery = normalizeDiscoveryText(query);
  const compactQuery = compactDiscoveryText(query);
  const [topSuggestion, nextSuggestion] = suggestions;
  const topScore = Number(topSuggestion?.matchScore || 0);
  const nextScore = Number(nextSuggestion?.matchScore || 0);
  const scoreGap = topScore - nextScore;
  const exactishKinds = new Set([
    "exact-label",
    "exact-id",
    "exact-symbol",
    "exact-alias",
    "exact-company",
    "exact-description",
    "exact-compact-label",
    "exact-compact-id",
    "exact-compact-symbol",
    "exact-compact-alias",
    "exact-compact-company",
    "exact-compact-description",
  ]);

  const topInput = normalizeDiscoveryText(
    topSuggestion?.inputValue || topSuggestion?.subjectQuery,
  );
  const topLabel = normalizeDiscoveryText(topSuggestion?.label);
  const topSymbol = normalizeDiscoveryText(topSuggestion?.symbol);
  const topCompactInput = compactDiscoveryText(
    topSuggestion?.inputValue || topSuggestion?.subjectQuery,
  );
  const topCompactLabel = compactDiscoveryText(topSuggestion?.label);
  const topCompactSymbol = compactDiscoveryText(topSuggestion?.symbol);

  if (
    exactishKinds.has(String(topSuggestion?.matchKind || "")) &&
    topScore >= 208
  ) {
    return topSuggestion;
  }

  if (
    normalizedQuery &&
    (
      normalizedQuery === topInput ||
      normalizedQuery === topLabel ||
      normalizedQuery === topSymbol ||
      compactQuery === topCompactInput ||
      compactQuery === topCompactLabel ||
      compactQuery === topCompactSymbol
    ) &&
    topScore >= 180
  ) {
    return topSuggestion;
  }

  if (normalizedQuery.length >= 4 && topScore >= 200 && scoreGap >= 18) {
    return topSuggestion;
  }

  if (
    topSuggestion?.kind !== "provider" &&
    normalizedQuery.length >= 4 &&
    topScore >= 176 &&
    scoreGap >= 12
  ) {
    return topSuggestion;
  }

  return null;
}

export {
  chooseAutoResolvedSuggestion,
  compactDiscoveryText,
  isExplicitMarketSymbol,
  normalizeDiscoveryText,
  parseManualSelectionInput,
  shouldSearchRemoteSymbols,
};
