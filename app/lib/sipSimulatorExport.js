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
    "sip-simulator",
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
      "monthly_contribution",
      "min_contributions",
      "start_month",
      "start_date",
      "end_date",
      "contribution_count",
      "duration_years",
      "total_invested",
      "terminal_value",
      "gain",
      "wealth_multiple",
      "xirr_decimal",
    ],
    ...payload.cohorts.map((cohort) => [
      payload.studyTitle,
      payload.seriesLabel,
      payload.selection?.symbol ?? "",
      payload.methodLabel,
      payload.monthlyContribution,
      payload.minContributions,
      cohort.startMonthLabel,
      toIsoDate(cohort.startDate),
      toIsoDate(cohort.endDate),
      cohort.contributionCount,
      cohort.durationYears,
      cohort.totalInvested,
      cohort.terminalValue,
      cohort.gain,
      cohort.wealthMultiple,
      cohort.xirr,
    ]),
  ];
}

function buildSummaryRows(payload) {
  const { summary } = payload;
  const { fullWindowCohort } = summary;

  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(payload.studyTitle)],
    [createCell("Selection"), createCell(payload.seriesLabel)],
    [createCell("Symbol"), createCell(payload.selection?.symbol ?? "")],
    [createCell("Method"), createCell(payload.methodLabel)],
    [createCell("Requested Start"), createCell(payload.requestedStartDate, "date")],
    [createCell("Requested End"), createCell(payload.requestedEndDate, "date")],
    [createCell("Actual Start"), createCell(payload.actualStartDate, "date")],
    [createCell("Actual End"), createCell(payload.actualEndDate, "date")],
    [createCell("Monthly Contribution"), createCell(payload.monthlyContribution, "number2")],
    [createCell("Minimum Contributions"), createCell(payload.minContributions, "integer")],
    [createCell("Monthly Anchors"), createCell(summary.totalMonthlyAnchors, "integer")],
    [createCell("Cohorts"), createCell(summary.totalCohorts, "integer")],
    [createCell("Median Cohort XIRR"), createCell(summary.medianXirr, "percent")],
    [createCell("Average Cohort XIRR"), createCell(summary.averageXirr, "percent")],
    [createCell("Positive Cohort Rate"), createCell(summary.positiveRate, "percent")],
    [
      createCell("Full-Window XIRR"),
      createCell(fullWindowCohort?.xirr ?? null, "percent"),
    ],
    [
      createCell("Full-Window Terminal Value"),
      createCell(fullWindowCohort?.terminalValue ?? null, "number2"),
    ],
    [
      createCell("Full-Window Total Invested"),
      createCell(fullWindowCohort?.totalInvested ?? null, "number2"),
    ],
    [createCell("Warnings"), createCell(payload.warnings.length, "integer")],
    [createCell("Exported At"), createCell(formatDateTime(payload.exportedAt))],
  ];
}

function buildCohortRows(payload) {
  return [
    [
      createCell("Start Month", "header"),
      createCell("Start Date", "header"),
      createCell("End Date", "header"),
      createCell("Contributions", "header"),
      createCell("Duration Years", "header"),
      createCell("Total Invested", "header"),
      createCell("Terminal Value", "header"),
      createCell("Gain", "header"),
      createCell("Wealth Multiple", "header"),
      createCell("XIRR", "header"),
    ],
    ...payload.cohorts.map((cohort) => [
      createCell(cohort.startMonthLabel),
      createCell(cohort.startDate, "date"),
      createCell(cohort.endDate, "date"),
      createCell(cohort.contributionCount, "integer"),
      createCell(cohort.durationYears, "number2"),
      createCell(cohort.totalInvested, "number2"),
      createCell(cohort.terminalValue, "number2"),
      createCell(cohort.gain, "number2"),
      createCell(cohort.wealthMultiple, "number2"),
      createCell(cohort.xirr, "percent"),
    ]),
  ];
}

function buildFullWindowPathRows(payload) {
  const path = payload.summary.fullWindowCohort?.path ?? [];

  return [
    [
      createCell("Date", "header"),
      createCell("Contribution Amount", "header"),
      createCell("Contribution Price", "header"),
      createCell("Total Invested", "header"),
      createCell("Portfolio Value", "header"),
      createCell("Units Held", "header"),
      createCell("Terminal Only", "header"),
    ],
    ...path.map((row) => [
      createCell(row.date, "date"),
      createCell(row.contributionAmount, "number2"),
      createCell(row.contributionPrice, "number2"),
      createCell(row.totalInvested, "number2"),
      createCell(row.portfolioValue, "number2"),
      createCell(row.unitsHeld, "number4"),
      createCell(row.terminalOnly ? "Yes" : "No"),
    ]),
  ];
}

function buildFullWindowCashFlowRows(payload) {
  const cashFlows = payload.summary.fullWindowCohort?.cashFlows ?? [];

  return [
    [
      createCell("Date", "header"),
      createCell("Amount", "header"),
    ],
    ...cashFlows.map((cashFlow) => [
      createCell(cashFlow.date, "date"),
      createCell(cashFlow.amount, "number2"),
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
      name: "Cohorts",
      rows: buildCohortRows(payload),
    },
    {
      name: "Full Window Path",
      rows: buildFullWindowPathRows(payload),
    },
    {
      name: "Cash Flows",
      rows: buildFullWindowCashFlowRows(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsRows(payload),
    },
  ]);
}

function exportSipSimulatorCsv(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(buildCsvRows(payload)),
    "text/csv;charset=utf-8",
  );
}

function exportSipSimulatorXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportSipSimulatorCsv,
  exportSipSimulatorXls,
};
