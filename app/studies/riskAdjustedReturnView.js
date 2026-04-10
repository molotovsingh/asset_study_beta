import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";
import { renderSelectionDetails } from "./shared/selectionSummaryView.js";

const RESULT_TAB_DEFINITIONS = [
  {
    id: "overview",
    label: "Overview",
    sections: [
      {
        title: "Quick Read",
        summary: "Six first-pass metrics for the current window.",
        cards: [
          {
            label: "CAGR",
            value: ({ metrics }) => formatPercent(metrics.annualizedReturn),
            detail: "Annualized compound return",
          },
          {
            label: "Total Return",
            value: ({ metrics }) => formatPercent(metrics.totalReturn),
            detail: ({ startDate, endDate }) => formatDateRange(startDate, endDate),
          },
          {
            label: "Volatility",
            value: ({ metrics }) => formatPercent(metrics.annualizedVolatility),
            detail: "Annualized log-return volatility",
          },
          {
            label: "Max Drawdown",
            value: ({ metrics }) => formatPercent(metrics.maxDrawdown),
            detail: "Peak-to-trough",
          },
          {
            label: "Sharpe Ratio",
            value: ({ metrics }) => formatNumber(metrics.sharpeRatio),
            detail: "Uses annualized excess log return",
          },
          {
            label: "Sortino Ratio",
            value: ({ metrics }) => formatNumber(metrics.sortinoRatio),
            detail: "Uses downside log deviation",
          },
        ],
      },
    ],
  },
  {
    id: "volatility",
    label: "Volatility",
    sections: [
      {
        title: "Volatility",
        summary: "Realized, downside, and tail-risk views of the same return stream.",
        cards: [
          {
            label: "Volatility",
            value: ({ metrics }) => formatPercent(metrics.annualizedVolatility),
            detail: "Annualized volatility of log returns",
          },
          {
            label: "Downside Deviation",
            value: ({ metrics }) => formatPercent(metrics.downsideDeviation),
            detail: "Annualized downside deviation of excess log returns",
          },
          {
            label: "Ulcer Index",
            value: ({ metrics }) => formatPercent(metrics.ulcerIndex),
            detail: "Depth and persistence of drawdowns",
          },
          {
            label: "VaR 95%",
            value: ({ metrics }) => formatPercent(metrics.valueAtRisk95),
            detail: "5th percentile log return",
          },
          {
            label: "CVaR 95%",
            value: ({ metrics }) =>
              formatPercent(metrics.conditionalValueAtRisk95),
            detail: "Average log return beyond VaR",
          },
          {
            label: "Skewness",
            value: ({ metrics }) => formatNumber(metrics.skewness),
            detail: "Asymmetry of returns",
          },
          {
            label: "Excess Kurtosis",
            value: ({ metrics }) => formatNumber(metrics.excessKurtosis),
            detail: "Tail heaviness",
          },
        ],
      },
    ],
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    sections: [
      {
        title: "Risk Context",
        summary: "Secondary ratios and assumptions behind the headline read.",
        cards: [
          {
            label: "Calmar Ratio",
            value: ({ metrics }) => formatNumber(metrics.calmarRatio),
            detail: "CAGR divided by max drawdown",
          },
          {
            label: "Martin Ratio",
            value: ({ metrics }) => formatNumber(metrics.martinRatio),
            detail: "Excess return divided by ulcer index",
          },
          {
            label: "Risk-Free Rate",
            value: ({ metrics }) =>
              formatPercent(metrics.averageAnnualRiskFreeRate),
            detail: "Average annual rate used",
          },
          {
            label: "Longest Drawdown",
            value: ({ metrics }) =>
              `${formatNumber(metrics.maxDrawdownDurationDays, 0)}d`,
            detail: "Peak to recovery or end",
          },
        ],
      },
      {
        title: "Distribution",
        summary: "How often and how evenly periods finished positive.",
        cards: [
          {
            label: "Win Rate",
            value: ({ metrics }) => formatPercent(metrics.winRate),
            detail: "Positive return periods",
          },
          {
            label: "Avg Log Return",
            value: ({ metrics }) => formatPercent(metrics.averagePeriodReturn),
            detail: "Arithmetic mean of log returns",
          },
          {
            label: "Median Log Return",
            value: ({ metrics }) => formatPercent(metrics.medianPeriodReturn),
            detail: "Median log return per period",
          },
          {
            label: "Winning Periods",
            value: ({ metrics }) =>
              `${formatNumber(metrics.positivePeriods, 0)} / ${formatNumber(
                metrics.periodicObservations,
                0,
              )}`,
            detail: "Positive vs total periods",
          },
        ],
      },
    ],
    renderDetails: ({ metrics, startDate, endDate, methodLabel, warnings }) => `
      <div class="result-details">
        <div class="detail-block">
          <h3>Study Context</h3>
          <p class="result-detail">Window: ${formatDateRange(startDate, endDate)}</p>
          <p class="result-detail">Method: ${methodLabel}</p>
          <p class="result-detail">Return mode: log returns for volatility, tail risk, and Sharpe/Sortino statistics</p>
          <p class="result-detail">Sampling frequency: ${formatNumber(metrics.periodsPerYear, 0)} periods per year</p>
          <p class="result-detail">Index observations: ${formatNumber(metrics.observations, 0)}</p>
          <p class="result-detail">Return observations: ${formatNumber(metrics.periodicObservations, 0)}</p>
          <p class="result-detail">Longest drawdown span: ${formatNumber(metrics.maxDrawdownDurationPeriods, 0)} periods</p>
        </div>
        <div class="detail-block">
          <h3>Return Extremes</h3>
          <p class="result-detail">
            Best period:
            ${metrics.bestPeriod ? `${formatDate(metrics.bestPeriod.startDate)} to ${formatDate(metrics.bestPeriod.endDate)} (${formatPercent(metrics.bestPeriod.value)})` : "n/a"}
          </p>
          <p class="result-detail">
            Worst period:
            ${metrics.worstPeriod ? `${formatDate(metrics.worstPeriod.startDate)} to ${formatDate(metrics.worstPeriod.endDate)} (${formatPercent(metrics.worstPeriod.value)})` : "n/a"}
          </p>
          <p class="result-detail">Non-positive periods: ${formatNumber(metrics.nonPositivePeriods, 0)}</p>
        </div>
        ${renderWarnings(warnings)}
      </div>
    `,
  },
];

function renderMetricCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function renderMetricSection({ title, summary, cards }) {
  return `
    <section class="results-section">
      <div class="results-section-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
      </div>
      <div class="results-grid">
        ${cards.join("")}
      </div>
    </section>
  `;
}

function resolveCardContent(property, context) {
  return typeof property === "function" ? property(context) : property;
}

function renderSectionFromDefinition(section, context) {
  return renderMetricSection({
    title: section.title,
    summary: resolveCardContent(section.summary, context),
    cards: section.cards.map((card) =>
      renderMetricCard({
        label: card.label,
        value: resolveCardContent(card.value, context),
        detail: resolveCardContent(card.detail, context),
      }),
    ),
  });
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

function renderResults({ metrics, startDate, endDate, methodLabel, warnings }) {
  const context = {
    metrics,
    startDate,
    endDate,
    methodLabel,
    warnings,
  };

  return `
    <div class="results-shell">
      <div class="results-tabs" data-results-tabs>
        <div class="results-toolbar">
          <div class="results-tab-list" role="tablist" aria-label="Result sections">
            ${RESULT_TAB_DEFINITIONS.map(
              (tab, index) => `
                <button
                  class="results-tab-button${index === 0 ? " is-active" : ""}"
                  type="button"
                  role="tab"
                  aria-selected="${index === 0}"
                  data-results-tab-trigger="${tab.id}"
                >${tab.label}</button>
              `,
            ).join("")}
          </div>
          <div class="results-export-actions">
            <button
              class="results-export-button"
              type="button"
              data-results-export="csv"
            >Export CSV</button>
            <button
              class="results-export-button"
              type="button"
              data-results-export="xls"
            >Export XLS</button>
          </div>
        </div>

        ${RESULT_TAB_DEFINITIONS.map(
          (tab, index) => `
            <section
              class="results-tab-panel"
              role="tabpanel"
              data-results-tab-panel="${tab.id}"
              ${index === 0 ? "" : "hidden"}
            >
              ${tab.sections
                .map((section) => renderSectionFromDefinition(section, context))
                .join("")}
              ${tab.renderDetails ? tab.renderDetails(context) : ""}
            </section>
          `,
        ).join("")}
      </div>
    </div>
  `;
}

function studyTemplate(defaultStartDate, defaultEndDate) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 01</p>
          <h2>Risk-Adjusted Return</h2>
          <p>
            Compare return, risk, and drawdown for a bundled dataset or live symbol.
          </p>
        </div>
        <div class="note-box">
          <p>
            Period risk statistics use <span class="mono">log returns</span>.
          </p>
          <p>
            Total return and drawdown stay price-based.
          </p>
        </div>
      </div>

      <section class="card study-primary">
          <form id="risk-study-form" class="card-grid">
            <div class="card-wide">
              <label class="field-label" for="index-query">Index Or Symbol</label>
              <input id="index-query" class="input" type="text" list="index-suggestions" value="Nifty 50" autocomplete="off" spellcheck="false">
              <datalist id="index-suggestions"></datalist>
              <p class="helper">
                Examples: <span class="mono">Nifty 50</span>, <span class="mono">Sensex</span>, <span class="mono">AAPL</span>, <span class="mono">^NSEI</span>, <span class="mono">ETH-USD</span>.
              </p>
              <div id="index-summary"></div>
            </div>

            <div>
              <label class="field-label" for="start-date">Start Date</label>
              <input id="start-date" class="input" type="date" value="${defaultStartDate}">
            </div>

            <div>
              <label class="field-label" for="end-date">End Date</label>
              <input id="end-date" class="input" type="date" value="${defaultEndDate}">
            </div>

            <div class="card-wide toggle-row">
              <input id="use-demo-data" type="checkbox">
              <label for="use-demo-data">Use demo data instead of bundled or live data</label>
            </div>

            <div class="card-wide">
              <label class="field-label" for="constant-rate">Risk-Free Rate %</label>
              <input id="constant-rate" class="input" type="number" step="0.01" value="5.50">
              <p class="helper">
                Enter an annual rate from a source you trust, such as RBI
                91-day T-bill data.
              </p>
            </div>

            <div class="card-wide">
              <div class="study-actions">
                <button class="button" type="submit">Run Study</button>
                <button id="load-five-year-window" class="button secondary" type="button">Use Last 5 Years</button>
              </div>
              <p id="study-status" class="status"></p>
            </div>
          </form>
      </section>

      <section id="results-root" class="card results-card">
        <div class="empty-state">
          <p>Run the study to see return, risk, and drawdown metrics.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#risk-adjusted-return/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}&rf=5.50">
              Try Nifty 50 risk metrics
            </a>
            <a class="empty-state-link" href="#risk-adjusted-return/overview?subject=Sensex&start=${defaultStartDate}&end=${defaultEndDate}&rf=5.50">
              Try Sensex comparison base
            </a>
          </div>
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel">
          <summary class="reference-summary">
            <div>
              <p class="section-label">Reference</p>
              <p class="summary-meta">Sources, backend path, and the TRI caveat.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
              <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
              <li>Risk-free reference: <a href="https://data.rbi.org.in" target="_blank" rel="noreferrer">RBI 91-day T-bill data</a>.</li>
            </ul>

            <p class="section-label">Notes</p>
            <p class="helper">
              Use TRI data when available. Price-only series can understate long-run quality.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { renderResults, renderSelectionDetails, studyTemplate };
