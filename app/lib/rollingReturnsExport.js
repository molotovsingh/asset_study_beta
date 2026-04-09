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
  return [
    "rolling-returns",
    slugify(payload.seriesLabel || payload.selection?.label || "study"),
    toIsoDate(payload.actualStartDate),
    toIsoDate(payload.actualEndDate),
  ].join("-");
}

function buildCsvRows(payload) {
  return [
    [
      "study",
      "selection_label",
      "selection_symbol",
      "method",
      "window_years",
      "window_label",
      "start_date",
      "end_date",
      "elapsed_days",
      "start_value",
      "end_value",
      "total_return_decimal",
      "annualized_log_return_decimal",
      "cagr_decimal",
    ],
    ...payload.availableWindowSummaries.flatMap((windowSummary) =>
      windowSummary.windowRows.map((row) => [
        payload.studyTitle,
        payload.seriesLabel,
        payload.selection?.symbol ?? "",
        payload.methodLabel,
        row.windowYears,
        row.windowLabel,
        toIsoDate(row.startDate),
        toIsoDate(row.endDate),
        row.elapsedDays,
        row.startValue,
        row.endValue,
        row.totalReturn,
        row.annualizedLogReturn,
        row.annualizedReturn,
      ]),
    ),
  ];
}

function buildSummaryRows(payload) {
  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(payload.studyTitle)],
    [createCell("Selection"), createCell(payload.seriesLabel)],
    [createCell("Symbol"), createCell(payload.selection?.symbol ?? "")],
    [createCell("Provider"), createCell(payload.selection?.providerName ?? "")],
    [createCell("Method"), createCell(payload.methodLabel)],
    [createCell("Requested Start"), createCell(payload.requestedStartDate, "date")],
    [createCell("Requested End"), createCell(payload.requestedEndDate, "date")],
    [createCell("Actual Start"), createCell(payload.actualStartDate, "date")],
    [createCell("Actual End"), createCell(payload.actualEndDate, "date")],
    [createCell("Full-Period CAGR"), createCell(payload.fullPeriodCagr, "percent")],
    [
      createCell("Full-Period Total Return"),
      createCell(payload.fullPeriodTotalReturn, "percent"),
    ],
    [
      createCell("Available Rolling Horizons"),
      createCell(payload.availableWindowSummaries.length, "integer"),
    ],
    [
      createCell("Total Rolling Windows"),
      createCell(payload.summary.totalRollingObservations, "integer"),
    ],
    [createCell("Warnings"), createCell(payload.warnings.length, "integer")],
    [createCell("Exported At"), createCell(formatDateTime(payload.exportedAt))],
  ];
}

function buildWindowStatsRows(payload) {
  return [
    [
      createCell("Window", "header"),
      createCell("Observations", "header"),
      createCell("Latest CAGR", "header"),
      createCell("Median CAGR", "header"),
      createCell("25th Percentile", "header"),
      createCell("75th Percentile", "header"),
      createCell("Best CAGR", "header"),
      createCell("Worst CAGR", "header"),
      createCell("Positive Rate", "header"),
      createCell("Range", "header"),
    ],
    ...payload.windowSummaries.map((windowSummary) => [
      createCell(windowSummary.windowLabel),
      createCell(windowSummary.observations, "integer"),
      createCell(windowSummary.latestCagr, "percent"),
      createCell(windowSummary.medianCagr, "percent"),
      createCell(windowSummary.percentile25Cagr, "percent"),
      createCell(windowSummary.percentile75Cagr, "percent"),
      createCell(windowSummary.bestCagr, "percent"),
      createCell(windowSummary.worstCagr, "percent"),
      createCell(windowSummary.positiveRate, "percent"),
      createCell(windowSummary.cagrRange, "percent"),
    ]),
  ];
}

function buildRollingRowsSheet(payload) {
  return [
    [
      createCell("Window Years", "header"),
      createCell("Window Label", "header"),
      createCell("Start Date", "header"),
      createCell("End Date", "header"),
      createCell("Elapsed Days", "header"),
      createCell("Start Value", "header"),
      createCell("End Value", "header"),
      createCell("Total Return", "header"),
      createCell("Annualized Log Return", "header"),
      createCell("CAGR", "header"),
    ],
    ...payload.availableWindowSummaries.flatMap((windowSummary) =>
      windowSummary.windowRows.map((row) => [
        createCell(row.windowYears, "integer"),
        createCell(row.windowLabel),
        createCell(row.startDate, "date"),
        createCell(row.endDate, "date"),
        createCell(row.elapsedDays, "integer"),
        createCell(row.startValue, "number2"),
        createCell(row.endValue, "number2"),
        createCell(row.totalReturn, "percent"),
        createCell(row.annualizedLogReturn, "number4"),
        createCell(row.annualizedReturn, "percent"),
      ]),
    ),
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
      name: "Window Stats",
      rows: buildWindowStatsRows(payload),
    },
    {
      name: "Rolling Rows",
      rows: buildRollingRowsSheet(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsRows(payload),
    },
  ]);
}

function exportRollingReturnsCsv(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(buildCsvRows(payload)),
    "text/csv;charset=utf-8",
  );
}

function exportRollingReturnsXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportRollingReturnsCsv,
  exportRollingReturnsXls,
};
