import {
  buildXmlWorkbook,
  createCell,
  downloadTextFile,
  serializeCsv,
  slugify,
  toIsoDate,
} from "./studyExport.js";
import { flattenOptionsScreenerRows } from "./optionsScreener.js";

function buildExportFileBaseName(studyRun) {
  return [
    "options-screener",
    slugify(studyRun.universe.id || "universe"),
    studyRun.asOfDate ? toIsoDate(studyRun.asOfDate) : "snapshot",
  ].join("-");
}

function buildCsvRows(studyRun) {
  return [
    [
      "Rank",
      "Symbol",
      "Provider",
      "As Of",
      "Spot Price",
      "Currency",
      "Expiry",
      "Days To Expiry",
      "Strike",
      "Straddle Mid",
      "Implied Move Percent",
      "Direction Score",
      "Direction Label",
      "Trend Score",
      "Seasonality Score",
      "Seasonality Month",
      "Seasonality Mean Return",
      "Seasonality Win Rate",
      "Seasonality Observations",
      "Vol Pricing Score",
      "Execution Score",
      "Confidence Score",
      "Candidate Advisory",
      "Straddle IV",
      "ATM IV",
      "Put 25D IV",
      "Call 25D IV",
      "HV20",
      "HV60",
      "IV/HV20",
      "IV/HV60",
      "IV Percentile",
      "RV Percentile",
      "VRP",
      "Normalized Skew",
      "Term Structure Steepness",
      "Term Structure Label",
      "IV Rank",
      "RV Rank",
      "VRP Rank",
      "Term Structure Rank",
      "Skew Rank",
      "IV/HV20 Percentile",
      "Combined Open Interest",
      "Combined Volume",
      "Liquidity",
      "Spread Share",
      "Spread Quality",
      "Pricing",
      "Trade Idea",
      "Trade Idea Matches",
    ],
    ...flattenOptionsScreenerRows(studyRun).map((row) => [
      row.rank,
      row.symbol,
      row.providerName,
      row.asOfDate ? toIsoDate(row.asOfDate) : "",
      row.spotPrice,
      row.currency,
      row.expiry,
      row.daysToExpiry,
      row.strike,
      row.straddleMidPrice,
      row.impliedMovePercent,
      row.directionScore,
      row.directionLabel,
      row.trendScore,
      row.seasonalityScore,
      row.seasonalityMonthLabel,
      row.seasonalityMeanReturn,
      row.seasonalityWinRate,
      row.seasonalityObservations,
      row.volPricingScore,
      row.executionScore,
      row.confidenceScore,
      row.candidateAdvisory,
      row.straddleImpliedVolatility,
      row.atmImpliedVolatility,
      row.put25DeltaImpliedVolatility,
      row.call25DeltaImpliedVolatility,
      row.historicalVolatility20,
      row.historicalVolatility60,
      row.ivHv20Ratio,
      row.ivHv60Ratio,
      row.ivPercentile,
      row.rvPercentile,
      row.vrp,
      row.normalizedSkew,
      row.termStructureSteepness,
      row.termStructureLabel,
      row.ivRank,
      row.rvRank,
      row.vrpRank,
      row.termStructureRank,
      row.skewRank,
      row.ivHv20Percentile,
      row.combinedOpenInterest,
      row.combinedVolume,
      row.liquidityLabel,
      row.spreadShare,
      row.spreadQuality,
      row.pricingLabel,
      row.primaryTradeIdea,
      row.tradeIdeaLabels,
    ]),
  ];
}

function buildSummaryRows(studyRun) {
  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(studyRun.studyTitle)],
    [createCell("Universe"), createCell(studyRun.universe.label)],
    [createCell("As Of"), createCell(studyRun.asOfDate, "date")],
    [createCell("Minimum DTE"), createCell(studyRun.minimumDte, "integer")],
    [createCell("Rows Loaded"), createCell(studyRun.rows.length, "integer")],
    [createCell("Rows Displayed"), createCell(studyRun.filteredRows.length, "integer")],
    [createCell("Bias Filter"), createCell(studyRun.bias)],
    [createCell("Preset Filter"), createCell(studyRun.presetDefinition?.label || "All Presets")],
    [createCell("Sort Key"), createCell(studyRun.sortKey)],
    [createCell("Rich Count"), createCell(studyRun.richCount, "integer")],
    [createCell("Cheap Count"), createCell(studyRun.cheapCount, "integer")],
    [createCell("Failures"), createCell(studyRun.failures.length, "integer")],
    [createCell("Top Direction"), createCell(studyRun.topDirectionRow?.symbol || "")],
    [createCell("Top Rich"), createCell(studyRun.topRichRow?.symbol || "")],
    [createCell("Top Cheap"), createCell(studyRun.topCheapRow?.symbol || "")],
  ];
}

function buildRowsSheet(studyRun) {
  return [
    [
      createCell("Symbol", "header"),
      createCell("Expiry", "header"),
      createCell("DTE", "header"),
      createCell("Direction", "header"),
      createCell("Candidate", "header"),
      createCell("Direction Score", "header"),
      createCell("Execution Score", "header"),
      createCell("Confidence Score", "header"),
      createCell("Straddle IV", "header"),
      createCell("ATM IV", "header"),
      createCell("Put 25D IV", "header"),
      createCell("Call 25D IV", "header"),
      createCell("HV20", "header"),
      createCell("HV60", "header"),
      createCell("IV/HV20", "header"),
      createCell("IV/HV60", "header"),
      createCell("IV Percentile", "header"),
      createCell("RV Percentile", "header"),
      createCell("VRP", "header"),
      createCell("Normalized Skew", "header"),
      createCell("Term Structure Steepness", "header"),
      createCell("Term Structure Label", "header"),
      createCell("IV Rank", "header"),
      createCell("RV Rank", "header"),
      createCell("VRP Rank", "header"),
      createCell("Term Structure Rank", "header"),
      createCell("Skew Rank", "header"),
      createCell("IV/HV20 Percentile", "header"),
      createCell("Implied Move %", "header"),
      createCell("Combined OI", "header"),
      createCell("Spread Share", "header"),
      createCell("Pricing", "header"),
      createCell("Trade Idea", "header"),
      createCell("Trade Idea Matches", "header"),
    ],
    ...studyRun.filteredRows.map((row) => [
      createCell(row.symbol),
      createCell(row.expiry),
      createCell(row.daysToExpiry, "integer"),
      createCell(row.directionLabel),
      createCell(row.candidateAdvisory),
      createCell(row.directionScore, "number2"),
      createCell(row.executionScore, "number2"),
      createCell(row.confidenceScore, "number2"),
      createCell(row.straddleImpliedVolatility, "percent"),
      createCell(row.atmImpliedVolatility, "percent"),
      createCell(row.put25DeltaImpliedVolatility, "percent"),
      createCell(row.call25DeltaImpliedVolatility, "percent"),
      createCell(row.historicalVolatility20, "percent"),
      createCell(row.historicalVolatility60, "percent"),
      createCell(row.ivHv20Ratio, "number2"),
      createCell(row.ivHv60Ratio, "number2"),
      createCell(row.ivPercentile, "percent"),
      createCell(row.rvPercentile, "percent"),
      createCell(row.vrp, "percent"),
      createCell(row.normalizedSkew, "percent"),
      createCell(row.termStructureSteepness, "percent"),
      createCell(row.termStructureLabel),
      createCell(row.ivRank, "number2"),
      createCell(row.rvRank, "number2"),
      createCell(row.vrpRank, "number2"),
      createCell(row.termStructureRank, "number2"),
      createCell(row.skewRank, "number2"),
      createCell(row.ivHv20Percentile, "percent"),
      createCell(row.impliedMovePercent, "percent"),
      createCell(row.combinedOpenInterest, "integer"),
      createCell(row.spreadShare, "percent"),
      createCell(row.pricingLabel),
      createCell(row.primaryTradeIdea),
      createCell((row.tradeIdeaLabels || []).join(" | ")),
    ]),
  ];
}

function buildFailuresRows(studyRun) {
  if (!studyRun.failures.length) {
    return [[createCell("No failures in this screener run.")]];
  }
  return [
    [createCell("Symbol", "header"), createCell("Error", "header")],
    ...studyRun.failures.map((failure) => [
      createCell(failure.symbol),
      createCell(failure.error),
    ]),
  ];
}

function buildWorkbookXml(studyRun) {
  return buildXmlWorkbook([
    { name: "Summary", rows: buildSummaryRows(studyRun) },
    { name: "Rows", rows: buildRowsSheet(studyRun) },
    { name: "Failures", rows: buildFailuresRows(studyRun) },
  ]);
}

function exportOptionsScreenerCsv(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.csv`,
    serializeCsv(buildCsvRows(studyRun)),
    "text/csv;charset=utf-8",
  );
}

function exportOptionsScreenerXls(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.xls`,
    buildWorkbookXml(studyRun),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportOptionsScreenerCsv,
  exportOptionsScreenerXls,
};
