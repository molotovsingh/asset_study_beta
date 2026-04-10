import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";
import { renderRollingReturnsInterpretation } from "./shared/interpretation.js";

function renderCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
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

function renderWindowTable(windowSummaries) {
  return `
    <div class="rolling-table-wrap">
      <table class="rolling-table">
        <thead>
          <tr>
            <th>Window</th>
            <th>Latest CAGR</th>
            <th>Median CAGR</th>
            <th>25% to 75%</th>
            <th>Best</th>
            <th>Worst</th>
            <th>Positive Rate</th>
            <th>Windows</th>
          </tr>
        </thead>
        <tbody>
          ${windowSummaries
            .map((windowSummary) => {
              if (!windowSummary.observations) {
                return `
                  <tr class="is-unavailable">
                    <th scope="row">${windowSummary.windowLabel}</th>
                    <td colspan="6">Not enough history in the active window</td>
                    <td>0</td>
                  </tr>
                `;
              }

              return `
                <tr>
                  <th scope="row">${windowSummary.windowLabel}</th>
                  <td>${formatPercent(windowSummary.latestCagr)}</td>
                  <td>${formatPercent(windowSummary.medianCagr)}</td>
                  <td>${formatWindowBand(windowSummary)}</td>
                  <td>${formatPercent(windowSummary.bestCagr)}</td>
                  <td>${formatPercent(windowSummary.worstCagr)}</td>
                  <td>${formatPercent(windowSummary.positiveRate)}</td>
                  <td>${formatNumber(windowSummary.observations, 0)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRollingReturnsResults(studyRun) {
  const latestCards = studyRun.availableWindowSummaries.map((windowSummary) =>
    renderCard({
      label: `Latest ${windowSummary.windowLabel}`,
      value: formatPercent(windowSummary.latestCagr),
      detail: windowSummary.latestWindow
        ? `${formatDateRange(
            windowSummary.latestWindow.startDate,
            windowSummary.latestWindow.endDate,
          )}`
        : "No full window available",
    }),
  );
  const unavailableWindows = studyRun.unavailableWindowSummaries.map(
    (windowSummary) => windowSummary.windowLabel,
  );

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Rolling Returns Exports</p>
          <p class="summary-meta">Download the rolling window rows and the horizon summary table.</p>
        </div>
        <div class="results-export-actions">
          <button
            class="results-export-button"
            type="button"
            data-rolling-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-rolling-export="xls"
          >Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Rolling Snapshot</p>
            <p class="summary-meta">
              Latest rolling CAGR by horizon, plus the full-period CAGR across the active study window.
            </p>
          </div>
        </div>
        <div class="results-grid relative-results-grid">
          ${renderCard({
            label: "Full-Period CAGR",
            value: formatPercent(studyRun.fullPeriodCagr),
            detail: formatDateRange(studyRun.actualStartDate, studyRun.actualEndDate),
          })}
          ${latestCards.join("")}
        </div>
      </section>
      ${renderRollingReturnsInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Rolling Read</p>
            <p class="summary-meta">
              Compare the latest, median, best, and worst rolling CAGR for each available horizon.
            </p>
          </div>
        </div>
        <div class="results-grid">
          ${renderCard({
            label: "Latest Leader",
            value: studyRun.summary.latestLeader?.windowLabel || "n/a",
            detail: studyRun.summary.latestLeader
              ? `Latest CAGR ${formatPercent(studyRun.summary.latestLeader.latestCagr)}`
              : "No full rolling window available",
          })}
          ${renderCard({
            label: "Strongest Median",
            value: studyRun.summary.strongestMedianWindow?.windowLabel || "n/a",
            detail: studyRun.summary.strongestMedianWindow
              ? `Median CAGR ${formatPercent(studyRun.summary.strongestMedianWindow.medianCagr)}`
              : "No full rolling window available",
          })}
          ${renderCard({
            label: "Highest Positive Rate",
            value: studyRun.summary.highestPositiveRateWindow?.windowLabel || "n/a",
            detail: studyRun.summary.highestPositiveRateWindow
              ? `${formatPercent(studyRun.summary.highestPositiveRateWindow.positiveRate)} of rolling windows stayed positive`
              : "No full rolling window available",
          })}
          ${renderCard({
            label: "Widest Historical Range",
            value: studyRun.summary.widestRangeWindow?.windowLabel || "n/a",
            detail: studyRun.summary.widestRangeWindow
              ? `${formatPercent(studyRun.summary.widestRangeWindow.cagrRange)} from best to worst`
              : "No full rolling window available",
          })}
        </div>
      </section>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Window Table</p>
            <p class="summary-meta">
              Each row summarizes the rolling CAGR distribution for one horizon inside the active date range.
            </p>
          </div>
        </div>
        ${renderWindowTable(studyRun.windowSummaries)}
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
            Rolling output: CAGR on exact historical windows that end on each observed market date
          </p>
        </div>
        <div class="detail-block">
          <h3>Coverage</h3>
          <p class="result-detail">
            Available horizons: ${formatNumber(studyRun.summary.availableWindowCount, 0)}
          </p>
          <p class="result-detail">
            Total rolling windows: ${formatNumber(studyRun.summary.totalRollingObservations, 0)}
          </p>
          <p class="result-detail">
            Longest available horizon: ${studyRun.availableWindowSummaries.at(-1)?.windowLabel || "n/a"}
          </p>
          <p class="result-detail">
            Latest rolling end date: ${studyRun.availableWindowSummaries[0]?.latestEndDate ? formatDate(studyRun.availableWindowSummaries[0].latestEndDate) : "n/a"}
          </p>
        </div>
        <div class="detail-block">
          <h3>Unavailable Horizons</h3>
          <p class="result-detail">
            ${
              unavailableWindows.length
                ? `${unavailableWindows.join(", ")} could not be formed from the active date range.`
                : "All configured rolling horizons are available in the active range."
            }
          </p>
          <p class="result-detail">
            Shorter horizons naturally have more overlapping windows than longer ones.
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function rollingReturnsTemplate(defaultStartDate, defaultEndDate) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 03</p>
          <h2>Rolling Returns</h2>
          <p>
            See how 1Y, 3Y, 5Y, and 10Y CAGR would have changed across historical entry and exit dates.
          </p>
        </div>
        <div class="note-box">
          <p>
            Rolling windows use <span class="mono">CAGR</span>, not point-to-point raw return.
          </p>
          <p>
            Long horizons will stay unavailable until the active date range contains enough history to form them.
          </p>
        </div>
      </div>

      <section class="card study-primary">
        <form id="rolling-returns-study-form" class="card-grid">
          <div class="card-wide">
            <label class="field-label" for="rolling-returns-query">Dataset Or Symbol</label>
            <input id="rolling-returns-query" class="input" type="text" list="rolling-returns-suggestions" value="Nifty 50" autocomplete="off" spellcheck="false">
            <datalist id="rolling-returns-suggestions"></datalist>
            <p class="helper">
              Examples: <span class="mono">Nifty 50</span>, <span class="mono">Sensex</span>, <span class="mono">^GSPC</span>, <span class="mono">AAPL</span>.
            </p>
            <div id="rolling-returns-summary"></div>
          </div>

          <div>
            <label class="field-label" for="rolling-returns-start-date">Start Date</label>
            <input id="rolling-returns-start-date" class="input" type="date" value="${defaultStartDate}">
          </div>

          <div>
            <label class="field-label" for="rolling-returns-end-date">End Date</label>
            <input id="rolling-returns-end-date" class="input" type="date" value="${defaultEndDate}">
          </div>

          <div class="card-wide">
            <div class="study-actions">
              <button class="button" type="submit">Run Study</button>
              <button id="rolling-returns-load-five-year-window" class="button secondary" type="button">Use Last 5 Years</button>
            </div>
            <p id="rolling-returns-status" class="status"></p>
          </div>
        </form>
      </section>

      <section id="rolling-returns-results-root" class="card results-card">
        <div class="empty-state">
          <p>Run the study to see rolling CAGR ranges by horizon.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#rolling-returns/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}">
              Try Nifty 50 rolling returns
            </a>
            <a class="empty-state-link" href="#rolling-returns/overview?subject=Sensex&start=${defaultStartDate}&end=${defaultEndDate}">
              Try Sensex rolling returns
            </a>
          </div>
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel">
          <summary class="reference-summary">
            <div>
              <p class="section-label">Reference</p>
              <p class="summary-meta">Window rules, backend path, and horizon caveats.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
              <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
              <li>Rolling windows anchor to actual observed market dates, not synthetic calendar interpolation.</li>
            </ul>

            <p class="section-label">Notes</p>
            <p class="helper">
              Long-horizon rolling returns are usually more stable, but they also require much longer history. Price-only data can understate long-run return quality.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { renderRollingReturnsResults, rollingReturnsTemplate };
