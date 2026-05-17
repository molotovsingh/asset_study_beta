import { getRunnableIndexCatalog } from "../../catalog/indexCatalog.js";
import { parseManualSelectionInput } from "../../lib/symbolDiscovery.js";
import { normalizeReturnBasis } from "./returnBasis.js";

function buildYahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

const SOURCE_METADATA_KEYS = [
  "sourcePolicy",
  "sourceName",
  "licenseNote",
  "retrievalMethod",
  "updateCadence",
  "lastVerifiedDate",
];

function buildSourceMetadata(...sources) {
  return SOURCE_METADATA_KEYS.reduce((metadata, key) => {
    const value = sources
      .map((source) => source?.[key])
      .find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
    return {
      ...metadata,
      [key]: value || null,
    };
  }, {});
}

function normalizeQuery(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compactQuery(value) {
  return normalizeQuery(value).replace(/[^a-z0-9]+/g, "");
}

function buildSelectionSubjectQuery(selection) {
  if (!selection) {
    return "";
  }

  if (
    selection.kind === "builtin" ||
    selection.kind === "bundled" ||
    selection.kind === "remembered"
  ) {
    return selection.label || selection.symbol || "";
  }

  if (
    selection.kind === "adhoc" &&
    selection.label &&
    selection.symbol &&
    selection.label !== selection.symbol
  ) {
    return `${selection.label} | ${selection.symbol}`;
  }

  return selection.symbol || selection.label || "";
}

function buildBuiltInSelection(entry, bundledDataset = null) {
  const symbol = entry.sync?.symbol || entry.symbol || "";
  const targetSeriesType = entry.seriesType;
  const sourceSeriesType =
    bundledDataset?.sourceSeriesType ||
    entry.sync?.sourceSeriesType ||
    entry.seriesType;
  return {
    kind: "builtin",
    id: entry.id,
    label: entry.label,
    symbol,
    currency: bundledDataset?.currency || entry.currency || null,
    providerName: entry.provider,
    family: entry.family,
    targetSeriesType,
    sourceSeriesType,
    returnBasis: normalizeReturnBasis({
      returnBasis:
        bundledDataset?.returnBasis || entry.sync?.returnBasis || entry.returnBasis,
      targetSeriesType,
      sourceSeriesType,
    }),
    sourceUrl: bundledDataset?.sourceUrl || entry.sourceUrl,
    note: bundledDataset?.note || entry.sync?.note || entry.note || null,
    ...buildSourceMetadata(bundledDataset, entry.sync, entry),
    aliases: entry.aliases || [],
    generatedAt: bundledDataset?.generatedAt || null,
    range: bundledDataset?.range || null,
    sync: entry.sync || null,
    path: bundledDataset?.path || null,
  };
}

function buildBundledSelection(entry) {
  const targetSeriesType = entry.targetSeriesType || "Price";
  const sourceSeriesType = entry.sourceSeriesType || targetSeriesType;
  return {
    kind: "bundled",
    id: entry.datasetId,
    label: entry.label || entry.datasetId,
    symbol: entry.symbol,
    currency: entry.currency || null,
    providerName: entry.providerName || "Yahoo Finance",
    family: entry.family || "Bundled",
    targetSeriesType,
    sourceSeriesType,
    returnBasis: normalizeReturnBasis({
      returnBasis: entry.returnBasis,
      targetSeriesType,
      sourceSeriesType,
    }),
    sourceUrl: entry.sourceUrl || buildYahooQuoteUrl(entry.symbol),
    note: entry.note || null,
    ...buildSourceMetadata(entry),
    aliases: [],
    generatedAt: entry.generatedAt || null,
    range: entry.range || null,
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: entry.datasetId,
      symbol: entry.symbol,
      sourceSeriesType,
      returnBasis: normalizeReturnBasis({
        returnBasis: entry.returnBasis,
        targetSeriesType,
        sourceSeriesType,
      }),
      ...buildSourceMetadata(entry),
    },
    path: entry.path || null,
  };
}

function buildRememberedSelection(entry) {
  const targetSeriesType = entry.targetSeriesType || "Price";
  const sourceSeriesType = entry.sourceSeriesType || targetSeriesType;
  return {
    kind: "remembered",
    id: entry.datasetId || entry.symbol,
    label: entry.label || entry.symbol,
    symbol: entry.symbol,
    currency: entry.currency || null,
    providerName: entry.providerName || "Yahoo Finance",
    family: entry.family || "Remembered",
    targetSeriesType,
    sourceSeriesType,
    returnBasis: normalizeReturnBasis({
      returnBasis: entry.returnBasis,
      targetSeriesType,
      sourceSeriesType,
    }),
    sourceUrl: entry.sourceUrl || buildYahooQuoteUrl(entry.symbol),
    note: entry.note || null,
    ...buildSourceMetadata(entry),
    aliases: [],
    generatedAt: entry.generatedAt || null,
    range: entry.range || null,
    sync: null,
    path: entry.path || null,
  };
}

function buildAdHocSelection(rawValue, { label = null } = {}) {
  const symbol = rawValue.trim();
  const normalizedLabel = String(label || "").trim() || symbol;
  const isManualEntry = normalizedLabel !== symbol;

  return {
    kind: "adhoc",
    id: `adhoc:${symbol}`,
    label: normalizedLabel,
    symbol,
    currency: null,
    providerName: "Yahoo Finance",
    family: isManualEntry ? "Manual" : "Ad hoc",
    targetSeriesType: "Price",
    sourceSeriesType: "Price",
    returnBasis: "price",
    sourcePolicy: "price_only",
    sourceName: "Yahoo Finance via local backend",
    licenseNote: "Local yfinance fetch; price-return evidence only.",
    retrievalMethod: "Local backend yfinance history fetch",
    updateCadence: null,
    lastVerifiedDate: null,
    sourceUrl: buildYahooQuoteUrl(symbol),
    note: isManualEntry
      ? "Manual symbol entry. This label is stored locally after the first successful load."
      : null,
    aliases: [],
    generatedAt: null,
    range: null,
    sync: null,
    path: null,
  };
}

function buildSelectionIdentity(selection) {
  if (!selection) {
    return "none";
  }

  return selection.id
    ? `id:${normalizeQuery(selection.id)}`
    : `sym:${normalizeQuery(selection.symbol)}|${normalizeQuery(
        selection.targetSeriesType || "",
      )}`;
}

function buildSelectionSignature(selection) {
  if (!selection) {
    return "none";
  }

  return [
    selection.kind,
    selection.id,
    selection.symbol,
    selection.targetSeriesType,
  ].join("|");
}

function scoreSelectionSuggestion(entry, normalizedQuery) {
  const normalizedCompactQuery = compactQuery(normalizedQuery);
  const normalizedLabel = normalizeQuery(entry.label || "");
  const normalizedId = normalizeQuery(entry.id || "");
  const normalizedSymbol = normalizeQuery(entry.symbol || "");
  const normalizedFamily = normalizeQuery(entry.family || "");
  const normalizedAliases = (entry.aliases || []).map((alias) =>
    normalizeQuery(alias),
  );
  const compactLabel = compactQuery(entry.label || "");
  const compactId = compactQuery(entry.id || "");
  const compactSymbol = compactQuery(entry.symbol || "");
  const compactFamily = compactQuery(entry.family || "");
  const compactAliases = (entry.aliases || []).map((alias) =>
    compactQuery(alias),
  );

  if (!normalizedQuery) {
    return null;
  }

  if (normalizedLabel === normalizedQuery) {
    return { score: 220, matchKind: "exact-label" };
  }

  if (normalizedId === normalizedQuery) {
    return { score: 214, matchKind: "exact-id" };
  }

  if (normalizedSymbol === normalizedQuery) {
    return { score: 210, matchKind: "exact-symbol" };
  }

  if (normalizedAliases.includes(normalizedQuery)) {
    return { score: 208, matchKind: "exact-alias" };
  }

  if (normalizedCompactQuery && compactLabel === normalizedCompactQuery) {
    return { score: 216, matchKind: "exact-compact-label" };
  }

  if (normalizedCompactQuery && compactId === normalizedCompactQuery) {
    return { score: 210, matchKind: "exact-compact-id" };
  }

  if (normalizedCompactQuery && compactSymbol === normalizedCompactQuery) {
    return { score: 206, matchKind: "exact-compact-symbol" };
  }

  if (
    normalizedCompactQuery &&
    compactAliases.includes(normalizedCompactQuery)
  ) {
    return { score: 204, matchKind: "exact-compact-alias" };
  }

  if (normalizedLabel.startsWith(normalizedQuery)) {
    return { score: 182, matchKind: "starts-with-label" };
  }

  if (normalizedAliases.some((alias) => alias.startsWith(normalizedQuery))) {
    return { score: 176, matchKind: "starts-with-alias" };
  }

  if (normalizedSymbol.startsWith(normalizedQuery)) {
    return { score: 172, matchKind: "starts-with-symbol" };
  }

  if (
    normalizedCompactQuery &&
    compactLabel.startsWith(normalizedCompactQuery)
  ) {
    return { score: 176, matchKind: "starts-with-compact-label" };
  }

  if (
    normalizedCompactQuery &&
    compactAliases.some((alias) => alias.startsWith(normalizedCompactQuery))
  ) {
    return { score: 170, matchKind: "starts-with-compact-alias" };
  }

  if (
    normalizedCompactQuery &&
    compactSymbol.startsWith(normalizedCompactQuery)
  ) {
    return { score: 166, matchKind: "starts-with-compact-symbol" };
  }

  if (normalizedLabel.includes(normalizedQuery)) {
    return { score: 148, matchKind: "contains-label" };
  }

  if (normalizedAliases.some((alias) => alias.includes(normalizedQuery))) {
    return { score: 142, matchKind: "contains-alias" };
  }

  if (normalizedSymbol.includes(normalizedQuery)) {
    return { score: 138, matchKind: "contains-symbol" };
  }

  if (
    normalizedCompactQuery &&
    compactLabel.includes(normalizedCompactQuery)
  ) {
    return { score: 144, matchKind: "contains-compact-label" };
  }

  if (
    normalizedCompactQuery &&
    compactAliases.some((alias) => alias.includes(normalizedCompactQuery))
  ) {
    return { score: 140, matchKind: "contains-compact-alias" };
  }

  if (
    normalizedCompactQuery &&
    compactSymbol.includes(normalizedCompactQuery)
  ) {
    return { score: 136, matchKind: "contains-compact-symbol" };
  }

  if (normalizedFamily && normalizedFamily.includes(normalizedQuery)) {
    return { score: 122, matchKind: "contains-family" };
  }

  if (
    normalizedCompactQuery &&
    compactFamily &&
    compactFamily.includes(normalizedCompactQuery)
  ) {
    return { score: 118, matchKind: "contains-compact-family" };
  }

  return null;
}

function discoverSelectionSuggestions(query, suggestions, { limit = 8 } = {}) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const matches = suggestions
    .map((entry) => {
      const scored = scoreSelectionSuggestion(entry, normalizedQuery);
      if (!scored) {
        return null;
      }

      return {
        kind: entry.kind,
        label: entry.label,
        symbol: entry.symbol,
        subjectQuery: buildSelectionSubjectQuery(entry),
        providerName: entry.providerName || "Yahoo Finance",
        family: entry.family || null,
        targetSeriesType: entry.targetSeriesType || null,
        sourceSeriesType: entry.sourceSeriesType || null,
        returnBasis: entry.returnBasis || null,
        sourcePolicy: entry.sourcePolicy || null,
        note: entry.note || null,
        matchKind: scored.matchKind,
        matchScore: scored.score,
        selection: entry,
      };
    })
    .filter(Boolean);

  matches.sort((left, right) => {
    if (right.matchScore !== left.matchScore) {
      return right.matchScore - left.matchScore;
    }

    if ((left.label || "").length !== (right.label || "").length) {
      return (left.label || "").length - (right.label || "").length;
    }

    return (left.symbol || "").localeCompare(right.symbol || "");
  });

  const uniqueMatches = [];
  const seen = new Set();
  for (const suggestion of matches) {
    const identity = buildSelectionIdentity(suggestion.selection);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    uniqueMatches.push(suggestion);
    if (uniqueMatches.length >= limit) {
      break;
    }
  }

  return uniqueMatches;
}

function mergeSelectionSuggestions(bundledManifest, rememberedCatalog) {
  const bundledDatasets = bundledManifest?.datasets || [];
  const bundledById = new Map(
    bundledDatasets.map((entry) => [entry.datasetId, entry]),
  );
  const builtIns = getRunnableIndexCatalog().map((entry) =>
    buildBuiltInSelection(entry, bundledById.get(entry.id) || null),
  );
  const builtInIds = new Set(builtIns.map((entry) => entry.id));
  const bundledOnly = bundledDatasets
    .filter((entry) => !builtInIds.has(entry.datasetId))
    .map(buildBundledSelection);
  const seen = new Set(
    [...builtIns, ...bundledOnly].map(buildSelectionIdentity),
  );
  const remembered = rememberedCatalog
    .map(buildRememberedSelection)
    .filter((entry) => !seen.has(buildSelectionIdentity(entry)));

  return [...builtIns, ...bundledOnly, ...remembered];
}

function findSelectionByQuery(query, suggestions) {
  const normalized = normalizeQuery(query);
  const compact = compactQuery(query);
  if (!normalized) {
    return null;
  }

  const labelMatch = suggestions.find(
    (entry) => normalizeQuery(entry.label) === normalized,
  );
  if (labelMatch) {
    return labelMatch;
  }

  const idMatch = suggestions.find(
    (entry) => normalizeQuery(entry.id || "") === normalized,
  );
  if (idMatch) {
    return idMatch;
  }

  const aliasMatch = suggestions.find((entry) =>
    entry.aliases.some((alias) => normalizeQuery(alias) === normalized),
  );
  if (aliasMatch) {
    return aliasMatch;
  }

  const symbolMatches = suggestions.filter(
    (entry) => normalizeQuery(entry.symbol) === normalized,
  );
  if (symbolMatches.length === 1) {
    return symbolMatches[0];
  }

  if (compact) {
    const compactLabelMatch = suggestions.find(
      (entry) => compactQuery(entry.label) === compact,
    );
    if (compactLabelMatch) {
      return compactLabelMatch;
    }

    const compactIdMatch = suggestions.find(
      (entry) => compactQuery(entry.id || "") === compact,
    );
    if (compactIdMatch) {
      return compactIdMatch;
    }

    const compactAliasMatch = suggestions.find((entry) =>
      entry.aliases.some((alias) => compactQuery(alias) === compact),
    );
    if (compactAliasMatch) {
      return compactAliasMatch;
    }

    const compactSymbolMatches = suggestions.filter(
      (entry) => compactQuery(entry.symbol) === compact,
    );
    if (compactSymbolMatches.length === 1) {
      return compactSymbolMatches[0];
    }

    const rememberedCompactSymbolMatch = compactSymbolMatches.find(
      (entry) => entry.kind === "remembered",
    );
    if (rememberedCompactSymbolMatch) {
      return rememberedCompactSymbolMatch;
    }
  }

  const rememberedSymbolMatch = symbolMatches.find(
    (entry) => entry.kind === "remembered",
  );
  if (rememberedSymbolMatch) {
    return rememberedSymbolMatch;
  }

  const manualSelection = parseManualSelectionInput(query);
  if (manualSelection) {
    return buildAdHocSelection(manualSelection.symbol, {
      label: manualSelection.label,
    });
  }

  return buildAdHocSelection(query);
}

function buildSeriesRequest(selection) {
  return {
    datasetId: selection.kind === "adhoc" ? undefined : selection.id,
    symbol: selection.symbol,
    label: selection.label,
    currency: selection.currency,
    providerName: selection.providerName,
    family: selection.family,
    targetSeriesType: selection.targetSeriesType,
    sourceSeriesType: selection.sourceSeriesType,
    returnBasis: selection.returnBasis,
    sourceUrl: selection.sourceUrl,
    note: selection.note,
    sourcePolicy: selection.sourcePolicy,
    sourceName: selection.sourceName,
    licenseNote: selection.licenseNote,
    retrievalMethod: selection.retrievalMethod,
    updateCadence: selection.updateCadence,
    lastVerifiedDate: selection.lastVerifiedDate,
    remember: selection.kind !== "builtin" && selection.kind !== "bundled",
  };
}

function upsertRememberedCatalogEntry(catalog, entry) {
  if (!entry?.symbol) {
    return catalog;
  }

  const nextCatalog = [...catalog];
  const nextEntry = buildRememberedSelection(entry);
  const nextIdentity = buildSelectionIdentity(nextEntry);
  const existingIndex = nextCatalog.findIndex(
    (item) =>
      buildSelectionIdentity(buildRememberedSelection(item)) === nextIdentity,
  );

  if (existingIndex >= 0) {
    nextCatalog[existingIndex] = entry;
  } else {
    nextCatalog.push(entry);
  }

  return nextCatalog;
}

export {
  buildRememberedSelection,
  buildSelectionSubjectQuery,
  buildSelectionSignature,
  buildSeriesRequest,
  discoverSelectionSuggestions,
  findSelectionByQuery,
  mergeSelectionSuggestions,
  upsertRememberedCatalogEntry,
};
