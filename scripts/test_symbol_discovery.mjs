import {
  discoverSelectionSuggestions,
  mergeSelectionSuggestions,
} from "../app/studies/shared/indexSelection.js";

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
    limit: 5,
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

testBuiltInDiscovery();
testRememberedDiscovery();

console.log(`symbol discovery checks passed (${assertionCount} assertions)`);
