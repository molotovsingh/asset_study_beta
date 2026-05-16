import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import { renderInterpretationPanel } from "./shared/interpretation.js";
import {
  DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
  DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS,
  OPTIONS_VALIDATION_GROUP_DEFINITIONS,
  OPTIONS_VALIDATION_HORIZON_DEFINITIONS,
} from "../lib/optionsValidation.js";

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
  const comparisonText = studyRun.primaryComparison
    ? `${studyRun.primaryComparison.leftLabel} averages ${formatPercent(studyRun.primaryComparison.leftReturn)} versus ${studyRun.primaryComparison.rightLabel} at ${formatPercent(studyRun.primaryComparison.rightReturn)}. The current spread is ${formatPercent(studyRun.primaryComparison.spread)} in favor of ${studyRun.primaryComparison.leaderLabel}.`
    : "The selected grouping does not yet have both comparison buckets populated.";
  return renderInterpretationPanel({
    title: "Validation Read",
    summary:
      "This page measures what archived screener rows did next in the underlying, grouped by the evidence bucket you choose.",
    items: [
      {
        label: "Coverage",
        tone: studyRun.sampleQualityLabel,
        toneId: studyRun.sampleQualityToneId,
        text: `${formatNumber(studyRun.maturedCount, 0)} matured observations and ${formatNumber(studyRun.pendingCount, 0)} pending rows are available for ${studyRun.horizonLabel} validation. ${studyRun.sampleQualityNote}`,
      },
      {
        label: "Best Group",
        tone: studyRun.bestGroup?.label || "n/a",
        toneId:
          Number.isFinite(studyRun.bestGroup?.averageForwardReturn) &&
          studyRun.bestGroup.averageForwardReturn > 0
            ? "positive"
            : "neutral",
        text: studyRun.bestGroup
          ? `${studyRun.bestGroup.label} has the strongest average forward return at ${formatPercent(studyRun.bestGroup.averageForwardReturn)} across ${formatNumber(studyRun.bestGroup.count, 0)} matured rows.`
          : "No matured group has enough data yet.",
      },
      {
        label: "Weakest Group",
        tone: studyRun.weakestGroup?.label || "n/a",
        toneId:
          Number.isFinite(studyRun.weakestGroup?.averageForwardReturn) &&
          studyRun.weakestGroup.averageForwardReturn < 0
            ? "caution"
            : "neutral",
        text: studyRun.weakestGroup
          ? `${studyRun.weakestGroup.label} is weakest at ${formatPercent(studyRun.weakestGroup.averageForwardReturn)} on average.`
          : "No matured group has enough data yet.",
      },
      {
        label: "Signal Spread",
        tone: studyRun.primaryComparison?.leaderLabel || "n/a",
        toneId:
          Number.isFinite(studyRun.primaryComparison?.spread) &&
          studyRun.primaryComparison.spread > 0
            ? "positive"
            : "neutral",
        text: comparisonText,
      },
      {
        label: "Scope",
        tone: studyRun.groupDefinition.label,
        toneId: "neutral",
        text: `Validation is currently grouped by ${studyRun.groupDefinition.label.toLowerCase()} using archived screener rows from ${studyRun.universe.label}.`,
      },
    ],
  });
}

function renderPendingBlock(studyRun) {
  if (!studyRun.pendingObservations.length) {
    return "";
  }
  const pendingRows = studyRun.pendingObservations.slice(0, 8);
  return `
    <div class="detail-block">
      <h3>Pending Rows</h3>
      <p class="summary-meta">These archived rows have not reached the ${studyRun.horizonLabel} forward horizon yet.</p>
      <ul class="warning-list">
        ${pendingRows
          .map(
            (row) => `
              <li><strong>${row.symbol}</strong>: ${row.availableTradingDays} trading days elapsed${row.duplicateCount > 1 ? ` · ${formatNumber(row.duplicateCount, 0)} reruns collapsed` : ""}${row.reason ? ` · ${row.reason}` : ""}</li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderOptionsValidationResults(studyRun) {
  const groupsMarkup = studyRun.groupedResults.length
    ? `
        <div class="rolling-table-wrap">
          <table class="rolling-table options-validation-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Count</th>
                <th>Avg Fwd Return</th>
                <th>Median</th>
                <th>Win Rate</th>
                <th>Avg Abs Move</th>
                <th>Avg Move Edge</th>
                <th>Beat Implied</th>
                <th>Avg IV/HV20</th>
                <th>Avg Direction</th>
                <th>Latest As Of</th>
              </tr>
            </thead>
            <tbody>
              ${studyRun.groupedResults
                .map(
                  (group) => `
                    <tr>
                      <th scope="row">${group.label}</th>
                      <td>${formatNumber(group.count, 0)}</td>
                      <td>${formatPercent(group.averageForwardReturn)}</td>
                      <td>${formatPercent(group.medianForwardReturn)}</td>
                      <td>${formatPercent(group.winRate)}</td>
                      <td>${formatPercent(group.averageAbsoluteMove)}</td>
                      <td>${formatPercent(group.averageMoveEdge)}</td>
                      <td>${formatPercent(group.beatImpliedRate)}</td>
                      <td>${formatNumber(group.averageIvHv20Ratio, 2)}</td>
                      <td>${formatNumber(group.averageDirectionScore, 0)}</td>
                      <td>${group.latestAsOfDate ? formatDate(group.latestAsOfDate) : "n/a"}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    : `
        <div class="empty-state">
          No matured archived rows exist yet for the selected ${studyRun.horizonLabel} horizon. Keep running the screener and this validation layer will fill in automatically.
        </div>
      `;

  const latestRows = studyRun.maturedObservations.slice(0, 8);
  const observationsMarkup = latestRows.length
    ? `
        <div class="rolling-table-wrap">
          <table class="rolling-table options-validation-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>As Of</th>
                <th>Forward Date</th>
                <th>Forward Return</th>
                <th>Move Edge</th>
                <th>Pricing</th>
                <th>Candidate</th>
                <th>Direction</th>
                <th>IV/HV20</th>
              </tr>
            </thead>
            <tbody>
              ${latestRows
                .map(
                  (row) => `
                    <tr>
                      <th scope="row">${row.symbol}</th>
                      <td>${row.asOfDate ? formatDate(row.asOfDate) : "n/a"}</td>
                      <td>${row.forwardDate ? formatDate(row.forwardDate) : "n/a"}</td>
                      <td>${formatPercent(row.forwardReturn)}</td>
                      <td>${formatPercent(row.moveEdge)}</td>
                      <td>${row.pricingLabel}</td>
                      <td>${row.candidateAdvisory}</td>
                      <td>${row.directionLabel}</td>
                      <td>${formatNumber(row.ivHv20Ratio, 2)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    : "";

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Validation Exports</p>
          <p class="summary-meta">
            Export grouped outcomes and archived observations for ${studyRun.universe.label} at the ${studyRun.horizonLabel} horizon.
          </p>
        </div>
        <div class="results-export-actions">
          <button class="results-export-button" type="button" data-options-validation-export="csv">Export CSV</button>
          <button class="results-export-button" type="button" data-options-validation-export="xls">Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-grid options-validation-summary-grid">
          ${renderMetricCard({
            label: "Archived Runs",
            value: formatNumber(studyRun.runCount, 0),
            detail: `${formatNumber(studyRun.observationCount, 0)} archived rows across the selected universe`,
          })}
          ${renderMetricCard({
            label: "Matured Rows",
            value: formatNumber(studyRun.maturedCount, 0),
            detail: `${studyRun.horizonLabel} forward horizon`,
          })}
          ${renderMetricCard({
            label: "Pending Rows",
            value: formatNumber(studyRun.pendingCount, 0),
            detail: "Still collecting forward outcomes",
          })}
          ${renderMetricCard({
            label: "Signal Spread",
            value: Number.isFinite(studyRun.primaryComparison?.spread)
              ? formatPercent(studyRun.primaryComparison.spread)
              : "n/a",
            detail: studyRun.primaryComparison
              ? `${studyRun.primaryComparison.leftLabel} vs ${studyRun.primaryComparison.rightLabel}`
              : "Comparison bucket not ready",
          })}
        </div>
      </section>

      ${renderInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Grouped Outcomes</p>
            <p class="summary-meta">
              Archived screener rows grouped by ${studyRun.groupDefinition.label.toLowerCase()} and measured over the next ${studyRun.horizonLabel}.
            </p>
          </div>
        </div>
        ${groupsMarkup}
      </section>

      ${latestRows.length ? `
        <section class="results-section">
          <div class="results-section-head">
            <div>
              <p class="section-label">Latest Matured Observations</p>
              <p class="summary-meta">
                Recent archived screener rows that have already reached the selected forward horizon.
              </p>
            </div>
          </div>
          ${observationsMarkup}
        </section>
      ` : ""}

      <div class="result-details">
        <div class="detail-block">
          <h3>Context</h3>
          <p class="result-detail">Universe: ${studyRun.universe.label}</p>
          <p class="result-detail">Grouping: ${studyRun.groupDefinition.label}</p>
          <p class="result-detail">Forward horizon: ${studyRun.horizonLabel}</p>
          <p class="result-detail">Sample quality: ${studyRun.sampleQualityLabel}</p>
          <p class="result-detail">Latest archived row: ${studyRun.latestAsOfDate ? formatDate(studyRun.latestAsOfDate) : "n/a"}</p>
          ${
            studyRun.rerunCountCollapsed > 0
              ? `<p class="result-detail">${formatNumber(studyRun.rerunCountCollapsed, 0)} same-day reruns were collapsed so validation counts reflect distinct evidence rows.</p>`
              : ""
          }
        </div>
        <div class="detail-block">
          <h3>Methods</h3>
          <p class="result-detail">Each archived screener row is matched to cached daily closes for the same symbol.</p>
          <p class="result-detail">Forward outcomes use trading-day steps from the latest cached close on or before the archived screener date.</p>
          <p class="result-detail">Move edge is realized absolute move minus the archived implied move for that row.</p>
          <p class="result-detail">A 1M view uses 21 trading days as the monthly hold proxy.</p>
          <p class="result-detail">Rows that have not yet reached the selected horizon remain pending and are excluded from grouped outcome statistics.</p>
        </div>
        ${renderPendingBlock(studyRun)}
      </div>
    </div>
  `;
}

function optionsValidationTemplate({
  universeCatalog,
  universeId,
  groupKey,
  horizonDaysValue,
}) {
  return `
    <div class="card-shell">
      <section class="card intro-card">
        <div>
          <p class="study-kicker">Study 11</p>
          <h2>Options Validation</h2>
          <p class="summary-meta">
            Group archived screener rows and measure what the underlying did over the next few trading sessions or a monthly hold proxy.
          </p>
        </div>
        <form id="options-validation-form" class="card-grid options-validation-form-grid">
          <label class="field">
            <span class="field-label">Universe</span>
            <select id="options-validation-universe" class="input">
              ${universeCatalog
                .map(
                  (entry) => `
                    <option value="${entry.id}" ${entry.id === universeId ? "selected" : ""}>${entry.label}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Group By</span>
            <select id="options-validation-group" class="input">
              ${OPTIONS_VALIDATION_GROUP_DEFINITIONS
                .map(
                  (definition) => `
                    <option value="${definition.key}" ${definition.key === (groupKey || DEFAULT_OPTIONS_VALIDATION_GROUP_KEY) ? "selected" : ""}>${definition.label}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Forward Horizon</span>
            <select id="options-validation-horizon" class="input">
              ${OPTIONS_VALIDATION_HORIZON_DEFINITIONS
                .map(
                  (definition) => `
                    <option value="${definition.days}" ${definition.days === Number(horizonDaysValue || DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS) ? "selected" : ""}>${definition.label}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <div class="study-actions options-validation-form-actions">
            <button class="button primary" type="submit">Load Validation</button>
          </div>
          <p id="options-validation-status" class="status"></p>
        </form>
      </section>

      <section id="options-validation-results-root" class="card results-card">
        <div class="empty-state">
          <h2>No validation run is loaded yet.</h2>
          <p>Load the archived screener rows to see grouped forward outcomes.</p>
        </div>
      </section>
    </div>
  `;
}

export {
  optionsValidationTemplate,
  renderOptionsValidationResults,
};
