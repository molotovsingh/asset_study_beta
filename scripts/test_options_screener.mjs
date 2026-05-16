import {
  DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  getOptionsScreenerUniverseById,
} from "../app/catalog/optionsScreenerCatalog.js";
import {
  DEFAULT_OPTIONS_SCREENER_SORT_KEY,
  buildOptionsScreenerStudyRun,
  flattenOptionsScreenerRows,
} from "../app/lib/optionsScreener.js";
import {
  buildCsvRows,
  buildWorkbookXml,
} from "../app/lib/optionsScreenerExport.js";
import { getStudyById } from "../app/studies/registry.js";
import {
  optionsScreenerTemplate,
  renderOptionsScreenerHistory,
  renderOptionsScreenerResults,
  renderUniversePresetInfo,
} from "../app/studies/optionsScreenerView.js";
import { mountOptionsScreenerVisuals } from "../app/studies/optionsScreenerVisuals.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function buildSnapshot({
  symbol,
  spotPrice,
  straddleIv,
  backStraddleIv,
  hv20,
  hv60,
  hv120,
  openInterest,
  volume,
  spreadWidth,
  historyIvValues,
  historyHv20Values,
  normalizedSkew = 0.08,
  normalizedUpsideSkew = -0.04,
  directionContext,
}) {
  const expiry = "2026-05-15";
  const backExpiry = "2026-06-19";
  const daysToExpiry = 33;
  const backDaysToExpiry = 68;
  const strike = Math.round(spotPrice / 5) * 5;
  const callMidPrice = 8;
  const putMidPrice = 7.5;
  const straddleMidPrice = callMidPrice + putMidPrice;
  const callSpread = spreadWidth / 2;
  const putSpread = spreadWidth / 2;
  const normalizedHistoryIvValues = historyIvValues || [
    straddleIv * 0.9,
    straddleIv * 0.96,
    straddleIv,
  ];
  const normalizedHistoryHv20Values = historyHv20Values || [
    hv20 * 0.9,
    hv20 * 0.96,
    hv20,
  ];

  return {
    symbol,
    provider: "yfinance",
    providerName: "Yahoo Finance (yfinance)",
    currency: "USD",
    fetchedAt: "2026-04-12T08:15:00.000Z",
    asOfDate: "2026-04-12",
    spotDate: "2026-04-10",
    spotPrice,
    minimumDte: 25,
    maxContracts: 1,
    note: "Fixture monthly snapshot.",
    directionContext,
    history: {
      frontContracts: normalizedHistoryIvValues.map((historyIv, index) => {
        const historyHv20 = normalizedHistoryHv20Values[index];
        return {
          asOfDate: ["2026-04-08", "2026-04-10", "2026-04-12"][index] || "2026-04-12",
          expiry,
          daysToExpiry: [37, 35, daysToExpiry][index] || daysToExpiry,
          strike,
          spotPrice: [spotPrice * 0.98, spotPrice * 0.99, spotPrice][index] || spotPrice,
          impliedMovePercent: [0.058, 0.061, 0.066][index] || 0.066,
          straddleImpliedVolatility: historyIv,
          chainImpliedVolatility: historyIv - 0.004,
          impliedVolatilityGap: 0.004,
          historicalVolatility20: historyHv20,
          historicalVolatility60: hv60,
          historicalVolatility120: hv120,
          ivHv20Ratio: historyIv / historyHv20,
          ivHv60Ratio: historyIv / hv60,
          ivHv120Ratio: historyIv / hv120,
          ivHv20Spread: historyIv - historyHv20,
          ivHv60Spread: historyIv - hv60,
          ivHv120Spread: historyIv - hv120,
          combinedOpenInterest: openInterest - (2 - index) * 500,
          combinedVolume: volume - (2 - index) * 100,
        };
      }),
    },
    realizedVolatility: {
      seriesType: "adj_close",
      observations: 252,
      startDate: "2025-04-11",
      endDate: "2026-04-10",
      hv20,
      hv60,
      hv120,
    },
    monthlyContracts: [
      {
        expiry,
        daysToExpiry,
        strike,
        callBid: callMidPrice - callSpread / 2,
        callAsk: callMidPrice + callSpread / 2,
        callLastPrice: callMidPrice,
        callMidPrice,
        callPriceSource: "mid",
        callOpenInterest: Math.round(openInterest * 0.45),
        callVolume: Math.round(volume * 0.52),
        callImpliedVolatility: straddleIv + 0.008,
        callSpread,
        putBid: putMidPrice - putSpread / 2,
        putAsk: putMidPrice + putSpread / 2,
        putLastPrice: putMidPrice,
        putMidPrice,
        putPriceSource: "mid",
        putOpenInterest: Math.round(openInterest * 0.55),
        putVolume: Math.round(volume * 0.48),
        putImpliedVolatility: straddleIv - 0.008,
        putSpread,
        straddleMidPrice,
        impliedMovePrice: straddleMidPrice,
        impliedMovePercent: straddleMidPrice / spotPrice,
        straddleImpliedVolatility: straddleIv,
        chainImpliedVolatility: straddleIv - 0.004,
        atmImpliedVolatility: straddleIv - 0.004,
        put25DeltaImpliedVolatility: (straddleIv - 0.004) * (1 + normalizedSkew),
        call25DeltaImpliedVolatility:
          (straddleIv - 0.004) * (1 + normalizedUpsideSkew),
        normalizedSkew,
        normalizedUpsideSkew,
        impliedVolatilityGap: 0.004,
        historicalVolatility20: hv20,
        historicalVolatility60: hv60,
        historicalVolatility120: hv120,
        ivHv20Ratio: straddleIv / hv20,
        ivHv60Ratio: straddleIv / hv60,
        ivHv120Ratio: straddleIv / hv120,
        ivHv20Spread: straddleIv - hv20,
        ivHv60Spread: straddleIv - hv60,
        ivHv120Spread: straddleIv - hv120,
        combinedOpenInterest: openInterest,
        combinedVolume: volume,
        pricingMode: "bid-ask-mid",
      },
      {
        expiry: backExpiry,
        daysToExpiry: backDaysToExpiry,
        strike,
        callBid: callMidPrice - callSpread / 2,
        callAsk: callMidPrice + callSpread / 2,
        callLastPrice: callMidPrice,
        callMidPrice,
        callPriceSource: "mid",
        callOpenInterest: Math.round(openInterest * 0.4),
        callVolume: Math.round(volume * 0.44),
        callImpliedVolatility: backStraddleIv + 0.008,
        callSpread,
        putBid: putMidPrice - putSpread / 2,
        putAsk: putMidPrice + putSpread / 2,
        putLastPrice: putMidPrice,
        putMidPrice,
        putPriceSource: "mid",
        putOpenInterest: Math.round(openInterest * 0.6),
        putVolume: Math.round(volume * 0.56),
        putImpliedVolatility: backStraddleIv - 0.008,
        putSpread,
        straddleMidPrice,
        impliedMovePrice: straddleMidPrice,
        impliedMovePercent: straddleMidPrice / spotPrice,
        straddleImpliedVolatility: backStraddleIv,
        chainImpliedVolatility: backStraddleIv - 0.004,
        atmImpliedVolatility: backStraddleIv - 0.004,
        put25DeltaImpliedVolatility: (backStraddleIv - 0.004) * (1 + normalizedSkew),
        call25DeltaImpliedVolatility:
          (backStraddleIv - 0.004) * (1 + normalizedUpsideSkew),
        normalizedSkew,
        normalizedUpsideSkew,
        impliedVolatilityGap: 0.004,
        historicalVolatility20: hv20,
        historicalVolatility60: hv60,
        historicalVolatility120: hv120,
        ivHv20Ratio: backStraddleIv / hv20,
        ivHv60Ratio: backStraddleIv / hv60,
        ivHv120Ratio: backStraddleIv / hv120,
        ivHv20Spread: backStraddleIv - hv20,
        ivHv60Spread: backStraddleIv - hv60,
        ivHv120Spread: backStraddleIv - hv120,
        combinedOpenInterest: openInterest,
        combinedVolume: volume,
        pricingMode: "bid-ask-mid",
      },
    ],
  };
}

function buildFixtureStudyRun(overrides = {}) {
  const universe =
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
  return buildOptionsScreenerStudyRun({
    universe,
    minimumDte: 25,
    maxContracts: 1,
    sortKey: DEFAULT_OPTIONS_SCREENER_SORT_KEY,
    bias: "all",
    screenerPayload: {
      snapshots: [
        buildSnapshot({
          symbol: "AAPL",
          spotPrice: 260,
          straddleIv: 0.39,
          backStraddleIv: 0.43,
          hv20: 0.22,
          hv60: 0.24,
          hv120: 0.23,
          openInterest: 22000,
          volume: 3200,
          spreadWidth: 0.7,
          historyIvValues: [0.26, 0.31, 0.39],
          historyHv20Values: [0.18, 0.2, 0.22],
          normalizedSkew: 0.09,
          directionContext: {
            asOfDate: "2026-04-12",
            historyStartDate: "2010-01-04",
            historyEndDate: "2026-04-10",
            observations: 4100,
            directionScore: 74,
            directionLabel: "Long Bias",
            trend: {
              score: 80,
              label: "Long Bias",
              spotAboveSma50: true,
              sma50AboveSma200: true,
              return63: 0.14,
              return252: 0.31,
              sma50: 252,
              sma200: 236,
            },
            seasonality: {
              calendarMonth: 4,
              calendarMonthLabel: "Apr",
              observations: 12,
              meanReturn: 0.031,
              medianReturn: 0.028,
              winRate: 0.67,
              averageAbsoluteReturn: 0.072,
              score: 68,
              label: "Long Bias",
              sampleQuality: "deep",
            },
          },
        }),
        buildSnapshot({
          symbol: "MSFT",
          spotPrice: 430,
          straddleIv: 0.25,
          backStraddleIv: 0.251,
          hv20: 0.15,
          hv60: 0.24,
          hv120: 0.23,
          openInterest: 4200,
          volume: 380,
          spreadWidth: 1.25,
          historyIvValues: [0.31, 0.29, 0.25],
          historyHv20Values: [0.22, 0.18, 0.15],
          normalizedSkew: 0.05,
          directionContext: {
            asOfDate: "2026-04-12",
            historyStartDate: "2010-01-04",
            historyEndDate: "2026-04-10",
            observations: 4100,
            directionScore: 56,
            directionLabel: "Neutral",
            trend: {
              score: 58,
              label: "Neutral",
              spotAboveSma50: true,
              sma50AboveSma200: true,
              return63: 0.03,
              return252: 0.06,
              sma50: 418,
              sma200: 401,
            },
            seasonality: {
              calendarMonth: 4,
              calendarMonthLabel: "Apr",
              observations: 12,
              meanReturn: 0.011,
              medianReturn: 0.012,
              winRate: 0.58,
              averageAbsoluteReturn: 0.051,
              score: 54,
              label: "Neutral",
              sampleQuality: "deep",
            },
          },
        }),
        buildSnapshot({
          symbol: "TSLA",
          spotPrice: 349,
          straddleIv: 0.28,
          backStraddleIv: 0.29,
          hv20: 0.4,
          hv60: 0.42,
          hv120: 0.4,
          openInterest: 15000,
          volume: 2900,
          spreadWidth: 1.1,
          historyIvValues: [0.38, 0.34, 0.28],
          historyHv20Values: [0.52, 0.46, 0.4],
          normalizedSkew: 0.12,
          directionContext: {
            asOfDate: "2026-04-12",
            historyStartDate: "2010-06-29",
            historyEndDate: "2026-04-10",
            observations: 3970,
            directionScore: 34,
            directionLabel: "Short Bias",
            trend: {
              score: 30,
              label: "Short Bias",
              spotAboveSma50: false,
              sma50AboveSma200: false,
              return63: -0.12,
              return252: -0.04,
              sma50: 365,
              sma200: 381,
            },
            seasonality: {
              calendarMonth: 4,
              calendarMonthLabel: "Apr",
              observations: 11,
              meanReturn: -0.025,
              medianReturn: -0.018,
              winRate: 0.36,
              averageAbsoluteReturn: 0.094,
              score: 38,
              label: "Short Bias",
              sampleQuality: "deep",
            },
          },
        }),
        buildSnapshot({
          symbol: "NVDA",
          spotPrice: 920,
          straddleIv: 0.31,
          backStraddleIv: 0.39,
          hv20: 0.36,
          hv60: 0.34,
          hv120: 0.33,
          openInterest: 16500,
          volume: 2500,
          spreadWidth: 0.8,
          historyIvValues: [0.22, 0.27, 0.31],
          historyHv20Values: [0.42, 0.39, 0.36],
          normalizedSkew: 0.11,
          directionContext: {
            asOfDate: "2026-04-12",
            historyStartDate: "2010-01-04",
            historyEndDate: "2026-04-10",
            observations: 4100,
            directionScore: 61,
            directionLabel: "Neutral",
            trend: {
              score: 62,
              label: "Neutral",
              spotAboveSma50: true,
              sma50AboveSma200: true,
              return63: 0.08,
              return252: 0.22,
              sma50: 902,
              sma200: 860,
            },
            seasonality: {
              calendarMonth: 4,
              calendarMonthLabel: "Apr",
              observations: 12,
              meanReturn: 0.017,
              medianReturn: 0.013,
              winRate: 0.55,
              averageAbsoluteReturn: 0.063,
              score: 57,
              label: "Neutral",
              sampleQuality: "deep",
            },
          },
        }),
      ],
      failures: [
        {
          symbol: "NFLX",
          error: "No usable monthly chain was returned.",
        },
      ],
    },
    ...overrides,
  });
}

function testStudyRun() {
  const studyRun = buildFixtureStudyRun();
  assert(studyRun.rows.length === 4, "study run should build one row per snapshot");
  assert(studyRun.filteredRows.length === 4, "all filters should keep every fixture row");
  assert(studyRun.richCount === 2, "fixture should produce two rich rows");
  assert(studyRun.cheapCount === 2, "fixture should produce two cheap rows");
  assert(studyRun.topDirectionRow?.symbol === "AAPL", "AAPL should lead direction rows");
  assert(studyRun.topRichRow?.symbol === "AAPL", "AAPL should lead rich rows");
  assert(studyRun.topCheapRow?.symbol === "TSLA", "TSLA should lead cheap rows");
  assert(studyRun.filteredRows[0].symbol === "AAPL", "default sort should rank richest IV/HV20 first");
  assert(studyRun.providerSummary[0].count === 4, "provider summary should aggregate row counts");
  assert(studyRun.failures.length === 1, "study run should preserve failures");
  assert(studyRun.bestExecutionRow?.symbol === "AAPL", "AAPL should lead execution score");
  assert(studyRun.rows.find((row) => row.symbol === "AAPL")?.tradeIdeaLabels.includes("Sell Vega"), "AAPL should match the Sell Vega preset");
  assert(studyRun.rows.find((row) => row.symbol === "TSLA")?.tradeIdeaLabels.includes("Buy Gamma/Vega"), "TSLA should match the Buy Gamma/Vega preset");
  assert(studyRun.rows.find((row) => row.symbol === "MSFT")?.tradeIdeaLabels.includes("Long Calendar"), "MSFT should match the Long Calendar preset");
  assert(studyRun.rows.find((row) => row.symbol === "NVDA")?.tradeIdeaLabels.includes("Short Calendar"), "NVDA should match the Short Calendar preset");

  const cheapOnly = buildFixtureStudyRun({ bias: "cheap" });
  assert(cheapOnly.filteredRows.length === 2, "cheap bias should keep only cheap rows");
  assert(cheapOnly.filteredRows[0].symbol === "TSLA", "cheap bias should keep TSLA");

  const shortPremiumOnly = buildFixtureStudyRun({ candidateFilter: "short-premium" });
  assert(shortPremiumOnly.filteredRows.length === 1, "candidate filter should keep only matching rows");
  assert(shortPremiumOnly.filteredRows[0].symbol === "AAPL", "short premium filter should keep AAPL");

  const longCalendarOnly = buildFixtureStudyRun({ presetId: "long-calendar" });
  assert(longCalendarOnly.filteredRows.length === 1, "preset filter should keep only matching rows");
  assert(longCalendarOnly.filteredRows[0].symbol === "MSFT", "long calendar preset should keep MSFT");

  const flattenedRows = flattenOptionsScreenerRows(studyRun);
  assert(flattenedRows.length === 4, "flattened rows should match rendered rows");
  assert(flattenedRows[0].pricingLabel === "Rich", "flattened row should preserve pricing label");
  assert(flattenedRows[0].directionLabel === "Long Bias", "flattened row should preserve direction label");
  assert(flattenedRows[0].candidateAdvisory === "Short Premium Candidate", "flattened row should preserve advisory");
  assert(flattenedRows[0].primaryTradeIdea === "Sell Vega", "flattened row should preserve the primary preset");
  assert(Number.isFinite(flattenedRows[0].rvPercentile), "flattened rows should include RV percentile");

  const csvRows = buildCsvRows(studyRun);
  assert(csvRows.length === 5, "csv export should include header plus rows");
  assert(csvRows[0][0] === "Rank", "csv export should start with Rank");
  assert(csvRows[0].includes("RV Percentile"), "csv export should include RV percentile");
  assert(csvRows[0].includes("Normalized Skew"), "csv export should include normalized skew");
  assert(csvRows[0].includes("Trade Idea"), "csv export should include trade-idea output");

  const workbook = buildWorkbookXml(studyRun);
  assert(workbook.includes('Worksheet ss:Name="Summary"'), "workbook should include Summary sheet");
  assert(workbook.includes('Worksheet ss:Name="Rows"'), "workbook should include Rows sheet");
  assert(workbook.includes('Worksheet ss:Name="Failures"'), "workbook should include Failures sheet");
  console.log("ok options screener study");
}

function testViews() {
  const universe =
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
  const studyRun = buildFixtureStudyRun();
  const template = optionsScreenerTemplate({
    universeCatalog: [universe],
    universeId: universe.id,
    bias: "all",
    candidateFilter: "all",
    presetId: "all",
    sortKey: DEFAULT_OPTIONS_SCREENER_SORT_KEY,
    minimumDteValue: "25",
    presetMarkup: renderUniversePresetInfo(universe),
  });
  assert(template.includes('id="options-screener-form"'), "template should include the screener form");
  assert(template.includes("US Liquid 10"), "template should include the universe label");
  assert(template.includes("This study loads its own preset universe"), "template should explain the preset model");
  assert(template.includes('id="options-screener-history-root"'), "template should include the screener history root");
  assert(template.includes('id="options-screener-preset"'), "template should include the trade-idea preset selector");

  const historyMarkup = renderOptionsScreenerHistory(
    {
      runs: [
        {
          runId: 7,
          asOfDate: "2026-04-12",
          createdAt: "2026-04-12T08:30:00.000Z",
          rowCount: 3,
          failureCount: 1,
          pricingCounts: { rich: 1, cheap: 1, fair: 1, none: 0 },
          candidateCounts: {
            "short-premium": 1,
            "long-premium": 1,
            "low-confidence": 1,
            watch: 0,
          },
          topDirection: { symbol: "AAPL", directionLabel: "Long Bias" },
          topRich: { symbol: "AAPL", ivHv20Ratio: 1.64 },
          topCheap: { symbol: "TSLA", ivHv20Ratio: 0.75 },
          rows: [{ symbol: "AAPL" }, { symbol: "MSFT" }],
        },
      ],
    },
    "US Liquid 10",
  );
  assert(historyMarkup.includes("Recent Archive"), "history renderer should include archive heading");
  assert(historyMarkup.includes("Run #7"), "history renderer should include run identifiers");
  assert(historyMarkup.includes("AAPL"), "history renderer should include row symbols");

  const resultsMarkup = renderOptionsScreenerResults(studyRun);
  assert(resultsMarkup.includes("Ranked Rows"), "results should include the ranked rows section");
  assert(resultsMarkup.includes("Export CSV"), "results should include export buttons");
  assert(resultsMarkup.includes("#monthly-straddle/overview?subject=AAPL"), "results should link to the monthly straddle drilldown");
  assert(resultsMarkup.includes("Failures"), "results should include the failures context");
  assert(resultsMarkup.includes("Sell Vega"), "results should include trade-idea labels");
  assert(resultsMarkup.includes("RV Pctl"), "results should include RV percentile columns");
  assert(resultsMarkup.includes("Active Sort (IV/HV20)"), "results should expose the active sort metric column");
  assert(resultsMarkup.includes("Long Bias"), "results should include direction badges");

  const populatedRoot = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const dispose = mountOptionsScreenerVisuals(populatedRoot, { lastStudyRun: studyRun });
  assert(populatedRoot.innerHTML.includes("Options Screener Visuals"), "visuals should render when a run is present");
  assert(populatedRoot.innerHTML.includes("Pricing Mix"), "visuals should include the pricing mix card");
  assert(populatedRoot.innerHTML.includes("Direction Mix"), "visuals should include the direction mix card");
  assert(populatedRoot.innerHTML.includes("Trade Ideas"), "visuals should include the trade-idea mix card");
  assert(populatedRoot.innerHTML.includes("Top Rich"), "visuals should include the rich leaderboard");
  assert(populatedRoot.innerHTML.includes("sort IV/HV20"), "visuals should render the human sort label");
  dispose();

  const emptyRoot = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  mountOptionsScreenerVisuals(emptyRoot, {
    universeId: universe.id,
    bias: "all",
    candidateFilter: "all",
    presetId: "all",
    sortKey: DEFAULT_OPTIONS_SCREENER_SORT_KEY,
    minimumDteValue: "25",
    lastStudyRun: null,
  });
  assert(emptyRoot.innerHTML.includes("No options screener run is loaded yet."), "visuals should render an empty state without a run");
  console.log("ok options screener views");
}

function testRegistry() {
  const study = getStudyById("options-screener");
  assert(Boolean(study), "registry should return the options screener study");
  assert(study.views.length === 2, "options screener should register overview and visuals");
  assert(study.views.some((view) => view.id === "visuals"), "visuals view should be present");
  console.log("ok options screener registry");
}

testStudyRun();
testViews();
testRegistry();
console.log(`options screener checks passed (${assertionCount} assertions)`);
