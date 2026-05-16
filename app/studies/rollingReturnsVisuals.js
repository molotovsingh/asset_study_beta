import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  exportRollingReturnsCsv,
  exportRollingReturnsXls,
} from "../lib/rollingReturnsExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("rolling-returns");
const OVERVIEW_HASH = "#rolling-returns/overview";
const CHART_WIDTH = 720;
const CHART_HEIGHT = 248;
const CHART_PADDING = {
  top: 18,
  right: 18,
  bottom: 30,
  left: 52,
};
const WINDOW_COLORS = {
  "1Y": "#0d5f4d",
  "3Y": "#8a4f26",
  "5Y": "#2548a7",
  "10Y": "#6f3ca2",
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

function renderYAxis(ticks, yScale) {
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
          >${formatPercent(tick, 1)}</text>
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

function buildChartSeries(availableWindowSummaries) {
  return availableWindowSummaries.map((windowSummary) => ({
    windowLabel: windowSummary.windowLabel,
    color: WINDOW_COLORS[windowSummary.windowLabel] || "#0d5f4d",
    points: windowSummary.windowRows.map((row) => ({
      date: row.endDate,
      value: row.annualizedReturn,
    })),
  }));
}

function renderRollingLineChart(studyRun) {
  const chartSeries = buildChartSeries(studyRun.availableWindowSummaries).filter(
    (series) => series.points.length >= 2,
  );

  if (!chartSeries.length) {
    return `
      <section class="card visual-card rolling-returns-chart-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">Rolling CAGR Paths</p>
            <p class="summary-meta">The active window did not produce enough rolling observations to chart.</p>
          </div>
        </div>
        <div class="empty-state visual-chart-empty">
          Broaden the date range or use a shorter rolling horizon.
        </div>
      </section>
    `;
  }

  const allPoints = chartSeries.flatMap((series) => series.points);
  const startDate = allPoints[0].date;
  const endDate = allPoints[allPoints.length - 1].date;
  const allValues = allPoints.map((point) => point.value);
  const padded = withPadding(Math.min(...allValues), Math.max(...allValues), 0.1);
  const xScale = createTimeScale(startDate, endDate);
  const yScale = createValueScale(padded.min, padded.max);
  const yTicks = buildTickValues(padded.min, padded.max, 4);
  const baselineY =
    padded.min <= 0 && padded.max >= 0 ? yScale(0) : null;

  return `
    <section class="card visual-card rolling-returns-chart-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Rolling CAGR Paths</p>
          <p class="summary-meta">
            Each line shows how CAGR would have looked if the window ended on each observed market date.
          </p>
        </div>
        <div class="rolling-legend">
          ${chartSeries
            .map(
              (series) => `
                <span class="rolling-legend-item">
                  <span class="rolling-legend-swatch" style="background: ${series.color};"></span>
                  ${series.windowLabel}
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
        aria-label="Rolling CAGR paths by horizon"
      >
        ${renderYAxis(yTicks, yScale)}
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
        ${chartSeries
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

function renderBarCard({
  title,
  summary,
  windowSummaries,
  valueKey,
  formatter,
  statLabel,
  statValue,
}) {
  const populated = windowSummaries.filter((windowSummary) =>
    Number.isFinite(windowSummary[valueKey]),
  );

  if (!populated.length) {
    return `
      <section class="card visual-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">${title}</p>
            <p class="summary-meta">${summary}</p>
          </div>
        </div>
        <div class="empty-state visual-chart-empty">
          No rolling windows are available for this visual yet.
        </div>
      </section>
    `;
  }

  const maxAbsValue = Math.max(
    ...populated.map((windowSummary) => Math.abs(windowSummary[valueKey])),
    Number.EPSILON,
  );

  return `
    <section class="card visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">${statLabel}</span>
          <strong>${statValue}</strong>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${windowSummaries
          .map((windowSummary) => {
            const rawValue = windowSummary[valueKey];
            const width = Number.isFinite(rawValue)
              ? `${Math.max((Math.abs(rawValue) / maxAbsValue) * 100, 4)}%`
              : "0%";
            const tone =
              !Number.isFinite(rawValue)
                ? "is-empty"
                : rawValue >= 0
                  ? "is-positive"
                  : "is-negative";

            return `
              <div class="seasonality-bar-row ${tone}">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${windowSummary.windowLabel}</span>
                  <span class="seasonality-bar-value">${formatter(rawValue, windowSummary)}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill" style="width: ${width};"></span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderVisualsShell(studyRun) {
  return `
    <div class="visuals-shell rolling-returns-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Rolling Returns Visuals</h2>
          <p class="summary-meta">
            Read the full-period CAGR first, then compare how different rolling horizons behaved through time.
          </p>
          <p class="summary-meta">
            ${studyRun.seriesLabel} · ${formatDateRange(
              studyRun.actualStartDate,
              studyRun.actualEndDate,
            )} · ${studyRun.methodLabel}
          </p>
        </div>
        <div class="visuals-actions">
          <a class="study-view-link" href="${OVERVIEW_HASH}">Overview</a>
          <button
            class="results-export-button"
            type="button"
            data-rolling-visual-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-rolling-visual-export="xls"
          >Export XLS</button>
        </div>
        <p id="rolling-returns-visuals-status" class="status visuals-status"></p>
      </section>

      <div class="visuals-summary-grid rolling-returns-summary-grid">
        <section class="card visuals-summary-card">
          <p class="meta-label">Full-Period CAGR</p>
          <strong class="visuals-summary-value">${formatPercent(studyRun.fullPeriodCagr)}</strong>
          <p class="summary-meta">
            ${formatDateRange(studyRun.actualStartDate, studyRun.actualEndDate)}
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Latest Leader</p>
          <strong class="visuals-summary-value">${studyRun.summary.latestLeader?.windowLabel || "n/a"}</strong>
          <p class="summary-meta">
            ${studyRun.summary.latestLeader ? `Latest CAGR ${formatPercent(studyRun.summary.latestLeader.latestCagr)}` : "No rolling horizon available"}
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Strongest Median</p>
          <strong class="visuals-summary-value">${studyRun.summary.strongestMedianWindow?.windowLabel || "n/a"}</strong>
          <p class="summary-meta">
            ${studyRun.summary.strongestMedianWindow ? `Median CAGR ${formatPercent(studyRun.summary.strongestMedianWindow.medianCagr)}` : "No rolling horizon available"}
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Widest Range</p>
          <strong class="visuals-summary-value">${studyRun.summary.widestRangeWindow?.windowLabel || "n/a"}</strong>
          <p class="summary-meta">
            ${studyRun.summary.widestRangeWindow ? `${formatPercent(studyRun.summary.widestRangeWindow.cagrRange)} best to worst` : "No rolling horizon available"}
          </p>
        </section>
      </div>

      <div class="visuals-chart-grid">
        ${renderRollingLineChart(studyRun)}
        ${renderBarCard({
          title: "Latest Rolling CAGR",
          summary: "The most recent rolling CAGR available for each horizon.",
          windowSummaries: studyRun.availableWindowSummaries,
          valueKey: "latestCagr",
          formatter: (value) => formatPercent(value),
          statLabel: "Leader",
          statValue: studyRun.summary.latestLeader?.windowLabel || "n/a",
        })}
        ${renderBarCard({
          title: "Median Rolling CAGR",
          summary: "Median CAGR across all rolling windows for each horizon.",
          windowSummaries: studyRun.availableWindowSummaries,
          valueKey: "medianCagr",
          formatter: (value, windowSummary) =>
            `${formatPercent(value)} · ${formatWindowBand(windowSummary)}`,
          statLabel: "Leader",
          statValue: studyRun.summary.strongestMedianWindow?.windowLabel || "n/a",
        })}
        ${renderBarCard({
          title: "Positive Window Rate",
          summary: "Share of rolling windows where CAGR stayed positive.",
          windowSummaries: studyRun.availableWindowSummaries,
          valueKey: "positiveRate",
          formatter: (value) => formatPercent(value),
          statLabel: "Best",
          statValue:
            studyRun.summary.highestPositiveRateWindow?.windowLabel || "n/a",
        })}
      </div>

      <div class="visuals-context-grid">
        <section class="card visuals-context">
          <h3>Coverage</h3>
          <p class="summary-meta">
            ${formatNumber(studyRun.summary.totalRollingObservations, 0)} rolling windows were generated across ${formatNumber(studyRun.summary.availableWindowCount, 0)} horizons.
          </p>
          <p class="summary-meta">
            Unavailable horizons: ${
              studyRun.unavailableWindowSummaries.length
                ? studyRun.unavailableWindowSummaries
                    .map((windowSummary) => windowSummary.windowLabel)
                    .join(", ")
                : "none"
            }.
          </p>
        </section>
        <section class="card visuals-context">
          <h3>Method</h3>
          <p class="summary-meta">
            Each rolling row uses the nearest observed market date on or before the target horizon start date.
          </p>
          <p class="summary-meta">
            CAGR is annualized from the actual elapsed days inside each historical window.
          </p>
        </section>
      </div>
    </div>
  `;
}

function formatWindowBand(windowSummary) {
  if (
    !windowSummary ||
    !Number.isFinite(windowSummary.percentile25Cagr) ||
    !Number.isFinite(windowSummary.percentile75Cagr)
  ) {
    return "n/a";
  }

  return `${formatPercent(windowSummary.percentile25Cagr)} to ${formatPercent(
    windowSummary.percentile75Cagr,
  )}`;
}

function renderEmptyState(root) {
  root.innerHTML = `
    <div class="empty-state visual-empty">
      <p class="study-kicker">Visuals Need A Run</p>
      <h2>No rolling returns study is loaded yet.</h2>
      <p class="summary-meta">
        Run the overview once, then return here for the rolling CAGR paths and horizon breakdowns.
      </p>
      <div class="visuals-actions">
        <a class="study-view-link is-active" href="${OVERVIEW_HASH}">Go To Overview</a>
      </div>
    </div>
  `;
}

function mountRollingReturnsVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    renderEmptyState(root);
    return () => {};
  }

  root.innerHTML = renderVisualsShell(studyRun);
  const status = root.querySelector("#rolling-returns-visuals-status");

  function setStatus(message, statusState = "info") {
    if (!status) {
      return;
    }

    status.className = `status visuals-status ${statusState}`;
    status.textContent = message;
  }

  const handleClick = createExportClickHandler({
    triggerSelector: "[data-rolling-visual-export]",
    datasetKey: "rollingVisualExport",
    getPayload: () => studyRun,
    exporters: {
      csv: exportRollingReturnsCsv,
      xls: exportRollingReturnsXls,
    },
    setStatus,
  });

  root.addEventListener("click", handleClick);
  return () => {
    root.removeEventListener("click", handleClick);
  };
}

export { mountRollingReturnsVisuals };
