import { getRunnableIndexCatalog } from "../../catalog/indexCatalog.js";

function buildYahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function normalizeQuery(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildBuiltInSelection(entry, bundledDataset = null) {
  return {
    kind: "builtin",
    id: entry.id,
    label: entry.label,
    symbol: entry.sync.symbol,
    currency: bundledDataset?.currency || entry.currency || null,
    providerName: entry.provider,
    family: entry.family,
    targetSeriesType: entry.seriesType,
    sourceSeriesType:
      bundledDataset?.sourceSeriesType ||
      entry.sync.sourceSeriesType ||
      entry.seriesType,
    sourceUrl: bundledDataset?.sourceUrl || entry.sourceUrl,
    note: bundledDataset?.note || entry.sync.note || null,
    aliases: entry.aliases || [],
    generatedAt: bundledDataset?.generatedAt || null,
    range: bundledDataset?.range || null,
    sync: entry.sync,
    path: bundledDataset?.path || null,
  };
}

function buildBundledSelection(entry) {
  return {
    kind: "bundled",
    id: entry.datasetId,
    label: entry.label || entry.datasetId,
    symbol: entry.symbol,
    currency: entry.currency || null,
    providerName: entry.providerName || "Yahoo Finance",
    family: entry.family || "Bundled",
    targetSeriesType: entry.targetSeriesType || "Price",
    sourceSeriesType:
      entry.sourceSeriesType || entry.targetSeriesType || "Price",
    sourceUrl: entry.sourceUrl || buildYahooQuoteUrl(entry.symbol),
    note: entry.note || null,
    aliases: [],
    generatedAt: entry.generatedAt || null,
    range: entry.range || null,
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: entry.datasetId,
      symbol: entry.symbol,
      sourceSeriesType:
        entry.sourceSeriesType || entry.targetSeriesType || "Price",
    },
    path: entry.path || null,
  };
}

function buildRememberedSelection(entry) {
  return {
    kind: "remembered",
    id: entry.datasetId || entry.symbol,
    label: entry.label || entry.symbol,
    symbol: entry.symbol,
    currency: entry.currency || null,
    providerName: entry.providerName || "Yahoo Finance",
    family: entry.family || "Remembered",
    targetSeriesType: entry.targetSeriesType || "Price",
    sourceSeriesType:
      entry.sourceSeriesType || entry.targetSeriesType || "Price",
    sourceUrl: entry.sourceUrl || buildYahooQuoteUrl(entry.symbol),
    note: entry.note || null,
    aliases: [],
    generatedAt: entry.generatedAt || null,
    range: entry.range || null,
    sync: null,
    path: entry.path || null,
  };
}

function buildAdHocSelection(rawValue) {
  const symbol = rawValue.trim();

  return {
    kind: "adhoc",
    id: `adhoc:${symbol}`,
    label: symbol,
    symbol,
    currency: null,
    providerName: "Yahoo Finance",
    family: "Ad hoc",
    targetSeriesType: "Price",
    sourceSeriesType: "Price",
    sourceUrl: buildYahooQuoteUrl(symbol),
    note: null,
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

  const rememberedSymbolMatch = symbolMatches.find(
    (entry) => entry.kind === "remembered",
  );
  if (rememberedSymbolMatch) {
    return rememberedSymbolMatch;
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
    sourceUrl: selection.sourceUrl,
    note: selection.note,
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
  buildSelectionSignature,
  buildSeriesRequest,
  findSelectionByQuery,
  mergeSelectionSuggestions,
  upsertRememberedCatalogEntry,
};
