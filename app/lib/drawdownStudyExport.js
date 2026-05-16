import { formatDateTime } from "./format.js";
import { buildDrawdownMetricPresentation } from "./metricRegistry.js";
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
    "drawdown-study",
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
      "depth_rank",
      "peak_date",
      "trough_date",
      "recovery_date",
      "max_drawdown_decimal",
      "peak_to_trough_days",
      "duration_days",
      "recovery_days",
      "recovered",
    ],
    ...payload.episodesByDepth.map((episode) => [
      payload.studyTitle,
      payload.seriesLabel,
      payload.selection?.symbol ?? "",
      payload.methodLabel,
      episode.depthRank,
      toIsoDate(episode.peakDate),
      toIsoDate(episode.troughDate),
      episode.recoveryDate ? toIsoDate(episode.recoveryDate) : "",
      episode.maxDepth,
      episode.peakToTroughDays,
      episode.durationDays,
      episode.recoveryDays,
      episode.recovered ? "yes" : "no",
    ]),
  ];
}

function buildSummaryRows(payload) {
  const { summary } = payload;
  const metricPresentation = buildDrawdownMetricPresentation({ summary });
  const maxEpisode = summary.maxDrawdownEpisode;
  const longestEpisode = summary.longestEpisode;
  const longestRecovery = summary.longestRecovery;

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
    [createCell("Observations"), createCell(summary.observations, "integer")],
    [createCell("Materiality Threshold"), createCell(summary.materialityThreshold, "percent")],
    [createCell("Episode Role"), createCell(metricPresentation.materialEpisodes.note)],
    [createCell("Total Episodes"), createCell(summary.totalEpisodes, "integer")],
    [createCell("Recovered Episodes"), createCell(summary.recoveredEpisodes, "integer")],
    [createCell("Unrecovered Episodes"), createCell(summary.unrecoveredEpisodes, "integer")],
    [createCell("Time Underwater"), createCell(summary.timeUnderwaterRate, "percent")],
    [createCell("Latest Depth"), createCell(summary.latestDepth, "percent")],
    [createCell("Average Episode Depth"), createCell(summary.averageEpisodeDepth, "percent")],
    [createCell("Median Episode Depth"), createCell(summary.medianEpisodeDepth, "percent")],
    [createCell("Average Episode Duration (Days)"), createCell(summary.averageEpisodeDurationDays, "number2")],
    [createCell("Median Episode Duration (Days)"), createCell(summary.medianEpisodeDurationDays, "number2")],
    [createCell("Average Recovery (Days)"), createCell(summary.averageRecoveryDays, "number2")],
    [createCell("Median Recovery (Days)"), createCell(summary.medianRecoveryDays, "number2")],
    [createCell("Worst Drawdown"), createCell(maxEpisode?.maxDepth ?? null, "percent")],
    [createCell("Worst Peak Date"), createCell(maxEpisode?.peakDate ?? null, "date")],
    [createCell("Worst Trough Date"), createCell(maxEpisode?.troughDate ?? null, "date")],
    [createCell("Worst Recovery Date"), createCell(maxEpisode?.recoveryDate ?? null, "date")],
    [createCell("Longest Episode (Days)"), createCell(longestEpisode?.durationDays ?? null, "number2")],
    [createCell("Longest Episode Peak Date"), createCell(longestEpisode?.peakDate ?? null, "date")],
    [createCell("Longest Episode End Date"), createCell(longestEpisode?.endDate ?? null, "date")],
    [createCell("Longest Recovery (Days)"), createCell(longestRecovery?.recoveryDays ?? null, "number2")],
    [createCell("Longest Recovery Peak Date"), createCell(longestRecovery?.peakDate ?? null, "date")],
    [createCell("Longest Recovery Recovery Date"), createCell(longestRecovery?.recoveryDate ?? null, "date")],
    [createCell("Warnings"), createCell(payload.warnings.length, "integer")],
    [createCell("Exported At"), createCell(formatDateTime(payload.exportedAt))],
  ];
}

function buildEpisodeRows(payload) {
  return [
    [
      createCell("Depth Rank", "header"),
      createCell("Peak Date", "header"),
      createCell("Trough Date", "header"),
      createCell("Recovery Date", "header"),
      createCell("Recovered", "header"),
      createCell("Max Drawdown", "header"),
      createCell("Peak to Trough (Days)", "header"),
      createCell("Duration (Days)", "header"),
      createCell("Recovery (Days)", "header"),
      createCell("Peak Value", "header"),
      createCell("Trough Value", "header"),
      createCell("End Value", "header"),
    ],
    ...payload.episodesByDepth.map((episode) => [
      createCell(episode.depthRank, "integer"),
      createCell(episode.peakDate, "date"),
      createCell(episode.troughDate, "date"),
      createCell(episode.recoveryDate, "date"),
      createCell(episode.recovered ? "Yes" : "No"),
      createCell(episode.maxDepth, "percent"),
      createCell(episode.peakToTroughDays, "number2"),
      createCell(episode.durationDays, "number2"),
      createCell(episode.recoveryDays, "number2"),
      createCell(episode.peakValue, "number2"),
      createCell(episode.troughValue, "number2"),
      createCell(episode.endValue, "number2"),
    ]),
  ];
}

function buildUnderwaterRows(payload) {
  return [
    [
      createCell("Date", "header"),
      createCell("Underwater Depth", "header"),
    ],
    ...payload.underwaterSeries.map((point) => [
      createCell(point.date, "date"),
      createCell(point.depth, "percent"),
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
      name: "Episodes",
      rows: buildEpisodeRows(payload),
    },
    {
      name: "Underwater",
      rows: buildUnderwaterRows(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsRows(payload),
    },
  ]);
}

function exportDrawdownStudyCsv(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(buildCsvRows(payload)),
    "text/csv;charset=utf-8",
  );
}

function exportDrawdownStudyXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildCsvRows,
  buildWorkbookXml,
  exportDrawdownStudyCsv,
  exportDrawdownStudyXls,
};
