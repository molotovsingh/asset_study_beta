const indexCatalog = [
  {
    id: "nifty-50-tri",
    label: "Nifty 50 TRI",
    provider: "NSE Indices",
    family: "Broad Market",
    seriesType: "TRI",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty 50 total return index", "nifty50 tri"],
  },
  {
    id: "nifty-next-50",
    label: "Nifty Next 50",
    provider: "NSE Indices",
    family: "Broad Market",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty next fifty"],
  },
  {
    id: "nifty-bank",
    label: "Nifty Bank",
    provider: "NSE Indices",
    family: "Sectoral",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["bank nifty"],
  },
  {
    id: "nifty-midcap-150",
    label: "Nifty Midcap 150",
    provider: "NSE Indices",
    family: "Broad Market",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty midcap150"],
  },
  {
    id: "nifty-smallcap-250",
    label: "Nifty Smallcap 250",
    provider: "NSE Indices",
    family: "Broad Market",
    seriesType: "Price",
    sourceUrl: "https://www.niftyindices.com/reports/historical-data",
    aliases: ["nifty smallcap250"],
  },
  {
    id: "sensex",
    label: "S&P BSE Sensex",
    provider: "BSE",
    family: "Broad Market",
    seriesType: "Price",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["sensex", "bse sensex"],
  },
  {
    id: "sensex-tri",
    label: "S&P BSE Sensex TRI",
    provider: "BSE",
    family: "Broad Market",
    seriesType: "TRI",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["sensex total return index", "bse sensex tri"],
  },
  {
    id: "bse-100",
    label: "S&P BSE 100",
    provider: "BSE",
    family: "Broad Market",
    seriesType: "Price",
    sourceUrl: "https://www.bseindia.com/indices/IndexArchiveData.html",
    aliases: ["bse 100"],
  },
  {
    id: "bse-500",
    label: "S&P BSE 500",
    provider: "BSE",
    family: "Broad Market",
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

export { indexCatalog, findIndexByName };
