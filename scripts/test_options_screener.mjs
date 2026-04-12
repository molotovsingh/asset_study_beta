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
  hv20,
  hv60,
  hv120,
  openInterest,
  volume,
  spreadWidth,
  directionContext,
}) {
  const expiry = "2026-05-15";
  const daysToExpiry = 33;
  const strike = Math.round(spotPrice / 5) * 5;
  const callMidPrice = 8;
  const putMidPrice = 7.5;
  const straddleMidPrice = callMidPrice + putMidPrice;
  const callSpread = spreadWidth / 2;
  const putSpread = spreadWidth / 2;

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
      frontContracts: [
        {
          asOfDate: "2026-04-08",
          expiry,
          daysToExpiry: 37,
          strike,
          spotPrice: spotPrice * 0.98,
          impliedMovePercent: 0.058,
          straddleImpliedVolatility: straddleIv * 0.9,
          chainImpliedVolatility: straddleIv * 0.89,
          impliedVolatilityGap: 0.01,
          historicalVolatility20: hv20,
          historicalVolatility60: hv60,
          historicalVolatility120: hv120,
          ivHv20Ratio: (straddleIv * 0.9) / hv20,
          ivHv60Ratio: (straddleIv * 0.9) / hv60,
          ivHv120Ratio: (straddleIv * 0.9) / hv120,
          ivHv20Spread: straddleIv * 0.9 - hv20,
          ivHv60Spread: straddleIv * 0.9 - hv60,
          ivHv120Spread: straddleIv * 0.9 - hv120,
          combinedOpenInterest: openInterest - 1000,
          combinedVolume: volume - 200,
        },
        {
          asOfDate: "2026-04-10",
          expiry,
          daysToExpiry: 35,
          strike,
          spotPrice: spotPrice * 0.99,
          impliedMovePercent: 0.061,
          straddleImpliedVolatility: straddleIv * 0.96,
          chainImpliedVolatility: straddleIv * 0.955,
          impliedVolatilityGap: 0.005,
          historicalVolatility20: hv20,
          historicalVolatility60: hv60,
          historicalVolatility120: hv120,
          ivHv20Ratio: (straddleIv * 0.96) / hv20,
          ivHv60Ratio: (straddleIv * 0.96) / hv60,
          ivHv120Ratio: (straddleIv * 0.96) / hv120,
          ivHv20Spread: straddleIv * 0.96 - hv20,
          ivHv60Spread: straddleIv * 0.96 - hv60,
          ivHv120Spread: straddleIv * 0.96 - hv120,
          combinedOpenInterest: openInterest - 500,
          combinedVolume: volume - 100,
        },
        {
          asOfDate: "2026-04-12",
          expiry,
          daysToExpiry,
          strike,
          spotPrice,
          impliedMovePercent: 0.066,
          straddleImpliedVolatility: straddleIv,
          chainImpliedVolatility: straddleIv - 0.004,
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
        },
      ],
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
          straddleIv: 0.36,
          hv20: 0.22,
          hv60: 0.24,
          hv120: 0.23,
          openInterest: 22000,
          volume: 3200,
          spreadWidth: 0.7,
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
          straddleIv: 0.26,
          hv20: 0.25,
          hv60: 0.24,
          hv120: 0.23,
          openInterest: 18000,
          volume: 2100,
          spreadWidth: 0.55,
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
          straddleIv: 0.33,
          hv20: 0.44,
          hv60: 0.42,
          hv120: 0.4,
          openInterest: 15000,
          volume: 2900,
          spreadWidth: 1.1,
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
  assert(studyRun.rows.length === 3, "study run should build one row per snapshot");
  assert(studyRun.filteredRows.length === 3, "all bias should keep every row");
  assert(studyRun.richCount === 1, "fixture should produce one rich row");
  assert(studyRun.cheapCount === 1, "fixture should produce one cheap row");
  assert(studyRun.topDirectionRow?.symbol === "AAPL", "AAPL should lead direction rows");
  assert(studyRun.topRichRow?.symbol === "AAPL", "AAPL should lead rich rows");
  assert(studyRun.topCheapRow?.symbol === "TSLA", "TSLA should lead cheap rows");
  assert(studyRun.filteredRows[0].symbol === "AAPL", "default sort should rank richest IV/HV20 first");
  assert(studyRun.providerSummary[0].count === 3, "provider summary should aggregate row counts");
  assert(studyRun.failures.length === 1, "study run should preserve failures");
  assert(studyRun.bestExecutionRow?.symbol === "AAPL", "AAPL should lead execution score");

  const cheapOnly = buildFixtureStudyRun({ bias: "cheap" });
  assert(cheapOnly.filteredRows.length === 1, "cheap bias should keep only cheap rows");
  assert(cheapOnly.filteredRows[0].symbol === "TSLA", "cheap bias should keep TSLA");

  const shortPremiumOnly = buildFixtureStudyRun({ candidateFilter: "short-premium" });
  assert(shortPremiumOnly.filteredRows.length === 1, "candidate filter should keep only matching rows");
  assert(shortPremiumOnly.filteredRows[0].symbol === "AAPL", "short premium filter should keep AAPL");

  const flattenedRows = flattenOptionsScreenerRows(studyRun);
  assert(flattenedRows.length === 3, "flattened rows should match rendered rows");
  assert(flattenedRows[0].pricingLabel === "Rich", "flattened row should preserve pricing label");
  assert(flattenedRows[0].directionLabel === "Long Bias", "flattened row should preserve direction label");
  assert(flattenedRows[0].candidateAdvisory === "Short Premium Candidate", "flattened row should preserve advisory");

  const csvRows = buildCsvRows(studyRun);
  assert(csvRows.length === 4, "csv export should include header plus rows");
  assert(csvRows[0][0] === "Rank", "csv export should start with Rank");
  assert(csvRows[0].includes("IV/HV20"), "csv export should include IV/HV20");
  assert(csvRows[0].includes("Direction Score"), "csv export should include direction score");

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
    sortKey: DEFAULT_OPTIONS_SCREENER_SORT_KEY,
    minimumDteValue: "25",
    presetMarkup: renderUniversePresetInfo(universe),
  });
  assert(template.includes('id="options-screener-form"'), "template should include the screener form");
  assert(template.includes("US Liquid 10"), "template should include the universe label");
  assert(template.includes("This study loads its own preset universe"), "template should explain the preset model");
  assert(template.includes('id="options-screener-history-root"'), "template should include the screener history root");

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
  assert(resultsMarkup.includes("Long Premium Candidate"), "results should include advisory badges");
  assert(resultsMarkup.includes("Long Bias"), "results should include direction badges");

  const populatedRoot = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const dispose = mountOptionsScreenerVisuals(populatedRoot, { lastStudyRun: studyRun });
  assert(populatedRoot.innerHTML.includes("Options Screener Visuals"), "visuals should render when a run is present");
  assert(populatedRoot.innerHTML.includes("Pricing Mix"), "visuals should include the pricing mix card");
  assert(populatedRoot.innerHTML.includes("Direction Mix"), "visuals should include the direction mix card");
  assert(populatedRoot.innerHTML.includes("Top Rich"), "visuals should include the rich leaderboard");
  dispose();

  const emptyRoot = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  mountOptionsScreenerVisuals(emptyRoot, {
    universeId: universe.id,
    bias: "all",
    candidateFilter: "all",
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
