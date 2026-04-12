function buildYahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

const SECTOR_HORIZON_YEARS = [1, 5, 10, 20];

const sectorMarketCatalog = [
  {
    id: "india",
    label: "India",
    universeLabel: "Nifty Sector Indexes",
    preferredProvider: "yfinance",
    note:
      "Cross-sectional sector snapshot using Nifty sector price indexes against Nifty 50.",
    defaultRiskFreeRatePercent: "6.00",
    benchmark: {
      id: "nifty-50",
      label: "Nifty 50",
      symbol: "^NSEI",
      providerName: "NSE Indices",
      family: "Broad Market",
      sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      seriesType: "Price",
      note:
        "Benchmark comparison uses the local market-data cache for the Nifty 50 price index.",
    },
    sectors: [
      {
        id: "nifty-bank",
        label: "Nifty Bank",
        symbol: "^NSEBANK",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-it",
        label: "Nifty IT",
        symbol: "^CNXIT",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-pharma",
        label: "Nifty Pharma",
        symbol: "^CNXPHARMA",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-fmcg",
        label: "Nifty FMCG",
        symbol: "^CNXFMCG",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-auto",
        label: "Nifty Auto",
        symbol: "^CNXAUTO",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-realty",
        label: "Nifty Realty",
        symbol: "^CNXREALTY",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-energy",
        label: "Nifty Energy",
        symbol: "^CNXENERGY",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
      {
        id: "nifty-metal",
        label: "Nifty Metal",
        symbol: "^CNXMETAL",
        providerName: "NSE Indices",
        family: "Sector",
        sourceUrl: "https://www.niftyindices.com/reports/historical-data",
      },
    ],
  },
  {
    id: "usa",
    label: "USA",
    universeLabel: "SPDR Sector ETF Proxies",
    preferredProvider: "yfinance",
    note:
      "Cross-sectional sector snapshot using liquid SPDR sector ETF proxies against SPY for consistent daily history.",
    defaultRiskFreeRatePercent: "4.00",
    benchmark: {
      id: "spy",
      label: "SPDR S&P 500 ETF",
      symbol: "SPY",
      providerName: "State Street SPDR",
      family: "Broad Market Proxy",
      sourceUrl:
        "https://www.ssga.com/us/en/intermediary/etfs/funds/spdr-sp-500-etf-trust-spy",
      seriesType: "Price",
      note:
        "USA sector comparison uses ETF proxies instead of official sector indexes for more stable daily coverage.",
    },
    sectors: [
      {
        id: "financials",
        label: "Financials",
        symbol: "XLF",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-financial-select-sector-spdr-fund-xlf",
      },
      {
        id: "technology",
        label: "Technology",
        symbol: "XLK",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-technology-select-sector-spdr-fund-xlk",
      },
      {
        id: "health-care",
        label: "Health Care",
        symbol: "XLV",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-health-care-select-sector-spdr-fund-xlv",
      },
      {
        id: "consumer-discretionary",
        label: "Consumer Discretionary",
        symbol: "XLY",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-consumer-discretionary-select-sector-spdr-fund-xly",
      },
      {
        id: "consumer-staples",
        label: "Consumer Staples",
        symbol: "XLP",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-consumer-staples-select-sector-spdr-fund-xlp",
      },
      {
        id: "energy",
        label: "Energy",
        symbol: "XLE",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-energy-select-sector-spdr-fund-xle",
      },
      {
        id: "materials",
        label: "Materials",
        symbol: "XLB",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-materials-select-sector-spdr-fund-xlb",
      },
      {
        id: "industrials",
        label: "Industrials",
        symbol: "XLI",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-industrial-select-sector-spdr-fund-xli",
      },
      {
        id: "utilities",
        label: "Utilities",
        symbol: "XLU",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-utilities-select-sector-spdr-fund-xlu",
      },
      {
        id: "communication-services",
        label: "Communication Services",
        symbol: "XLC",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-communication-services-select-sector-spdr-fund-xlc",
      },
      {
        id: "real-estate",
        label: "Real Estate",
        symbol: "XLRE",
        providerName: "State Street SPDR",
        family: "Sector Proxy",
        sourceUrl:
          "https://www.ssga.com/us/en/intermediary/etfs/funds/the-real-estate-select-sector-spdr-fund-xlre",
      },
    ],
  },
];

function getSectorMarketById(marketId) {
  return sectorMarketCatalog.find((entry) => entry.id === marketId) || null;
}

function buildSectorSeriesRequest(entry, market) {
  return {
    symbol: entry.symbol,
    label: entry.label,
    providerName: entry.providerName,
    family: `${market.label} ${entry.family || "Sector"}`,
    targetSeriesType: entry.seriesType || "Price",
    sourceSeriesType: entry.seriesType || "Price",
    sourceUrl: entry.sourceUrl || buildYahooQuoteUrl(entry.symbol),
    note: entry.note || null,
    preferredProvider: market.preferredProvider || null,
    remember: false,
  };
}

const DEFAULT_SECTOR_MARKET_ID = sectorMarketCatalog[0].id;

export {
  DEFAULT_SECTOR_MARKET_ID,
  SECTOR_HORIZON_YEARS,
  buildSectorSeriesRequest,
  getSectorMarketById,
  sectorMarketCatalog,
};
