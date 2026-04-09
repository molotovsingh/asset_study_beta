import { formatDateTime } from "./format.js";
import {
  buildXmlWorkbook,
  createCell,
  downloadTextFile,
  serializeCsv,
  slugify,
  toIsoDate,
} from "./studyExport.js";

function buildExportFileBaseName(payload) {
  return `relative-performance-${slugify(
    payload.assetLabel || payload.assetSelection?.label || "asset",
  )}-vs-${slugify(
    payload.benchmarkLabel || payload.benchmarkSelection?.label || "benchmark",
  )}-${toIsoDate(payload.overlapStartDate)}-to-${toIsoDate(payload.overlapEndDate)}`;
}

function buildCsvRows(payload) {
  return [
    [
      "study",
      "asset_label",
      "asset_symbol",
      "benchmark_label",
      "benchmark_symbol",
      "date_start",
      "date_end",
      "period_days",
      "asset_simple_return_decimal",
      "asset_log_return_decimal",
      "benchmark_simple_return_decimal",
      "benchmark_log_return_decimal",
      "excess_simple_return_decimal",
      "excess_log_return_decimal",
    ],
    ...payload.relativeMetrics.alignedPeriods.map((period) => [
      payload.studyTitle,
      payload.assetLabel,
      payload.assetSelection?.symbol ?? "",
      payload.benchmarkLabel,
      payload.benchmarkSelection?.symbol ?? "",
      toIsoDate(period.startDate),
      toIsoDate(period.endDate),
      period.days,
      period.assetSimpleReturn,
      period.assetLogReturn,
      period.benchmarkSimpleReturn,
      period.benchmarkLogReturn,
      period.excessSimpleReturn,
      period.excessLogReturn,
    ]),
  ];
}

function buildSummaryRows(payload) {
  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(payload.studyTitle)],
    [createCell("Asset"), createCell(payload.assetLabel)],
    [createCell("Asset Symbol"), createCell(payload.assetSelection?.symbol ?? "")],
    [createCell("Benchmark"), createCell(payload.benchmarkLabel)],
    [
      createCell("Benchmark Symbol"),
      createCell(payload.benchmarkSelection?.symbol ?? ""),
    ],
    [
      createCell("Comparison Basis"),
      createCell(payload.comparisonBasisLabel || payload.comparisonBasis || "Local currency"),
    ],
    [createCell("Base Currency"), createCell(payload.baseCurrency || "")],
    [createCell("Asset Currency"), createCell(payload.assetSelection?.currency || "")],
    [createCell("Benchmark Currency"), createCell(payload.benchmarkSelection?.currency || "")],
    [createCell("Requested Start"), createCell(payload.requestedStartDate, "date")],
    [createCell("Requested End"), createCell(payload.requestedEndDate, "date")],
    [createCell("Overlap Start"), createCell(payload.overlapStartDate, "date")],
    [createCell("Overlap End"), createCell(payload.overlapEndDate, "date")],
    [createCell("Asset Method"), createCell(payload.assetMethodLabel)],
    [createCell("Benchmark Method"), createCell(payload.benchmarkMethodLabel)],
    [createCell("Asset Currency Path"), createCell(payload.assetCurrencyPath || "")],
    [createCell("Benchmark Currency Path"), createCell(payload.benchmarkCurrencyPath || "")],
    [createCell("Exported At"), createCell(formatDateTime(payload.exportedAt))],
    [createCell("Warnings"), createCell(payload.warnings.length, "integer")],
  ];
}

function buildMetricsRows(payload) {
  const metrics = payload.relativeMetrics;

  const definitions = [
    ["Asset CAGR", metrics.assetMetrics.annualizedReturn, "percent"],
    ["Benchmark CAGR", metrics.benchmarkMetrics.annualizedReturn, "percent"],
    ["CAGR Spread", metrics.cagrSpread, "percent"],
    ["Relative Wealth", metrics.relativeWealth, "percent"],
    ["Correlation", metrics.correlation, "number2"],
    ["Beta", metrics.beta, "number2"],
    ["Tracking Error", metrics.trackingError, "percent"],
    ["Information Ratio", metrics.informationRatio, "number2"],
    ["Outperformance Rate", metrics.outperformanceRate, "percent"],
    ["Upside Capture", metrics.upsideCapture, "number2"],
    ["Downside Capture", metrics.downsideCapture, "number2"],
    ["Relative Drawdown", metrics.relativeDrawdown, "percent"],
    [
      "Annualized Excess Log Return",
      metrics.annualizedExcessLogReturn,
      "number4",
    ],
    ["Overlap Observations", metrics.overlapObservations, "integer"],
    ["Overlap Return Observations", metrics.overlapReturnObservations, "integer"],
    ["Periods Per Year", metrics.periodsPerYear, "integer"],
  ];

  return [
    [
      createCell("Metric", "header"),
      createCell("Value", "header"),
      createCell("Format", "header"),
    ],
    ...definitions.map(([label, value, styleId]) => [
      createCell(label),
      createCell(value, styleId),
      createCell(styleId),
    ]),
  ];
}

function buildAlignedPeriodsRows(payload) {
  return [
    [
      createCell("Start Date", "header"),
      createCell("End Date", "header"),
      createCell("Days", "header"),
      createCell("Asset Simple Return", "header"),
      createCell("Asset Log Return", "header"),
      createCell("Benchmark Simple Return", "header"),
      createCell("Benchmark Log Return", "header"),
      createCell("Excess Simple Return", "header"),
      createCell("Excess Log Return", "header"),
    ],
    ...payload.relativeMetrics.alignedPeriods.map((period) => [
      createCell(period.startDate, "date"),
      createCell(period.endDate, "date"),
      createCell(period.days, "integer"),
      createCell(period.assetSimpleReturn, "percent"),
      createCell(period.assetLogReturn, "number4"),
      createCell(period.benchmarkSimpleReturn, "percent"),
      createCell(period.benchmarkLogReturn, "number4"),
      createCell(period.excessSimpleReturn, "percent"),
      createCell(period.excessLogReturn, "number4"),
    ]),
  ];
}

function buildWarningsRows(payload) {
  if (!payload.warnings.length) {
    return [
      [createCell("Warnings", "header")],
      [createCell("No warnings generated for this run.")],
    ];
  }

  return [
    [createCell("Warnings", "header")],
    ...payload.warnings.map((warning) => [createCell(warning)]),
  ];
}

function buildWorkbookXml(payload) {
  return buildXmlWorkbook([
    {
      name: "Summary",
      rows: buildSummaryRows(payload),
    },
    {
      name: "Metrics",
      rows: buildMetricsRows(payload),
    },
    {
      name: "Aligned Periods",
      rows: buildAlignedPeriodsRows(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsRows(payload),
    },
  ]);
}

function exportRelativeStudyCsv(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(buildCsvRows(payload)),
    "text/csv;charset=utf-8",
  );
}

function exportRelativeStudyXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export { exportRelativeStudyCsv, exportRelativeStudyXls };
