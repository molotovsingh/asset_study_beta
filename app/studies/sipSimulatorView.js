import {
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";
import { renderSipInterpretation } from "./shared/interpretation.js";

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

function formatAmount(value, currencyCode) {
  const amount = formatNumber(value, 2);
  return currencyCode ? `${amount} ${currencyCode}` : amount;
}

function renderCohortTable(studyRun) {
  return `
    <div class="sip-table-wrap">
      <table class="sip-table">
        <thead>
          <tr>
            <th>Start Month</th>
            <th>Contributions</th>
            <th>Total Invested</th>
            <th>Terminal Value</th>
            <th>Gain</th>
            <th>Wealth Multiple</th>
            <th>XIRR</th>
          </tr>
        </thead>
        <tbody>
          ${studyRun.cohorts
            .map((cohort) => {
              const rowTone =
                cohort.xirr > 0
                  ? "is-positive"
                  : cohort.xirr < 0
                    ? "is-negative"
                    : "";

              return `
                <tr class="${rowTone}">
                  <th scope="row">${cohort.startMonthLabel}</th>
                  <td>${formatNumber(cohort.contributionCount, 0)}</td>
                  <td>${formatAmount(cohort.totalInvested, studyRun.selection?.currency)}</td>
                  <td>${formatAmount(cohort.terminalValue, studyRun.selection?.currency)}</td>
                  <td>${formatAmount(cohort.gain, studyRun.selection?.currency)}</td>
                  <td>${formatNumber(cohort.wealthMultiple, 2)}x</td>
                  <td>${formatPercent(cohort.xirr)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSipSimulatorResults(studyRun) {
  const { summary } = studyRun;
  const fullWindow = summary.fullWindowCohort;

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">SIP Exports</p>
          <p class="summary-meta">Download the cohort table and the full-window contribution path.</p>
        </div>
        <div class="results-export-actions">
          <button
            class="results-export-button"
            type="button"
            data-sip-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-sip-export="xls"
          >Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">SIP Snapshot</p>
            <p class="summary-meta">
              Full-window SIP outcome using the first trading day of each month and a fixed monthly contribution.
            </p>
          </div>
        </div>
        <div class="results-grid relative-results-grid">
          ${renderCard({
            label: "Full-Window SIP XIRR",
            value: formatPercent(fullWindow?.xirr),
            detail: fullWindow
              ? `${fullWindow.startMonthLabel} to ${studyRun.endMonthLabel}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Terminal Value",
            value: formatAmount(fullWindow?.terminalValue, studyRun.selection?.currency),
            detail: fullWindow
              ? `${formatNumber(fullWindow.contributionCount, 0)} contributions of ${formatAmount(studyRun.monthlyContribution, studyRun.selection?.currency)}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Total Invested",
            value: formatAmount(fullWindow?.totalInvested, studyRun.selection?.currency),
            detail: "Fixed monthly amount across the full study window",
          })}
          ${renderCard({
            label: "Total Gain",
            value: formatAmount(fullWindow?.gain, studyRun.selection?.currency),
            detail: fullWindow
              ? `Terminal wealth ${formatNumber(fullWindow.wealthMultiple, 2)}x invested capital`
              : "No cohort available",
          })}
        </div>
      </section>
      ${renderSipInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Cohort Read</p>
            <p class="summary-meta">
              Each cohort starts in a different month and contributes until the same terminal market date.
            </p>
          </div>
        </div>
        <div class="results-grid">
          ${renderCard({
            label: "Median Cohort XIRR",
            value: formatPercent(summary.medianXirr),
            detail: `Middle cohort across ${formatNumber(summary.totalCohorts, 0)} eligible start months`,
          })}
          ${renderCard({
            label: "Positive Cohorts",
            value: formatPercent(summary.positiveRate),
            detail: `${formatNumber(summary.totalCohorts, 0)} cohorts met the minimum contribution count`,
          })}
          ${renderCard({
            label: "Best Start Month",
            value: summary.bestCohort?.startMonthLabel || "n/a",
            detail: summary.bestCohort
              ? `XIRR ${formatPercent(summary.bestCohort.xirr)}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Worst Start Month",
            value: summary.worstCohort?.startMonthLabel || "n/a",
            detail: summary.worstCohort
              ? `XIRR ${formatPercent(summary.worstCohort.xirr)}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Best Wealth Multiple",
            value: summary.highestWealthMultipleCohort
              ? `${formatNumber(summary.highestWealthMultipleCohort.wealthMultiple, 2)}x`
              : "n/a",
            detail: summary.highestWealthMultipleCohort
              ? `${summary.highestWealthMultipleCohort.startMonthLabel} cohort`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Shortest Included Cohort",
            value: summary.shortestIncludedCohort?.startMonthLabel || "n/a",
            detail: summary.shortestIncludedCohort
              ? `${formatNumber(summary.shortestIncludedCohort.contributionCount, 0)} contributions`
              : "No cohort available",
          })}
        </div>
      </section>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Cohort Table</p>
            <p class="summary-meta">
              Read the full SIP cohort panel before jumping to visuals or exports.
            </p>
          </div>
        </div>
        ${renderCohortTable(studyRun)}
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
            Contribution rule: first observed trading day of each month inside the active window
          </p>
        </div>
        <div class="detail-block">
          <h3>Cohort Coverage</h3>
          <p class="result-detail">
            Monthly anchors: ${formatNumber(summary.totalMonthlyAnchors, 0)}
          </p>
          <p class="result-detail">
            Eligible cohorts: ${formatNumber(summary.totalCohorts, 0)}
          </p>
          <p class="result-detail">
            Minimum contribution count: ${formatNumber(studyRun.minContributions, 0)}
          </p>
          <p class="result-detail">
            IQR of cohort XIRR: ${formatPercent(summary.percentile25Xirr)} to ${formatPercent(summary.percentile75Xirr)}
          </p>
        </div>
        <div class="detail-block">
          <h3>Notes</h3>
          <p class="result-detail">
            SIP cohorts that start later naturally have fewer contributions than earlier cohorts.
          </p>
          <p class="result-detail">
            XIRR is based on dated monthly cash flows plus terminal portfolio value at the latest market date.
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function sipSimulatorTemplate(defaultStartDate, defaultEndDate, defaultContributionValue) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 04</p>
          <h2>SIP Simulator</h2>
          <p>
            Simulate a fixed monthly SIP across every eligible historical start month and compare the resulting XIRR range.
          </p>
        </div>
        <div class="note-box">
          <p>
            Monthly buys use the first observed trading day of each month inside the active window.
          </p>
          <p>
            Very short cohorts are excluded by default so the XIRR panel stays comparable.
          </p>
        </div>
      </div>

      <section class="card study-primary">
        <form id="sip-simulator-study-form" class="card-grid">
          <div class="card-wide">
            <label class="field-label" for="sip-simulator-query">Dataset Or Symbol</label>
            <input id="sip-simulator-query" class="input" type="text" list="sip-simulator-suggestions" value="Nifty 50" autocomplete="off" spellcheck="false">
            <datalist id="sip-simulator-suggestions"></datalist>
            <p class="helper">
              Examples: <span class="mono">Nifty 50</span>, <span class="mono">Sensex</span>, <span class="mono">^GSPC</span>, <span class="mono">AAPL</span>.
            </p>
            <div id="sip-simulator-summary"></div>
          </div>

          <div>
            <label class="field-label" for="sip-simulator-contribution">Monthly Contribution</label>
            <input id="sip-simulator-contribution" class="input" type="number" min="1" step="100" value="${defaultContributionValue}">
          </div>

          <div>
            <label class="field-label" for="sip-simulator-start-date">Start Date</label>
            <input id="sip-simulator-start-date" class="input" type="date" value="${defaultStartDate}">
          </div>

          <div>
            <label class="field-label" for="sip-simulator-end-date">End Date</label>
            <input id="sip-simulator-end-date" class="input" type="date" value="${defaultEndDate}">
          </div>

          <div class="card-wide">
            <div class="study-actions">
              <button class="button" type="submit">Run Study</button>
              <button id="sip-simulator-load-five-year-window" class="button secondary" type="button">Use Last 5 Years</button>
            </div>
            <p id="sip-simulator-status" class="status"></p>
          </div>
        </form>
      </section>

      <section id="sip-simulator-results-root" class="card results-card">
        <div class="empty-state">
          <p>Run the study to compare SIP outcomes across historical start months.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#sip-simulator/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}&contribution=${defaultContributionValue}">
              Try Nifty 50 monthly SIP
            </a>
            <a class="empty-state-link" href="#sip-simulator/overview?subject=Sensex&start=${defaultStartDate}&end=${defaultEndDate}&contribution=${defaultContributionValue}">
              Try Sensex monthly SIP
            </a>
          </div>
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel">
          <summary class="reference-summary">
            <div>
              <p class="section-label">Reference</p>
              <p class="summary-meta">Contribution rule, backend path, and cash-flow notes.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
              <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
              <li>SIP cohorts use monthly dated cash flows and terminal value at the latest market date.</li>
            </ul>

            <p class="section-label">Notes</p>
            <p class="helper">
              This is a deterministic cohort simulator, not a recommendation engine. Price-only series can understate long-run total-return SIP outcomes.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { renderSipSimulatorResults, sipSimulatorTemplate };
