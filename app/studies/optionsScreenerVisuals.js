import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import {
  exportOptionsScreenerCsv,
  exportOptionsScreenerXls,
} from "../lib/optionsScreenerExport.js";
import { getSortDefinition } from "../lib/optionsScreener.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import { buildStudyViewHash } from "./studyShell.js";

function buildOverviewHash(studyRun) {
  return buildStudyViewHash("options-screener", "overview", {
    u: studyRun.universe.id,
    bias: studyRun.bias,
    advice: studyRun.candidateFilter,
    preset: studyRun.presetId,
    sort: studyRun.sortKey,
    dte: studyRun.minimumDte,
  });
}

function buildEmptyOverviewHash(session) {
  return buildStudyViewHash("options-screener", "overview", {
    u: session.universeId,
    bias: session.bias,
    advice: session.candidateFilter,
    preset: session.presetId,
    sort: session.sortKey,
    dte: session.minimumDteValue,
  });
}

function renderPricingMix(studyRun) {
  const buckets = [
    {
      label: "Rich",
      value: studyRun.richCount,
      fillClass: "options-screener-fill-rich",
    },
    {
      label: "Cheap",
      value: studyRun.cheapCount,
      fillClass: "options-screener-fill-cheap",
    },
    {
      label: "Fair",
      value: studyRun.rows.filter((row) => row.pricingBucket === "fair").length,
      fillClass: "options-screener-fill-fair",
    },
    {
      label: "No Read",
      value: studyRun.rows.filter((row) => row.pricingBucket === "none").length,
      fillClass: "options-screener-fill-none",
    },
  ];
  const maxValue = Math.max(...buckets.map((entry) => entry.value), 1);

  return `
    <section class="visual-card options-screener-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Pricing Mix</p>
          <p class="summary-meta">Current rich/fair/cheap split across the loaded universe.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${buckets
          .map(
            (entry) => `
              <div class="seasonality-bar-row">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${entry.label}</span>
                  <span class="seasonality-bar-value">${formatNumber(entry.value, 0)}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill ${entry.fillClass}" style="width: ${Math.max((entry.value / maxValue) * 100, 4)}%;"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderDirectionMix(studyRun) {
  const buckets = [
    {
      label: "Long Bias",
      value: studyRun.rows.filter((row) => row.directionBucket === "long").length,
      fillClass: "options-screener-fill-cheap",
    },
    {
      label: "Neutral",
      value: studyRun.rows.filter((row) => row.directionBucket === "neutral").length,
      fillClass: "options-screener-fill-fair",
    },
    {
      label: "Short Bias",
      value: studyRun.rows.filter((row) => row.directionBucket === "short").length,
      fillClass: "options-screener-fill-rich",
    },
    {
      label: "No Read",
      value: studyRun.rows.filter((row) => row.directionBucket === "none").length,
      fillClass: "options-screener-fill-none",
    },
  ];
  const maxValue = Math.max(...buckets.map((entry) => entry.value), 1);

  return `
    <section class="visual-card options-screener-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Direction Mix</p>
          <p class="summary-meta">Trend plus current-calendar-month seasonality across the loaded universe.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${buckets
          .map(
            (entry) => `
              <div class="seasonality-bar-row">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${entry.label}</span>
                  <span class="seasonality-bar-value">${formatNumber(entry.value, 0)}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill ${entry.fillClass}" style="width: ${Math.max((entry.value / maxValue) * 100, 4)}%;"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderTradeIdeaMix(studyRun) {
  const buckets = [
    {
      label: "Long Calendar",
      value: Number(studyRun.presetCounts?.["long-calendar"]) || 0,
      fillClass: "options-screener-fill-cheap",
    },
    {
      label: "Sell Vega",
      value: Number(studyRun.presetCounts?.["sell-vega"]) || 0,
      fillClass: "options-screener-fill-rich",
    },
    {
      label: "Buy Gamma/Vega",
      value: Number(studyRun.presetCounts?.["buy-gamma-vega"]) || 0,
      fillClass: "options-screener-fill-fair",
    },
    {
      label: "Short Calendar",
      value: Number(studyRun.presetCounts?.["short-calendar"]) || 0,
      fillClass: "options-screener-fill-none",
    },
  ];
  const maxValue = Math.max(...buckets.map((entry) => entry.value), 1);

  return `
    <section class="visual-card options-screener-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Trade Ideas</p>
          <p class="summary-meta">Preset hits across the currently loaded universe.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${buckets
          .map(
            (entry) => `
              <div class="seasonality-bar-row">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${entry.label}</span>
                  <span class="seasonality-bar-value">${formatNumber(entry.value, 0)}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill ${entry.fillClass}" style="width: ${Math.max((entry.value / maxValue) * 100, 4)}%;"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLeaderboard(title, summary, rows, mode) {
  if (!rows.length) {
    return `
      <section class="visual-card options-screener-visual-card">
        <div class="visual-empty">
          <h2>${title}</h2>
          <p>${summary}</p>
        </div>
      </section>
    `;
  }

  const maxRatio = Math.max(
    ...rows.map((row) =>
      Number.isFinite(row.ivHv20Ratio) ? Math.abs(row.ivHv20Ratio) : 0,
    ),
    0.01,
  );
  return `
    <section class="visual-card options-screener-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${rows
          .map(
            (row) => `
              <div class="seasonality-bar-row">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${row.symbol}</span>
                  <span class="seasonality-bar-value">${formatNumber(row.ivHv20Ratio, 2)} · ${formatPercent(row.straddleImpliedVolatility)}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill ${
                    mode === "cheap"
                      ? "options-screener-fill-cheap"
                      : "options-screener-fill-rich"
                  }" style="width: ${Math.max((Math.abs(row.ivHv20Ratio) / maxRatio) * 100, 4)}%;"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLiquidityView(studyRun) {
  const rows = [...studyRun.rows]
    .filter((row) => Number.isFinite(row.combinedOpenInterest))
    .sort((left, right) => right.combinedOpenInterest - left.combinedOpenInterest)
    .slice(0, 6);
  if (!rows.length) {
    return `
      <section class="visual-card options-screener-visual-card">
        <div class="visual-empty">
          <h2>No liquidity view yet.</h2>
          <p>The current screener run did not return usable open-interest readings.</p>
        </div>
      </section>
    `;
  }

  const maxOpenInterest = Math.max(...rows.map((row) => row.combinedOpenInterest), 1);
  return `
    <section class="visual-card options-screener-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Liquidity Check</p>
          <p class="summary-meta">Top open-interest rows for the currently loaded universe.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${rows
          .map(
            (row) => `
              <div class="seasonality-bar-row">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${row.symbol}</span>
                  <span class="seasonality-bar-value">${formatNumber(row.combinedOpenInterest, 0)} · ${row.spreadQuality}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill options-screener-fill-fair" style="width: ${Math.max((row.combinedOpenInterest / maxOpenInterest) * 100, 4)}%;"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderVisualsShell(studyRun) {
  const sortDefinition = getSortDefinition(studyRun.sortKey);
  const richRows = [...studyRun.rows]
    .filter((row) => row.pricingBucket === "rich")
    .sort((left, right) => right.ivHv20Ratio - left.ivHv20Ratio)
    .slice(0, 5);
  const cheapRows = [...studyRun.rows]
    .filter((row) => row.pricingBucket === "cheap")
    .sort((left, right) => left.ivHv20Ratio - right.ivHv20Ratio)
    .slice(0, 5);

  return `
    <div class="visuals-shell options-screener-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">Study 10</p>
          <h2>Options Screener Visuals</h2>
          <p class="summary-meta">
            ${studyRun.universe.label} · ${formatNumber(studyRun.rows.length, 0)} loaded rows · ${studyRun.asOfDate ? formatDate(studyRun.asOfDate) : "n/a"}
          </p>
          <p class="summary-meta">
            Bias ${studyRun.bias} · candidate ${studyRun.candidateFilter} · preset ${studyRun.presetDefinition?.label || "All Presets"} · sort ${sortDefinition.label} · front monthly only · ${studyRun.storage ? `archive #${studyRun.storage.runId}` : "archive unavailable"}
          </p>
        </div>
        <div class="visuals-actions">
          <a class="study-view-link" href="${buildOverviewHash(studyRun)}">Overview</a>
          <button class="results-export-button" type="button" data-options-screener-visual-export="csv">Export CSV</button>
          <button class="results-export-button" type="button" data-options-screener-visual-export="xls">Export XLS</button>
        </div>
      </section>

      <div class="visuals-summary-grid options-screener-visual-summary-grid">
        <section class="card visuals-summary-card">
          <p class="meta-label">Rows Loaded</p>
          <strong class="visuals-summary-value">${formatNumber(studyRun.rows.length, 0)}</strong>
          <p class="summary-meta">${formatNumber(studyRun.failures.length, 0)} failures</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Preset Hits</p>
          <strong class="visuals-summary-value">${formatNumber(
            Object.values(studyRun.presetCounts || {}).reduce(
              (sum, value) => sum + (Number(value) || 0),
              0,
            ),
            0,
          )}</strong>
          <p class="summary-meta">${studyRun.presetDefinition?.label || "All Presets"} filter</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Top Direction</p>
          <strong class="visuals-summary-value">${studyRun.topDirectionRow?.symbol || "n/a"}</strong>
          <p class="summary-meta">${studyRun.topDirectionRow ? `${studyRun.topDirectionRow.directionLabel} · ${formatNumber(studyRun.topDirectionRow.directionScore, 0)}` : "No direction leader"}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Rich Reads</p>
          <strong class="visuals-summary-value">${formatNumber(studyRun.richCount, 0)}</strong>
          <p class="summary-meta">${studyRun.topRichRow ? `${studyRun.topRichRow.symbol} leads` : "No rich leader"}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Cheap Reads</p>
          <strong class="visuals-summary-value">${formatNumber(studyRun.cheapCount, 0)}</strong>
          <p class="summary-meta">${studyRun.topCheapRow ? `${studyRun.topCheapRow.symbol} leads` : "No cheap leader"}</p>
        </section>
      </div>

      <div class="visuals-chart-grid options-screener-visual-grid">
        ${renderPricingMix(studyRun)}
        ${renderDirectionMix(studyRun)}
        ${renderTradeIdeaMix(studyRun)}
        ${renderLeaderboard(
          "Top Rich",
          "Highest IV/HV20 rows in the current run. These are candidates for review, not auto-trades.",
          richRows,
          "rich",
        )}
        ${renderLeaderboard(
          "Top Cheap",
          "Lowest IV/HV20 rows in the current run. These are the cheapest current front-month reads.",
          cheapRows,
          "cheap",
        )}
        ${renderLiquidityView(studyRun)}
      </div>
    </div>
  `;
}

function mountOptionsScreenerVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    root.innerHTML = `
      <section class="card visual-empty">
        <p class="study-kicker">Visuals Need A Run</p>
        <h2>No options screener run is loaded yet.</h2>
        <p>Run the overview once, then return here for the pricing mix and rich-versus-cheap leaderboard view.</p>
        <div class="visuals-actions">
          <a class="study-view-link is-active" href="${buildEmptyOverviewHash(session)}">Go To Overview</a>
        </div>
      </section>
    `;
    return () => {};
  }

  root.innerHTML = renderVisualsShell(studyRun);
  const setStatus = () => {};
  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-options-screener-visual-export]",
    datasetKey: "optionsScreenerVisualExport",
    getPayload: () => session.lastStudyRun,
    exporters: {
      csv: exportOptionsScreenerCsv,
      xls: exportOptionsScreenerXls,
    },
    setStatus,
  });
  const handleClick = (event) => {
    handleExportClick(event);
  };
  root.addEventListener("click", handleClick);
  return () => {
    root.removeEventListener("click", handleClick);
  };
}

export { mountOptionsScreenerVisuals };
