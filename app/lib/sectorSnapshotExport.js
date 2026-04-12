import {
  buildXmlWorkbook,
  createCell,
  downloadTextFile,
  serializeCsv,
  slugify,
  toIsoDate,
} from "./studyExport.js";
import { flattenSectorSnapshotRows, sortRowsByMetric } from "./sectorSnapshot.js";

function buildExportFileBaseName(studyRun) {
  const marketSlug = slugify(studyRun.market.label);
  const endDate = studyRun.commonEndDate
    ? toIsoDate(studyRun.commonEndDate)
    : "snapshot";
  return `sector-snapshot-${marketSlug}-${endDate}`;
}

function buildCsvRows(studyRun) {
  const rows = flattenSectorSnapshotRows(studyRun);
  return [
    [
      "Market",
      "Universe",
      "Benchmark",
      "Benchmark Symbol",
      "Horizon Years",
      "Requested Start",
      "End Date",
      "Sector",
      "Symbol",
      "Provider",
      "Available",
      "Availability Reason",
      "Observations",
      "CAGR",
      "Volatility",
      "Max Drawdown",
      "Sharpe",
      "Calmar",
      "Relative Wealth",
      "CAGR Spread",
      "Tracking Error",
      "Information Ratio",
      "Outperformance Rate",
      "Upside Capture",
      "Downside Capture",
    ],
    ...rows.map((row) => [
      row.market,
      row.universe,
      row.benchmark,
      row.benchmarkSymbol,
      row.horizonYears,
      row.requestedStartDate ? toIsoDate(row.requestedStartDate) : "",
      row.endDate ? toIsoDate(row.endDate) : "",
      row.sector,
      row.symbol,
      row.providerName,
      row.available ? "yes" : "no",
      row.availabilityReason || "",
      row.observations,
      row.annualizedReturn,
      row.annualizedVolatility,
      row.maxDrawdown,
      row.sharpeRatio,
      row.calmarRatio,
      row.relativeWealth,
      row.cagrSpread,
      row.trackingError,
      row.informationRatio,
      row.outperformanceRate,
      row.upsideCapture,
      row.downsideCapture,
    ]),
  ];
}

function buildSummarySheetRows(studyRun) {
  return [
    [createCell("Study", "header"), createCell(studyRun.studyTitle)],
    [createCell("Market", "header"), createCell(studyRun.market.label)],
    [createCell("Universe", "header"), createCell(studyRun.market.universeLabel)],
    [createCell("Benchmark", "header"), createCell(studyRun.benchmark.label)],
    [createCell("As Of", "header"), createCell(studyRun.commonEndDate, "date")],
    [createCell("Focus Horizon", "header"), createCell(studyRun.focusHorizonYears, "integer")],
    [createCell("Focus Metric", "header"), createCell(studyRun.focusMetricKey)],
    [createCell("Risk-Free Rate", "header"), createCell(studyRun.riskFreeRate, "percent")],
    [],
    [createCell("Provider"), createCell("Series Count")],
    ...studyRun.providerSummary.map((entry) => [
      createCell(entry.providerName),
      createCell(entry.count, "integer"),
    ]),
  ];
}

function buildFocusSheetRows(studyRun) {
  const focusResult = studyRun.focusHorizonResult;
  if (!focusResult) {
    return [[createCell("No focus horizon is available yet.")]];
  }

  const sortedRows = sortRowsByMetric(focusResult.rows, studyRun.focusMetricKey);

  return [
    [
      createCell("Rank", "header"),
      createCell("Sector", "header"),
      createCell("Symbol", "header"),
      createCell("Provider", "header"),
      createCell("CAGR", "header"),
      createCell("Volatility", "header"),
      createCell("Max Drawdown", "header"),
      createCell("Sharpe", "header"),
      createCell("Calmar", "header"),
      createCell("Relative Wealth", "header"),
      createCell("CAGR Spread", "header"),
      createCell("Tracking Error", "header"),
      createCell("Information Ratio", "header"),
    ],
    ...sortedRows.map((row, index) => [
      createCell(index + 1, "integer"),
      createCell(row.label),
      createCell(row.symbol),
      createCell(row.providerName),
      createCell(row.metrics?.annualizedReturn ?? null, "percent"),
      createCell(row.metrics?.annualizedVolatility ?? null, "percent"),
      createCell(row.metrics?.maxDrawdown ?? null, "percent"),
      createCell(row.metrics?.sharpeRatio ?? null, "number2"),
      createCell(row.metrics?.calmarRatio ?? null, "number2"),
      createCell(row.relativeMetrics?.relativeWealth ?? null, "percent"),
      createCell(row.relativeMetrics?.cagrSpread ?? null, "percent"),
      createCell(row.relativeMetrics?.trackingError ?? null, "percent"),
      createCell(row.relativeMetrics?.informationRatio ?? null, "number2"),
    ]),
  ];
}

function buildAllHorizonsSheetRows(studyRun) {
  const rows = flattenSectorSnapshotRows(studyRun);
  return [
    [
      createCell("Market", "header"),
      createCell("Sector", "header"),
      createCell("Symbol", "header"),
      createCell("Horizon", "header"),
      createCell("Available", "header"),
      createCell("CAGR", "header"),
      createCell("Volatility", "header"),
      createCell("Max Drawdown", "header"),
      createCell("Sharpe", "header"),
      createCell("Calmar", "header"),
      createCell("Relative Wealth", "header"),
      createCell("CAGR Spread", "header"),
      createCell("Tracking Error", "header"),
      createCell("Information Ratio", "header"),
    ],
    ...rows.map((row) => [
      createCell(row.market),
      createCell(row.sector),
      createCell(row.symbol),
      createCell(row.horizonYears, "integer"),
      createCell(row.available ? "yes" : "no"),
      createCell(row.annualizedReturn, "percent"),
      createCell(row.annualizedVolatility, "percent"),
      createCell(row.maxDrawdown, "percent"),
      createCell(row.sharpeRatio, "number2"),
      createCell(row.calmarRatio, "number2"),
      createCell(row.relativeWealth, "percent"),
      createCell(row.cagrSpread, "percent"),
      createCell(row.trackingError, "percent"),
      createCell(row.informationRatio, "number2"),
    ]),
  ];
}

function buildWarningsSheetRows(studyRun) {
  if (!studyRun.warnings?.length) {
    return [[createCell("No warnings were recorded for this run.")]];
  }

  return [
    [createCell("Warnings", "header")],
    ...studyRun.warnings.map((warning) => [createCell(warning)]),
  ];
}

function buildWorkbookXml(studyRun) {
  return buildXmlWorkbook([
    { name: "Summary", rows: buildSummarySheetRows(studyRun) },
    { name: "Focus Horizon", rows: buildFocusSheetRows(studyRun) },
    { name: "All Horizons", rows: buildAllHorizonsSheetRows(studyRun) },
    { name: "Warnings", rows: buildWarningsSheetRows(studyRun) },
  ]);
}

function exportSectorSnapshotCsv(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.csv`,
    serializeCsv(buildCsvRows(studyRun)),
    "text/csv;charset=utf-8",
  );
}

function exportSectorSnapshotXls(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.xls`,
    buildWorkbookXml(studyRun),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportSectorSnapshotCsv,
  exportSectorSnapshotXls,
};
