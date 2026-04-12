import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import { renderInterpretationPanel } from "./shared/interpretation.js";

function formatPrice(value) {
  return Number.isFinite(value) ? formatNumber(value, 2) : "n/a";
}

function formatInteger(value) {
  return Number.isFinite(value) ? formatNumber(value, 0) : "n/a";
}

function renderMetricCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function renderInterpretation(studyRun) {
  const focus = studyRun.focusContract;
  const volComparison = studyRun.focusVolComparison;
  const history = studyRun.historySummary;
  const slopeText =
    studyRun.curveShape === "Upward"
      ? "Longer monthlies are carrying a higher annualized implied-vol read than the front contract."
      : studyRun.curveShape === "Downward"
        ? "Front-month volatility is richer than the later monthly contracts."
        : "The monthly term structure is fairly flat across the loaded expiries.";

  return renderInterpretationPanel({
    title: "Options Read",
    summary:
      "Snapshot of what the current monthly ATM straddle is implying, not a historical volatility forecast.",
    items: [
      {
        label: "Move",
        tone:
          Number.isFinite(focus.impliedMovePercent) && focus.impliedMovePercent >= 0.1
            ? "Large"
            : "Contained",
        toneId:
          Number.isFinite(focus.impliedMovePercent) && focus.impliedMovePercent >= 0.1
            ? "caution"
            : "neutral",
        text: `${studyRun.symbol} is pricing an ATM straddle move of ${formatPrice(focus.impliedMovePrice)} (${formatPercent(focus.impliedMovePercent)}) into ${focus.expiry}.`,
      },
      {
        label: "IV",
        tone:
          Number.isFinite(focus.impliedVolatilityGap) &&
          Math.abs(focus.impliedVolatilityGap) <= 0.02
            ? "Aligned"
            : "Check",
        toneId:
          Number.isFinite(focus.impliedVolatilityGap) &&
          Math.abs(focus.impliedVolatilityGap) <= 0.02
            ? "positive"
            : "neutral",
        text: `Straddle-derived annualized IV is ${formatPercent(focus.straddleImpliedVolatility)} versus chain IV ${formatPercent(focus.chainImpliedVolatility)}.`,
      },
      {
        label: "IV/HV",
        tone: volComparison?.label || "No Read",
        toneId: volComparison?.toneId || "neutral",
        text: volComparison
          ? `Front IV is ${formatPercent(volComparison.historicalVolatility)} on an HV${volComparison.windowDays} basis, putting IV/HV at ${formatNumber(volComparison.ratio, 2)} (${formatPercent(volComparison.spread)} spread).`
          : "Historical-volatility context was not available for the focus expiry.",
      },
      {
        label: "Curve",
        tone: studyRun.curveShape,
        toneId: studyRun.curveShape === "Upward" ? "caution" : "neutral",
        text: slopeText,
      },
      {
        label: "History",
        tone:
          history.observations >= 20
            ? "Usable"
            : history.observations > 1
              ? "Early"
              : "Thin",
        toneId:
          history.observations >= 20
            ? "positive"
            : history.observations > 1
              ? "neutral"
              : "caution",
        text:
          history.observations > 0
            ? `Front IV sits at the ${formatPercent(history.ivPercentile)} percentile and IV/HV20 at the ${formatPercent(history.ivHv20Percentile)} percentile across ${formatInteger(history.observations)} stored front-month snapshots.`
            : "No stored snapshot history is available yet for percentile context.",
      },
      {
        label: "Liquidity",
        tone:
          focus.combinedOpenInterest >= 5000
            ? "Deep"
            : focus.combinedOpenInterest >= 1000
              ? "Usable"
              : "Thin",
        toneId:
          focus.combinedOpenInterest >= 5000
            ? "positive"
            : focus.combinedOpenInterest >= 1000
              ? "neutral"
              : "caution",
        text: `The focus contract has ${formatInteger(focus.combinedOpenInterest)} combined open interest and ${formatInteger(focus.combinedVolume)} combined volume.`,
      },
    ],
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

function renderMonthlyStraddleResults(studyRun) {
  const focus = studyRun.focusContract;

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Monthly Straddle Exports</p>
          <p class="summary-meta">
            Download the loaded monthly contracts and the focus snapshot for ${studyRun.symbol}.
          </p>
        </div>
        <div class="results-export-actions">
          <button class="results-export-button" type="button" data-straddle-export="csv">Export CSV</button>
          <button class="results-export-button" type="button" data-straddle-export="xls">Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Focus Contract</p>
            <p class="summary-meta">
              ATM monthly contract nearest the current spot price with at least ${formatInteger(studyRun.minimumDte)} days to expiry.
            </p>
          </div>
        </div>
        <div class="results-grid">
          ${renderMetricCard({
            label: "Spot Price",
            value: `${studyRun.currency || ""} ${formatPrice(studyRun.spotPrice)}`.trim(),
            detail: studyRun.spotDate ? `Latest close ${formatDate(studyRun.spotDate)}` : "Latest close",
          })}
          ${renderMetricCard({
            label: "Focus Expiry",
            value: focus.expiry,
            detail: `${formatInteger(focus.daysToExpiry)} days to expiry`,
          })}
          ${renderMetricCard({
            label: "ATM Strike",
            value: `${studyRun.currency || ""} ${formatPrice(focus.strike)}`.trim(),
            detail: "Nearest common call/put strike",
          })}
          ${renderMetricCard({
            label: "Straddle Mid",
            value: `${studyRun.currency || ""} ${formatPrice(focus.straddleMidPrice)}`.trim(),
            detail: `Call ${formatPrice(focus.callMidPrice)} + Put ${formatPrice(focus.putMidPrice)}`,
          })}
          ${renderMetricCard({
            label: "Implied Move",
            value: formatPercent(focus.impliedMovePercent),
            detail: `${studyRun.currency || ""} ${formatPrice(focus.impliedMovePrice)}`.trim(),
          })}
          ${renderMetricCard({
            label: "Straddle IV",
            value: formatPercent(focus.straddleImpliedVolatility),
            detail: `Chain IV ${formatPercent(focus.chainImpliedVolatility)}`,
          })}
          ${renderMetricCard({
            label: "HV20",
            value: formatPercent(focus.historicalVolatility20),
            detail: "Annualized realized vol from log returns",
          })}
          ${renderMetricCard({
            label: "HV60",
            value: formatPercent(focus.historicalVolatility60),
            detail: "Medium-window realized vol context",
          })}
          ${renderMetricCard({
            label: "IV/HV20",
            value: formatNumber(focus.ivHv20Ratio, 2),
            detail: `Spread ${formatPercent(focus.ivHv20Spread)}`,
          })}
          ${renderMetricCard({
            label: "IV/HV60",
            value: formatNumber(focus.ivHv60Ratio, 2),
            detail: `Spread ${formatPercent(focus.ivHv60Spread)}`,
          })}
          ${renderMetricCard({
            label: "Pricing",
            value: studyRun.focusVolComparison?.label || "n/a",
            detail: studyRun.focusVolComparison
              ? `Based on IV/HV${studyRun.focusVolComparison.windowDays}`
              : "No usable IV/HV context",
          })}
          ${renderMetricCard({
            label: "IV Percentile",
            value: formatPercent(studyRun.historySummary.ivPercentile),
            detail: `${formatInteger(studyRun.historySummary.observations)} stored front snapshots`,
          })}
          ${renderMetricCard({
            label: "IV/HV20 Pctl",
            value: formatPercent(studyRun.historySummary.ivHv20Percentile),
            detail: studyRun.historySummary.startDate
              ? `${formatDate(studyRun.historySummary.startDate)} onward`
              : "No stored history yet",
          })}
          ${renderMetricCard({
            label: "Combined OI",
            value: formatInteger(focus.combinedOpenInterest),
            detail: `${formatInteger(focus.combinedVolume)} combined volume`,
          })}
        </div>
      </section>

      ${renderInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Monthly Contracts</p>
            <p class="summary-meta">
              Current standard monthlies using bid/ask mids where possible, with holiday-adjusted monthly expiries included.
            </p>
          </div>
        </div>
        <div class="rolling-table-wrap">
          <table class="rolling-table straddle-table">
            <thead>
              <tr>
                <th>Expiry</th>
                <th>DTE</th>
                <th>Strike</th>
                <th>Straddle</th>
                <th>Move %</th>
                <th>Straddle IV</th>
                <th>HV20</th>
                <th>HV60</th>
                <th>IV/HV20</th>
                <th>Chain IV</th>
                <th>IV Gap</th>
                <th>Combined OI</th>
                <th>Pricing</th>
              </tr>
            </thead>
            <tbody>
              ${studyRun.contracts
                .map(
                  (contract, index) => `
                    <tr class="${index === 0 ? "straddle-focus-row" : ""}">
                      <th scope="row">${contract.expiry}</th>
                      <td>${formatInteger(contract.daysToExpiry)}</td>
                      <td>${formatPrice(contract.strike)}</td>
                      <td>${formatPrice(contract.straddleMidPrice)}</td>
                      <td>${formatPercent(contract.impliedMovePercent)}</td>
                      <td>${formatPercent(contract.straddleImpliedVolatility)}</td>
                      <td>${formatPercent(contract.historicalVolatility20)}</td>
                      <td>${formatPercent(contract.historicalVolatility60)}</td>
                      <td>${formatNumber(contract.ivHv20Ratio, 2)}</td>
                      <td>${formatPercent(contract.chainImpliedVolatility)}</td>
                      <td>${formatPercent(contract.impliedVolatilityGap)}</td>
                      <td>${formatInteger(contract.combinedOpenInterest)}</td>
                      <td>${contract.pricingMode}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <div class="result-details">
        <div class="detail-block">
          <h3>Methods</h3>
          <p class="result-detail">
            ATM strike is the nearest common call/put strike to the current spot price.
          </p>
          <p class="result-detail">
            Annualized straddle IV uses the ATM implied move approximation based on the straddle premium and time to expiry.
          </p>
          <p class="result-detail">
            Chain IV is the simple average of the ATM call and put implied-volatility fields returned by ${studyRun.providerName}.
          </p>
          <p class="result-detail">
            Historical volatility uses daily log returns annualized at 252 trading days, with adjusted closes preferred when the provider supplies them.
          </p>
        </div>
        <div class="detail-block">
          <h3>Context</h3>
          <p class="result-detail">Symbol: ${studyRun.symbol}</p>
          <p class="result-detail">Provider: ${studyRun.providerName}</p>
          <p class="result-detail">As of: ${studyRun.asOfDate ? formatDate(studyRun.asOfDate) : "n/a"}</p>
          <p class="result-detail">Curve shape: ${studyRun.curveShape}</p>
          <p class="result-detail">Contracts loaded: ${formatInteger(studyRun.contracts.length)}</p>
          <p class="result-detail">
            Realized-vol source: ${studyRun.realizedVolatility.seriesType === "adj_close" ? "Adjusted close" : "Close"} · ${formatInteger(studyRun.realizedVolatility.observations)} daily closes
          </p>
          <p class="result-detail">
            Stored front-history snapshots: ${formatInteger(studyRun.historySummary.observations)}
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function monthlyStraddleTemplate({
  activeSymbol,
  minimumDteValue,
  contractCountValue,
}) {
  return `
    <div class="card-shell">
      <section class="card intro-card">
        <div>
          <p class="study-kicker">Study 08</p>
          <h2>Monthly Straddle Snapshot</h2>
          <p class="summary-meta">
            Live ATM straddle-implied move, annualized IV, and IV/HV pricing context for the next standard monthly contracts.
          </p>
        </div>
        <div class="panel study-subject-context straddle-symbol-panel">
          <div class="meta-row">
            <p class="meta-label">Active Asset</p>
            <p>${activeSymbol}</p>
          </div>
          <div class="meta-row">
            <p class="meta-label">Study Fit</p>
            <p>Best for optionable US equities and ETFs such as AAPL, TSLA, SPY, or QQQ. Set the symbol from the sidebar.</p>
          </div>
        </div>
        <form id="monthly-straddle-form" class="card-grid straddle-form-grid">
          <label class="field">
            <span class="field-label">Minimum DTE</span>
            <input id="monthly-straddle-min-dte" class="input" type="number" min="7" max="365" step="1" value="${minimumDteValue}">
          </label>
          <label class="field">
            <span class="field-label">Contracts</span>
            <input id="monthly-straddle-contract-count" class="input" type="number" min="1" max="8" step="1" value="${contractCountValue}">
          </label>
          <div class="study-actions straddle-form-actions">
            <button class="button primary" type="submit">Run Snapshot</button>
          </div>
          <p id="monthly-straddle-status" class="status"></p>
        </form>
      </section>

      <section id="monthly-straddle-results-root" class="card results-card">
        <div class="empty-state">
          <h2>No monthly straddle snapshot is loaded yet.</h2>
          <p>Set an optionable symbol in the sidebar, then run the snapshot to compare the next monthly contracts.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#monthly-straddle/overview?subject=AAPL&dte=25&count=4">Try AAPL</a>
            <a class="empty-state-link" href="#monthly-straddle/overview?subject=TSLA&dte=25&count=4">Try TSLA</a>
          </div>
        </div>
      </section>
    </div>
  `;
}

export {
  monthlyStraddleTemplate,
  renderMonthlyStraddleResults,
};
