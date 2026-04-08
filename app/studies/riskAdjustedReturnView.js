import {
  formatDate,
  formatDateTime,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  LOCAL_API_COMMAND,
  describeFreshness,
  getSnapshotFreshness,
} from "../lib/syncedData.js";

const RESULT_TAB_DEFINITIONS = [
  {
    id: "overview",
    label: "Overview",
    sections: [
      {
        title: "Quick Read",
        summary: "The six default metrics that matter most on a first pass.",
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
            detail: "Annualized",
          },
          {
            label: "Max Drawdown",
            value: ({ metrics }) => formatPercent(metrics.maxDrawdown),
            detail: "Peak-to-trough",
          },
          {
            label: "Sharpe Ratio",
            value: ({ metrics }) => formatNumber(metrics.sharpeRatio),
            detail: "Uses total volatility",
          },
          {
            label: "Sortino Ratio",
            value: ({ metrics }) => formatNumber(metrics.sortinoRatio),
            detail: "Uses downside deviation",
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
        summary:
          "How variable the series was, with increasing downside and tail sensitivity.",
        cards: [
          {
            label: "Volatility",
            value: ({ metrics }) => formatPercent(metrics.annualizedVolatility),
            detail: "Annualized realized volatility",
          },
          {
            label: "Downside Deviation",
            value: ({ metrics }) => formatPercent(metrics.downsideDeviation),
            detail: "Annualized downside-only volatility",
          },
          {
            label: "Ulcer Index",
            value: ({ metrics }) => formatPercent(metrics.ulcerIndex),
            detail: "Depth and persistence of drawdowns",
          },
          {
            label: "VaR 95%",
            value: ({ metrics }) => formatPercent(metrics.valueAtRisk95),
            detail: "5th percentile period return",
          },
          {
            label: "CVaR 95%",
            value: ({ metrics }) =>
              formatPercent(metrics.conditionalValueAtRisk95),
            detail: "Average beyond VaR",
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
        summary:
          "Secondary ratios and assumptions that add more context after the quick read.",
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
        summary: "How returns were distributed across periods.",
        cards: [
          {
            label: "Win Rate",
            value: ({ metrics }) => formatPercent(metrics.winRate),
            detail: "Positive return periods",
          },
          {
            label: "Avg Period Return",
            value: ({ metrics }) => formatPercent(metrics.averagePeriodReturn),
            detail: "Arithmetic mean",
          },
          {
            label: "Median Period Return",
            value: ({ metrics }) => formatPercent(metrics.medianPeriodReturn),
            detail: "Middle observed period",
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

function renderFreshnessDetails(snapshot, prefixLabel, extraMeta = "") {
  const freshness = getSnapshotFreshness(snapshot);
  const latestDate = freshness.latestDate ? formatDate(freshness.latestDate) : "n/a";
  const syncedAt = snapshot.generatedAt
    ? formatDateTime(new Date(snapshot.generatedAt))
    : "n/a";
  const rangeStart = snapshot.range?.startDate
    ? formatDate(new Date(`${snapshot.range.startDate}T00:00:00`))
    : "n/a";
  const rangeEnd = snapshot.range?.endDate
    ? formatDate(new Date(`${snapshot.range.endDate}T00:00:00`))
    : "n/a";

  return `
    <div class="sync-summary-grid">
      <div class="sync-summary-row">
        <span class="summary-pill ${freshness.status}">${describeFreshness(
    freshness,
  )}</span>
        <span class="summary-meta">Latest market date: ${latestDate}</span>
      </div>
      <p class="summary-meta">${prefixLabel}: ${syncedAt}</p>
      <p class="summary-meta">Series range: ${rangeStart} to ${rangeEnd}</p>
      <p class="summary-meta">Observations: ${
        snapshot.range?.observations ?? "n/a"
      }</p>
      ${extraMeta}
    </div>
  `;
}

function renderSelectionDetails(
  selection,
  runtimeSnapshot,
  useDemoData,
  backendState,
) {
  if (!selection) {
    return `
      <div class="note-box">
        <p>Choose a bundled dataset like Nifty 50 or enter a yfinance symbol like AAPL.</p>
      </div>
    `;
  }

  const sourceUrl = runtimeSnapshot?.sourceUrl || selection.sourceUrl;
  const providerName = runtimeSnapshot?.providerName || selection.providerName;
  const family = runtimeSnapshot?.family || selection.family;
  const targetSeriesType =
    runtimeSnapshot?.targetSeriesType || selection.targetSeriesType;
  const sourceSeriesType =
    runtimeSnapshot?.sourceSeriesType || selection.sourceSeriesType;
  const note = runtimeSnapshot?.note || selection.note || null;
  const sourceLabel =
    selection.kind === "builtin" || selection.kind === "bundled"
      ? "Bundled"
      : selection.kind === "remembered"
        ? "Saved Symbol"
        : "Symbol";

  let runtimeMeta = "";

  if (runtimeSnapshot) {
    const demoNote = useDemoData
      ? `<p class="summary-meta">Demo mode is active. The latest loaded data is shown below for reference only.</p>`
      : "";
    const backendMeta = runtimeSnapshot.cache?.status
      ? `<p class="summary-meta">Fetch: local backend ${runtimeSnapshot.cache.status}</p>`
      : `<p class="summary-meta">Fetch: bundled snapshot</p>`;
    runtimeMeta = renderFreshnessDetails(
      runtimeSnapshot,
      runtimeSnapshot.cache ? "Last fetched" : "Bundled sync",
      `${demoNote}${backendMeta}`,
    );
  } else if (
    (selection.kind === "builtin" || selection.kind === "bundled") &&
    selection.generatedAt &&
    selection.range
  ) {
    runtimeMeta = renderFreshnessDetails(
      {
        generatedAt: selection.generatedAt,
        range: selection.range,
      },
      "Bundled sync",
      `<p class="summary-meta">Bundled snapshot is ready to load.</p>`,
    );
  } else if (
    selection.kind === "remembered" &&
    selection.generatedAt &&
    selection.range
  ) {
    runtimeMeta = renderFreshnessDetails(
      {
        generatedAt: selection.generatedAt,
        range: selection.range,
      },
      "Last fetched",
      `<p class="summary-meta">Saved locally. Run the study to refresh it.</p>`,
    );
  } else if (selection.kind === "adhoc" || selection.kind === "remembered") {
    runtimeMeta =
      backendState === "ready"
        ? `<p class="summary-meta">Will fetch <span class="mono">${selection.symbol}</span> through the local backend.</p>`
        : `<p class="summary-meta">This selection needs the local backend. Start <span class="mono">${LOCAL_API_COMMAND}</span> first.</p>`;
  } else {
    runtimeMeta = `<p class="summary-meta">Bundled snapshot is ready to load.</p>`;
  }

  const proxyWarning =
    sourceSeriesType && sourceSeriesType !== targetSeriesType
      ? `<p class="summary-meta">Bootstrap uses <span class="mono">${sourceSeriesType}</span> data as a proxy for <span class="mono">${targetSeriesType}</span>.</p>`
      : "";

  return `
    <div class="note-box">
      <p><span class="section-label">${sourceLabel}</span>${selection.label}</p>
      <p>${providerName} · ${family} · ${targetSeriesType}</p>
      <p>Source: <a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceUrl}</a></p>
      <p class="summary-meta">Resolved symbol: <span class="mono">${selection.symbol}</span></p>
      ${proxyWarning}
      ${note ? `<p class="summary-meta">${note}</p>` : ""}
      ${runtimeMeta}
    </div>
  `;
}

function renderMetricCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong>${value}</strong>
      <span>${detail}</span>
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
            Pick a bundled dataset or enter a yfinance symbol, choose a date
            range, set the annual risk-free rate, and run the study. Bundled
            datasets load from repo snapshots. Raw symbols use the optional
            local backend.
          </p>
        </div>
        <div class="note-box">
          <p>
            <span class="mono">Sharpe = (CAGR - average risk-free rate) / annualized volatility</span>
          </p>
          <p>
            Sortino replaces total volatility with downside deviation.
          </p>
        </div>
      </div>

      <div class="study-grid">
        <section class="card">
          <form id="risk-study-form" class="card-grid">
            <div class="card-wide">
              <label class="field-label" for="index-query">Index Or Symbol</label>
              <input id="index-query" class="input" type="text" list="index-suggestions" value="Nifty 50" autocomplete="off" spellcheck="false">
              <datalist id="index-suggestions"></datalist>
              <p class="helper">
                Try <span class="mono">Nifty 50</span>, <span class="mono">S&amp;P BSE Sensex</span>, <span class="mono">AAPL</span>, <span class="mono">^NSEI</span>, or <span class="mono">ETH-USD</span>.
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

        <aside class="card">
          <p class="section-label">Data Mode</p>
          <ul class="source-list">
            <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
            <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
            <li>Risk-free reference: <a href="https://data.rbi.org.in" target="_blank" rel="noreferrer">RBI 91-day T-bill data</a>.</li>
          </ul>

          <p class="section-label">Notes</p>
          <p class="helper">
            This study is built for return, risk, and drawdown diagnostics.
            Price-only series can understate long-run quality versus true TRI data.
          </p>
        </aside>
      </div>

      <section id="results-root" class="card">
        <div class="empty-state">
          Run the study to see return, risk, and drawdown metrics.
        </div>
      </section>
    </div>
  `;
}

export { renderResults, renderSelectionDetails, studyTemplate };
