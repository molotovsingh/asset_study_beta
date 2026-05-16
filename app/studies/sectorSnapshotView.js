import { formatDate, formatDateRange, formatNumber, formatPercent } from "../lib/format.js";
import {
  DEFAULT_FOCUS_HORIZON_YEARS,
  DEFAULT_FOCUS_METRIC_KEY,
  SECTOR_FOCUS_METRIC_DEFINITIONS,
  getMetricDefinition,
  getMetricValue,
  sortRowsByMetric,
} from "../lib/sectorSnapshot.js";
import { renderInterpretationPanel } from "./shared/interpretation.js";
import { renderWarnings } from "./shared/resultsViewShared.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("sector-snapshot");

const STYLE_FORMATTERS = {
  percent: (value) => formatPercent(value),
  number2: (value) => formatNumber(value, 2),
  integer: (value) => formatNumber(value, 0),
};

function formatMetricValue(metricKey, value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  const metric = getMetricDefinition(metricKey);
  const formatter = STYLE_FORMATTERS[metric.styleId] || STYLE_FORMATTERS.number2;
  return formatter(value);
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

function renderMetricCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value sector-result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function countBenchmarkBeaters(rows) {
  return rows.filter(
    (row) =>
      row.available &&
      Number.isFinite(row.relativeMetrics?.cagrSpread) &&
      row.relativeMetrics.cagrSpread > 0,
  ).length;
}

function buildPersistentLeader(studyRun, metricKey) {
  const counts = new Map();
  studyRun.horizonResults.forEach((result) => {
    const leader = sortRowsByMetric(result.availableRows, metricKey)[0] || null;
    if (!leader) {
      return;
    }
    counts.set(leader.label, (counts.get(leader.label) || 0) + 1);
  });

  const ranked = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
  if (!ranked.length) {
    return null;
  }

  return {
    label: ranked[0][0],
    count: ranked[0][1],
  };
}

function renderSnapshotSummary(studyRun) {
  const focusResult = studyRun.focusHorizonResult;
  if (!focusResult?.availableRows?.length) {
    return "";
  }

  const returnLeader = focusResult.leaders.annualizedReturn;
  const sharpeLeader = focusResult.leaders.sharpeRatio;
  const relativeLeader = focusResult.leaders.relativeWealth;
  const drawdownLeader = focusResult.leaders.maxDrawdown;
  const beatCount = countBenchmarkBeaters(focusResult.availableRows);
  const persistentRelativeLeader = buildPersistentLeader(
    studyRun,
    "relativeWealth",
  );
  const breadthTone =
    focusResult.availableCount > 0 &&
    beatCount / focusResult.availableCount >= 0.6
      ? "Broad"
      : beatCount > 0
        ? "Narrow"
        : "Weak";

  return `
    <section class="sector-summary-panel">
      <div class="results-section-head">
        <div>
          <p class="section-label">Snapshot Summary</p>
          <p class="summary-meta">
            Plain-English read of the completed ${focusResult.years}Y cross-section. Use it to orient the table and visuals, not to replace them.
          </p>
        </div>
      </div>
      <div class="sector-summary-grid">
        <article class="sector-summary-item">
          <p class="meta-label">Leader</p>
          <p>
            ${
              relativeLeader
                ? `${relativeLeader.label} is ahead of ${studyRun.benchmark.label} on relative wealth at ${formatMetricValue("relativeWealth", relativeLeader.relativeMetrics.relativeWealth)}.`
                : `No sector has a usable benchmark-relative lead over ${focusResult.years}Y.`
            }
            ${
              returnLeader
                ? ` ${returnLeader.label} also leads absolute CAGR at ${formatMetricValue("annualizedReturn", returnLeader.metrics.annualizedReturn)}.`
                : ""
            }
          </p>
        </article>
        <article class="sector-summary-item">
          <p class="meta-label">Breadth</p>
          <p>
            ${formatNumber(beatCount, 0)} of ${formatNumber(focusResult.availableCount, 0)} available sectors beat ${studyRun.benchmark.label} on CAGR spread in the ${focusResult.years}Y window.
            ${breadthTone === "Broad" ? "Leadership is broad rather than concentrated." : breadthTone === "Narrow" ? "Leadership is selective, so benchmark-relative winners are not widespread." : "The benchmark held up better than the sector basket in this window."}
          </p>
        </article>
        <article class="sector-summary-item">
          <p class="meta-label">Persistence</p>
          <p>
            ${
              persistentRelativeLeader
                ? `${persistentRelativeLeader.label} leads relative wealth in ${formatNumber(persistentRelativeLeader.count, 0)} of ${formatNumber(studyRun.horizonResults.length, 0)} configured horizons.`
                : "No persistent benchmark-relative leader is available across the configured horizons."
            }
            This helps separate one-window strength from repeat leadership.
          </p>
        </article>
        <article class="sector-summary-item">
          <p class="meta-label">Risk Context</p>
          <p>
            ${
              sharpeLeader
                ? `${sharpeLeader.label} is the most efficient sector on Sharpe at ${formatMetricValue("sharpeRatio", sharpeLeader.metrics.sharpeRatio)}.`
                : "No Sharpe leader is available."
            }
            ${
              drawdownLeader
                ? ` ${drawdownLeader.label} had the shallowest max drawdown at ${formatMetricValue("maxDrawdown", drawdownLeader.metrics.maxDrawdown)}.`
                : ""
            }
          </p>
        </article>
      </div>
    </section>
  `;
}

function renderProviderSummary(studyRun) {
  return studyRun.providerSummary
    .map((entry) => `${entry.providerName} (${formatNumber(entry.count, 0)})`)
    .join(" · ");
}

function renderMarketPresetInfo(market) {
  return `
    <div class="sector-preset-context">
      <div>
        <p class="section-label">Preset Universe</p>
        <p class="summary-meta">
          ${market.note}
        </p>
        <p class="summary-meta">
          This study ignores the sidebar active asset and loads its own benchmark plus sector basket.
        </p>
      </div>
      <div class="sector-preset-pill-grid">
        ${market.sectors
          .map(
            (sector) => `
              <span class="sector-preset-pill">${sector.label}</span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function buildLeadershipSpread(focusRows, metricKey) {
  if (focusRows.length < 2) {
    return null;
  }

  const bestValue = getMetricValue(focusRows[0], metricKey);
  const worstValue = getMetricValue(focusRows[focusRows.length - 1], metricKey);
  if (!Number.isFinite(bestValue) || !Number.isFinite(worstValue)) {
    return null;
  }

  return bestValue - worstValue;
}

function renderSectorSnapshotInterpretation(studyRun) {
  const focusResult = studyRun.focusHorizonResult;
  if (!focusResult?.availableRows?.length) {
    return "";
  }

  const returnLeader = focusResult.leaders.annualizedReturn;
  const sharpeLeader = focusResult.leaders.sharpeRatio;
  const relativeLeader = focusResult.leaders.relativeWealth;
  const drawdownLeader = focusResult.leaders.maxDrawdown;
  const cagrSpread = buildLeadershipSpread(
    sortRowsByMetric(focusResult.availableRows, "annualizedReturn"),
    "annualizedReturn",
  );

  return renderInterpretationPanel({
    title: "Cross-Section Read",
    summary:
      "The focus horizon is a same-end-date sector snapshot, not a forecast. Read leaders, spread, and benchmark-relative context together.",
    items: [
      {
        label: "Return Leader",
        tone: returnLeader ? "Leading" : "No Read",
        toneId: returnLeader ? "positive" : "neutral",
        text: returnLeader
          ? `${returnLeader.label} leads ${focusResult.years}Y CAGR at ${formatMetricValue("annualizedReturn", returnLeader.metrics.annualizedReturn)}.`
          : "No return leader is available.",
      },
      {
        label: "Risk-Adjusted",
        tone: sharpeLeader ? "Efficient" : "No Read",
        toneId: sharpeLeader ? "positive" : "neutral",
        text: sharpeLeader
          ? `${sharpeLeader.label} has the strongest ${focusResult.years}Y Sharpe at ${formatMetricValue("sharpeRatio", sharpeLeader.metrics.sharpeRatio)} using the configured risk-free rate.`
          : "No risk-adjusted leader is available.",
      },
      {
        label: "Relative",
        tone: relativeLeader ? "Ahead" : "No Read",
        toneId: relativeLeader ? "positive" : "neutral",
        text: relativeLeader
          ? `${relativeLeader.label} leads relative wealth versus ${studyRun.benchmark.label} at ${formatMetricValue("relativeWealth", relativeLeader.relativeMetrics.relativeWealth)} over ${focusResult.years}Y.`
          : "No benchmark-relative leader is available.",
      },
      {
        label: "Spread",
        tone: Number.isFinite(cagrSpread) && cagrSpread >= 0.08 ? "Wide" : "Tighter",
        toneId:
          Number.isFinite(cagrSpread) && cagrSpread >= 0.08 ? "positive" : "neutral",
        text: Number.isFinite(cagrSpread)
          ? `The leader-to-laggard CAGR spread is ${formatPercent(cagrSpread)} in the ${focusResult.years}Y cross-section.`
          : "No spread read is available for the focus horizon.",
      },
      {
        label: "Coverage",
        tone:
          focusResult.availableCount === studyRun.market.sectors.length
            ? "Complete"
            : "Partial",
        toneId:
          focusResult.availableCount === studyRun.market.sectors.length
            ? "positive"
            : "caution",
        text: `${formatNumber(focusResult.availableCount, 0)} of ${formatNumber(studyRun.market.sectors.length, 0)} sectors are available in the ${focusResult.years}Y window.`,
      },
      {
        label: "Drawdown",
        tone: drawdownLeader ? "Resilient" : "No Read",
        toneId: drawdownLeader ? "neutral" : "neutral",
        text: drawdownLeader
          ? `${drawdownLeader.label} had the shallowest max drawdown at ${formatMetricValue("maxDrawdown", drawdownLeader.metrics.maxDrawdown)}.`
          : "No drawdown read is available.",
      },
    ],
  });
}

function renderHeatmap(title, copy, market, horizonResults, metricKey) {
  const rowsBySector = market.sectors.map((sector) => {
    const values = horizonResults.map((horizonResult) =>
      horizonResult.rows.find((row) => row.id === sector.id) || null,
    );
    return { sector, values };
  });

  return `
    <section class="results-section">
      <div class="results-section-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${copy}</p>
        </div>
      </div>
      <div class="sector-heatmap-card">
        <div class="sector-heatmap-grid">
          <div class="sector-heatmap-corner"></div>
          ${horizonResults
            .map(
              (horizonResult) => `
                <div class="sector-heatmap-axis">${horizonResult.years}Y</div>
              `,
            )
            .join("")}
          ${rowsBySector
            .map(({ sector, values }) => {
              const cells = values
                .map((row, horizonIndex) => {
                  const value = getMetricValue(row, metricKey);
                  const unavailableReason = row?.reason || "No trailing window";
                  const horizonValues = horizonResults[horizonIndex].rows
                    .map((peerRow) => getMetricValue(peerRow, metricKey))
                    .filter(Number.isFinite);
                  const tone = buildHeatTone(metricKey, horizonValues, value);
                  return `
                    <div
                      class="sector-heatmap-cell${Number.isFinite(value) ? "" : " is-empty"}"
                      style="${tone}"
                      title="${row?.label || sector.label}: ${
                        Number.isFinite(value)
                          ? formatMetricValue(metricKey, value)
                          : unavailableReason
                      }"
                    >
                      ${Number.isFinite(value) ? formatMetricValue(metricKey, value) : "n/a"}
                    </div>
                  `;
                })
                .join("");

              return `
                <div class="sector-heatmap-axis sector-heatmap-sector">${sector.label}</div>
                ${cells}
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderFocusTable(studyRun) {
  const focusResult = studyRun.focusHorizonResult;
  if (!focusResult) {
    return "";
  }

  const sortedRows = sortRowsByMetric(focusResult.rows, studyRun.focusMetricKey);

  return `
    <section class="results-section">
      <div class="results-section-head">
        <div>
          <p class="section-label">Focus Horizon Table</p>
          <p class="summary-meta">
            Sorted by ${getMetricDefinition(studyRun.focusMetricKey).label} for the ${focusResult.years}Y snapshot.
          </p>
        </div>
      </div>
      <div class="rolling-table-wrap">
        <table class="rolling-table sector-focus-table">
          <thead>
            <tr>
              <th>Sector</th>
              <th>Provider</th>
              <th>CAGR</th>
              <th>Volatility</th>
              <th>Max Drawdown</th>
              <th>Sharpe</th>
              <th>Calmar</th>
              <th>CAGR Spread</th>
              <th>Relative Wealth</th>
              <th>Tracking Error</th>
              <th>Info Ratio</th>
            </tr>
          </thead>
          <tbody>
            ${sortedRows
              .map((row, index) => {
                if (!row.available) {
                  return `
                    <tr class="is-unavailable">
                      <th scope="row">${row.label}</th>
                      <td>${row.providerName}</td>
                      <td colspan="9">${row.reason}</td>
                    </tr>
                  `;
                }

                return `
                  <tr class="${index === 0 ? "sector-focus-top-row" : ""}">
                    <th scope="row">${row.label}</th>
                    <td>${row.providerName}</td>
                    <td>${formatMetricValue("annualizedReturn", row.metrics.annualizedReturn)}</td>
                    <td>${formatMetricValue("annualizedVolatility", row.metrics.annualizedVolatility)}</td>
                    <td>${formatMetricValue("maxDrawdown", row.metrics.maxDrawdown)}</td>
                    <td>${formatMetricValue("sharpeRatio", row.metrics.sharpeRatio)}</td>
                    <td>${formatMetricValue("calmarRatio", row.metrics.calmarRatio)}</td>
                    <td>${formatMetricValue("cagrSpread", row.relativeMetrics.cagrSpread)}</td>
                    <td>${formatMetricValue("relativeWealth", row.relativeMetrics.relativeWealth)}</td>
                    <td>${formatMetricValue("trackingError", row.relativeMetrics.trackingError)}</td>
                    <td>${formatMetricValue("informationRatio", row.relativeMetrics.informationRatio)}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSectorSnapshotResults(studyRun) {
  const focusResult = studyRun.focusHorizonResult;
  const leaders = focusResult?.leaders || {};

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Sector Snapshot Exports</p>
          <p class="summary-meta">
            Download the focus table and all horizon rows for the current market preset.
          </p>
        </div>
        <div class="results-export-actions">
          <button class="results-export-button" type="button" data-sector-export="csv">Export CSV</button>
          <button class="results-export-button" type="button" data-sector-export="xls">Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Snapshot Leaders</p>
            <p class="summary-meta">
              ${studyRun.market.label} sector cross-section as of ${formatDate(studyRun.commonEndDate)} with ${studyRun.benchmark.label} as the benchmark.
            </p>
          </div>
        </div>
        <div class="results-grid relative-results-grid sector-leader-grid">
          ${renderMetricCard({
            label: "Best CAGR",
            value: leaders.annualizedReturn
              ? leaders.annualizedReturn.label
              : "n/a",
            detail: leaders.annualizedReturn
              ? `${formatMetricValue("annualizedReturn", leaders.annualizedReturn.metrics.annualizedReturn)} over ${focusResult.years}Y`
              : "No available horizon row",
          })}
          ${renderMetricCard({
            label: "Best Sharpe",
            value: leaders.sharpeRatio ? leaders.sharpeRatio.label : "n/a",
            detail: leaders.sharpeRatio
              ? `${formatMetricValue("sharpeRatio", leaders.sharpeRatio.metrics.sharpeRatio)} over ${focusResult.years}Y`
              : "No available horizon row",
          })}
          ${renderMetricCard({
            label: "Best Relative Wealth",
            value: leaders.relativeWealth ? leaders.relativeWealth.label : "n/a",
            detail: leaders.relativeWealth
              ? `${formatMetricValue("relativeWealth", leaders.relativeWealth.relativeMetrics.relativeWealth)} versus ${studyRun.benchmark.label}`
              : "No benchmark-relative leader",
          })}
          ${renderMetricCard({
            label: "Shallowest Drawdown",
            value: leaders.maxDrawdown ? leaders.maxDrawdown.label : "n/a",
            detail: leaders.maxDrawdown
              ? `${formatMetricValue("maxDrawdown", leaders.maxDrawdown.metrics.maxDrawdown)} max drawdown`
              : "No drawdown leader",
          })}
          ${renderMetricCard({
            label: "Available Sectors",
            value: `${formatNumber(focusResult.availableCount, 0)} / ${formatNumber(studyRun.market.sectors.length, 0)}`,
            detail: `${focusResult.years}Y trailing window with same end date`,
          })}
          ${renderMetricCard({
            label: "Provider Mix",
            value: studyRun.providerSummary[0]?.providerName || "n/a",
            detail: renderProviderSummary(studyRun),
          })}
        </div>
      </section>

      ${renderSnapshotSummary(studyRun)}

      ${renderSectorSnapshotInterpretation(studyRun)}

      ${renderHeatmap(
        "Absolute CAGR Heatmap",
        "Each cell is a trailing CAGR for the same market end date. Green cells lead their peers; amber cells lag.",
        studyRun.market,
        studyRun.horizonResults,
        "annualizedReturn",
      )}

      ${renderHeatmap(
        "Relative Wealth Heatmap",
        `Each cell shows ending wealth spread versus ${studyRun.benchmark.label} over the same trailing window.`,
        studyRun.market,
        studyRun.horizonResults,
        "relativeWealth",
      )}

      ${renderFocusTable(studyRun)}

      <div class="result-details">
        <div class="detail-block">
          <h3>Study Context</h3>
          <p class="result-detail">Market: ${studyRun.market.label}</p>
          <p class="result-detail">Universe: ${studyRun.market.universeLabel}</p>
          <p class="result-detail">Benchmark: ${studyRun.benchmark.label} (${studyRun.benchmark.symbol})</p>
          <p class="result-detail">Shared end date: ${formatDate(studyRun.commonEndDate)}</p>
          <p class="result-detail">Focus horizon: ${formatNumber(studyRun.focusHorizonYears, 0)}Y</p>
          <p class="result-detail">Risk-free rate: ${formatPercent(studyRun.riskFreeRate)}</p>
        </div>
        <div class="detail-block">
          <h3>Methods</h3>
          <p class="result-detail">
            Relative metrics are benchmarked against ${studyRun.benchmark.label} using aligned daily log returns.
          </p>
          <p class="result-detail">
            Horizons use a shared end date and trailing windows of 1Y, 5Y, 10Y, and 20Y where coverage allows.
          </p>
          <p class="result-detail">
            Provider mix: ${renderProviderSummary(studyRun)}.
          </p>
          <p class="result-detail">
            ${studyRun.market.note}
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function sectorSnapshotTemplate({
  market,
  focusMetricKey = DEFAULT_FOCUS_METRIC_KEY,
  focusHorizonYears = DEFAULT_FOCUS_HORIZON_YEARS,
  riskFreeRateValue,
}) {
  return `
    <div class="card-shell">
      <section class="card intro-card">
        <div>
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Sector Snapshot</h2>
          <p class="summary-meta">
            Same-end-date sector comparison across 1Y, 5Y, 10Y, and 20Y trailing windows.
          </p>
        </div>
        <form id="sector-snapshot-form" class="card-grid sector-form-grid">
          <label class="field">
            <span class="field-label">Market</span>
            <select id="sector-market" class="input">
              <option value="india"${market.id === "india" ? " selected" : ""}>India</option>
              <option value="usa"${market.id === "usa" ? " selected" : ""}>USA</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Focus Horizon</span>
            <select id="sector-focus-horizon" class="input">
              <option value="1"${Number(focusHorizonYears) === 1 ? " selected" : ""}>1Y</option>
              <option value="5"${Number(focusHorizonYears) === 5 ? " selected" : ""}>5Y</option>
              <option value="10"${Number(focusHorizonYears) === 10 ? " selected" : ""}>10Y</option>
              <option value="20"${Number(focusHorizonYears) === 20 ? " selected" : ""}>20Y</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Focus Metric</span>
            <select id="sector-focus-metric" class="input">
              ${SECTOR_FOCUS_METRIC_DEFINITIONS.map(
                (metric) => `
                  <option value="${metric.key}"${metric.key === focusMetricKey ? " selected" : ""}>${metric.label}</option>
                `,
              ).join("")}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Risk-Free Rate %</span>
            <input id="sector-risk-free-rate" class="input" type="number" step="0.01" value="${riskFreeRateValue}">
          </label>
          <div class="study-actions sector-form-actions">
            <button class="button primary" type="submit">Run Snapshot</button>
          </div>
          <p id="sector-snapshot-status" class="status"></p>
        </form>
      </section>

      <section class="card results-card">
        <div id="sector-preset-context-root">
          ${renderMarketPresetInfo(market)}
        </div>
      </section>

      <section id="sector-snapshot-results-root" class="card results-card">
        <div class="empty-state">
          <h2>No sector snapshot is loaded yet.</h2>
          <p>
            Run the preset market universe to compare sector leaders, laggards, and benchmark-relative spreads.
          </p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#sector-snapshot/overview?market=india&h=5&metric=relativeWealth&rf=6.00">Try India 5Y relative snapshot</a>
            <a class="empty-state-link" href="#sector-snapshot/overview?market=usa&h=5&metric=relativeWealth&rf=4.00">Try USA 5Y relative snapshot</a>
          </div>
        </div>
      </section>
    </div>
  `;
}

export {
  renderMarketPresetInfo,
  renderSectorSnapshotResults,
  sectorSnapshotTemplate,
};
