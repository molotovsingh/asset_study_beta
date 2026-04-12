import {
  buildXmlWorkbook,
  createCell,
  downloadTextFile,
  serializeCsv,
  slugify,
  toIsoDate,
} from "./studyExport.js";
import { flattenMonthlyStraddleRows } from "./monthlyStraddle.js";

function buildExportFileBaseName(studyRun) {
  return [
    "monthly-straddle",
    slugify(studyRun.symbol || "symbol"),
    studyRun.asOfDate ? toIsoDate(studyRun.asOfDate) : "snapshot",
  ].join("-");
}

function buildCsvRows(studyRun) {
  return [
    [
      "Rank",
      "Symbol",
      "Provider",
      "Currency",
      "Spot Price",
      "As Of",
      "Expiry",
      "Days To Expiry",
      "Strike",
      "Call Bid",
      "Call Ask",
      "Call Last",
      "Call Mid",
      "Call Open Interest",
      "Call Volume",
      "Call IV",
      "Put Bid",
      "Put Ask",
      "Put Last",
      "Put Mid",
      "Put Open Interest",
      "Put Volume",
      "Put IV",
      "Straddle Mid",
      "Implied Move Price",
      "Implied Move Percent",
      "Straddle IV",
      "HV20",
      "HV60",
      "HV120",
      "IV/HV20",
      "IV/HV60",
      "IV/HV120",
      "Chain IV",
      "IV Gap",
      "IV-HV20 Spread",
      "IV-HV60 Spread",
      "IV-HV120 Spread",
      "Combined Open Interest",
      "Combined Volume",
      "Pricing Mode",
    ],
    ...flattenMonthlyStraddleRows(studyRun).map((row) => [
      row.rank,
      row.symbol,
      row.providerName,
      row.currency,
      row.spotPrice,
      row.asOfDate ? toIsoDate(row.asOfDate) : "",
      row.expiry,
      row.daysToExpiry,
      row.strike,
      row.callBid,
      row.callAsk,
      row.callLastPrice,
      row.callMidPrice,
      row.callOpenInterest,
      row.callVolume,
      row.callImpliedVolatility,
      row.putBid,
      row.putAsk,
      row.putLastPrice,
      row.putMidPrice,
      row.putOpenInterest,
      row.putVolume,
      row.putImpliedVolatility,
      row.straddleMidPrice,
      row.impliedMovePrice,
      row.impliedMovePercent,
      row.straddleImpliedVolatility,
      row.historicalVolatility20,
      row.historicalVolatility60,
      row.historicalVolatility120,
      row.ivHv20Ratio,
      row.ivHv60Ratio,
      row.ivHv120Ratio,
      row.chainImpliedVolatility,
      row.impliedVolatilityGap,
      row.ivHv20Spread,
      row.ivHv60Spread,
      row.ivHv120Spread,
      row.combinedOpenInterest,
      row.combinedVolume,
      row.pricingMode,
    ]),
  ];
}

function buildSummaryRows(studyRun) {
  const focus = studyRun.focusContract;
  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(studyRun.studyTitle)],
    [createCell("Symbol"), createCell(studyRun.symbol)],
    [createCell("Provider"), createCell(studyRun.providerName)],
    [createCell("Currency"), createCell(studyRun.currency)],
    [createCell("Spot Price"), createCell(studyRun.spotPrice, "number2")],
    [createCell("Spot Date"), createCell(studyRun.spotDate, "date")],
    [createCell("As Of"), createCell(studyRun.asOfDate, "date")],
    [createCell("Minimum DTE"), createCell(studyRun.minimumDte, "integer")],
    [createCell("Contracts Loaded"), createCell(studyRun.contracts.length, "integer")],
    [createCell("Curve Shape"), createCell(studyRun.curveShape)],
    [createCell("Curve Slope"), createCell(studyRun.curveSlope, "percent")],
    [createCell("Realized Vol Source"), createCell(studyRun.realizedVolatility.seriesType)],
    [createCell("Realized Vol Observations"), createCell(studyRun.realizedVolatility.observations, "integer")],
    [createCell("Stored Front Snapshots"), createCell(studyRun.historySummary.observations, "integer")],
    [createCell("IV Percentile"), createCell(studyRun.historySummary.ivPercentile, "percent")],
    [createCell("Move Percentile"), createCell(studyRun.historySummary.movePercentile, "percent")],
    [createCell("IV/HV20 Percentile"), createCell(studyRun.historySummary.ivHv20Percentile, "percent")],
    [createCell("IV/HV60 Percentile"), createCell(studyRun.historySummary.ivHv60Percentile, "percent")],
    [],
    [createCell("Focus Expiry", "header"), createCell(focus.expiry)],
    [createCell("Focus DTE"), createCell(focus.daysToExpiry, "integer")],
    [createCell("ATM Strike"), createCell(focus.strike, "number2")],
    [createCell("Straddle Mid"), createCell(focus.straddleMidPrice, "number2")],
    [createCell("Implied Move Price"), createCell(focus.impliedMovePrice, "number2")],
    [createCell("Implied Move Percent"), createCell(focus.impliedMovePercent, "percent")],
    [createCell("Straddle IV"), createCell(focus.straddleImpliedVolatility, "percent")],
    [createCell("HV20"), createCell(focus.historicalVolatility20, "percent")],
    [createCell("HV60"), createCell(focus.historicalVolatility60, "percent")],
    [createCell("HV120"), createCell(focus.historicalVolatility120, "percent")],
    [createCell("IV/HV20"), createCell(focus.ivHv20Ratio, "number2")],
    [createCell("IV/HV60"), createCell(focus.ivHv60Ratio, "number2")],
    [createCell("IV/HV120"), createCell(focus.ivHv120Ratio, "number2")],
    [createCell("Pricing Label"), createCell(studyRun.focusVolComparison?.label || "")],
    [createCell("Chain IV"), createCell(focus.chainImpliedVolatility, "percent")],
    [createCell("IV Gap"), createCell(focus.impliedVolatilityGap, "percent")],
    [createCell("Combined Open Interest"), createCell(focus.combinedOpenInterest, "integer")],
    [createCell("Combined Volume"), createCell(focus.combinedVolume, "integer")],
    [createCell("Warnings"), createCell(studyRun.warnings.length, "integer")],
  ];
}

function buildContractsRows(studyRun) {
  return [
    [
      createCell("Expiry", "header"),
      createCell("DTE", "header"),
      createCell("Strike", "header"),
      createCell("Straddle Mid", "header"),
      createCell("Implied Move %", "header"),
      createCell("Straddle IV", "header"),
      createCell("HV20", "header"),
      createCell("HV60", "header"),
      createCell("HV120", "header"),
      createCell("IV/HV20", "header"),
      createCell("IV/HV60", "header"),
      createCell("IV/HV120", "header"),
      createCell("Chain IV", "header"),
      createCell("IV Gap", "header"),
      createCell("IV-HV20 Spread", "header"),
      createCell("IV-HV60 Spread", "header"),
      createCell("IV-HV120 Spread", "header"),
      createCell("Combined OI", "header"),
      createCell("Combined Volume", "header"),
      createCell("Pricing", "header"),
    ],
    ...studyRun.contracts.map((contract) => [
      createCell(contract.expiry),
      createCell(contract.daysToExpiry, "integer"),
      createCell(contract.strike, "number2"),
      createCell(contract.straddleMidPrice, "number2"),
      createCell(contract.impliedMovePercent, "percent"),
      createCell(contract.straddleImpliedVolatility, "percent"),
      createCell(contract.historicalVolatility20, "percent"),
      createCell(contract.historicalVolatility60, "percent"),
      createCell(contract.historicalVolatility120, "percent"),
      createCell(contract.ivHv20Ratio, "number2"),
      createCell(contract.ivHv60Ratio, "number2"),
      createCell(contract.ivHv120Ratio, "number2"),
      createCell(contract.chainImpliedVolatility, "percent"),
      createCell(contract.impliedVolatilityGap, "percent"),
      createCell(contract.ivHv20Spread, "percent"),
      createCell(contract.ivHv60Spread, "percent"),
      createCell(contract.ivHv120Spread, "percent"),
      createCell(contract.combinedOpenInterest, "integer"),
      createCell(contract.combinedVolume, "integer"),
      createCell(contract.pricingMode),
    ]),
  ];
}

function buildWarningsRows(studyRun) {
  if (!studyRun.warnings.length) {
    return [[createCell("No warnings generated for this snapshot.")]];
  }
  return [
    [createCell("Warnings", "header")],
    ...studyRun.warnings.map((warning) => [createCell(warning)]),
  ];
}

function buildHistoryRows(studyRun) {
  if (!studyRun.frontHistory.length) {
    return [[createCell("No stored front-history snapshots are available yet.")]];
  }

  return [
    [
      createCell("As Of", "header"),
      createCell("Expiry", "header"),
      createCell("DTE", "header"),
      createCell("Spot", "header"),
      createCell("Implied Move %", "header"),
      createCell("Straddle IV", "header"),
      createCell("HV20", "header"),
      createCell("HV60", "header"),
      createCell("IV/HV20", "header"),
      createCell("IV/HV60", "header"),
    ],
    ...studyRun.frontHistory.map((row) => [
      createCell(row.asOfDate, "date"),
      createCell(row.expiry),
      createCell(row.daysToExpiry, "integer"),
      createCell(row.spotPrice, "number2"),
      createCell(row.impliedMovePercent, "percent"),
      createCell(row.straddleImpliedVolatility, "percent"),
      createCell(row.historicalVolatility20, "percent"),
      createCell(row.historicalVolatility60, "percent"),
      createCell(row.ivHv20Ratio, "number2"),
      createCell(row.ivHv60Ratio, "number2"),
    ]),
  ];
}

function buildWorkbookXml(studyRun) {
  return buildXmlWorkbook([
    { name: "Summary", rows: buildSummaryRows(studyRun) },
    { name: "Contracts", rows: buildContractsRows(studyRun) },
    { name: "History", rows: buildHistoryRows(studyRun) },
    { name: "Warnings", rows: buildWarningsRows(studyRun) },
  ]);
}

function exportMonthlyStraddleCsv(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.csv`,
    serializeCsv(buildCsvRows(studyRun)),
    "text/csv;charset=utf-8",
  );
}

function exportMonthlyStraddleXls(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.xls`,
    buildWorkbookXml(studyRun),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportMonthlyStraddleCsv,
  exportMonthlyStraddleXls,
};
