import {
  buildXmlWorkbook,
  createCell,
  downloadTextFile,
  serializeCsv,
  slugify,
  toIsoDate,
} from "./studyExport.js";
import {
  flattenOptionsValidationGroups,
  flattenOptionsValidationObservations,
} from "./optionsValidation.js";

function buildExportFileBaseName(studyRun) {
  return [
    "options-validation",
    slugify(studyRun.universe.id || "universe"),
    studyRun.horizonLabel.toLowerCase(),
  ].join("-");
}

function buildCsvRows(studyRun) {
  return [
    [
      "Section",
      "Rank",
      "Group",
      "Count",
      "Latest As Of",
      "Average Forward Return",
      "Median Forward Return",
      "Win Rate",
      "Average Absolute Move",
      "Average IV/HV20",
      "Average Direction Score",
      "Run Id",
      "Symbol",
      "As Of",
      "Base Date",
      "Forward Date",
      "Matured",
      "Base Price",
      "Forward Price",
      "Forward Return",
      "Absolute Move",
      "Available Trading Days",
      "Pricing",
      "Candidate",
      "Direction",
      "Reason",
    ],
    ...flattenOptionsValidationGroups(studyRun).map((group) => [
      "group",
      group.rank,
      group.group,
      group.count,
      group.latestAsOfDate ? toIsoDate(group.latestAsOfDate) : "",
      group.averageForwardReturn,
      group.medianForwardReturn,
      group.winRate,
      group.averageAbsoluteMove,
      group.averageIvHv20Ratio,
      group.averageDirectionScore,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
    ...flattenOptionsValidationObservations(studyRun).map((row) => [
      "observation",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      row.runId,
      row.symbol,
      row.asOfDate ? toIsoDate(row.asOfDate) : "",
      row.baseDate ? toIsoDate(row.baseDate) : "",
      row.forwardDate ? toIsoDate(row.forwardDate) : "",
      row.matured ? "yes" : "no",
      row.basePrice,
      row.forwardPrice,
      row.forwardReturn,
      row.absoluteMove,
      row.availableTradingDays,
      row.pricingLabel,
      row.candidateAdvisory,
      row.directionLabel,
      row.reason,
    ]),
  ];
}

function buildSummaryRows(studyRun) {
  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(studyRun.studyTitle)],
    [createCell("Universe"), createCell(studyRun.universe.label)],
    [createCell("Horizon"), createCell(studyRun.horizonLabel)],
    [createCell("Group By"), createCell(studyRun.groupDefinition.label)],
    [createCell("Archived Runs"), createCell(studyRun.runCount, "integer")],
    [createCell("Archived Observations"), createCell(studyRun.observationCount, "integer")],
    [createCell("Matured Observations"), createCell(studyRun.maturedCount, "integer")],
    [createCell("Pending Observations"), createCell(studyRun.pendingCount, "integer")],
    [createCell("Best Group"), createCell(studyRun.bestGroup?.label || "")],
    [createCell("Weakest Group"), createCell(studyRun.weakestGroup?.label || "")],
  ];
}

function buildGroupsSheet(studyRun) {
  return [
    [
      createCell("Group", "header"),
      createCell("Count", "header"),
      createCell("Latest As Of", "header"),
      createCell("Average Forward Return", "header"),
      createCell("Median Forward Return", "header"),
      createCell("Win Rate", "header"),
      createCell("Average Absolute Move", "header"),
      createCell("Average IV/HV20", "header"),
      createCell("Average Direction Score", "header"),
    ],
    ...flattenOptionsValidationGroups(studyRun).map((group) => [
      createCell(group.group),
      createCell(group.count, "integer"),
      createCell(group.latestAsOfDate, "date"),
      createCell(group.averageForwardReturn, "percent"),
      createCell(group.medianForwardReturn, "percent"),
      createCell(group.winRate, "percent"),
      createCell(group.averageAbsoluteMove, "percent"),
      createCell(group.averageIvHv20Ratio, "number2"),
      createCell(group.averageDirectionScore, "number2"),
    ]),
  ];
}

function buildObservationsSheet(studyRun) {
  return [
    [
      createCell("Run Id", "header"),
      createCell("Symbol", "header"),
      createCell("As Of", "header"),
      createCell("Base Date", "header"),
      createCell("Forward Date", "header"),
      createCell("Matured", "header"),
      createCell("Base Price", "header"),
      createCell("Forward Price", "header"),
      createCell("Forward Return", "header"),
      createCell("Absolute Move", "header"),
      createCell("Available Trading Days", "header"),
      createCell("Pricing", "header"),
      createCell("Candidate", "header"),
      createCell("Direction", "header"),
      createCell("IV/HV20", "header"),
      createCell("Direction Score", "header"),
      createCell("Execution Score", "header"),
      createCell("Confidence Score", "header"),
      createCell("Reason", "header"),
    ],
    ...flattenOptionsValidationObservations(studyRun).map((row) => [
      createCell(row.runId, "integer"),
      createCell(row.symbol),
      createCell(row.asOfDate, "date"),
      createCell(row.baseDate, "date"),
      createCell(row.forwardDate, "date"),
      createCell(row.matured ? "yes" : "no"),
      createCell(row.basePrice, "number2"),
      createCell(row.forwardPrice, "number2"),
      createCell(row.forwardReturn, "percent"),
      createCell(row.absoluteMove, "percent"),
      createCell(row.availableTradingDays, "integer"),
      createCell(row.pricingLabel),
      createCell(row.candidateAdvisory),
      createCell(row.directionLabel),
      createCell(row.ivHv20Ratio, "number2"),
      createCell(row.directionScore, "number2"),
      createCell(row.executionScore, "number2"),
      createCell(row.confidenceScore, "number2"),
      createCell(row.reason),
    ]),
  ];
}

function buildWorkbookXml(studyRun) {
  return buildXmlWorkbook([
    { name: "Summary", rows: buildSummaryRows(studyRun) },
    { name: "Groups", rows: buildGroupsSheet(studyRun) },
    { name: "Observations", rows: buildObservationsSheet(studyRun) },
  ]);
}

function exportOptionsValidationCsv(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.csv`,
    serializeCsv(buildCsvRows(studyRun)),
    "text/csv;charset=utf-8",
  );
}

function exportOptionsValidationXls(studyRun) {
  downloadTextFile(
    `${buildExportFileBaseName(studyRun)}.xls`,
    buildWorkbookXml(studyRun),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportOptionsValidationCsv,
  exportOptionsValidationXls,
};
