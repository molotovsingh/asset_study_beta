import {
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";

function renderCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value seasonality-result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function renderWarnings(warnings) {
  if (!warnings.length) {
    return "";
  }

  return `
    <div class="detail-block">
      <h3>Warnings</h3>
      <ul class="warning-list">
        ${warnings.map((warning) => `<li>${warning}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderBucketTable(bucketStats) {
  return `
    <div class="seasonality-table-wrap">
      <table class="seasonality-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Avg Return</th>
            <th>Median</th>
            <th>Win Rate</th>
            <th>Volatility</th>
            <th>Positive Years</th>
            <th>Best</th>
            <th>Worst</th>
            <th>Obs</th>
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

              return `
                <tr class="${tone}">
                  <th scope="row">${bucket.monthLabel}</th>
                  <td>${formatPercent(bucket.averageLogReturn)}</td>
                  <td>${formatPercent(bucket.medianLogReturn)}</td>
                  <td>${formatPercent(bucket.winRate)}</td>
                  <td>${formatPercent(bucket.volatility)}</td>
                  <td>${formatPercent(bucket.positiveYearsPct)}</td>
                  <td>${formatPercent(bucket.bestLogReturn)}</td>
                  <td>${formatPercent(bucket.worstLogReturn)}</td>
                  <td>${formatNumber(bucket.observations, 0)}</td>
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
              ? `Avg ${formatPercent(summary.strongestMonth.averageLogReturn)}`
              : "No observations",
          })}
          ${renderCard({
            label: "Weakest Month",
            value: summary.weakestMonth?.monthLabel || "n/a",
            detail: summary.weakestMonth
              ? `Avg ${formatPercent(summary.weakestMonth.averageLogReturn)}`
              : "No observations",
          })}
          ${renderCard({
            label: "Best Hit Rate",
            value: summary.bestHitRateMonth?.monthLabel || "n/a",
            detail: summary.bestHitRateMonth
              ? `Win rate ${formatPercent(summary.bestHitRateMonth.winRate)}`
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
            label: "Years Observed",
            value: formatNumber(summary.yearsObserved, 0),
            detail: `${formatNumber(summary.monthsUsed, 0)} monthly rows used`,
          })}
        </div>
      </section>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Month Buckets</p>
            <p class="summary-meta">Each row is a calendar month bucket across the active study window.</p>
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
            Skipped month gaps: ${formatNumber(summary.skippedTransitions, 0)}
          </p>
          <p class="result-detail">
            Current study lens: Month of year only
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
            The first and last partial months are excluded by default.
          </p>
        </div>
      </div>

      <section class="card study-primary">
        <form id="seasonality-study-form" class="card-grid">
          <div class="card-wide">
            <label class="field-label" for="seasonality-query">Dataset Or Symbol</label>
            <input id="seasonality-query" class="input" type="text" list="seasonality-suggestions" value="Nifty 50" autocomplete="off" spellcheck="false">
            <datalist id="seasonality-suggestions"></datalist>
            <p class="helper">
              Examples: <span class="mono">Nifty 50</span>, <span class="mono">Sensex</span>, <span class="mono">^GSPC</span>, <span class="mono">AAPL</span>.
            </p>
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
          Run the study to see month-by-month seasonality buckets.
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
              Longer windows are more reliable. Price-only series and short samples can make seasonal reads fragile.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { renderSeasonalityResults, seasonalityTemplate };
