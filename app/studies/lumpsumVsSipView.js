import {
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { DEFAULT_HORIZON_OPTIONS } from "../lib/lumpsumVsSip.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";
import { renderLumpsumVsSipInterpretation } from "./shared/interpretation.js";
import { renderWarnings } from "./shared/resultsViewShared.js";

function renderCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function formatAmount(value, currencyCode) {
  const amount = formatNumber(value, 2);
  return currencyCode ? `${amount} ${currencyCode}` : amount;
}

function formatWinner(value) {
  if (value === "lumpsum") {
    return "Lumpsum";
  }

  if (value === "sip") {
    return "SIP";
  }

  return "Tie";
}

function renderHorizonOptions(activeHorizonYears) {
  return DEFAULT_HORIZON_OPTIONS.map(
    (horizonYears) => `
      <option value="${horizonYears}" ${horizonYears === activeHorizonYears ? "selected" : ""}>
        ${horizonYears}Y
      </option>
    `,
  ).join("");
}

function renderCohortTable(studyRun) {
  return `
    <div class="sip-table-wrap">
      <table class="sip-table">
        <thead>
          <tr>
            <th>Start Month</th>
            <th>End Date</th>
            <th>Lumpsum Value</th>
            <th>SIP Value</th>
            <th>Advantage</th>
            <th>Lumpsum CAGR</th>
            <th>SIP XIRR</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          ${studyRun.cohorts
            .map((cohort) => {
              const rowTone =
                cohort.winner === "lumpsum"
                  ? "is-positive"
                  : cohort.winner === "sip"
                    ? "is-negative"
                    : "";

              return `
                <tr class="${rowTone}">
                  <th scope="row">${cohort.startMonthLabel}</th>
                  <td>${formatDateRange(cohort.startDate, cohort.endDate)}</td>
                  <td>${formatAmount(cohort.lumpsumTerminalValue, studyRun.selection?.currency)}</td>
                  <td>${formatAmount(cohort.sipTerminalValue, studyRun.selection?.currency)}</td>
                  <td>${formatAmount(cohort.advantageAmount, studyRun.selection?.currency)} · ${formatPercent(cohort.advantageRate)}</td>
                  <td>${formatPercent(cohort.lumpsumCagr)}</td>
                  <td>${formatPercent(cohort.sipXirr)}</td>
                  <td>${formatWinner(cohort.winner)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLumpsumVsSipResults(studyRun) {
  const { summary } = studyRun;
  const firstCohort = summary.firstCohort;

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Comparison Exports</p>
          <p class="summary-meta">Download every historical Lumpsum vs SIP cohort and the representative SIP path.</p>
        </div>
        <div class="results-export-actions">
          <button
            class="results-export-button"
            type="button"
            data-lumpsum-sip-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-lumpsum-sip-export="xls"
          >Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Headline Comparison</p>
            <p class="summary-meta">
              Same total capital, same start month, same terminal date; only the deployment path changes.
            </p>
          </div>
        </div>
        <div class="results-grid relative-results-grid">
          ${renderCard({
            label: "Lumpsum Win Rate",
            value: formatPercent(summary.lumpsumWinRate),
            detail: `${formatNumber(summary.lumpsumWins, 0)} of ${formatNumber(summary.totalCohorts, 0)} cohorts`,
          })}
          ${renderCard({
            label: "SIP Win Rate",
            value: formatPercent(summary.sipWinRate),
            detail: `${formatNumber(summary.sipWins, 0)} of ${formatNumber(summary.totalCohorts, 0)} cohorts`,
          })}
          ${renderCard({
            label: "Median Advantage",
            value: formatPercent(summary.medianAdvantageRate),
            detail: "Positive means lumpsum finished ahead",
          })}
          ${renderCard({
            label: "IQR Advantage",
            value: `${formatPercent(summary.percentile25AdvantageRate)} to ${formatPercent(summary.percentile75AdvantageRate)}`,
            detail: "Middle 50% of historical start months",
          })}
        </div>
      </section>
      ${renderLumpsumVsSipInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Representative Cohort</p>
            <p class="summary-meta">
              The earliest eligible start month is a concrete example of how the two paths diverged.
            </p>
          </div>
        </div>
        <div class="results-grid">
          ${renderCard({
            label: "Start Month",
            value: firstCohort?.startMonthLabel || "n/a",
            detail: firstCohort
              ? `${formatDateRange(firstCohort.startDate, firstCohort.endDate)}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Lumpsum Terminal",
            value: formatAmount(firstCohort?.lumpsumTerminalValue, studyRun.selection?.currency),
            detail: firstCohort
              ? `CAGR ${formatPercent(firstCohort.lumpsumCagr)}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "SIP Terminal",
            value: formatAmount(firstCohort?.sipTerminalValue, studyRun.selection?.currency),
            detail: firstCohort
              ? `XIRR ${formatPercent(firstCohort.sipXirr)}`
              : "No cohort available",
          })}
          ${renderCard({
            label: "Winner",
            value: firstCohort ? formatWinner(firstCohort.winner) : "n/a",
            detail: firstCohort
              ? `${formatAmount(firstCohort.advantageAmount, studyRun.selection?.currency)} terminal gap`
              : "No cohort available",
          })}
        </div>
      </section>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Cohort Table</p>
            <p class="summary-meta">
              Each row compares one historical start month over the selected fixed horizon.
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
            Horizon: ${formatNumber(studyRun.horizonYears, 0)} years with ${formatAmount(studyRun.totalInvestment, studyRun.selection?.currency)} total capital
          </p>
        </div>
        <div class="detail-block">
          <h3>Comparison Method</h3>
          <p class="result-detail">
            Lumpsum invests all capital on the start date.
          </p>
          <p class="result-detail">
            SIP divides the same capital across monthly buys before the terminal date.
          </p>
          <p class="result-detail">
            Eligible cohorts: ${formatNumber(summary.totalCohorts, 0)} from ${summary.firstStartDate ? formatDateRange(summary.firstStartDate, summary.lastStartDate) : "n/a"}
          </p>
        </div>
        <div class="detail-block">
          <h3>Return Read</h3>
          <p class="result-detail">
            Median lumpsum CAGR: ${formatPercent(summary.medianLumpsumCagr)}
          </p>
          <p class="result-detail">
            Median SIP XIRR: ${formatPercent(summary.medianSipXirr)}
          </p>
          <p class="result-detail">
            Ties: ${formatNumber(summary.ties, 0)}
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function lumpsumVsSipTemplate(
  defaultStartDate,
  defaultEndDate,
  defaultTotalInvestmentValue,
  defaultHorizonYears,
) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 05</p>
          <h2>Lumpsum vs SIP</h2>
          <p>
            Compare whether the same capital historically did better when invested upfront or spread monthly.
          </p>
        </div>
        <div class="note-box">
          <p>
            This study compares terminal values, not behavior comfort or investor psychology.
          </p>
          <p>
            Positive advantage means lumpsum beat SIP for that historical start month.
          </p>
        </div>
      </div>

      <section class="card study-primary">
        <form id="lumpsum-sip-study-form" class="card-grid">
          <div class="card-wide study-subject-context">
            <p class="meta-label">Active Asset</p>
            <input id="lumpsum-sip-query" type="hidden" value="Nifty 50">
            <datalist id="lumpsum-sip-suggestions"></datalist>
            <div id="lumpsum-sip-summary"></div>
          </div>

          <div>
            <label class="field-label" for="lumpsum-sip-total-investment">Total Investment</label>
            <input id="lumpsum-sip-total-investment" class="input" type="number" min="0" step="1000" value="${defaultTotalInvestmentValue}">
          </div>

          <div>
            <label class="field-label" for="lumpsum-sip-horizon-years">Horizon</label>
            <select id="lumpsum-sip-horizon-years" class="select">
              ${renderHorizonOptions(defaultHorizonYears)}
            </select>
          </div>

          <div>
            <label class="field-label" for="lumpsum-sip-start-date">Start Date</label>
            <input id="lumpsum-sip-start-date" class="input" type="date" value="${defaultStartDate}">
          </div>

          <div>
            <label class="field-label" for="lumpsum-sip-end-date">End Date</label>
            <input id="lumpsum-sip-end-date" class="input" type="date" value="${defaultEndDate}">
          </div>

          <div class="card-wide">
            <div class="study-actions">
              <button class="button" type="submit">Run Study</button>
              <button id="lumpsum-sip-load-five-year-window" class="button secondary" type="button">Use Last 5 Years</button>
            </div>
            <p id="lumpsum-sip-status" class="status"></p>
          </div>
        </form>
      </section>

      <section id="lumpsum-sip-results-root" class="card results-card">
        <div class="empty-state">
          <p>Run the study to compare historical lumpsum and SIP cohorts.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#lumpsum-vs-sip/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}&total=${defaultTotalInvestmentValue}&horizon=${defaultHorizonYears}">
              Try Nifty 50, 3Y horizon
            </a>
            <a class="empty-state-link" href="#lumpsum-vs-sip/overview?subject=Sensex&start=${defaultStartDate}&end=${defaultEndDate}&total=${defaultTotalInvestmentValue}&horizon=${defaultHorizonYears}">
              Try Sensex, 3Y horizon
            </a>
          </div>
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel">
          <summary class="reference-summary">
            <div>
              <p class="section-label">Reference</p>
              <p class="summary-meta">Capital matching, horizon handling, and backend path.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
              <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
              <li>SIP uses monthly buys before the terminal date; lumpsum invests all capital at the start.</li>
            </ul>

            <p class="section-label">Notes</p>
            <p class="helper">
              This is historical cohort analysis. It does not decide which route is suitable for a real investor.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { lumpsumVsSipTemplate, renderLumpsumVsSipResults };
