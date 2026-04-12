const DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID = "us-liquid-10";

const optionsScreenerUniverseCatalog = [
  {
    id: DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
    label: "US Liquid 10",
    marketLabel: "US Optionable Equities",
    note:
      "Small liquid universe for proving the rich-versus-cheap vol screener without pretending broad market coverage.",
    defaultMinimumDte: 25,
    maxContracts: 1,
    symbols: [
      { symbol: "AAPL", label: "Apple" },
      { symbol: "TSLA", label: "Tesla" },
      { symbol: "SPY", label: "SPDR S&P 500 ETF" },
      { symbol: "QQQ", label: "Invesco QQQ" },
      { symbol: "NVDA", label: "NVIDIA" },
      { symbol: "MSFT", label: "Microsoft" },
      { symbol: "AMZN", label: "Amazon" },
      { symbol: "META", label: "Meta" },
      { symbol: "AMD", label: "AMD" },
      { symbol: "NFLX", label: "Netflix" },
    ],
  },
];

function getOptionsScreenerUniverseById(universeId) {
  return (
    optionsScreenerUniverseCatalog.find((entry) => entry.id === universeId) ||
    null
  );
}

export {
  DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  getOptionsScreenerUniverseById,
  optionsScreenerUniverseCatalog,
};
