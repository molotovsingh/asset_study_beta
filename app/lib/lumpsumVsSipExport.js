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
    "lumpsum-vs-sip",
    slugify(payload.seriesLabel || payload.selection?.label || "study"),
    `${payload.horizonYears}y`,
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
      "total_investment",
      "horizon_years",
      "start_month",
      "start_date",
      "target_end_date",
      "end_date",
      "duration_years",
      "sip_contribution_count",
      "sip_monthly_contribution",
      "lumpsum_terminal_value",
      "lumpsum_return_decimal",
      "lumpsum_cagr_decimal",
      "sip_terminal_value",
      "sip_return_decimal",
      "sip_xirr_decimal",
      "advantage_amount",
      "advantage_rate_decimal",
      "advantage_of_sip_value_decimal",
      "winner",
    ],
    ...payload.cohorts.map((cohort) => [
      payload.studyTitle,
      payload.seriesLabel,
      payload.selection?.symbol ?? "",
      payload.methodLabel,
      payload.totalInvestment,
      payload.horizonYears,
      cohort.startMonthLabel,
      toIsoDate(cohort.startDate),
      toIsoDate(cohort.targetEndDate),
      toIsoDate(cohort.endDate),
      cohort.durationYears,
      cohort.contributionCount,
      cohort.monthlyContribution,
      cohort.lumpsumTerminalValue,
      cohort.lumpsumReturn,
      cohort.lumpsumCagr,
      cohort.sipTerminalValue,
      cohort.sipReturn,
      cohort.sipXirr,
      cohort.advantageAmount,
      cohort.advantageRate,
      cohort.advantageOfSipValue,
      cohort.winner,
    ]),
  ];
}

function buildSummaryRows(payload) {
  const { summary } = payload;

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
    [createCell("Total Investment"), createCell(payload.totalInvestment, "number2")],
    [createCell("Horizon Years"), createCell(payload.horizonYears, "number2")],
    [createCell("Cohorts"), createCell(summary.totalCohorts, "integer")],
    [createCell("Lumpsum Wins"), createCell(summary.lumpsumWins, "integer")],
    [createCell("SIP Wins"), createCell(summary.sipWins, "integer")],
    [createCell("Lumpsum Win Rate"), createCell(summary.lumpsumWinRate, "percent")],
    [createCell("SIP Win Rate"), createCell(summary.sipWinRate, "percent")],
    [
      createCell("Median Advantage"),
      createCell(summary.medianAdvantageRate, "percent"),
    ],
    [
      createCell("Average Advantage"),
      createCell(summary.averageAdvantageRate, "percent"),
    ],
    [
      createCell("Median Lumpsum CAGR"),
      createCell(summary.medianLumpsumCagr, "percent"),
    ],
    [
      createCell("Median SIP XIRR"),
      createCell(summary.medianSipXirr, "percent"),
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
      createCell("SIP Contributions", "header"),
      createCell("Monthly SIP Amount", "header"),
      createCell("Lumpsum Terminal", "header"),
      createCell("Lumpsum CAGR", "header"),
      createCell("SIP Terminal", "header"),
      createCell("SIP XIRR", "header"),
      createCell("Advantage Amount", "header"),
      createCell("Advantage Rate", "header"),
      createCell("Winner", "header"),
    ],
    ...payload.cohorts.map((cohort) => [
      createCell(cohort.startMonthLabel),
      createCell(cohort.startDate, "date"),
      createCell(cohort.endDate, "date"),
      createCell(cohort.contributionCount, "integer"),
      createCell(cohort.monthlyContribution, "number2"),
      createCell(cohort.lumpsumTerminalValue, "number2"),
      createCell(cohort.lumpsumCagr, "percent"),
      createCell(cohort.sipTerminalValue, "number2"),
      createCell(cohort.sipXirr, "percent"),
      createCell(cohort.advantageAmount, "number2"),
      createCell(cohort.advantageRate, "percent"),
      createCell(cohort.winner),
    ]),
  ];
}

function buildRepresentativeSipPathRows(payload) {
  const path = payload.summary.firstCohort?.sipPath ?? [];

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
      name: "Representative SIP Path",
      rows: buildRepresentativeSipPathRows(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsRows(payload),
    },
  ]);
}

function exportLumpsumVsSipCsv(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(buildCsvRows(payload)),
    "text/csv;charset=utf-8",
  );
}

function exportLumpsumVsSipXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportLumpsumVsSipCsv,
  exportLumpsumVsSipXls,
};
