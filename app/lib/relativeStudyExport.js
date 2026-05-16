import { formatDateTime } from "./format.js";
import { buildRelativeMetricPresentation } from "./metricRegistry.js";
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
  const metricPresentation = buildRelativeMetricPresentation({ relativeMetrics: metrics });

  const definitions = [
    [
      metricPresentation.relativeWealth.exportLabel,
      metricPresentation.relativeWealth.value,
      metricPresentation.relativeWealth.styleId,
      metricPresentation.relativeWealth.note,
    ],
    [
      metricPresentation.activeReturn.exportLabel,
      metricPresentation.activeReturn.value,
      metricPresentation.activeReturn.styleId,
      metricPresentation.activeReturn.note,
    ],
    ["Asset Total Return", metrics.assetMetrics.totalReturn, "percent", "Asset period return across the overlap"],
    ["Benchmark Total Return", metrics.benchmarkMetrics.totalReturn, "percent", "Benchmark period return across the overlap"],
    ["Asset Annualized Pace", metrics.assetMetrics.annualizedReturn, "percent", "Annualized asset return; diagnostic when overlap is short or thin"],
    ["Benchmark Annualized Pace", metrics.benchmarkMetrics.annualizedReturn, "percent", "Annualized benchmark return; diagnostic when overlap is short or thin"],
    [
      metricPresentation.annualizedSpread.exportLabel,
      metricPresentation.annualizedSpread.value,
      metricPresentation.annualizedSpread.styleId,
      metricPresentation.annualizedSpread.note,
    ],
    ["Correlation", metrics.correlation, "number2", `Computed from ${metrics.overlapReturnObservations} overlap return observations`],
    ["Beta", metrics.beta, "number2", `Computed from ${metrics.overlapReturnObservations} overlap return observations`],
    ["Tracking Error", metrics.trackingError, "percent", `Annualized diagnostic from ${metrics.overlapReturnObservations} overlap return observations`],
    ["Information Ratio", metrics.informationRatio, "number2", `Annualized diagnostic from ${metrics.overlapReturnObservations} overlap return observations`],
    ["Outperformance Rate", metrics.outperformanceRate, "percent", "Share of overlap periods where the asset beat the benchmark"],
    ["Upside Capture", metrics.upsideCapture, "number2", "Return capture in benchmark-up periods"],
    ["Downside Capture", metrics.downsideCapture, "number2", "Return capture in benchmark-down periods"],
    ["Relative Drawdown", metrics.relativeDrawdown, "percent", "Worst peak-to-trough decline in relative wealth"],
    [
      "Annualized Excess Log Return",
      metrics.annualizedExcessLogReturn,
      "number4",
      "Diagnostic annualized excess log return",
    ],
    ["Overlap Observations", metrics.overlapObservations, "integer", "Aligned price observations in the overlap"],
    ["Overlap Return Observations", metrics.overlapReturnObservations, "integer", "Aligned return observations in the overlap"],
    ["Periods Per Year", metrics.periodsPerYear, "integer", "Sampling frequency inferred from aligned periods"],
  ];

  return [
    [
      createCell("Metric", "header"),
      createCell("Value", "header"),
      createCell("Notes", "header"),
    ],
    ...definitions.map(([label, value, styleId, note]) => [
      createCell(label),
      createCell(value, styleId),
      createCell(note),
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

export {
  buildCsvRows,
  buildWorkbookXml,
  exportRelativeStudyCsv,
  exportRelativeStudyXls,
};
