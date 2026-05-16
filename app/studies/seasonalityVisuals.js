import {
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  exportSeasonalityCsv,
  exportSeasonalityXls,
} from "../lib/seasonalityExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("seasonality");
const OVERVIEW_HASH = "#seasonality/overview";

function formatConfidenceBand(bucket) {
  if (
    !bucket ||
    !Number.isFinite(bucket.confidenceBandLow) ||
    !Number.isFinite(bucket.confidenceBandHigh)
  ) {
    return "n/a";
  }

  return `${formatPercent(bucket.confidenceBandLow)} to ${formatPercent(
    bucket.confidenceBandHigh,
  )}`;
}

function formatConsistencyLabel(bucket) {
  if (!bucket || !Number.isFinite(bucket.consistencyScore)) {
    return "n/a";
  }

  if (bucket.dominantDirection === "positive") {
    return `Up ${formatPercent(bucket.consistencyScore)}`;
  }

  if (bucket.dominantDirection === "negative") {
    return `Down ${formatPercent(bucket.consistencyScore)}`;
  }

  return `Split ${formatPercent(bucket.consistencyScore)}`;
}

function heatmapCellStyle(value, maxAbsValue) {
  if (!Number.isFinite(value) || maxAbsValue <= 0) {
    return "";
  }

  const intensity = Math.min(Math.abs(value) / maxAbsValue, 1);

  if (value >= 0) {
    const alpha = 0.14 + intensity * 0.56;
    const textColor = intensity > 0.58 ? "white" : "var(--accent-strong)";
    return `background: rgba(13, 95, 77, ${alpha}); color: ${textColor};`;
  }

  const alpha = 0.14 + intensity * 0.48;
  const textColor = intensity > 0.58 ? "white" : "#8a4f26";
  return `background: rgba(138, 79, 38, ${alpha}); color: ${textColor};`;
}

function renderHeatmap(studyRun) {
  const { heatmap } = studyRun;

  return `
    <section class="card visual-card seasonality-heatmap-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Year x Month Heatmap</p>
          <p class="summary-meta">Each cell is the month-end log return for that year and calendar month.</p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">Years</span>
          <strong>${formatNumber(heatmap.years.length, 0)}</strong>
        </div>
      </div>
      <div class="seasonality-heatmap-grid">
        <div class="seasonality-heatmap-corner"></div>
        ${heatmap.rows[0]?.cells
          .map(
            (cell) => `
              <div class="seasonality-heatmap-axis">${cell.monthLabel}</div>
            `,
          )
          .join("")}
        ${heatmap.rows
          .map(
            (row) => `
              <div class="seasonality-heatmap-axis seasonality-heatmap-year">${row.year}</div>
              ${row.cells
                .map((cell) => {
                  const label = cell.row
                    ? `${cell.monthLabel} ${cell.year}: ${formatPercent(cell.value)}`
                    : `${cell.monthLabel} ${cell.year}: no observation`;

                  return `
                    <div
                      class="seasonality-heatmap-cell${cell.value === null ? " is-empty" : ""}"
                      style="${heatmapCellStyle(cell.value, heatmap.maxAbsValue)}"
                      title="${label}"
                    >
                      ${cell.value === null ? "—" : formatPercent(cell.value, 1)}
                    </div>
                  `;
                })
                .join("")}
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderMetricBarCard({
  title,
  summary,
  bucketStats,
  valueKey,
  formatter,
  statLabel,
  statValue,
}) {
  const populated = bucketStats.filter(
    (bucket) => Number.isFinite(bucket[valueKey]) && bucket.observations > 0,
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
          Not enough monthly observations are available for this chart.
        </div>
      </section>
    `;
  }

  const maxAbsValue = Math.max(
    ...populated.map((bucket) => Math.abs(bucket[valueKey])),
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
        ${bucketStats
          .map((bucket) => {
            const rawValue = bucket[valueKey];
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
                  <span class="seasonality-bar-label">${bucket.monthLabel}</span>
                  <span class="seasonality-bar-value">${formatter(rawValue, bucket)}</span>
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
  const { summary } = studyRun;

  return `
    <div class="visuals-shell seasonality-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Seasonality Visuals</h2>
          <p class="summary-meta">
            Read the month-of-year pattern as one heatmap first, then check return, consistency, band width, and volatility by bucket.
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
            data-seasonality-visual-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-seasonality-visual-export="xls"
          >Export XLS</button>
        </div>
      </section>

      <div class="visuals-summary-grid">
        <section class="card visuals-summary-card">
          <p class="meta-label">Strongest Month</p>
          <strong class="visuals-summary-value">${summary.strongestMonth?.monthLabel || "n/a"}</strong>
          <p class="summary-meta">
            Avg ${formatPercent(summary.strongestMonth?.averageLogReturn)}
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Weakest Month</p>
          <strong class="visuals-summary-value">${summary.weakestMonth?.monthLabel || "n/a"}</strong>
          <p class="summary-meta">
            Avg ${formatPercent(summary.weakestMonth?.averageLogReturn)}
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Most Consistent</p>
          <strong class="visuals-summary-value">${summary.mostConsistentMonth?.monthLabel || "n/a"}</strong>
          <p class="summary-meta">
            ${formatConsistencyLabel(summary.mostConsistentMonth)}
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Spread</p>
          <strong class="visuals-summary-value">${formatPercent(summary.seasonalitySpread)}</strong>
          <p class="summary-meta">
            Strongest minus weakest average month
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Clearest Upside</p>
          <strong class="visuals-summary-value">${summary.clearestPositiveMonth?.monthLabel || "none"}</strong>
          <p class="summary-meta">
            ${
              summary.clearestPositiveMonth
                ? `${formatNumber(summary.confidenceLevel * 100, 0)}% band ${formatConfidenceBand(summary.clearestPositiveMonth)}`
                : "No band stays fully above zero"
            }
          </p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Thin Buckets</p>
          <strong class="visuals-summary-value">${formatNumber(summary.thinMonthCount, 0)}</strong>
          <p class="summary-meta">
            ${summary.thinMonthCount > 0 ? "Months with fewer than 4 observations" : "All observed months have 4+ samples"}
          </p>
        </section>
      </div>

      <section class="card visuals-context">
        <div class="visuals-context-grid">
          <div>
            <p class="section-label">Run Context</p>
            <p class="summary-meta">
              Return basis: month-end log returns, one row per full calendar month by default.
            </p>
            <p class="summary-meta">
              Monthly rows: ${formatNumber(summary.monthsUsed, 0)} across ${formatNumber(
                summary.yearsObserved,
                0,
              )} years.
            </p>
            <p class="summary-meta">
              ${formatNumber(summary.confidenceLevel * 100, 0)}% bands are deterministic bootstrap intervals around the average month return.
            </p>
          </div>
          <div>
            <p class="section-label">Confidence Cues</p>
            <p class="summary-meta">
              Clear signals: ${formatNumber(summary.clearSignalCount, 0)} of ${formatNumber(
                summary.observedBucketCount,
                0,
              )} observed months stay fully above or below zero.
            </p>
            <p class="summary-meta">
              Directional months: ${formatNumber(summary.directionalMonthCount, 0)} buckets keep the same sign at least 75% of the time.
            </p>
            <p class="summary-meta">
              ${
                studyRun.includePartialBoundaryMonths
                  ? "First and last partial months are included in the bucket set."
                  : "First and last partial months are excluded unless the full calendar month is inside the window."
              } Skipped month gaps: ${formatNumber(summary.skippedTransitions, 0)}.
            </p>
          </div>
        </div>
        ${
          studyRun.warnings.length
            ? `
              <div class="visuals-warning-strip">
                ${studyRun.warnings
                  .slice(0, 2)
                  .map(
                    (warning) => `
                      <span class="visuals-warning-pill">${warning}</span>
                    `,
                  )
                  .join("")}
              </div>
            `
            : ""
        }
        <p id="seasonality-visuals-status" class="status visuals-status"></p>
      </section>

      <div class="visuals-chart-grid seasonality-visual-grid">
        ${renderHeatmap(studyRun)}
        ${renderMetricBarCard({
          title: "Average Return By Month",
          summary: "Average month-end log return for each calendar bucket.",
          bucketStats: studyRun.bucketStats,
          valueKey: "averageLogReturn",
          formatter: (value) => formatPercent(value),
          statLabel: "Leader",
          statValue: summary.strongestMonth?.monthLabel || "n/a",
        })}
        ${renderMetricBarCard({
          title: "Consistency By Month",
          summary: "How often each bucket kept the same sign, regardless of whether the edge was up or down.",
          bucketStats: studyRun.bucketStats,
          valueKey: "consistencyScore",
          formatter: (_value, bucket) => formatConsistencyLabel(bucket),
          statLabel: "Leader",
          statValue: summary.mostConsistentMonth?.monthLabel || "n/a",
        })}
        ${renderMetricBarCard({
          title: "Confidence Band Width",
          summary: "Width of the bootstrap band around each average month return. Smaller is tighter.",
          bucketStats: studyRun.bucketStats,
          valueKey: "confidenceBandWidth",
          formatter: (value) => formatPercent(value),
          statLabel: "Tightest",
          statValue: summary.narrowestBandMonth?.monthLabel || "n/a",
        })}
        ${renderMetricBarCard({
          title: "Volatility By Month",
          summary: "Sample standard deviation of monthly log returns in each bucket.",
          bucketStats: studyRun.bucketStats,
          valueKey: "volatility",
          formatter: (value) => formatPercent(value),
          statLabel: "Highest",
          statValue: summary.mostVolatileMonth?.monthLabel || "n/a",
        })}
      </div>
    </div>
  `;
}

function renderEmptyState(root) {
  root.innerHTML = `
    <div class="empty-state visual-empty">
      <p class="study-kicker">Visuals Need A Run</p>
      <h2>No seasonality study is loaded yet.</h2>
      <p class="summary-meta">
        Run the overview once, then return here for the heatmap and month bucket charts.
      </p>
      <div class="visuals-actions">
        <a class="study-view-link is-active" href="${OVERVIEW_HASH}">Go To Overview</a>
      </div>
    </div>
  `;
}

function mountSeasonalityVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    renderEmptyState(root);
    return () => {};
  }

  root.innerHTML = renderVisualsShell(studyRun);
  const status = root.querySelector("#seasonality-visuals-status");

  function setStatus(message, statusState = "info") {
    status.className = `status visuals-status ${statusState}`;
    status.textContent = message;
  }

  const handleClick = createExportClickHandler({
    triggerSelector: "[data-seasonality-visual-export]",
    datasetKey: "seasonalityVisualExport",
    getPayload: () => studyRun,
    exporters: {
      csv: exportSeasonalityCsv,
      xls: exportSeasonalityXls,
    },
    setStatus,
  });

  root.addEventListener("click", handleClick);
  return () => {
    root.removeEventListener("click", handleClick);
  };
}

export { mountSeasonalityVisuals };
