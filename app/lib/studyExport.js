import { formatDateTime } from "./format.js";
import {
  buildAnnualizedMetricPolicy,
  buildRiskMetricPresentation,
} from "./metricRegistry.js";

function buildMetricExportDefinitions(payload) {
  const metricPresentation = buildRiskMetricPresentation({
    metrics: payload.metrics,
    startDate: payload.actualStartDate,
    endDate: payload.actualEndDate,
  });
  const { policy: metricPolicy } = metricPresentation;
  const returnObservationNote = `${metricPolicy.returnObservations} return observations`;

  return [
    {
      label: metricPresentation.primaryReturn.exportLabel,
      key: metricPresentation.primaryReturn.key,
      styleId: metricPresentation.primaryReturn.styleId,
      note: metricPresentation.primaryReturn.note,
    },
    {
      label: metricPresentation.secondaryReturn.exportLabel,
      key: metricPresentation.secondaryReturn.key,
      styleId: metricPresentation.secondaryReturn.styleId,
      note: metricPresentation.secondaryReturn.note,
    },
  {
    label: "Volatility",
    key: "annualizedVolatility",
    styleId: "percent",
    note: `Annualized volatility of log returns from ${returnObservationNote}`,
  },
  {
    label: "Downside Deviation",
    key: "downsideDeviation",
    styleId: "percent",
    note: `Annualized downside deviation from ${returnObservationNote}`,
  },
  {
    label: "Max Drawdown",
    key: "maxDrawdown",
    styleId: "percent",
    note: "Worst peak-to-trough decline",
  },
  {
    label: "Ulcer Index",
    key: "ulcerIndex",
    styleId: "percent",
    note: "Depth and persistence of drawdowns",
  },
  {
    label: "Sharpe Ratio",
    key: "sharpeRatio",
    styleId: "number2",
    note: `Annualized excess log return divided by volatility; ${returnObservationNote}`,
  },
  {
    label: "Sortino Ratio",
    key: "sortinoRatio",
    styleId: "number2",
    note: `Annualized excess log return divided by downside deviation; ${returnObservationNote}`,
  },
  {
    label: metricPresentation.drawdownEfficiency.exportLabel,
    key: metricPresentation.drawdownEfficiency.key,
    value: metricPresentation.drawdownEfficiency.value,
    styleId: metricPresentation.drawdownEfficiency.styleId,
    note: metricPresentation.drawdownEfficiency.note,
  },
  {
    label: "Martin Ratio",
    key: "martinRatio",
    styleId: "number2",
    note: `Return above risk-free divided by ulcer index; ${returnObservationNote}`,
  },
  {
    label: "Risk-Free Rate",
    key: "averageAnnualRiskFreeRate",
    styleId: "percent",
    note: "Average annual rate used in the study",
  },
  {
    label: "Win Rate",
    key: "winRate",
    styleId: "percent",
    note: "Share of positive periods",
  },
  {
    label: "Average Log Return",
    key: "averagePeriodReturn",
    styleId: "number4",
    note: "Arithmetic mean of period log returns",
  },
  {
    label: "Median Log Return",
    key: "medianPeriodReturn",
    styleId: "number4",
    note: "Median period log return",
  },
  {
    label: "VaR 95%",
    key: "valueAtRisk95",
    styleId: "number4",
    note: "5th percentile period log return",
  },
  {
    label: "CVaR 95%",
    key: "conditionalValueAtRisk95",
    styleId: "number4",
    note: "Average log return beyond VaR",
  },
  {
    label: "Skewness",
    key: "skewness",
    styleId: "number2",
    note: "Asymmetry of returns",
  },
  {
    label: "Excess Kurtosis",
    key: "excessKurtosis",
    styleId: "number2",
    note: "Tail heaviness beyond normal",
  },
  {
    label: "Periods Per Year",
    key: "periodsPerYear",
    styleId: "integer",
    note: "Sampling frequency inferred from date gaps",
  },
  {
    label: "Annualized Log Return",
    key: "annualizedLogReturn",
    styleId: "number4",
    note: "Continuously compounded annualized return",
  },
  {
    label: "Annualized Excess Log Return",
    key: "annualizedExcessLogReturn",
    styleId: "number4",
    note: "Annualized mean excess log return used in Sharpe and Sortino",
  },
  {
    label: "Average Annual Log Risk-Free Rate",
    key: "averageAnnualLogRiskFreeRate",
    styleId: "number4",
    note: "Log-rate equivalent of the average annual risk-free rate",
  },
  {
    label: "Observations",
    key: "observations",
    styleId: "integer",
    note: "Index observations in the filtered series",
  },
  {
    label: "Return Observations",
    key: "periodicObservations",
    styleId: "integer",
    note: "Return periods in the filtered series",
  },
  {
    label: "Longest Drawdown Days",
    key: "maxDrawdownDurationDays",
    styleId: "integer",
    note: "Peak-to-recovery or end, in days",
  },
  {
    label: "Longest Drawdown Periods",
    key: "maxDrawdownDurationPeriods",
    styleId: "integer",
    note: "Peak-to-recovery or end, in periods",
  },
  ];
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toExcelDateTime(date) {
  return `${toIsoDate(date)}T00:00:00.000`;
}

function annualRateToPeriodReturn(annualRate, days) {
  return (1 + annualRate) ** (days / 365) - 1;
}

function annualRateToPeriodLogReturn(annualRate, days) {
  return Math.log1p(annualRate) * (days / 365);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

function serializeCsv(rows) {
  return `\uFEFF${rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\r\n")}`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createCell(value, styleId = null) {
  return { value, styleId };
}

function sanitizeWorksheetName(name) {
  return name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet";
}

function buildSeriesRows(indexSeries, annualRiskFreeRate) {
  let peakValue = indexSeries[0]?.value ?? 0;

  return indexSeries.map((point, index) => {
    peakValue = Math.max(peakValue, point.value);
    const previous = index > 0 ? indexSeries[index - 1] : null;
    const periodDays = previous
      ? (point.date - previous.date) / 86400000
      : null;
    const periodReturn = previous
      ? point.value / previous.value - 1
      : null;
    const periodRiskFreeReturn =
      previous && annualRiskFreeRate !== null
        ? annualRateToPeriodReturn(annualRiskFreeRate, periodDays)
        : null;
    const logReturn = previous
      ? Math.log(point.value / previous.value)
      : null;
    const periodRiskFreeLogReturn =
      previous && annualRiskFreeRate !== null
        ? annualRateToPeriodLogReturn(annualRiskFreeRate, periodDays)
        : null;
    const excessReturn =
      logReturn !== null && periodRiskFreeLogReturn !== null
        ? logReturn - periodRiskFreeLogReturn
        : null;

    return {
      date: point.date,
      indexValue: point.value,
      periodReturn,
      logReturn,
      periodDays,
      annualRiskFreeRate,
      periodRiskFreeReturn,
      periodRiskFreeLogReturn,
      excessReturn,
      drawdown: peakValue > 0 ? point.value / peakValue - 1 : null,
    };
  });
}

function buildPeriodRows(indexSeries, annualRiskFreeRate) {
  const rows = [];

  for (let index = 1; index < indexSeries.length; index += 1) {
    const start = indexSeries[index - 1];
    const end = indexSeries[index];
    const periodDays = (end.date - start.date) / 86400000;
    const periodReturn = end.value / start.value - 1;
    const logReturn = Math.log(end.value / start.value);
    const periodRiskFreeReturn =
      annualRiskFreeRate !== null
        ? annualRateToPeriodReturn(annualRiskFreeRate, periodDays)
        : null;
    const periodRiskFreeLogReturn =
      annualRiskFreeRate !== null
        ? annualRateToPeriodLogReturn(annualRiskFreeRate, periodDays)
        : null;

    rows.push({
      startDate: start.date,
      endDate: end.date,
      startValue: start.value,
      endValue: end.value,
      periodDays,
      periodReturn,
      logReturn,
      annualRiskFreeRate,
      periodRiskFreeReturn,
      periodRiskFreeLogReturn,
      excessReturn:
        periodRiskFreeLogReturn !== null
          ? logReturn - periodRiskFreeLogReturn
          : null,
    });
  }

  return rows;
}

function buildExportFileBaseName(payload) {
  const label = slugify(payload.seriesLabel || payload.selection?.label || "series");
  return `risk-adjusted-return-${label}-${toIsoDate(payload.actualStartDate)}-to-${toIsoDate(payload.actualEndDate)}`;
}

function buildCsvRows(payload) {
  const seriesRows = buildSeriesRows(payload.indexSeries, payload.annualRiskFreeRate);
  const header = [
    "study",
    "selection_label",
    "selection_symbol",
    "method",
    "date",
    "index_value",
    "period_simple_return_decimal",
    "period_log_return_decimal",
    "period_days",
    "annual_risk_free_rate_decimal",
    "period_risk_free_return_decimal",
    "period_risk_free_log_return_decimal",
    "excess_log_return_decimal",
    "drawdown_decimal",
  ];

  return [
    header,
    ...seriesRows.map((row) => [
      payload.studyTitle,
      payload.seriesLabel,
      payload.selection?.symbol ?? "",
      payload.methodLabel,
      toIsoDate(row.date),
      row.indexValue,
      row.periodReturn,
      row.logReturn,
      row.periodDays,
      row.annualRiskFreeRate,
      row.periodRiskFreeReturn,
      row.periodRiskFreeLogReturn,
      row.excessReturn,
      row.drawdown,
    ]),
  ];
}

function buildSummarySheetRows(payload) {
  const metricPolicy = buildAnnualizedMetricPolicy({
    startDate: payload.actualStartDate,
    endDate: payload.actualEndDate,
    returnObservations: payload.metrics?.periodicObservations,
  });

  return [
    [createCell("Field", "header"), createCell("Value", "header")],
    [createCell("Study"), createCell(payload.studyTitle)],
    [createCell("Selection"), createCell(payload.seriesLabel)],
    [createCell("Symbol"), createCell(payload.selection?.symbol ?? "")],
    [createCell("Provider"), createCell(payload.selection?.providerName ?? "")],
    [createCell("Series Type"), createCell(payload.selection?.targetSeriesType ?? "")],
    [createCell("Method"), createCell(payload.methodLabel)],
    [createCell("Periodic Return Mode"), createCell("Log returns for volatility and distribution metrics")],
    [createCell("Requested Start"), createCell(payload.requestedStartDate, "date")],
    [createCell("Requested End"), createCell(payload.requestedEndDate, "date")],
    [createCell("Actual Start"), createCell(payload.actualStartDate, "date")],
    [createCell("Actual End"), createCell(payload.actualEndDate, "date")],
    [createCell("Input Risk-Free Rate"), createCell(payload.annualRiskFreeRate, "percent")],
    [
      createCell("Annualized Headline Policy"),
      createCell(metricPolicy.canHeadlineAnnualized ? "CAGR allowed as headline" : "Period truth first; annualized values diagnostic"),
    ],
    [createCell("Policy Calendar Days"), createCell(metricPolicy.calendarDays, "integer")],
    [createCell("Policy Return Observations"), createCell(metricPolicy.returnObservations, "integer")],
    [createCell("Demo Mode"), createCell(payload.useDemoData ? "Yes" : "No")],
    [createCell("Exported At"), createCell(formatDateTime(payload.exportedAt))],
    [createCell("Warnings"), createCell(payload.warnings.length, "integer")],
  ];
}

function buildMetricsSheetRows(payload) {
  const definitions = buildMetricExportDefinitions(payload);
  return [
    [
      createCell("Metric", "header"),
      createCell("Value", "header"),
      createCell("Notes", "header"),
    ],
    ...definitions.map((definition) => [
      createCell(definition.label),
      createCell(
        Object.hasOwn(definition, "value")
          ? definition.value
          : payload.metrics[definition.key],
        definition.styleId,
      ),
      createCell(definition.note),
    ]),
    [
      createCell("Best Period"),
      createCell(
        payload.metrics.bestPeriod
          ? `${toIsoDate(payload.metrics.bestPeriod.startDate)} to ${toIsoDate(payload.metrics.bestPeriod.endDate)}`
          : "",
      ),
      createCell(
        payload.metrics.bestPeriod ? payload.metrics.bestPeriod.value : null,
        "percent",
      ),
    ],
    [
      createCell("Worst Period"),
      createCell(
        payload.metrics.worstPeriod
          ? `${toIsoDate(payload.metrics.worstPeriod.startDate)} to ${toIsoDate(payload.metrics.worstPeriod.endDate)}`
          : "",
      ),
      createCell(
        payload.metrics.worstPeriod ? payload.metrics.worstPeriod.value : null,
        "percent",
      ),
    ],
  ];
}

function buildSeriesSheetRows(payload) {
  const rows = buildSeriesRows(payload.indexSeries, payload.annualRiskFreeRate);

  return [
    [
      createCell("Date", "header"),
      createCell("Index Value", "header"),
      createCell("Simple Return", "header"),
      createCell("Log Return", "header"),
      createCell("Period Days", "header"),
      createCell("Annual Risk-Free Rate", "header"),
      createCell("Period Risk-Free Return", "header"),
      createCell("Period Risk-Free Log Return", "header"),
      createCell("Excess Log Return", "header"),
      createCell("Drawdown", "header"),
    ],
    ...rows.map((row) => [
      createCell(row.date, "date"),
      createCell(row.indexValue, "number2"),
      createCell(row.periodReturn, "percent"),
      createCell(row.logReturn, "number4"),
      createCell(row.periodDays, "integer"),
      createCell(row.annualRiskFreeRate, "percent"),
      createCell(row.periodRiskFreeReturn, "percent"),
      createCell(row.periodRiskFreeLogReturn, "number4"),
      createCell(row.excessReturn, "number4"),
      createCell(row.drawdown, "percent"),
    ]),
  ];
}

function buildPeriodsSheetRows(payload) {
  const rows = buildPeriodRows(payload.indexSeries, payload.annualRiskFreeRate);

  return [
    [
      createCell("Start Date", "header"),
      createCell("End Date", "header"),
      createCell("Start Value", "header"),
      createCell("End Value", "header"),
      createCell("Period Days", "header"),
      createCell("Simple Return", "header"),
      createCell("Log Return", "header"),
      createCell("Annual Risk-Free Rate", "header"),
      createCell("Period Risk-Free Return", "header"),
      createCell("Period Risk-Free Log Return", "header"),
      createCell("Excess Log Return", "header"),
    ],
    ...rows.map((row) => [
      createCell(row.startDate, "date"),
      createCell(row.endDate, "date"),
      createCell(row.startValue, "number2"),
      createCell(row.endValue, "number2"),
      createCell(row.periodDays, "integer"),
      createCell(row.periodReturn, "percent"),
      createCell(row.logReturn, "number4"),
      createCell(row.annualRiskFreeRate, "percent"),
      createCell(row.periodRiskFreeReturn, "percent"),
      createCell(row.periodRiskFreeLogReturn, "number4"),
      createCell(row.excessReturn, "number4"),
    ]),
  ];
}

function buildWarningsSheetRows(payload) {
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

function xmlCell(cell) {
  if (!cell || cell.value === null || cell.value === undefined || cell.value === "") {
    return "<Cell/>";
  }

  const styleAttr = cell.styleId ? ` ss:StyleID="${cell.styleId}"` : "";

  if (cell.value instanceof Date) {
    return `<Cell${styleAttr}><Data ss:Type="DateTime">${xmlEscape(
      toExcelDateTime(cell.value),
    )}</Data></Cell>`;
  }

  if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
    return `<Cell${styleAttr}><Data ss:Type="Number">${cell.value}</Data></Cell>`;
  }

  return `<Cell${styleAttr}><Data ss:Type="String">${xmlEscape(
    cell.value,
  )}</Data></Cell>`;
}

function buildWorkbookXml(payload) {
  const sheets = [
    {
      name: "Summary",
      rows: buildSummarySheetRows(payload),
    },
    {
      name: "Metrics",
      rows: buildMetricsSheetRows(payload),
    },
    {
      name: "Series",
      rows: buildSeriesSheetRows(payload),
    },
    {
      name: "Periods",
      rows: buildPeriodsSheetRows(payload),
    },
    {
      name: "Warnings",
      rows: buildWarningsSheetRows(payload),
    },
  ];

  return buildXmlWorkbook(sheets);
}

function buildXmlWorkbook(sheets) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Bottom"/>
      <Borders/>
      <Font ss:FontName="Calibri" ss:Size="11"/>
      <Interior/>
      <NumberFormat/>
      <Protection/>
    </Style>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E8F1EE" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="date">
      <NumberFormat ss:Format="yyyy-mm-dd"/>
    </Style>
    <Style ss:ID="percent">
      <NumberFormat ss:Format="0.00%"/>
    </Style>
    <Style ss:ID="number2">
      <NumberFormat ss:Format="0.00"/>
    </Style>
    <Style ss:ID="number4">
      <NumberFormat ss:Format="0.0000"/>
    </Style>
    <Style ss:ID="integer">
      <NumberFormat ss:Format="0"/>
    </Style>
  </Styles>
  ${sheets
    .map(
      (sheet) => `
  <Worksheet ss:Name="${xmlEscape(sanitizeWorksheetName(sheet.name))}">
    <Table>
      ${sheet.rows
        .map(
          (row) => `
      <Row>
        ${row.map((cell) => xmlCell(cell)).join("")}
      </Row>`,
        )
        .join("")}
    </Table>
  </Worksheet>`,
    )
    .join("")}
</Workbook>`;
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportStudyCsv(payload) {
  const rows = buildCsvRows(payload);
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.csv`,
    serializeCsv(rows),
    "text/csv;charset=utf-8",
  );
}

function exportStudyXls(payload) {
  downloadTextFile(
    `${buildExportFileBaseName(payload)}.xls`,
    buildWorkbookXml(payload),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

export {
  buildXmlWorkbook,
  buildCsvRows,
  buildWorkbookXml,
  createCell,
  downloadTextFile,
  exportStudyCsv,
  exportStudyXls,
  serializeCsv,
  slugify,
  toIsoDate,
};
