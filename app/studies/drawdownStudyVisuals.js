import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  exportDrawdownStudyCsv,
  exportDrawdownStudyXls,
} from "../lib/drawdownStudyExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("drawdown-study");
const OVERVIEW_HASH = "#drawdown-study/overview";
const CHART_WIDTH = 720;
const CHART_HEIGHT = 248;
const CHART_PADDING = {
  top: 18,
  right: 18,
  bottom: 30,
  left: 52,
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
      return `${command}${xScale(point.date).toFixed(2)},${yScale(point.depth).toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(series, xScale, yScale, baselineY) {
  if (!series.length) {
    return "";
  }

  const linePath = buildLinePath(series, xScale, yScale);
  const startX = xScale(series[0].date).toFixed(2);
  const endX = xScale(series[series.length - 1].date).toFixed(2);
  return `${linePath} L${endX},${baselineY.toFixed(2)} L${startX},${baselineY.toFixed(2)} Z`;
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

function renderUnderwaterChart(studyRun) {
  const series = studyRun.underwaterSeries || [];
  if (series.length < 2) {
    return `
      <section class="card visual-card rolling-returns-chart-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">Underwater Path</p>
            <p class="summary-meta">Not enough observations to render an underwater chart.</p>
          </div>
        </div>
      </section>
    `;
  }

  const startDate = series[0].date;
  const endDate = series[series.length - 1].date;
  const values = series.map((point) => point.depth);
  const padded = withPadding(Math.min(...values), 0, 0.1);
  const xScale = createTimeScale(startDate, endDate);
  const yScale = createValueScale(padded.min, padded.max);
  const yTicks = buildTickValues(padded.min, padded.max, 4);
  const baselineY = yScale(0);

  return `
    <section class="card visual-card rolling-returns-chart-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Underwater Path</p>
          <p class="summary-meta">
            Distance from prior peaks through time. Values at 0% are new highs; negative values are drawdowns.
          </p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">Latest</span>
          <strong>${formatPercent(studyRun.summary.latestDepth)}</strong>
        </div>
      </div>

      <svg
        class="chart-svg"
        viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"
        role="img"
        aria-label="Underwater drawdown path"
      >
        ${renderYAxis(yTicks, yScale)}
        <line
          class="chart-baseline"
          x1="${CHART_PADDING.left}"
          x2="${CHART_WIDTH - CHART_PADDING.right}"
          y1="${baselineY}"
          y2="${baselineY}"
        />
        <path
          class="chart-area chart-area-drawdown"
          d="${buildAreaPath(series, xScale, yScale, baselineY)}"
        />
        <path
          class="chart-line chart-line-drawdown"
          d="${buildLinePath(series, xScale, yScale)}"
        />
        ${renderXAxis(xScale, startDate, endDate)}
      </svg>
    </section>
  `;
}

function renderDepthRanking(studyRun) {
  const ranked = studyRun.episodesByDepth.slice(0, 8);

  if (!ranked.length) {
    return `
      <section class="card visual-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">Episode Depth Ranking</p>
            <p class="summary-meta">No episodes formed inside this sample window.</p>
          </div>
        </div>
      </section>
    `;
  }

  const maxAbsDepth = Math.max(
    ...ranked.map((episode) => Math.abs(episode.maxDepth)),
    Number.EPSILON,
  );

  return `
    <section class="card visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Episode Depth Ranking</p>
          <p class="summary-meta">
            Worst drawdowns in this sample, ranked by depth.
          </p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${ranked
          .map((episode) => {
            const width = `${Math.max((Math.abs(episode.maxDepth) / maxAbsDepth) * 100, 4)}%`;
            return `
              <div class="seasonality-bar-row is-negative">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">#${episode.depthRank} · ${formatDate(episode.peakDate)} to ${formatDate(episode.troughDate)}</span>
                  <span class="seasonality-bar-value">${formatPercent(episode.maxDepth)}</span>
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

function renderDurationRanking(studyRun) {
  const ranked = [...studyRun.episodes]
    .sort((left, right) => right.durationDays - left.durationDays)
    .slice(0, 8);

  if (!ranked.length) {
    return `
      <section class="card visual-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">Episode Duration Ranking</p>
            <p class="summary-meta">No episodes formed inside this sample window.</p>
          </div>
        </div>
      </section>
    `;
  }

  const maxDuration = Math.max(
    ...ranked.map((episode) => episode.durationDays),
    Number.EPSILON,
  );

  return `
    <section class="card visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Episode Duration Ranking</p>
          <p class="summary-meta">
            Longest peak-to-recovery/end drawdown spans in the sample.
          </p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${ranked
          .map((episode) => {
            const width = `${Math.max((episode.durationDays / maxDuration) * 100, 4)}%`;
            const tone = episode.recovered ? "is-positive" : "is-negative";

            return `
              <div class="seasonality-bar-row ${tone}">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${formatDate(episode.peakDate)} to ${formatDate(episode.endDate)}</span>
                  <span class="seasonality-bar-value">${formatNumber(episode.durationDays, 0)}d</span>
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

function renderSummaryCard(label, value, detail) {
  return `
    <section class="card visuals-summary-card">
      <p class="meta-label">${label}</p>
      <strong class="visuals-summary-value">${value}</strong>
      <p class="summary-meta">${detail}</p>
    </section>
  `;
}

function renderVisualsShell(studyRun) {
  const maxEpisode = studyRun.summary.maxDrawdownEpisode;
  const longestRecovery = studyRun.summary.longestRecovery;

  return `
    <div class="visuals-shell rolling-returns-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Drawdown Visuals</h2>
          <p class="summary-meta">
            Read the underwater path first, then compare the deepest and longest historical episodes.
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
            data-drawdown-visual-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-drawdown-visual-export="xls"
          >Export XLS</button>
        </div>
        <p id="drawdown-visuals-status" class="status visuals-status"></p>
      </section>

      <div class="visuals-summary-grid">
        ${renderSummaryCard(
          "Max Drawdown",
          formatPercent(maxEpisode?.maxDepth),
          maxEpisode
            ? `${formatDate(maxEpisode.peakDate)} to ${formatDate(maxEpisode.troughDate)}`
            : "No episode formed",
        )}
        ${renderSummaryCard(
          "Longest Episode",
          studyRun.summary.longestEpisode
            ? `${formatNumber(studyRun.summary.longestEpisode.durationDays, 0)}d`
            : "n/a",
          studyRun.summary.longestEpisode
            ? `${formatDate(studyRun.summary.longestEpisode.peakDate)} to ${formatDate(studyRun.summary.longestEpisode.endDate)}`
            : "No episode formed",
        )}
        ${renderSummaryCard(
          "Longest Recovery",
          longestRecovery
            ? `${formatNumber(longestRecovery.recoveryDays, 0)}d`
            : "n/a",
          longestRecovery
            ? `${formatDate(longestRecovery.troughDate)} to ${formatDate(longestRecovery.recoveryDate)}`
            : "No recovered episode",
        )}
        ${renderSummaryCard(
          "Time Underwater",
          formatPercent(studyRun.summary.timeUnderwaterRate),
          `${formatNumber(studyRun.summary.totalEpisodes, 0)} episodes`,
        )}
      </div>

      <section class="results-grid">
        ${renderUnderwaterChart(studyRun)}
        ${renderDepthRanking(studyRun)}
        ${renderDurationRanking(studyRun)}
      </section>
    </div>
  `;
}

function renderEmptyVisualState() {
  return `
    <div class="empty-state visual-empty">
      <p class="study-kicker">Drawdown Visuals</p>
      <h2>Run the overview first.</h2>
      <p class="summary-meta">
        The visuals page uses the latest completed drawdown run from the overview view.
      </p>
      <a class="study-view-link" href="${OVERVIEW_HASH}">Go To Overview</a>
    </div>
  `;
}

function mountDrawdownStudyVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    root.innerHTML = renderEmptyVisualState();
    return () => {};
  }

  root.innerHTML = renderVisualsShell(studyRun);
  const status = root.querySelector("#drawdown-visuals-status");
  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-drawdown-visual-export]",
    datasetKey: "drawdownVisualExport",
    getPayload: () => session.lastStudyRun,
    exporters: {
      csv: exportDrawdownStudyCsv,
      xls: exportDrawdownStudyXls,
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

export { mountDrawdownStudyVisuals };
