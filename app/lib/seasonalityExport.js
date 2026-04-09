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
    "seasonality",
    slugify(payload.seriesLabel || payload.selection?.label || "study"),
    toIsoDate(payload.requestedStartDate),
    toIsoDate(payload.requestedEndDate),
  ].join("-");
}

function buildCsvRows(payload) {
  return [
    [
      "year",
      "month_number",
      "month_label",
      "month_start",
      "month_end",
      "start_date",
      "end_date",
      "start_value",
      "end_value",
      "simple_return",
      "log_return",
      "is_positive",
      "partial_boundary",
    ],
    ...payload.monthlyRows.map((row) => [
      row.year,
      row.monthNumber,
      row.monthLabel,
      toIsoDate(row.monthStart),
      toIsoDate(row.monthEnd),
      toIsoDate(row.startDate),
      toIsoDate(row.endDate),
      row.startValue,
      row.endValue,
      row.simpleReturn,
      row.logReturn,
      row.isPositive ? "yes" : "no",
      row.isBoundaryPartial ? "yes" : "no",
    ]),
  ];
}

function buildSummaryRows(payload) {
  const { summary } = payload;

  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(payload.studyTitle || "Seasonality")],
    [createCell("Selection"), createCell(payload.seriesLabel)],
    [createCell("Symbol"), createCell(payload.selection?.symbol || "")],
    [createCell("Method"), createCell(payload.methodLabel)],
    [createCell("Requested Start"), createCell(payload.requestedStartDate, "date")],
    [createCell("Requested End"), createCell(payload.requestedEndDate, "date")],
    [createCell("Actual Start"), createCell(payload.actualStartDate, "date")],
    [createCell("Actual End"), createCell(payload.actualEndDate, "date")],
    [
      createCell("Include Partial Boundary Months"),
      createCell(payload.includePartialBoundaryMonths ? "Yes" : "No"),
    ],
    [createCell("Return Basis"), createCell("Monthly log returns")],
    [createCell("Years Observed"), createCell(summary.yearsObserved, "integer")],
    [createCell("Months Used"), createCell(summary.monthsUsed, "integer")],
    [
      createCell("Seasonality Spread"),
      createCell(summary.seasonalitySpread, "percent"),
    ],
    [
      createCell("Strongest Month"),
      createCell(
        summary.strongestMonth
          ? `${summary.strongestMonth.monthLabel} (${summary.strongestMonth.averageLogReturn})`
          : "",
      ),
    ],
    [
      createCell("Weakest Month"),
      createCell(
        summary.weakestMonth
          ? `${summary.weakestMonth.monthLabel} (${summary.weakestMonth.averageLogReturn})`
          : "",
      ),
    ],
    [
      createCell("Best Hit Rate Month"),
      createCell(
        summary.bestHitRateMonth
          ? `${summary.bestHitRateMonth.monthLabel} (${summary.bestHitRateMonth.winRate})`
          : "",
      ),
    ],
    [
      createCell("Most Volatile Month"),
      createCell(
        summary.mostVolatileMonth
          ? `${summary.mostVolatileMonth.monthLabel} (${summary.mostVolatileMonth.volatility})`
          : "",
      ),
    ],
    [createCell("Skipped Month Gaps"), createCell(summary.skippedTransitions, "integer")],
    [createCell("Warnings"), createCell(payload.warnings.length, "integer")],
    [createCell("Exported At"), createCell(formatDateTime(payload.exportedAt))],
  ];
}

function buildBucketSheetRows(payload) {
  return [
    [
      createCell("Month", "header"),
      createCell("Observations", "header"),
      createCell("Avg Log Return", "header"),
      createCell("Median Log Return", "header"),
      createCell("Win Rate", "header"),
      createCell("Volatility", "header"),
      createCell("Positive Years %", "header"),
      createCell("Best", "header"),
      createCell("Worst", "header"),
      createCell("Best Year", "header"),
      createCell("Worst Year", "header"),
    ],
    ...payload.bucketStats.map((bucket) => [
      createCell(bucket.monthLabel),
      createCell(bucket.observations, "integer"),
      createCell(bucket.averageLogReturn, "percent"),
      createCell(bucket.medianLogReturn, "percent"),
      createCell(bucket.winRate, "percent"),
      createCell(bucket.volatility, "percent"),
      createCell(bucket.positiveYearsPct, "percent"),
      createCell(bucket.bestLogReturn, "percent"),
      createCell(bucket.worstLogReturn, "percent"),
      createCell(bucket.bestYear, "integer"),
      createCell(bucket.worstYear, "integer"),
    ]),
  ];
}

function buildHeatmapSheetRows(payload) {
  return [
    [
      createCell("Year", "header"),
      ...payload.heatmap.rows[0]?.cells.map((cell) =>
        createCell(cell.monthLabel, "header"),
      ),
    ],
    ...payload.heatmap.rows.map((row) => [
      createCell(row.year, "integer"),
      ...row.cells.map((cell) => createCell(cell.value, "percent")),
    ]),
  ];
}

function buildMonthlyRowsSheet(payload) {
  return [
    [
      createCell("Year", "header"),
      createCell("Month Number", "header"),
      createCell("Month Label", "header"),
      createCell("Month Start", "header"),
      createCell("Month End", "header"),
      createCell("Start Date", "header"),
      createCell("End Date", "header"),
      createCell("Start Value", "header"),
      createCell("End Value", "header"),
      createCell("Simple Return", "header"),
      createCell("Log Return", "header"),
      createCell("Positive", "header"),
      createCell("Partial Boundary", "header"),
    ],
    ...payload.monthlyRows.map((row) => [
      createCell(row.year, "integer"),
      createCell(row.monthNumber, "integer"),
      createCell(row.monthLabel),
      createCell(row.monthStart, "date"),
      createCell(row.monthEnd, "date"),
      createCell(row.startDate, "date"),
      createCell(row.endDate, "date"),
      createCell(row.startValue, "number2"),
      createCell(row.endValue, "number2"),
      createCell(row.simpleReturn, "percent"),
      createCell(row.logReturn, "percent"),
      createCell(row.isPositive ? "Yes" : "No"),
      createCell(row.isBoundaryPartial ? "Yes" : "No"),
    ]),
  ];
}

function buildWarningsSheetRows(payload) {
  return [
    [createCell("Warning", "header")],
    ...(payload.warnings.length
      ? payload.warnings.map((warning) => [createCell(warning)])
      : [[createCell("No warnings.")]]),
  ];
}

function buildWorkbookXml(payload) {
  return buildXmlWorkbook([
    {
      name: "Summary",
      rows: buildSummaryRows(payload),
    },
    {
      name: "Month Buckets",
      rows: buildBucketSheetRows(payload),
    },
    {
      name: "Year-Month Heatmap",
      rows: buildHeatmapSheetRows(payload),
    },
    {
      name: "Monthly Rows",
      rows: buildMonthlyRowsSheet(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsSheetRows(payload),
    },
  ]);
}

function exportSeasonalityCsv(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(buildCsvRows(payload)),
    "text/csv;charset=utf-8",
  );
}

function exportSeasonalityXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export { exportSeasonalityCsv, exportSeasonalityXls };
