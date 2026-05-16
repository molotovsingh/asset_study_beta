import {
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { buildSeasonalityMetricPresentation } from "../lib/metricRegistry.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";
import { renderSeasonalityInterpretation } from "./shared/interpretation.js";
import { renderWarnings } from "./shared/resultsViewShared.js";

function renderCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value seasonality-result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

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

function renderSamplePill(bucket) {
  return `
    <span class="seasonality-sample-pill ${bucket.sampleQualityId}">
      ${formatNumber(bucket.observations, 0)} · ${bucket.sampleQualityLabel}
    </span>
  `;
}

function formatSampleDepth(summary) {
  if (!summary.observedBucketCount) {
    return "No observed month buckets";
  }

  if (summary.minBucketObservations === summary.maxBucketObservations) {
    return `${formatNumber(summary.minBucketObservations, 0)} samples per observed month`;
  }

  return `${formatNumber(summary.minBucketObservations, 0)}-${formatNumber(summary.maxBucketObservations, 0)} samples per observed month`;
}

function renderBucketTable(bucketStats) {
  return `
    <div class="seasonality-table-wrap">
      <table class="seasonality-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Avg Return</th>
            <th>90% Band</th>
            <th>Win Rate</th>
            <th>Consistency</th>
            <th>Volatility</th>
            <th>Best</th>
            <th>Worst</th>
            <th>Sample</th>
          </tr>
        </thead>
        <tbody>
          ${bucketStats
            .map((bucket) => {
              const tone =
                bucket.averageLogReturn > 0
                  ? "is-positive"
                  : bucket.averageLogReturn < 0
                    ? "is-negative"
                    : "";
              const sampleTone =
                bucket.sampleQualityId === "thin" ? " is-thin" : "";

              return `
                <tr class="${tone}${sampleTone}">
                  <th scope="row">${bucket.monthLabel}</th>
                  <td>${formatPercent(bucket.averageLogReturn)}</td>
                  <td>${formatConfidenceBand(bucket)}</td>
                  <td>${formatPercent(bucket.winRate)}</td>
                  <td>${formatConsistencyLabel(bucket)}</td>
                  <td>${formatPercent(bucket.volatility)}</td>
                  <td>${formatPercent(bucket.bestLogReturn)}</td>
                  <td>${formatPercent(bucket.worstLogReturn)}</td>
                  <td>${renderSamplePill(bucket)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSeasonalityResults(studyRun) {
  const { summary } = studyRun;
  const metricPresentation = buildSeasonalityMetricPresentation({ summary });

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Seasonality Exports</p>
          <p class="summary-meta">Download the monthly bucket view and the year-by-month panel.</p>
        </div>
        <div class="results-export-actions">
          <button
            class="results-export-button"
            type="button"
            data-seasonality-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-seasonality-export="xls"
          >Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Seasonality Read</p>
            <p class="summary-meta">Month-of-year tendencies built from month-end log returns.</p>
          </div>
        </div>
        <div class="results-grid relative-results-grid">
          ${renderCard({
            label: "Strongest Month",
            value: summary.strongestMonth?.monthLabel || "n/a",
            detail: summary.strongestMonth
              ? `Avg ${formatPercent(summary.strongestMonth.averageLogReturn)} across ${formatNumber(summary.strongestMonth.observations, 0)} samples`
              : "No observations",
          })}
          ${renderCard({
            label: "Weakest Month",
            value: summary.weakestMonth?.monthLabel || "n/a",
            detail: summary.weakestMonth
              ? `Avg ${formatPercent(summary.weakestMonth.averageLogReturn)} across ${formatNumber(summary.weakestMonth.observations, 0)} samples`
              : "No observations",
          })}
          ${renderCard({
            label: "Best Hit Rate",
            value: summary.bestHitRateMonth?.monthLabel || "n/a",
            detail: summary.bestHitRateMonth
              ? `Win rate ${formatPercent(summary.bestHitRateMonth.winRate)} across ${formatNumber(summary.bestHitRateMonth.observations, 0)} samples`
              : "No observations",
          })}
          ${renderCard({
            label: "Most Volatile",
            value: summary.mostVolatileMonth?.monthLabel || "n/a",
            detail: summary.mostVolatileMonth
              ? `Volatility ${formatPercent(summary.mostVolatileMonth.volatility)}`
              : "No observations",
          })}
          ${renderCard({
            label: "Seasonality Spread",
            value: formatPercent(summary.seasonalitySpread),
            detail: "Strongest minus weakest average month",
          })}
          ${renderCard({
            label: metricPresentation.sampleDepth.label,
            value: `${formatNumber(metricPresentation.sampleDepth.value, 0)} rows`,
            detail: metricPresentation.sampleDepth.detail || formatSampleDepth(summary),
          })}
        </div>
      </section>
      ${renderSeasonalityInterpretation(summary)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Confidence Read</p>
            <p class="summary-meta">
              Deterministic ${formatNumber(summary.confidenceLevel * 100, 0)}% bootstrap bands and direction consistency keep the month view honest.
            </p>
          </div>
        </div>
        <div class="results-grid">
          ${renderCard({
            label: "Most Consistent",
            value: summary.mostConsistentMonth?.monthLabel || "n/a",
            detail: summary.mostConsistentMonth
              ? `${formatConsistencyLabel(summary.mostConsistentMonth)} across ${formatNumber(summary.mostConsistentMonth.observations, 0)} years`
              : "No observations",
          })}
          ${renderCard({
            label: "Clearest Upside",
            value: summary.clearestPositiveMonth?.monthLabel || "none",
            detail: summary.clearestPositiveMonth
              ? `${formatNumber(summary.confidenceLevel * 100, 0)}% band ${formatConfidenceBand(summary.clearestPositiveMonth)}`
              : "No month band stays fully above zero",
          })}
          ${renderCard({
            label: "Clearest Downside",
            value: summary.clearestNegativeMonth?.monthLabel || "none",
            detail: summary.clearestNegativeMonth
              ? `${formatNumber(summary.confidenceLevel * 100, 0)}% band ${formatConfidenceBand(summary.clearestNegativeMonth)}`
              : "No month band stays fully below zero",
          })}
          ${renderCard({
            label: "Thin Buckets",
            value: formatNumber(summary.thinMonthCount, 0),
            detail:
              summary.thinMonthCount > 0
                ? `Months with fewer than 4 observations`
                : "Every observed month has at least 4 samples",
          })}
        </div>
      </section>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Month Buckets</p>
            <p class="summary-meta">
              Each row is a calendar month bucket across the active study window, with a ${formatNumber(summary.confidenceLevel * 100, 0)}% band around the average month return.
            </p>
          </div>
        </div>
        ${renderBucketTable(studyRun.bucketStats)}
      </section>

      <div class="result-details">
        <div class="detail-block">
          <h3>Study Context</h3>
          <p class="result-detail">
            Requested window: ${formatDateRange(
              studyRun.requestedStartDate,
              studyRun.requestedEndDate,
            )}
          </p>
          <p class="result-detail">
            Actual data window: ${formatDateRange(
              studyRun.actualStartDate,
              studyRun.actualEndDate,
            )}
          </p>
          <p class="result-detail">Method: ${studyRun.methodLabel}</p>
          <p class="result-detail">
            Boundary months: ${studyRun.includePartialBoundaryMonths ? "included" : "excluded unless full calendar month"}
          </p>
          <p class="result-detail">
            Return basis: month-end log returns with one bucket per calendar month
          </p>
        </div>
        <div class="detail-block">
          <h3>Coverage</h3>
          <p class="result-detail">
            Months used: ${formatNumber(summary.monthsUsed, 0)}
          </p>
          <p class="result-detail">
            Years observed: ${formatNumber(summary.yearsObserved, 0)}
          </p>
          <p class="result-detail">
            Per-month sample depth: ${formatSampleDepth(summary)}
          </p>
          <p class="result-detail">
            Skipped month gaps: ${formatNumber(summary.skippedTransitions, 0)}
          </p>
          <p class="result-detail">
            Current study lens: Month of year only
          </p>
        </div>
        <div class="detail-block">
          <h3>Confidence Layer</h3>
          <p class="result-detail">
            Band rule: ${formatNumber(summary.confidenceLevel * 100, 0)}% bootstrap interval around the average monthly log return
          </p>
          <p class="result-detail">
            Clear signals: ${formatNumber(summary.clearSignalCount, 0)} of ${formatNumber(summary.observedBucketCount, 0)} observed months stay fully above or below zero
          </p>
          <p class="result-detail">
            Directional months: ${formatNumber(summary.directionalMonthCount, 0)} buckets show the same sign at least 75% of the time
          </p>
          <p class="result-detail">
            Tightest band: ${summary.narrowestBandMonth?.monthLabel || "n/a"}${summary.narrowestBandMonth ? ` at ${formatPercent(summary.narrowestBandMonth.confidenceBandWidth)}` : ""}
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function seasonalityTemplate(defaultStartDate, defaultEndDate, includePartialMonths) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 02</p>
          <h2>Seasonality</h2>
          <p>
            Read how one index behaves by month of year without mixing it with benchmark logic.
          </p>
        </div>
        <div class="note-box">
          <p>
            Monthly buckets use <span class="mono">month-end log returns</span>.
          </p>
          <p>
            The first and last partial months are excluded by default, and each bucket now carries a confidence band.
          </p>
        </div>
      </div>

      <section class="card study-primary">
        <form id="seasonality-study-form" class="card-grid">
          <div class="card-wide study-subject-context">
            <p class="meta-label">Active Asset</p>
            <input id="seasonality-query" type="hidden" value="Nifty 50">
            <datalist id="seasonality-suggestions"></datalist>
            <div id="seasonality-summary"></div>
          </div>

          <div>
            <label class="field-label" for="seasonality-start-date">Start Date</label>
            <input id="seasonality-start-date" class="input" type="date" value="${defaultStartDate}">
          </div>

          <div>
            <label class="field-label" for="seasonality-end-date">End Date</label>
            <input id="seasonality-end-date" class="input" type="date" value="${defaultEndDate}">
          </div>

          <div class="card-wide toggle-row">
            <input id="seasonality-include-partial" type="checkbox"${includePartialMonths ? " checked" : ""}>
            <label for="seasonality-include-partial">Include first and last partial months</label>
          </div>

          <div class="card-wide">
            <div class="study-actions">
              <button class="button" type="submit">Run Study</button>
              <button id="seasonality-load-five-year-window" class="button secondary" type="button">Use Last 5 Years</button>
            </div>
            <p id="seasonality-status" class="status"></p>
          </div>
        </form>
      </section>

      <section id="seasonality-results-root" class="card results-card">
        <div class="empty-state">
          <p>Run the study to see month-by-month seasonality buckets.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#seasonality/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}">
              Try Nifty 50 monthly seasonality
            </a>
            <a class="empty-state-link" href="#seasonality/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}&partial=1">
              Include boundary months
            </a>
          </div>
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel">
          <summary class="reference-summary">
            <div>
              <p class="section-label">Reference</p>
              <p class="summary-meta">Calendar buckets, backend path, and seasonal caveats.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
              <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
              <li>Month buckets use the last available trading day in each month.</li>
            </ul>

            <p class="section-label">Notes</p>
            <p class="helper">
              Longer windows are more reliable. Confidence bands narrow slowly, so short samples and price-only series can make seasonal reads fragile.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { renderSeasonalityResults, seasonalityTemplate };
