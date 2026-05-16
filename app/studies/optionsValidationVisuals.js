import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("options-validation");

function buildOverviewHash(studyRun) {
  const params = new URLSearchParams({
    u: studyRun.universe.id,
    group: studyRun.groupKey,
    h: String(studyRun.horizonDays),
  });
  return `#options-validation/overview?${params.toString()}`;
}

function renderOutcomeBars(studyRun) {
  const groups = studyRun.groupedResults;
  if (!groups.length) {
    return `
      <section class="visual-card options-validation-visual-card">
        <div class="visual-empty">
          <h2>No grouped outcomes yet.</h2>
          <p>The archive needs more matured rows before grouped forward returns can be visualized.</p>
        </div>
      </section>
    `;
  }

  const maxMagnitude = Math.max(
    ...groups.map((group) => Math.abs(group.averageForwardReturn || 0)),
    0.001,
  );

  return `
    <section class="visual-card options-validation-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Average Forward Return</p>
          <p class="summary-meta">
            Grouped average underlying return over the next ${studyRun.horizonLabel}.
          </p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${groups
          .map((group) => {
            const isNegative =
              Number.isFinite(group.averageForwardReturn) &&
              group.averageForwardReturn < 0;
            const width = Number.isFinite(group.averageForwardReturn)
              ? Math.max((Math.abs(group.averageForwardReturn) / maxMagnitude) * 100, 4)
              : 0;
            return `
              <div class="seasonality-bar-row ${isNegative ? "is-negative" : "is-positive"}">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${group.label}</span>
                  <span class="seasonality-bar-value">${formatPercent(group.averageForwardReturn)} · ${formatNumber(group.count, 0)} rows</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill options-validation-bar-fill" style="width: ${width}%;"></span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderWinRateBars(studyRun) {
  const groups = studyRun.groupedResults;
  if (!groups.length) {
    return `
      <section class="visual-card options-validation-visual-card">
        <div class="visual-empty">
          <h2>No win-rate view yet.</h2>
          <p>Load a horizon with matured rows to compare bucket hit rates.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="visual-card options-validation-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Win Rate</p>
          <p class="summary-meta">
            Share of matured observations with a positive forward return.
          </p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${groups
          .map((group) => `
            <div class="seasonality-bar-row">
              <div class="seasonality-bar-meta">
                <span class="seasonality-bar-label">${group.label}</span>
                <span class="seasonality-bar-value">${formatPercent(group.winRate)}</span>
              </div>
              <div class="seasonality-bar-track">
                <span class="seasonality-bar-fill options-validation-win-fill" style="width: ${Math.max((group.winRate || 0) * 100, 4)}%;"></span>
              </div>
            </div>
          `)
          .join("")}
      </div>
    </section>
  `;
}

function renderBeatImpliedBars(studyRun) {
  const groups = studyRun.groupedResults.filter((group) =>
    Number.isFinite(group.beatImpliedRate),
  );
  if (!groups.length) {
    return `
      <section class="visual-card options-validation-visual-card">
        <div class="visual-empty">
          <h2>No move-edge view yet.</h2>
          <p>Matured rows with implied-move context are needed before premium buckets can be judged properly.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="visual-card options-validation-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Beat Implied Rate</p>
          <p class="summary-meta">
            Share of matured rows where realized absolute move exceeded the archived implied move.
          </p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${groups
          .map((group) => `
            <div class="seasonality-bar-row">
              <div class="seasonality-bar-meta">
                <span class="seasonality-bar-label">${group.label}</span>
                <span class="seasonality-bar-value">${formatPercent(group.beatImpliedRate)}</span>
              </div>
              <div class="seasonality-bar-track">
                <span class="seasonality-bar-fill options-validation-win-fill" style="width: ${Math.max((group.beatImpliedRate || 0) * 100, 4)}%;"></span>
              </div>
            </div>
          `)
          .join("")}
      </div>
    </section>
  `;
}

function buildScatterModel(studyRun) {
  const groups = studyRun.groupedResults.filter(
    (group) =>
      Number.isFinite(group.averageForwardReturn) &&
      Number.isFinite(group.averageAbsoluteMove),
  );
  if (groups.length < 2) {
    return null;
  }

  const xValues = groups.map((group) => group.averageAbsoluteMove);
  const yValues = groups.map((group) => group.averageForwardReturn);
  const xMin = 0;
  const xMax = Math.max(...xValues) * 1.15;
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yPadding = Math.max((yMax - yMin) * 0.16, 0.01);

  return {
    groups,
    xDomain: { min: xMin, max: Math.max(xMax, 0.02) },
    yDomain: { min: yMin - yPadding, max: yMax + yPadding },
  };
}

function renderScatter(studyRun) {
  const model = buildScatterModel(studyRun);
  if (!model) {
    return `
      <section class="visual-card options-validation-visual-card options-validation-visual-card-wide">
        <div class="visual-empty">
          <h2>No scatter view yet.</h2>
          <p>At least two matured groups with return and move data are needed for a risk / payoff map.</p>
        </div>
      </section>
    `;
  }

  const width = 680;
  const height = 320;
  const padding = { top: 24, right: 28, bottom: 42, left: 56 };
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
  const baselineY = yScale(0);

  return `
    <section class="visual-card options-validation-visual-card options-validation-visual-card-wide">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Return / Move Map</p>
          <p class="summary-meta">
            Average forward return versus average absolute move for each ${studyRun.groupDefinition.label.toLowerCase()} bucket.
          </p>
        </div>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Validation return versus move scatter">
        <line class="chart-grid-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <line class="chart-grid-line" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
        <line class="chart-baseline" x1="${padding.left}" y1="${baselineY}" x2="${width - padding.right}" y2="${baselineY}" />
        <text class="chart-axis-label" x="${padding.left}" y="${padding.top - 6}">Avg forward return</text>
        <text class="chart-axis-label" x="${width - padding.right}" y="${height - 10}" text-anchor="end">Avg absolute move</text>
        ${model.groups
          .map(
            (group) => `
              <circle class="options-validation-scatter-point" cx="${xScale(group.averageAbsoluteMove)}" cy="${yScale(group.averageForwardReturn)}" r="7" />
              <text class="options-validation-scatter-label" x="${xScale(group.averageAbsoluteMove) + 10}" y="${yScale(group.averageForwardReturn) + 4}">${group.label}</text>
            `,
          )
          .join("")}
      </svg>
      <div class="visual-card-foot">
        <span>Higher is better. Farther right means more underlying movement.</span>
        <span>${studyRun.horizonLabel} · ${formatNumber(studyRun.maturedCount, 0)} matured rows</span>
      </div>
    </section>
  `;
}

function renderObservationsTable(studyRun) {
  const rows = studyRun.maturedObservations.slice(0, 10);
  if (!rows.length) {
    return "";
  }

  return `
    <section class="visual-card options-validation-visual-card options-validation-visual-card-wide">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Recent Matured Rows</p>
          <p class="summary-meta">
            Latest archived rows that have already reached the selected horizon.
          </p>
        </div>
      </div>
      <div class="rolling-table-wrap">
        <table class="rolling-table options-validation-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>As Of</th>
              <th>Forward Return</th>
              <th>Abs Move</th>
              <th>${studyRun.groupDefinition.label}</th>
              <th>Direction</th>
              <th>IV/HV20</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <th scope="row">${row.symbol}</th>
                    <td>${row.asOfDate ? formatDate(row.asOfDate) : "n/a"}</td>
                    <td>${formatPercent(row.forwardReturn)}</td>
                    <td>${formatPercent(row.absoluteMove)}</td>
                    <td>${row[studyRun.groupKey === "candidateBucket" ? "candidateAdvisory" : studyRun.groupKey === "pricingBucket" ? "pricingLabel" : "directionLabel"]}</td>
                    <td>${row.directionLabel}</td>
                    <td>${formatNumber(row.ivHv20Ratio, 2)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderVisualsShell(studyRun) {
  const spreadValue = Number.isFinite(studyRun.primaryComparison?.spread)
    ? formatPercent(studyRun.primaryComparison.spread)
    : "n/a";
  const spreadDetail = studyRun.primaryComparison
    ? `${studyRun.primaryComparison.leftLabel} vs ${studyRun.primaryComparison.rightLabel}`
    : "Comparison bucket not ready";
  return `
    <div class="visuals-shell options-validation-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Options Validation Visuals</h2>
          <p class="summary-meta">
            ${studyRun.universe.label} · ${studyRun.groupDefinition.label} groups · ${studyRun.horizonLabel} forward horizon
          </p>
          <p class="summary-meta">
            ${formatNumber(studyRun.maturedCount, 0)} matured rows from ${formatNumber(studyRun.runCount, 0)} archived runs
          </p>
        </div>
        <div class="visuals-actions">
          <a class="study-view-link" href="${buildOverviewHash(studyRun)}">Overview</a>
        </div>
      </section>

      <div class="visuals-summary-grid options-validation-visual-summary-grid">
        <section class="card visuals-summary-card">
          <p class="meta-label">Best Group</p>
          <strong class="visuals-summary-value">${studyRun.bestGroup?.label || "n/a"}</strong>
          <p class="summary-meta">${studyRun.bestGroup ? formatPercent(studyRun.bestGroup.averageForwardReturn) : "No matured groups yet"}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Weakest Group</p>
          <strong class="visuals-summary-value">${studyRun.weakestGroup?.label || "n/a"}</strong>
          <p class="summary-meta">${studyRun.weakestGroup ? formatPercent(studyRun.weakestGroup.averageForwardReturn) : "No matured groups yet"}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Coverage</p>
          <strong class="visuals-summary-value">${formatNumber(studyRun.maturedCount, 0)}</strong>
          <p class="summary-meta">${formatNumber(studyRun.pendingCount, 0)} pending rows still collecting</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Signal Spread</p>
          <strong class="visuals-summary-value">${spreadValue}</strong>
          <p class="summary-meta">${spreadDetail}</p>
        </section>
      </div>

      <div class="visuals-chart-grid options-validation-visual-grid">
        ${renderOutcomeBars(studyRun)}
        ${renderWinRateBars(studyRun)}
        ${renderBeatImpliedBars(studyRun)}
        ${renderScatter(studyRun)}
        ${renderObservationsTable(studyRun)}
      </div>
    </div>
  `;
}

export { renderVisualsShell as renderOptionsValidationVisuals };
