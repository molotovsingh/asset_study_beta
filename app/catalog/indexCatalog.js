import { sectorMarketCatalog } from "./sectorSnapshotCatalog.js";

const baseIndexCatalog = [
  {
    id: "nifty-50",
    label: "Nifty 50",
    provider: "NSE Indices",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty", "nifty fifty", "nifty50"],
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: "nifty-50",
      symbol: "^NSEI",
      sourceSeriesType: "Price",
    },
  },
  {
    id: "nifty-50-tri",
    label: "Nifty 50 TRI",
    provider: "NSE Indices",
    family: "Broad Market",
    currency: "INR",
    seriesType: "TRI",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty 50 total return index", "nifty50 tri"],
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: "nifty-50-tri",
      symbol: "^NSEI",
      sourceSeriesType: "Price",
      note: "Bootstrap sync uses the Yahoo Finance price index as a temporary TRI proxy.",
    },
  },
  {
    id: "nifty-next-50",
    label: "Nifty Next 50",
    provider: "NSE Indices",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty next fifty"],
  },
  {
    id: "nifty-500",
    label: "Nifty 500",
    provider: "NSE Indices",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/indices/equity/broad-based-indices/nifty-500",
    aliases: ["nifty500"],
    symbol: "^CRSLDX",
    note:
      "This built-in index loads through the local backend because it is not bundled in the repo snapshots.",
  },
  {
    id: "nifty-bank",
    label: "Nifty Bank",
    provider: "NSE Indices",
    family: "Sectoral",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["bank nifty"],
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: "nifty-bank",
      symbol: "^NSEBANK",
      sourceSeriesType: "Price",
    },
  },
  {
    id: "nifty-realty",
    label: "Nifty Realty",
    provider: "NSE Indices",
    family: "Sectoral",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty real estate"],
    symbol: "^CNXREALTY",
    note:
      "This built-in index loads through the local backend because it is not bundled in the repo snapshots.",
  },
  {
    id: "nifty-metal",
    label: "Nifty Metal",
    provider: "NSE Indices",
    family: "Sectoral",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty metals", "nifty metal index"],
    symbol: "^CNXMETAL",
    note:
      "This built-in index loads through the local backend because it is not bundled in the repo snapshots.",
  },
  {
    id: "nifty-energy",
    label: "Nifty Energy",
    provider: "NSE Indices",
    family: "Sectoral",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty energy index"],
    symbol: "^CNXENERGY",
    note:
      "This built-in index loads through the local backend because it is not bundled in the repo snapshots.",
  },
  {
    id: "nifty-midcap-150",
    label: "Nifty Midcap 150",
    provider: "NSE Indices",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty midcap150"],
  },
  {
    id: "nifty-smallcap-250",
    label: "Nifty Smallcap 250",
    provider: "NSE Indices",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty smallcap250"],
  },
  {
    id: "sensex",
    label: "S&P BSE Sensex",
    provider: "BSE",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["sensex", "bse sensex"],
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: "sensex",
      symbol: "^BSESN",
      sourceSeriesType: "Price",
    },
  },
  {
    id: "sensex-tri",
    label: "S&P BSE Sensex TRI",
    provider: "BSE",
    family: "Broad Market",
    currency: "INR",
    seriesType: "TRI",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["sensex total return index", "bse sensex tri"],
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId: "sensex-tri",
      symbol: "^BSESN",
      sourceSeriesType: "Price",
      note: "Bootstrap sync uses the Yahoo Finance price index as a temporary TRI proxy.",
    },
  },
  {
    id: "bse-100",
    label: "S&P BSE 100",
    provider: "BSE",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["bse 100"],
  },
  {
    id: "bse-500",
    label: "S&P BSE 500",
    provider: "BSE",
    family: "Broad Market",
    currency: "INR",
    seriesType: "Price",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["bse500"],
  },
  {
    id: "custom",
    label: "Custom Index",
    provider: "Manual",
    family: "Any",
    seriesType: "CSV Upload",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["manual", "upload"],
  },
];

function buildDerivedIndiaSectorEntries() {
  const indiaMarket = sectorMarketCatalog.find((entry) => entry.id === "india");
  if (!indiaMarket?.sectors?.length) {
    return [];
  }

  const existingIds = new Set(baseIndexCatalog.map((entry) => entry.id));
  return indiaMarket.sectors
    .filter((entry) => !existingIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      provider: entry.providerName || "NSE Indices",
      family: "Sectoral",
      currency: "INR",
      seriesType: entry.seriesType || "Price",
      sourceUrl:
        entry.sourceUrl || "https://www.niftyindices.com/reports/historical-data",
      aliases: [],
      symbol: entry.symbol,
      note:
        "This built-in index loads through the local backend because it is not bundled in the repo snapshots.",
    }));
}

const indexCatalog = [...baseIndexCatalog, ...buildDerivedIndiaSectorEntries()];

function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function findIndexByName(name) {
  const query = normalize(name || "");
  if (!query) {
    return null;
  }

  return (
    indexCatalog.find((entry) => normalize(entry.label) === query) ||
    indexCatalog.find((entry) =>
      entry.aliases.some((alias) => normalize(alias) === query),
    ) ||
    null
  );
}

function getIndexById(indexId) {
  return indexCatalog.find((entry) => entry.id === indexId) || null;
}

function getSyncedIndexCatalog() {
  return indexCatalog.filter((entry) => entry.sync);
}

function getRunnableIndexCatalog() {
  return indexCatalog.filter((entry) => entry.sync?.symbol || entry.symbol);
}

function entryMatchesQuery(entry, query) {
  if (!query) {
    return false;
  }

  if (normalize(entry.label) === query) {
    return true;
  }

  if (entry.aliases.some((alias) => normalize(alias) === query)) {
    return true;
  }

  return normalize(entry.sync?.symbol || entry.symbol || "") === query;
}

function findRunnableIndexMatch(name) {
  const query = normalize(name || "");
  if (!query) {
    return null;
  }

  return getRunnableIndexCatalog().find((entry) => entryMatchesQuery(entry, query)) || null;
}

export {
  indexCatalog,
  findIndexByName,
  findRunnableIndexMatch,
  getIndexById,
  getRunnableIndexCatalog,
  getSyncedIndexCatalog,
};
