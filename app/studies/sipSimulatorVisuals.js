import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  exportSipSimulatorCsv,
  exportSipSimulatorXls,
} from "../lib/sipSimulatorExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("sip-simulator");
const OVERVIEW_HASH = "#sip-simulator/overview";
const CHART_WIDTH = 720;
const CHART_HEIGHT = 248;
const CHART_PADDING = {
  top: 18,
  right: 18,
  bottom: 30,
  left: 60,
};
const CHART_COLORS = {
  xirr: "#0d5f4d",
  multiple: "#8a4f26",
  invested: "#6f3ca2",
  portfolio: "#2548a7",
};

function withPadding(minimum, maximum, paddingRatio = 0.08) {
  if (minimum === maximum) {
    const base = Math.abs(minimum) || 1;
    return {
      min: minimum - base * 0.14,
      max: maximum + base * 0.14,
    };
  }

  const span = maximum - minimum;
  return {
    min: minimum - span * paddingRatio,
    max: maximum + span * paddingRatio,
  };
}

function buildTickValues(minimum, maximum, segments = 4) {
  if (segments <= 0) {
    return [minimum];
  }

  const step = (maximum - minimum) / segments;
  return Array.from({ length: segments + 1 }, (_, index) => minimum + step * index);
}

function createTimeScale(startDate, endDate) {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const span = Math.max(endTime - startTime, 1);
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;

  return (date) =>
    CHART_PADDING.left +
    (plotWidth * (date.getTime() - startTime)) / span;
}

function createValueScale(minimum, maximum) {
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const span = Math.max(maximum - minimum, Number.EPSILON);

  return (value) =>
    CHART_PADDING.top + ((maximum - value) / span) * plotHeight;
}

function buildLinePath(series, xScale, yScale) {
  return series
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xScale(point.date).toFixed(2)},${yScale(point.value).toFixed(2)}`;
    })
    .join(" ");
}

function formatAmountAxis(value) {
  const absolute = Math.abs(value);

  if (absolute >= 10000000) {
    return `${formatNumber(value / 10000000, 1)}cr`;
  }

  if (absolute >= 100000) {
    return `${formatNumber(value / 100000, 1)}L`;
  }

  return formatNumber(value, 0);
}

function renderYAxis(ticks, yScale, labelFormatter) {
  const lineStart = CHART_PADDING.left;
  const lineEnd = CHART_WIDTH - CHART_PADDING.right;

  return ticks
    .map(
      (tick) => `
        <g>
          <line
            class="chart-grid-line"
            x1="${lineStart}"
            x2="${lineEnd}"
            y1="${yScale(tick)}"
            y2="${yScale(tick)}"
          />
          <text
            class="chart-axis-label"
            x="${lineStart - 12}"
            y="${yScale(tick) + 4}"
            text-anchor="end"
          >${labelFormatter(tick)}</text>
        </g>
      `,
    )
    .join("");
}

function renderXAxis(xScale, startDate, endDate) {
  const midpoint = new Date((startDate.getTime() + endDate.getTime()) / 2);

  return [startDate, midpoint, endDate]
    .map(
      (date) => `
        <text
          class="chart-axis-label"
          x="${xScale(date)}"
          y="${CHART_HEIGHT - 6}"
          text-anchor="middle"
        >${formatDate(date)}</text>
      `,
    )
    .join("");
}

function renderEmptyVisualCard(title, summary) {
  return `
    <section class="card visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
      </div>
      <div class="empty-state visual-chart-empty">
        Not enough cohort data is available for this visual.
      </div>
    </section>
  `;
}

function renderLineChart({
  title,
  summary,
  series,
  ariaLabel,
  color,
  labelFormatter,
  baselineZero = false,
}) {
  if (series.length < 2) {
    return renderEmptyVisualCard(title, summary);
  }

  const allValues = series.map((point) => point.value);
  const padded = withPadding(Math.min(...allValues), Math.max(...allValues), 0.1);
  const xScale = createTimeScale(series[0].date, series[series.length - 1].date);
  const yScale = createValueScale(padded.min, padded.max);
  const yTicks = buildTickValues(padded.min, padded.max, 4);
  const baselineY =
    baselineZero && padded.min <= 0 && padded.max >= 0 ? yScale(0) : null;

  return `
    <section class="card visual-card sip-chart-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
      </div>

      <svg
        class="chart-svg"
        viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"
        role="img"
        aria-label="${ariaLabel}"
      >
        ${renderYAxis(yTicks, yScale, labelFormatter)}
        ${
          baselineY !== null
            ? `
              <line
                class="chart-baseline"
                x1="${CHART_PADDING.left}"
                x2="${CHART_WIDTH - CHART_PADDING.right}"
                y1="${baselineY}"
                y2="${baselineY}"
              />
            `
            : ""
        }
        <path
          class="chart-line"
          d="${buildLinePath(series, xScale, yScale)}"
          style="stroke: ${color};"
        />
        ${renderXAxis(xScale, series[0].date, series[series.length - 1].date)}
      </svg>
    </section>
  `;
}

function renderDualLineChart({ title, summary, seriesList, ariaLabel, labelFormatter }) {
  const populatedSeries = seriesList.filter((series) => series.points.length >= 2);
  if (!populatedSeries.length) {
    return renderEmptyVisualCard(title, summary);
  }

  const allPoints = populatedSeries.flatMap((series) => series.points);
  const allValues = allPoints.map((point) => point.value);
  const startDate = allPoints[0].date;
  const endDate = allPoints[allPoints.length - 1].date;
  const padded = withPadding(Math.min(...allValues), Math.max(...allValues), 0.1);
  const xScale = createTimeScale(startDate, endDate);
  const yScale = createValueScale(padded.min, padded.max);
  const yTicks = buildTickValues(padded.min, padded.max, 4);

  return `
    <section class="card visual-card sip-chart-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
        <div class="rolling-legend">
          ${populatedSeries
            .map(
              (series) => `
                <span class="rolling-legend-item">
                  <span class="rolling-legend-swatch" style="background: ${series.color};"></span>
                  ${series.label}
                </span>
              `,
            )
            .join("")}
        </div>
      </div>

      <svg
        class="chart-svg"
        viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"
        role="img"
        aria-label="${ariaLabel}"
      >
        ${renderYAxis(yTicks, yScale, labelFormatter)}
        ${populatedSeries
          .map(
            (series) => `
              <path
                class="chart-line"
                d="${buildLinePath(series.points, xScale, yScale)}"
                style="stroke: ${series.color};"
              />
            `,
          )
          .join("")}
        ${renderXAxis(xScale, startDate, endDate)}
      </svg>
    </section>
  `;
}

function renderSummaryCard(label, value, detail) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function mountSipSimulatorVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    root.innerHTML = `
      <section class="card visual-empty">
        <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
        <h2>No SIP simulation is loaded yet.</h2>
        <p>
          Run the overview first so the visuals view has a cohort panel to draw.
        </p>
        <a class="button" href="${OVERVIEW_HASH}">Open Overview</a>
      </section>
    `;
    return () => {};
  }

  const { summary } = studyRun;
  const xirrSeries = studyRun.cohorts
    .filter((cohort) => Number.isFinite(cohort.xirr))
    .map((cohort) => ({
      date: cohort.startDate,
      value: cohort.xirr,
    }));
  const wealthSeries = studyRun.cohorts
    .filter((cohort) => Number.isFinite(cohort.wealthMultiple))
    .map((cohort) => ({
      date: cohort.startDate,
      value: cohort.wealthMultiple,
    }));
  const fullWindowPath = summary.fullWindowCohort?.path ?? [];

  root.innerHTML = `
    <div class="results-shell seasonality-visuals-shell">
      <section class="card visual-card">
        <div class="visual-card-head">
          <div>
            <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
            <h2>SIP Simulator Visuals</h2>
            <p>
              Compare cohort XIRR and wealth drift across historical SIP start months.
            </p>
            <p class="summary-meta">
              ${studyRun.seriesLabel} · ${formatDateRange(studyRun.actualStartDate, studyRun.actualEndDate)} · ${studyRun.methodLabel}
            </p>
          </div>
          <div class="results-export-actions">
            <a class="button secondary" href="${OVERVIEW_HASH}">Overview</a>
            <button class="results-export-button" type="button" data-sip-export="csv">Export CSV</button>
            <button class="results-export-button" type="button" data-sip-export="xls">Export XLS</button>
          </div>
        </div>
        <p id="sip-simulator-visuals-status" class="status visuals-status"></p>
      </section>

      <section class="results-section">
        <div class="results-grid relative-results-grid">
          ${renderSummaryCard(
            "Full-Window XIRR",
            formatPercent(summary.fullWindowCohort?.xirr),
            summary.fullWindowCohort
              ? `${summary.fullWindowCohort.startMonthLabel} cohort`
              : "No cohort available",
          )}
          ${renderSummaryCard(
            "Median Cohort XIRR",
            formatPercent(summary.medianXirr),
            `${formatNumber(summary.totalCohorts, 0)} eligible start months`,
          )}
          ${renderSummaryCard(
            "Best Start Month",
            summary.bestCohort?.startMonthLabel || "n/a",
            summary.bestCohort
              ? `XIRR ${formatPercent(summary.bestCohort.xirr)}`
              : "No cohort available",
          )}
          ${renderSummaryCard(
            "Positive Cohorts",
            formatPercent(summary.positiveRate),
            `Minimum ${formatNumber(studyRun.minContributions, 0)} contributions per cohort`,
          )}
        </div>
      </section>

      <section class="results-grid">
        ${renderLineChart({
          title: "Cohort XIRR",
          summary:
            "Each point is one SIP cohort, ordered by start month and measured against the same terminal market date.",
          series: xirrSeries,
          ariaLabel: "Cohort XIRR by start month",
          color: CHART_COLORS.xirr,
          labelFormatter: (value) => formatPercent(value, 1),
          baselineZero: true,
        })}
        ${renderLineChart({
          title: "Cohort Wealth Multiple",
          summary:
            "Terminal value divided by invested capital for each eligible cohort.",
          series: wealthSeries,
          ariaLabel: "Cohort wealth multiple by start month",
          color: CHART_COLORS.multiple,
          labelFormatter: (value) => `${formatNumber(value, 1)}x`,
        })}
        ${renderDualLineChart({
          title: "Full-Window SIP Path",
          summary:
            "Invested capital versus portfolio value for the earliest eligible cohort.",
          seriesList: [
            {
              label: "Invested",
              color: CHART_COLORS.invested,
              points: fullWindowPath.map((row) => ({
                date: row.date,
                value: row.totalInvested,
              })),
            },
            {
              label: "Portfolio",
              color: CHART_COLORS.portfolio,
              points: fullWindowPath.map((row) => ({
                date: row.date,
                value: row.portfolioValue,
              })),
            },
          ],
          ariaLabel: "Full-window SIP invested capital and portfolio value",
          labelFormatter: (value) => formatAmountAxis(value),
        })}
      </section>

      <div class="result-details">
        <div class="detail-block">
          <h3>Coverage</h3>
          <p class="result-detail">
            Monthly anchors: ${formatNumber(summary.totalMonthlyAnchors, 0)}
          </p>
          <p class="result-detail">
            Eligible cohorts: ${formatNumber(summary.totalCohorts, 0)}
          </p>
          <p class="result-detail">
            Earliest cohort: ${summary.fullWindowCohort?.startMonthLabel || "n/a"}
          </p>
          <p class="result-detail">
            Latest included cohort: ${summary.shortestIncludedCohort?.startMonthLabel || "n/a"}
          </p>
        </div>
        <div class="detail-block">
          <h3>Method</h3>
          <p class="result-detail">
            Monthly contribution: ${formatNumber(studyRun.monthlyContribution, 2)} ${studyRun.selection?.currency || ""}
          </p>
          <p class="result-detail">
            Cash-flow basis: dated monthly outflows plus final portfolio value at ${formatDate(studyRun.actualEndDate)}
          </p>
          <p class="result-detail">
            XIRR band: ${formatPercent(summary.percentile25Xirr)} to ${formatPercent(summary.percentile75Xirr)}
          </p>
        </div>
      </div>
    </div>
  `;

  const status = root.querySelector("#sip-simulator-visuals-status");
  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-sip-export]",
    datasetKey: "sipExport",
    getPayload: () => session.lastStudyRun,
    exporters: {
      csv: exportSipSimulatorCsv,
      xls: exportSipSimulatorXls,
    },
    setStatus(message, statusState = "info") {
      if (!status) {
        return;
      }

      status.className = `status ${statusState}`;
      status.textContent = message;
    },
    missingPayloadMessage: "Run the study before exporting.",
  });

  function handleRootClick(event) {
    handleExportClick(event);
  }

  root.addEventListener("click", handleRootClick);

  return () => {
    root.removeEventListener("click", handleRootClick);
  };
}

export { mountSipSimulatorVisuals };
