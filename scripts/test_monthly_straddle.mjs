import {
  DEFAULT_CONTRACT_COUNT,
  DEFAULT_MINIMUM_DTE,
  buildMonthlyStraddleStudyRun,
  flattenMonthlyStraddleRows,
} from "../app/lib/monthlyStraddle.js";
import {
  buildCsvRows,
  buildWorkbookXml,
} from "../app/lib/monthlyStraddleExport.js";
import { getStudyById } from "../app/studies/registry.js";
import {
  monthlyStraddleTemplate,
  renderMonthlyStraddleResults,
} from "../app/studies/monthlyStraddleView.js";
import { mountMonthlyStraddleVisuals } from "../app/studies/monthlyStraddleVisuals.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function buildFixtureStudyRun() {
  return buildMonthlyStraddleStudyRun(
    {
      symbol: "AAPL",
      provider: "yfinance",
      providerName: "Yahoo Finance (yfinance)",
      currency: "USD",
      fetchedAt: "2026-04-12T08:15:00.000Z",
      asOfDate: "2026-04-12",
      spotDate: "2026-04-10",
      spotPrice: 260.48,
      minimumDte: 25,
      maxContracts: 4,
      note: "Live options snapshot using current monthly contracts only.",
      history: {
        frontContracts: [
          {
            asOfDate: "2026-04-09",
            expiry: "2026-05-15",
            daysToExpiry: 36,
            strike: 260,
            spotPrice: 258.1,
            impliedMovePercent: 0.063,
            straddleImpliedVolatility: 0.261,
            chainImpliedVolatility: 0.259,
            impliedVolatilityGap: 0.002,
            historicalVolatility20: 0.219,
            historicalVolatility60: 0.228,
            historicalVolatility120: 0.221,
            ivHv20Ratio: 1.192,
            ivHv60Ratio: 1.145,
            ivHv120Ratio: 1.181,
            ivHv20Spread: 0.042,
            ivHv60Spread: 0.033,
            ivHv120Spread: 0.04,
            combinedOpenInterest: 21000,
            combinedVolume: 3000,
          },
          {
            asOfDate: "2026-04-10",
            expiry: "2026-05-15",
            daysToExpiry: 35,
            strike: 260,
            spotPrice: 259.8,
            impliedMovePercent: 0.066,
            straddleImpliedVolatility: 0.274,
            chainImpliedVolatility: 0.273,
            impliedVolatilityGap: 0.001,
            historicalVolatility20: 0.228,
            historicalVolatility60: 0.231,
            historicalVolatility120: 0.223,
            ivHv20Ratio: 1.202,
            ivHv60Ratio: 1.186,
            ivHv120Ratio: 1.229,
            ivHv20Spread: 0.046,
            ivHv60Spread: 0.043,
            ivHv120Spread: 0.051,
            combinedOpenInterest: 22000,
            combinedVolume: 3100,
          },
          {
            asOfDate: "2026-04-12",
            expiry: "2026-05-15",
            daysToExpiry: 33,
            strike: 260,
            spotPrice: 260.48,
            impliedMovePercent: 0.0679,
            straddleImpliedVolatility: 0.2828,
            chainImpliedVolatility: 0.2817,
            impliedVolatilityGap: 0.0011,
            historicalVolatility20: 0.244,
            historicalVolatility60: 0.231,
            historicalVolatility120: 0.226,
            ivHv20Ratio: 1.159,
            ivHv60Ratio: 1.224,
            ivHv120Ratio: 1.251,
            ivHv20Spread: 0.0388,
            ivHv60Spread: 0.0518,
            ivHv120Spread: 0.0568,
            combinedOpenInterest: 22827,
            combinedVolume: 3220,
          },
        ],
      },
      realizedVolatility: {
        seriesType: "adj_close",
        observations: 252,
        startDate: "2025-04-11",
        endDate: "2026-04-10",
        hv20: 0.244,
        hv60: 0.231,
        hv120: 0.226,
      },
      monthlyContracts: [
        {
          expiry: "2026-05-15",
          daysToExpiry: 33,
          strike: 260,
          callBid: 9.3,
          callAsk: 9.5,
          callLastPrice: 9.4,
          callMidPrice: 9.4,
          callPriceSource: "mid",
          callOpenInterest: 9597,
          callVolume: 2009,
          callImpliedVolatility: 0.2922,
          callSpread: 0.2,
          putBid: 8.2,
          putAsk: 8.35,
          putLastPrice: 8.26,
          putMidPrice: 8.275,
          putPriceSource: "mid",
          putOpenInterest: 13230,
          putVolume: 1211,
          putImpliedVolatility: 0.2711,
          putSpread: 0.15,
          straddleMidPrice: 17.675,
          impliedMovePrice: 17.675,
          impliedMovePercent: 0.0679,
          straddleImpliedVolatility: 0.2828,
          chainImpliedVolatility: 0.2817,
          impliedVolatilityGap: 0.0011,
          historicalVolatility20: 0.244,
          historicalVolatility60: 0.231,
          historicalVolatility120: 0.226,
          ivHv20Ratio: 1.159,
          ivHv60Ratio: 1.224,
          ivHv120Ratio: 1.251,
          ivHv20Spread: 0.0388,
          ivHv60Spread: 0.0518,
          ivHv120Spread: 0.0568,
          combinedOpenInterest: 22827,
          combinedVolume: 3220,
          pricingMode: "bid-ask-mid",
        },
        {
          expiry: "2026-06-18",
          daysToExpiry: 67,
          strike: 260,
          callBid: 12.8,
          callAsk: 13.1,
          callLastPrice: 13.0,
          callMidPrice: 12.95,
          callPriceSource: "mid",
          callOpenInterest: 14500,
          callVolume: 1200,
          callImpliedVolatility: 0.273,
          callSpread: 0.3,
          putBid: 10.95,
          putAsk: 11.15,
          putLastPrice: 11.0,
          putMidPrice: 11.05,
          putPriceSource: "mid",
          putOpenInterest: 17166,
          putVolume: 998,
          putImpliedVolatility: 0.2706,
          putSpread: 0.2,
          straddleMidPrice: 24.0,
          impliedMovePrice: 24.0,
          impliedMovePercent: 0.0921,
          straddleImpliedVolatility: 0.2704,
          chainImpliedVolatility: 0.2718,
          impliedVolatilityGap: -0.0014,
          historicalVolatility20: 0.244,
          historicalVolatility60: 0.231,
          historicalVolatility120: 0.226,
          ivHv20Ratio: 1.108,
          ivHv60Ratio: 1.17,
          ivHv120Ratio: 1.196,
          ivHv20Spread: 0.0264,
          ivHv60Spread: 0.0394,
          ivHv120Spread: 0.0444,
          combinedOpenInterest: 31666,
          combinedVolume: 2198,
          pricingMode: "bid-ask-mid",
        },
        {
          expiry: "2026-07-17",
          daysToExpiry: 96,
          strike: 260,
          callBid: 15.0,
          callAsk: 15.4,
          callLastPrice: 15.2,
          callMidPrice: 15.2,
          callPriceSource: "mid",
          callOpenInterest: 11000,
          callVolume: 670,
          callImpliedVolatility: 0.2668,
          callSpread: 0.4,
          putBid: 13.0,
          putAsk: 13.35,
          putLastPrice: 13.2,
          putMidPrice: 13.175,
          putPriceSource: "mid",
          putOpenInterest: 12336,
          putVolume: 544,
          putImpliedVolatility: 0.266,
          putSpread: 0.35,
          straddleMidPrice: 28.375,
          impliedMovePrice: 28.375,
          impliedMovePercent: 0.1089,
          straddleImpliedVolatility: 0.265,
          chainImpliedVolatility: 0.2664,
          impliedVolatilityGap: -0.0014,
          historicalVolatility20: 0.244,
          historicalVolatility60: 0.231,
          historicalVolatility120: 0.226,
          ivHv20Ratio: 1.086,
          ivHv60Ratio: 1.147,
          ivHv120Ratio: 1.172,
          ivHv20Spread: 0.021,
          ivHv60Spread: 0.034,
          ivHv120Spread: 0.039,
          combinedOpenInterest: 23336,
          combinedVolume: 1214,
          pricingMode: "bid-ask-mid",
        },
        {
          expiry: "2026-08-21",
          daysToExpiry: 131,
          strike: 260,
          callBid: 18.25,
          callAsk: 18.85,
          callLastPrice: 18.6,
          callMidPrice: 18.55,
          callPriceSource: "mid",
          callOpenInterest: 3700,
          callVolume: 210,
          callImpliedVolatility: 0.2801,
          callSpread: 0.6,
          putBid: 16.05,
          putAsk: 16.45,
          putLastPrice: 16.2,
          putMidPrice: 16.25,
          putPriceSource: "mid",
          putOpenInterest: 3856,
          putVolume: 188,
          putImpliedVolatility: 0.2787,
          putSpread: 0.4,
          straddleMidPrice: 34.8,
          impliedMovePrice: 34.8,
          impliedMovePercent: 0.1336,
          straddleImpliedVolatility: 0.2779,
          chainImpliedVolatility: 0.2794,
          impliedVolatilityGap: -0.0015,
          historicalVolatility20: 0.244,
          historicalVolatility60: 0.231,
          historicalVolatility120: 0.226,
          ivHv20Ratio: 1.139,
          ivHv60Ratio: 1.203,
          ivHv120Ratio: 1.23,
          ivHv20Spread: 0.0339,
          ivHv60Spread: 0.0469,
          ivHv120Spread: 0.0519,
          combinedOpenInterest: 7556,
          combinedVolume: 398,
          pricingMode: "bid-ask-mid",
        },
      ],
    },
    {
      requestedSymbol: "AAPL",
      minimumDte: DEFAULT_MINIMUM_DTE,
      maxContracts: DEFAULT_CONTRACT_COUNT,
    },
  );
}

function testStudyRun() {
  const studyRun = buildFixtureStudyRun();
  assert(studyRun.symbol === "AAPL", "study run should preserve the symbol");
  assert(studyRun.contracts.length === 4, "study run should keep four monthly contracts");
  assert(studyRun.focusContract.expiry === "2026-05-15", "front monthly should be the focus contract");
  assert(studyRun.curveShape === "Flat", "fixture curve should read as flat");
  assert(studyRun.focusVolComparison.label === "Mildly Rich", "fixture should classify front IV/HV properly");
  assert(studyRun.historySummary.observations === 3, "study run should preserve front-history observations");
  assert(studyRun.historySummary.hasCrediblePercentiles === false, "thin front-history should suppress percentile display");
  assert(studyRun.historySummary.ivPercentile === 1, "current fixture IV should be at the top percentile");
  assert(studyRun.warnings.length >= 3, "study run should include base snapshot and history warnings");

  const rows = flattenMonthlyStraddleRows(studyRun);
  assert(rows.length === 4, "flattened export rows should match the contract count");
  assert(rows[0].expiry === "2026-05-15", "first flattened row should be the front monthly");

  const csvRows = buildCsvRows(studyRun);
  assert(csvRows.length === 5, "csv export should include header plus contract rows");
  assert(csvRows[0][0] === "Rank", "csv header should start with Rank");
  assert(csvRows[0].includes("IV/HV20"), "csv export should include IV/HV columns");

  const workbook = buildWorkbookXml(studyRun);
  assert(workbook.includes('Worksheet ss:Name="Summary"'), "workbook should include Summary sheet");
  assert(workbook.includes('Worksheet ss:Name="Contracts"'), "workbook should include Contracts sheet");
  assert(workbook.includes('Worksheet ss:Name="History"'), "workbook should include History sheet");
  assert(workbook.includes("Suppressed until front-history is deeper"), "summary export should explain suppressed percentile context");
  console.log("ok monthly straddle study");
}

function testViews() {
  const studyRun = buildFixtureStudyRun();
  const template = monthlyStraddleTemplate({
    activeSymbol: "AAPL",
    minimumDteValue: "25",
    contractCountValue: "4",
  });
  assert(template.includes('id="monthly-straddle-form"'), "template should include the study form");
  assert(template.includes("Try AAPL"), "template should include starter links");

  const resultsMarkup = renderMonthlyStraddleResults(studyRun);
  assert(resultsMarkup.includes("Focus Contract"), "overview should include the focus section");
  assert(resultsMarkup.includes("Monthly Contracts"), "overview should include the contracts table");
  assert(resultsMarkup.includes("IV/HV20"), "overview should include IV/HV context");
  assert(resultsMarkup.includes("History Depth"), "overview should replace thin percentile cards with history depth");
  assert(resultsMarkup.includes("Percentile Status"), "overview should explain suppressed percentile context when history is thin");
  assert(resultsMarkup.includes("Export CSV"), "overview should include export buttons");

  const populatedRoot = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const dispose = mountMonthlyStraddleVisuals(populatedRoot, { lastStudyRun: studyRun });
  assert(populatedRoot.innerHTML.includes("Monthly Straddle Visuals"), "visuals should render when a run is present");
  assert(populatedRoot.innerHTML.includes("IV Curve"), "visuals should include the IV curve card");
  assert(populatedRoot.innerHTML.includes("Vol Context"), "visuals should include the vol context card");
  assert(populatedRoot.innerHTML.includes("Front History"), "visuals should include the front-history card");
  assert(populatedRoot.innerHTML.includes("History Depth"), "visuals should show history depth instead of a thin percentile headline");
  dispose();

  const emptyRoot = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  mountMonthlyStraddleVisuals(emptyRoot, { lastStudyRun: null });
  assert(emptyRoot.innerHTML.includes("No monthly straddle snapshot is loaded yet."), "visuals should render an empty state without a run");
  console.log("ok monthly straddle views");
}

function testRegistry() {
  const study = getStudyById("monthly-straddle");
  assert(Boolean(study), "registry should return the monthly straddle study");
  assert(study.views.length === 2, "monthly straddle should register overview and visuals");
  assert(study.views.some((view) => view.id === "visuals"), "visuals view should be present");
  console.log("ok monthly straddle registry");
}

testStudyRun();
testViews();
testRegistry();
console.log(`monthly straddle checks passed (${assertionCount} assertions)`);
