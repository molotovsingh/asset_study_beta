import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import { MIN_CREDIBLE_PERCENTILE_HISTORY } from "../lib/monthlyStraddle.js";
import {
  exportMonthlyStraddleCsv,
  exportMonthlyStraddleXls,
} from "../lib/monthlyStraddleExport.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";

function buildOverviewHash(studyRun) {
  const params = new URLSearchParams({
    subject: studyRun.symbol,
    dte: String(studyRun.minimumDte),
    count: String(studyRun.maxContracts),
  });
  return `#monthly-straddle/overview?${params.toString()}`;
}

function renderIvCurve(studyRun) {
  const contracts = studyRun.contracts.filter(
    (contract) =>
      Number.isFinite(contract.straddleImpliedVolatility) &&
      Number.isFinite(contract.chainImpliedVolatility),
  );
  if (contracts.length < 2) {
    return `
      <section class="visual-card straddle-visual-card">
        <div class="visual-empty">
          <h2>No IV curve yet.</h2>
          <p>At least two monthly contracts need usable IV readings to draw the curve.</p>
        </div>
      </section>
    `;
  }

  const width = 680;
  const height = 320;
  const padding = { top: 24, right: 24, bottom: 40, left: 54 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xStep = contracts.length > 1 ? innerWidth / (contracts.length - 1) : 0;
  const yValues = contracts.flatMap((contract) => [
    contract.straddleImpliedVolatility,
    contract.chainImpliedVolatility,
  ]);
  const yMin = Math.max(0, Math.min(...yValues) * 0.9);
  const yMax = Math.max(...yValues) * 1.08;
  const xScale = (index) => padding.left + index * xStep;
  const yScale = (value) =>
    padding.top +
    (1 - (value - yMin) / (yMax - yMin || 1)) * innerHeight;
  const straddlePath = contracts
    .map((contract, index) => `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(contract.straddleImpliedVolatility)}`)
    .join(" ");
  const chainPath = contracts
    .map((contract, index) => `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(contract.chainImpliedVolatility)}`)
    .join(" ");

  return `
    <section class="visual-card straddle-visual-card straddle-visual-card-wide">
      <div class="visual-card-head">
        <div>
          <p class="section-label">IV Curve</p>
          <p class="summary-meta">Straddle-derived annualized IV versus chain IV across the loaded monthly expiries.</p>
        </div>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly straddle implied volatility curve">
        <line class="chart-grid-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <line class="chart-grid-line" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
        <path class="chart-line straddle-line-primary" d="${straddlePath}" />
        <path class="chart-line straddle-line-secondary" d="${chainPath}" />
        ${contracts
          .map(
            (contract, index) => `
              <circle class="straddle-point-primary" cx="${xScale(index)}" cy="${yScale(contract.straddleImpliedVolatility)}" r="4.5" />
              <circle class="straddle-point-secondary" cx="${xScale(index)}" cy="${yScale(contract.chainImpliedVolatility)}" r="4" />
              <text class="chart-axis-label" x="${xScale(index)}" y="${height - 12}" text-anchor="middle">${contract.daysToExpiry}d</text>
            `,
          )
          .join("")}
        <text class="chart-axis-label" x="${padding.left}" y="${padding.top - 6}">Annualized IV</text>
      </svg>
      <div class="visual-card-foot">
        <span>Green is straddle-derived IV. Amber is chain IV.</span>
        <span>${studyRun.symbol} · ${formatDate(studyRun.asOfDate)}</span>
      </div>
    </section>
  `;
}

function renderMoveBars(studyRun) {
  return `
    <section class="visual-card straddle-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Implied Move</p>
          <p class="summary-meta">ATM straddle premium expressed as a percent move into each monthly expiry.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${studyRun.contracts
          .map((contract) => `
            <div class="seasonality-bar-row is-positive">
              <div class="seasonality-bar-meta">
                <span class="seasonality-bar-label">${contract.expiry}</span>
                <span class="seasonality-bar-value">${formatPercent(contract.impliedMovePercent)} · ${formatNumber(contract.daysToExpiry, 0)}d</span>
              </div>
              <div class="seasonality-bar-track">
                <span class="seasonality-bar-fill straddle-bar-fill" style="width: ${Math.max(contract.impliedMovePercent * 100 * 2.8, 4)}%;"></span>
              </div>
            </div>
          `)
          .join("")}
      </div>
    </section>
  `;
}

function renderLiquidityBars(studyRun) {
  const maxOpenInterest = Math.max(
    ...studyRun.contracts.map((contract) => contract.combinedOpenInterest),
    1,
  );
  return `
    <section class="visual-card straddle-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Liquidity</p>
          <p class="summary-meta">Combined open interest by monthly expiry for the ATM strike selected in each row.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${studyRun.contracts
          .map((contract) => `
            <div class="seasonality-bar-row">
              <div class="seasonality-bar-meta">
                <span class="seasonality-bar-label">${contract.expiry}</span>
                <span class="seasonality-bar-value">${formatNumber(contract.combinedOpenInterest, 0)}</span>
              </div>
              <div class="seasonality-bar-track">
                <span class="seasonality-bar-fill straddle-liquidity-fill" style="width: ${Math.max((contract.combinedOpenInterest / maxOpenInterest) * 100, 4)}%;"></span>
              </div>
            </div>
          `)
          .join("")}
      </div>
    </section>
  `;
}

function renderVolContextBars(studyRun) {
  const focus = studyRun.focusContract;
  const rows = [
    {
      label: "Straddle IV",
      value: focus.straddleImpliedVolatility,
    },
    {
      label: "Chain IV",
      value: focus.chainImpliedVolatility,
    },
    {
      label: "HV20",
      value: focus.historicalVolatility20,
    },
    {
      label: "HV60",
      value: focus.historicalVolatility60,
    },
    {
      label: "HV120",
      value: focus.historicalVolatility120,
    },
  ].filter((row) => Number.isFinite(row.value));

  if (!rows.length) {
    return `
      <section class="visual-card straddle-visual-card">
        <div class="visual-empty">
          <h2>No vol context yet.</h2>
          <p>The current snapshot did not include enough realized-vol history to compare against IV.</p>
        </div>
      </section>
    `;
  }

  const maxValue = Math.max(...rows.map((row) => row.value), 0.01);
  return `
    <section class="visual-card straddle-visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Vol Context</p>
          <p class="summary-meta">Front-contract IV against realized-vol windows for a quick rich-or-cheap read.</p>
        </div>
      </div>
      <div class="seasonality-bar-list">
        ${rows
          .map(
            (row) => `
              <div class="seasonality-bar-row">
                <div class="seasonality-bar-meta">
                  <span class="seasonality-bar-label">${row.label}</span>
                  <span class="seasonality-bar-value">${formatPercent(row.value)}</span>
                </div>
                <div class="seasonality-bar-track">
                  <span class="seasonality-bar-fill straddle-bar-fill" style="width: ${Math.max((row.value / maxValue) * 100, 4)}%;"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderFrontHistory(studyRun) {
  const rows = studyRun.frontHistory.filter(
    (row) =>
      row.asOfDate &&
      (Number.isFinite(row.straddleImpliedVolatility) || Number.isFinite(row.historicalVolatility20)),
  );
  if (rows.length < 2) {
    return `
      <section class="visual-card straddle-visual-card straddle-visual-card-wide">
        <div class="visual-empty">
          <h2>No front history yet.</h2>
          <p>Run and persist more daily snapshots to build IV percentile context and a front-history series.</p>
        </div>
      </section>
    `;
  }

  const width = 680;
  const height = 320;
  const padding = { top: 24, right: 24, bottom: 40, left: 54 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xStep = rows.length > 1 ? innerWidth / (rows.length - 1) : 0;
  const yValues = rows.flatMap((row) => [
    row.straddleImpliedVolatility,
    row.historicalVolatility20,
  ]).filter((value) => Number.isFinite(value));
  const yMin = Math.max(0, Math.min(...yValues) * 0.9);
  const yMax = Math.max(...yValues) * 1.08;
  const xScale = (index) => padding.left + index * xStep;
  const yScale = (value) =>
    padding.top +
    (1 - (value - yMin) / (yMax - yMin || 1)) * innerHeight;
  const straddlePath = rows
    .map((row, index) =>
      Number.isFinite(row.straddleImpliedVolatility)
        ? `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(row.straddleImpliedVolatility)}`
        : ""
    )
    .filter(Boolean)
    .join(" ");
  const hv20Path = rows
    .map((row, index) =>
      Number.isFinite(row.historicalVolatility20)
        ? `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(row.historicalVolatility20)}`
        : ""
    )
    .filter(Boolean)
    .join(" ");
  const lastIndex = rows.length - 1;

  return `
    <section class="visual-card straddle-visual-card straddle-visual-card-wide">
      <div class="visual-card-head">
        <div>
          <p class="section-label">Front History</p>
          <p class="summary-meta">Stored front-month straddle IV versus HV20 across previous snapshot dates.</p>
        </div>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Historical front straddle IV versus HV20">
        <line class="chart-grid-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <line class="chart-grid-line" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
        <path class="chart-line straddle-line-primary" d="${straddlePath}" />
        <path class="chart-line straddle-line-secondary" d="${hv20Path}" />
        <text class="chart-axis-label" x="${padding.left}" y="${padding.top - 6}">Annualized Vol</text>
        <text class="chart-axis-label" x="${padding.left}" y="${height - 12}" text-anchor="start">${formatDate(rows[0].asOfDate)}</text>
        <text class="chart-axis-label" x="${width - padding.right}" y="${height - 12}" text-anchor="end">${formatDate(rows[lastIndex].asOfDate)}</text>
      </svg>
      <div class="visual-card-foot">
        <span>Green is front straddle IV. Amber is HV20.</span>
        <span>${formatNumber(rows.length, 0)} stored snapshots</span>
      </div>
    </section>
  `;
}

function renderVisualsShell(studyRun) {
  const focus = studyRun.focusContract;
  const history = studyRun.historySummary;
  return `
    <div class="visuals-shell straddle-visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">Study 08</p>
          <h2>Monthly Straddle Visuals</h2>
          <p class="summary-meta">
            ${studyRun.symbol} · spot ${formatNumber(studyRun.spotPrice, 2)} ${studyRun.currency || ""} · focus ${focus.expiry}
          </p>
          <p class="summary-meta">
            Front implied move ${formatPercent(focus.impliedMovePercent)} · curve ${studyRun.curveShape}
          </p>
        </div>
        <div class="visuals-actions">
          <a class="study-view-link" href="${buildOverviewHash(studyRun)}">Overview</a>
          <button class="results-export-button" type="button" data-straddle-visual-export="csv">Export CSV</button>
          <button class="results-export-button" type="button" data-straddle-visual-export="xls">Export XLS</button>
        </div>
      </section>

      <div class="visuals-summary-grid">
        <section class="card visuals-summary-card">
          <p class="meta-label">Front Contract</p>
          <strong class="visuals-summary-value">${focus.expiry}</strong>
          <p class="summary-meta">${formatNumber(focus.daysToExpiry, 0)} days to expiry</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Front Move</p>
          <strong class="visuals-summary-value">${formatPercent(focus.impliedMovePercent)}</strong>
          <p class="summary-meta">${studyRun.currency || ""} ${formatNumber(focus.impliedMovePrice, 2)}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Front IV</p>
          <strong class="visuals-summary-value">${formatPercent(focus.straddleImpliedVolatility)}</strong>
          <p class="summary-meta">Chain IV ${formatPercent(focus.chainImpliedVolatility)}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">IV/HV20</p>
          <strong class="visuals-summary-value">${formatNumber(focus.ivHv20Ratio, 2)}</strong>
          <p class="summary-meta">HV20 ${formatPercent(focus.historicalVolatility20)}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">Pricing</p>
          <strong class="visuals-summary-value">${studyRun.focusVolComparison?.label || "n/a"}</strong>
          <p class="summary-meta">${studyRun.focusVolComparison ? `IV/HV${studyRun.focusVolComparison.windowDays}` : "No IV/HV read"}</p>
        </section>
        <section class="card visuals-summary-card">
          <p class="meta-label">${history.hasCrediblePercentiles ? "IV Percentile" : "History Depth"}</p>
          <strong class="visuals-summary-value">${
            history.hasCrediblePercentiles
              ? formatPercent(history.ivPercentile)
              : history.observations > 0
                ? formatNumber(history.observations, 0)
                : "Build"
          }</strong>
          <p class="summary-meta">${
            history.hasCrediblePercentiles
              ? `${formatNumber(history.observations, 0)} stored front snapshots`
              : history.observations > 0
                ? `${formatNumber(history.observations, 0)} of ${formatNumber(MIN_CREDIBLE_PERCENTILE_HISTORY, 0)} stored snapshots before percentile context is shown`
                : "Persist front-month snapshots to unlock percentile context"
          }</p>
        </section>
      </div>

      <div class="visuals-chart-grid straddle-curve-grid">
        ${renderIvCurve(studyRun)}
        ${renderFrontHistory(studyRun)}
        ${renderMoveBars(studyRun)}
        ${renderLiquidityBars(studyRun)}
        ${renderVolContextBars(studyRun)}
      </div>
    </div>
  `;
}

function mountMonthlyStraddleVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    root.innerHTML = `
      <section class="card visual-empty">
        <p class="study-kicker">Visuals Need A Run</p>
        <h2>No monthly straddle snapshot is loaded yet.</h2>
        <p>Run the overview once, then return here for the IV curve, implied move bars, and liquidity view.</p>
        <div class="visuals-actions">
          <a class="study-view-link is-active" href="#monthly-straddle/overview">Go To Overview</a>
        </div>
      </section>
    `;
    return () => {};
  }

  root.innerHTML = renderVisualsShell(studyRun);
  const setStatus = () => {};
  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-straddle-visual-export]",
    datasetKey: "straddleVisualExport",
    getPayload: () => session.lastStudyRun,
    exporters: {
      csv: exportMonthlyStraddleCsv,
      xls: exportMonthlyStraddleXls,
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

export { mountMonthlyStraddleVisuals };
