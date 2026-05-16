import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import {
  getMetricDefinition,
  getMetricValue,
  sortRowsByMetric,
} from "../lib/sectorSnapshot.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("sector-snapshot");

function formatMetricValue(metricKey, value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  const metric = getMetricDefinition(metricKey);
  if (metric.styleId === "percent") {
    return formatPercent(value);
  }
  if (metric.styleId === "integer") {
    return formatNumber(value, 0);
  }
  return formatNumber(value, 2);
}

function buildHeatTone(metricKey, values, value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) {
    return "";
  }

  const metric = getMetricDefinition(metricKey);
  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  if (maximum === minimum) {
    return "background: rgba(13, 95, 77, 0.12); color: var(--accent-strong);";
  }

  let normalized = (value - minimum) / (maximum - minimum);
  if (metric.better === "lower") {
    normalized = 1 - normalized;
  }

  const intensity = 0.14 + Math.abs(normalized - 0.5) * 0.38;
  if (normalized >= 0.5) {
    return `background: rgba(13, 95, 77, ${intensity}); color: ${
      normalized >= 0.78 ? "white" : "var(--accent-strong)"
    };`;
  }

  return `background: rgba(138, 79, 38, ${intensity}); color: ${
    normalized <= 0.22 ? "white" : "#8a4f26"
  };`;
}

function renderFocusMetricHeatmap(studyRun) {
  const metricKey = studyRun.focusMetricKey;
  return `
    <section class="visual-card sector-visual-card sector-visual-card-wide">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Focus Metric Heatmap</p>
          <p class="summary-meta">
            ${getMetricDefinition(metricKey).label} across all configured horizons for ${studyRun.market.label}.
          </p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">Metric</span>
          <strong>${getMetricDefinition(metricKey).label}</strong>
        </div>
      </div>
      <div class="sector-heatmap-card">
        <div class="sector-heatmap-grid">
          <div class="sector-heatmap-corner"></div>
          ${studyRun.horizonResults
            .map(
              (horizonResult) => `
                <div class="sector-heatmap-axis">${horizonResult.years}Y</div>
              `,
            )
            .join("")}
          ${studyRun.market.sectors
            .map((sector) => {
              const rows = studyRun.horizonResults.map(
                (horizonResult) =>
                  horizonResult.rows.find((row) => row.id === sector.id) || null,
              );
              return `
                <div class="sector-heatmap-axis sector-heatmap-sector">${sector.label}</div>
                ${rows
                  .map((row, horizonIndex) => {
                    const value = getMetricValue(row, metricKey);
                    const horizonValues = studyRun.horizonResults[horizonIndex].rows
                      .map((peerRow) => getMetricValue(peerRow, metricKey))
                      .filter(Number.isFinite);
                    const tone = buildHeatTone(metricKey, horizonValues, value);
                    return `
                      <div class="sector-heatmap-cell${Number.isFinite(value) ? "" : " is-empty"}" style="${tone}">
                        ${Number.isFinite(value) ? formatMetricValue(metricKey, value) : "n/a"}
                      </div>
                    `;
                  })
                  .join("")}
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function buildScatterModel(studyRun) {
  const focusResult = studyRun.focusHorizonResult;
  const rows = focusResult?.availableRows || [];
  if (rows.length < 2 || !focusResult?.benchmarkMetrics) {
    return null;
  }

  const points = rows.map((row) => ({
    label: row.label,
    volatility: row.metrics.annualizedVolatility,
    cagr: row.metrics.annualizedReturn,
    relativeWealth: row.relativeMetrics.relativeWealth,
  }));
  const benchmarkPoint = {
    label: studyRun.benchmark.label,
    volatility: focusResult.benchmarkMetrics.annualizedVolatility,
    cagr: focusResult.benchmarkMetrics.annualizedReturn,
  };
  const xValues = [...points.map((point) => point.volatility), benchmarkPoint.volatility];
  const yValues = [...points.map((point) => point.cagr), benchmarkPoint.cagr];
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xPadding = Math.max((xMax - xMin) * 0.12, 0.01);
  const yPadding = Math.max((yMax - yMin) * 0.12, 0.01);

  return {
    points,
    benchmarkPoint,
    xDomain: {
      min: Math.max(0, xMin - xPadding),
      max: xMax + xPadding,
    },
    yDomain: {
      min: yMin - yPadding,
      max: yMax + yPadding,
    },
  };
}

function buildOverviewHash(studyRun) {
  const params = new URLSearchParams({
    market: studyRun.market.id,
    h: String(studyRun.focusHorizonYears),
    metric: studyRun.focusMetricKey,
    rf: studyRun.riskFreeRate.toFixed(2),
  });
  return `#sector-snapshot/overview?${params.toString()}`;
}

function renderScatterChart(studyRun) {
  const model = buildScatterModel(studyRun);
  if (!model) {
    return `
      <section class="visual-card sector-visual-card">
        <div class="visual-empty">
          <h2>No scatter view yet.</h2>
          <p>Run the snapshot and keep at least two sectors available in the focus horizon.</p>
        </div>
      </section>
    `;
  }

  const width = 640;
  const height = 340;
  const padding = { top: 24, right: 30, bottom: 42, left: 54 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xScale = (value) =>
    padding.left +
    ((value - model.xDomain.min) / (model.xDomain.max - model.xDomain.min || 1)) *
      innerWidth;
  const yScale = (value) =>
    padding.top +
    (1 - (value - model.yDomain.min) / (model.yDomain.max - model.yDomain.min || 1)) *
      innerHeight;

  return `
    <section class="visual-card sector-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Risk / Return Scatter</p>
          <p class="summary-meta">
            ${studyRun.focusHorizonYears}Y annualized return versus annualized volatility.
          </p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">Benchmark</span>
          <strong>${studyRun.benchmark.label}</strong>
        </div>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sector risk return scatter plot">
        <line class="chart-grid-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <line class="chart-grid-line" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
        <text class="chart-axis-label" x="${padding.left}" y="${padding.top - 6}">CAGR</text>
        <text class="chart-axis-label" x="${width - padding.right}" y="${height - 8}" text-anchor="end">Volatility</text>
        ${model.points
          .map((point) => `
            <circle class="sector-scatter-point" cx="${xScale(point.volatility)}" cy="${yScale(point.cagr)}" r="6" />
            <text class="sector-scatter-label" x="${xScale(point.volatility) + 9}" y="${yScale(point.cagr) + 4}">${point.label}</text>
          `)
          .join("")}
        <rect
          class="sector-scatter-benchmark"
          x="${xScale(model.benchmarkPoint.volatility) - 6}"
          y="${yScale(model.benchmarkPoint.cagr) - 6}"
          width="12"
          height="12"
          rx="2"
        />
        <text class="sector-scatter-label sector-scatter-label-benchmark" x="${xScale(model.benchmarkPoint.volatility) + 10}" y="${yScale(model.benchmarkPoint.cagr) + 4}">
          ${model.benchmarkPoint.label}
        </text>
      </svg>
      <div class="visual-card-foot">
        <span>Upper left means higher return with lower volatility.</span>
        <span>${formatDate(studyRun.commonEndDate)} end date</span>
      </div>
    </section>
  `;
}

function renderLeadershipGrid(studyRun) {
  const metrics = [
    "annualizedReturn",
    "sharpeRatio",
    "relativeWealth",
    "maxDrawdown",
  ];
  const labels = {
    annualizedReturn: "Best CAGR",
    sharpeRatio: "Best Sharpe",
    relativeWealth: "Best Relative Wealth",
    maxDrawdown: "Shallowest Drawdown",
  };

  return `
    <section class="visual-card sector-visual-card sector-visual-card-wide">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Leadership Matrix</p>
          <p class="summary-meta">
            Who leads each horizon once you choose the metric lens.
          </p>
        </div>
      </div>
      <div class="sector-leadership-grid">
        <div class="sector-leadership-corner"></div>
        ${studyRun.horizonResults
          .map(
            (result) => `
              <div class="sector-leadership-axis">${result.years}Y</div>
            `,
          )
          .join("")}
        ${metrics
          .map((metricKey) => `
            <div class="sector-leadership-axis sector-leadership-metric">${labels[metricKey]}</div>
            ${studyRun.horizonResults
              .map((result) => {
                const leader = result.leaders[metricKey];
                return `
                  <div class="sector-leadership-cell">
                    <strong>${leader?.label || "n/a"}</strong>
                    <span>${leader ? formatMetricValue(metricKey, getMetricValue(leader, metricKey)) : "No read"}</span>
                  </div>
                `;
              })
              .join("")}
          `)
          .join("")}
      </div>
    </section>
  `;
}

function renderSummaryCards(studyRun) {
  const metricKey = studyRun.focusMetricKey;
  return `
    <div class="visuals-summary-grid sector-visual-summary-grid">
      ${studyRun.horizonResults
        .map((result) => {
          const leader = sortRowsByMetric(result.availableRows, metricKey)[0] || null;
          return `
            <section class="card visuals-summary-card">
              <span class="visual-card-stat-label">${result.years}Y Leader</span>
              <strong class="visuals-summary-value">${leader?.label || "n/a"}</strong>
              <p class="summary-meta">
                ${
                  leader
                    ? `${getMetricDefinition(metricKey).label} ${formatMetricValue(metricKey, getMetricValue(leader, metricKey))}`
                    : "No populated sector row"
                }
              </p>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderVisualsShell(studyRun) {
  return `
    <div class="visuals-shell sector-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Sector Snapshot Visuals</h2>
          <p class="summary-meta">
            ${studyRun.market.label} · ${studyRun.market.universeLabel} · focus ${studyRun.focusHorizonYears}Y ${getMetricDefinition(studyRun.focusMetricKey).label}
          </p>
          <p class="summary-meta">
            Benchmark ${studyRun.benchmark.label} · end date ${formatDate(studyRun.commonEndDate)}
          </p>
        </div>
        <div class="visuals-actions">
          <a class="study-view-link" href="${buildOverviewHash(studyRun)}">Overview</a>
        </div>
      </section>
      ${renderSummaryCards(studyRun)}
      <div class="visuals-chart-grid sector-visual-grid">
        ${renderFocusMetricHeatmap(studyRun)}
        ${renderScatterChart(studyRun)}
        ${renderLeadershipGrid(studyRun)}
      </div>
      <div class="visuals-context-grid">
        <section class="card visuals-context">
          <p class="section-label">Provider Mix</p>
          <p class="summary-meta">
            ${studyRun.providerSummary
              .map((entry) => `${entry.providerName} (${formatNumber(entry.count, 0)})`)
              .join(" · ")}
          </p>
        </section>
        <section class="card visuals-context">
          <p class="section-label">Method</p>
          <p class="summary-meta">
            Same-end-date trailing windows with log-return risk metrics and benchmark-relative spreads.
          </p>
        </section>
      </div>
    </div>
  `;
}

function mountSectorSnapshotVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    root.innerHTML = `
      <section class="card visual-empty">
        <p class="study-kicker">Visuals Need A Run</p>
        <h2>No sector snapshot is loaded yet.</h2>
        <p>Run the overview once, then return here for heatmaps, leadership grids, and the risk/return scatter.</p>
        <div class="visuals-actions">
          <a class="study-view-link is-active" href="#sector-snapshot/overview">Go To Overview</a>
        </div>
      </section>
    `;
    return () => {};
  }

  root.innerHTML = renderVisualsShell(studyRun);
  return () => {};
}

export { mountSectorSnapshotVisuals };
