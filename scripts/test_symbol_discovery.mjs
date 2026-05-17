import {
  discoverSelectionSuggestions,
  findSelectionByQuery,
  mergeSelectionSuggestions,
} from "../app/studies/shared/indexSelection.js";
import {
  chooseAutoResolvedSuggestion,
  isExplicitMarketSymbol,
  parseManualSelectionInput,
  shouldSearchRemoteSymbols,
} from "../app/lib/symbolDiscovery.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function testBuiltInDiscovery() {
  const suggestions = mergeSelectionSuggestions({ datasets: [] }, []);

  const exactBank = discoverSelectionSuggestions("bank nifty", suggestions, {
    limit: 5,
  });
  assert(exactBank.length >= 1, "bank nifty should produce a local suggestion");
  assert(exactBank[0].symbol === "^NSEBANK", "bank nifty should resolve to Nifty Bank");
  assert(
    exactBank[0].subjectQuery === "Nifty Bank",
    "built-in suggestions should preserve the human label as the active subject",
  );

  const partialNifty = discoverSelectionSuggestions("nifty", suggestions, {
    limit: 8,
  });
  assert(partialNifty.length >= 3, "nifty should fan out to multiple local choices");
  assert(
    partialNifty.some((entry) => entry.label === "Nifty 50"),
    "nifty suggestions should include Nifty 50",
  );
  assert(
    partialNifty.some((entry) => entry.label === "Nifty Bank"),
    "nifty suggestions should include Nifty Bank",
  );
  assert(
    partialNifty.some((entry) => entry.label === "Nifty 500"),
    "nifty suggestions should include Nifty 500",
  );

  const compactNifty = discoverSelectionSuggestions("nifty50", suggestions, {
    limit: 5,
  });
  assert(compactNifty.length >= 1, "nifty50 should produce a local suggestion");
  assert(
    compactNifty[0].label === "Nifty 50",
    "compact discovery should match spacing-insensitive labels and aliases",
  );
  assert(
    compactNifty[0].returnBasis === "price",
    "price-index suggestions should expose price return basis",
  );
  assert(
    compactNifty[0].sourcePolicy === "price_only",
    "price-index suggestions should expose price-only source policy",
  );

  const niftyTri = discoverSelectionSuggestions("nifty50 tri", suggestions, {
    limit: 5,
  });
  assert(niftyTri.length >= 1, "nifty50 tri should produce a local suggestion");
  assert(
    niftyTri[0].returnBasis === "proxy",
    "TRI proxy suggestions should expose proxy return basis",
  );
  assert(
    niftyTri[0].sourcePolicy === "blocked_proxy_tri",
    "TRI proxy suggestions should expose blocked proxy source policy",
  );

  const broad500 = discoverSelectionSuggestions("nifty 500", suggestions, {
    limit: 5,
  });
  assert(broad500.length >= 1, "nifty 500 should produce a local suggestion");
  assert(
    broad500[0].label === "Nifty 500",
    "nifty 500 should resolve to the built-in broad-market index",
  );

  const compact500 = discoverSelectionSuggestions("nifty500", suggestions, {
    limit: 5,
  });
  assert(compact500.length >= 1, "nifty500 should produce a local suggestion");
  assert(
    compact500[0].label === "Nifty 500",
    "compact discovery should resolve nifty500 to Nifty 500",
  );

  const compactBank = discoverSelectionSuggestions("banknifty", suggestions, {
    limit: 5,
  });
  assert(compactBank.length >= 1, "banknifty should produce a local suggestion");
  assert(
    compactBank[0].label === "Nifty Bank",
    "compact alias discovery should resolve banknifty to Nifty Bank",
  );

  const realty = discoverSelectionSuggestions("nifty realty", suggestions, {
    limit: 5,
  });
  assert(realty.length >= 1, "nifty realty should produce a local suggestion");
  assert(
    realty[0].label === "Nifty Realty",
    "nifty realty should resolve to the built-in sector index",
  );

  const metals = discoverSelectionSuggestions("nifty metals", suggestions, {
    limit: 5,
  });
  assert(metals.length >= 1, "nifty metals should produce a local suggestion");
  assert(
    metals[0].label === "Nifty Metal",
    "nifty metals should resolve through the plural alias to Nifty Metal",
  );

  const energy = discoverSelectionSuggestions("nifty energy", suggestions, {
    limit: 5,
  });
  assert(energy.length >= 1, "nifty energy should produce a local suggestion");
  assert(
    energy[0].label === "Nifty Energy",
    "nifty energy should resolve to the built-in sector index",
  );

  const it = discoverSelectionSuggestions("nifty it", suggestions, {
    limit: 5,
  });
  assert(it.length >= 1, "nifty it should produce a local suggestion");
  assert(
    it[0].label === "Nifty IT",
    "india sector-study symbols should feed the active-asset catalog automatically",
  );

  const autoResolved = chooseAutoResolvedSuggestion("nifty", partialNifty);
  assert(autoResolved?.label === "Nifty 50", "nifty should auto-resolve to the strongest exact local match");
}

function testRememberedDiscovery() {
  const suggestions = mergeSelectionSuggestions(
    { datasets: [] },
    [
      {
        datasetId: "aapl",
        label: "Apple Inc",
        symbol: "AAPL",
        currency: "USD",
        providerName: "Yahoo Finance",
        family: "Remembered",
      },
    ],
  );

  const byName = discoverSelectionSuggestions("apple", suggestions, { limit: 5 });
  assert(byName.length >= 1, "remembered name should produce a suggestion");
  assert(byName[0].symbol === "AAPL", "remembered name should keep the symbol");
  assert(
    byName[0].subjectQuery === "Apple Inc",
    "remembered suggestions should preserve the stored label as the active subject",
  );

  const bySymbol = discoverSelectionSuggestions("aapl", suggestions, { limit: 5 });
  assert(bySymbol.length >= 1, "remembered symbol should still be discoverable");
  assert(
    bySymbol[0].subjectQuery === "Apple Inc",
    "remembered symbol search should still route through the stored label",
  );
}

function testSymbolDiscoveryPolicy() {
  assert(
    isExplicitMarketSymbol("AAPL") === true,
    "uppercase ticker should count as an explicit market symbol",
  );
  assert(
    isExplicitMarketSymbol("^NSEI") === true,
    "caret-prefixed index symbol should count as explicit",
  );
  assert(
    isExplicitMarketSymbol("apple") === false,
    "plain company-name text should not be treated as an explicit symbol",
  );
  assert(
    shouldSearchRemoteSymbols("apple") === true,
    "plain company-name text should search the remote provider",
  );
  assert(
    shouldSearchRemoteSymbols("^NSEI") === false,
    "caret-prefixed symbols should skip remote provider search",
  );

  const manualSelection = parseManualSelectionInput("Nifty Oil & Gas | ^CNXOILGAS");
  assert(
    manualSelection?.symbol === "^CNXOILGAS" &&
      manualSelection?.label === "Nifty Oil & Gas",
    "manual entry syntax should extract label and symbol",
  );
  assert(
    shouldSearchRemoteSymbols("Nifty Oil & Gas | ^CNXOILGAS") === false,
    "manual entry syntax should bypass remote provider search",
  );

  const providerSuggestions = [
    {
      kind: "provider",
      label: "Apple Inc",
      symbol: "AAPL",
      subjectQuery: "AAPL",
      matchKind: "exact-company",
      matchScore: 240,
    },
    {
      kind: "provider",
      label: "Apple Hospitality REIT Inc",
      symbol: "APLE",
      subjectQuery: "APLE",
      matchKind: "starts-with-company",
      matchScore: 180,
    },
  ];
  const autoResolvedProvider = chooseAutoResolvedSuggestion(
    "apple",
    providerSuggestions,
  );
  assert(
    autoResolvedProvider?.symbol === "AAPL",
    "strong exact provider matches should auto-resolve on Enter",
  );
}

function testManualSelectionResolution() {
  const suggestions = mergeSelectionSuggestions({ datasets: [] }, []);
  const manualSelection = findSelectionByQuery(
    "Nifty Oil & Gas | ^CNXOILGAS",
    suggestions,
  );
  assert(manualSelection, "manual input should build a selection");
  assert(
    manualSelection.kind === "adhoc",
    "manual input should resolve to an ad hoc selection",
  );
  assert(
    manualSelection.symbol === "^CNXOILGAS" &&
      manualSelection.label === "Nifty Oil & Gas",
    "manual input should preserve both the custom label and the symbol",
  );
}

function runSymbolDiscoveryChecks() {
  assertionCount = 0;
  testBuiltInDiscovery();
  testRememberedDiscovery();
  testSymbolDiscoveryPolicy();
  testManualSelectionResolution();
  console.log(`symbol discovery checks passed (${assertionCount} assertions)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSymbolDiscoveryChecks();
}

export { runSymbolDiscoveryChecks };
