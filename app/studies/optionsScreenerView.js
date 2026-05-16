import { buildStudyViewHash } from "./studyShell.js";
import { formatDate, formatNumber, formatPercent } from "../lib/format.js";
import { renderInterpretationPanel } from "./shared/interpretation.js";
import {
  DEFAULT_OPTIONS_SCREENER_BIAS,
  DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER,
  DEFAULT_OPTIONS_SCREENER_PRESET_ID,
  DEFAULT_OPTIONS_SCREENER_SORT_KEY,
  OPTIONS_SCREENER_PRESET_DEFINITIONS,
  OPTIONS_SCREENER_SORT_DEFINITIONS,
  getSortDefinition,
} from "../lib/optionsScreener.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("options-screener");

function renderMetricCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function renderBadge(label, bucket, classPrefix) {
  return `<span class="${classPrefix} ${classPrefix}-${bucket}">${label}</span>`;
}

function renderIdeaPills(labels) {
  const normalizedLabels = Array.isArray(labels)
    ? labels.filter((label) => String(label || "").trim())
    : [];
  if (!normalizedLabels.length) {
    return `<span class="options-screener-pill">No Preset Match</span>`;
  }
  return normalizedLabels
    .map(
      (label) => `
        <span class="options-screener-pill">${label}</span>
      `,
    )
    .join("");
}

function renderCrossSectionalSummary(row) {
  return [
    `IV ${formatNumber(row.ivRank, 0)}`,
    `RV ${formatNumber(row.rvRank, 0)}`,
    `VRP ${formatNumber(row.vrpRank, 0)}`,
    `Term ${formatNumber(row.termStructureRank, 0)}`,
    `Skew ${formatNumber(row.skewRank, 0)}`,
  ].join(" · ");
}

function renderSortMetricValue(row, sortDefinition) {
  const value = row?.[sortDefinition.key];
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  switch (sortDefinition.styleId) {
    case "percent":
      return formatPercent(value);
    case "integer":
      return formatNumber(value, 0);
    default:
      return formatNumber(value, 2);
  }
}

function renderTermStructureValue(row) {
  if (!Number.isFinite(row.termStructureSteepness)) {
    return row.termStructureLabel || "No Read";
  }
  return `${row.termStructureLabel} · ${formatPercent(row.termStructureSteepness)}`;
}

function buildDrilldownHash(row, studyRun) {
  return buildStudyViewHash("monthly-straddle", "overview", {
    subject: row.symbol,
    dte: studyRun.minimumDte,
    count: 4,
  });
}

function renderOptionsScreenerInterpretation(studyRun) {
  const sortDefinition = getSortDefinition(studyRun.sortKey);
  const selectedPresetText = studyRun.presetDefinition
    ? `${studyRun.presetDefinition.label} is active, so only rows matching that playbook remain visible.`
    : "All trade-idea presets are visible, so the table shows the full opportunity set.";
  const presetHitCount = Object.values(studyRun.presetCounts || {}).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
  return renderInterpretationPanel({
    title: "Screener Read",
    summary:
      "This is a front-month daily options screen. IV, RV, VRP, curve shape, and skew stay separate so the preset matches can be inspected instead of guessed.",
    items: [
      {
        label: "Universe",
        tone: studyRun.universe.label,
        toneId: "neutral",
        text: `${formatNumber(studyRun.rows.length, 0)} of ${formatNumber(studyRun.universe.symbols.length, 0)} symbols returned a usable front-month snapshot.`,
      },
      {
        label: "Direction",
        tone: studyRun.topDirectionRow?.directionLabel || "No Read",
        toneId:
          studyRun.topDirectionRow?.directionBucket === "long"
            ? "positive"
            : studyRun.topDirectionRow?.directionBucket === "short"
              ? "caution"
              : "neutral",
        text: studyRun.topDirectionRow
          ? `${studyRun.topDirectionRow.symbol} has the strongest combined direction read at ${formatNumber(studyRun.topDirectionRow.directionScore, 0)}.`
          : "No usable direction read is available in this run.",
      },
      {
        label: "VRP",
        tone: studyRun.topRichRow?.symbol || "n/a",
        toneId: "caution",
        text:
          studyRun.topRichRow && studyRun.topCheapRow
            ? `${studyRun.topRichRow.symbol} has the richest front VRP at ${formatPercent(studyRun.topRichRow.vrp)}, while ${studyRun.topCheapRow.symbol} is cheapest on IV/HV20 at ${formatNumber(studyRun.topCheapRow.ivHv20Ratio, 2)}.`
            : "No clear rich-versus-cheap split is available in this run.",
      },
      {
        label: "Ideas",
        tone: studyRun.presetDefinition?.label || "All Presets",
        toneId: "neutral",
        text: `${selectedPresetText} ${formatNumber(presetHitCount, 0)} total preset matches exist across the current universe.`,
      },
      {
        label: "Sort",
        tone: sortDefinition.label,
        toneId: "neutral",
        text: `The current table is filtered to pricing ${studyRun.bias}, advisory ${studyRun.candidateFilter}, preset ${studyRun.presetDefinition?.label || "All Presets"}, and ranked by ${sortDefinition.label}.`,
      },
    ],
  });
}

function renderFailureBlock(studyRun) {
  if (!studyRun.failures.length) {
    return "";
  }
  return `
    <div class="detail-block">
      <h3>Failures</h3>
      <ul class="warning-list">
        ${studyRun.failures
          .map(
            (failure) => `
              <li><strong>${failure.symbol}</strong>: ${failure.error}</li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderRecentRunCard(run) {
  const visibleRows = Array.isArray(run.rows) ? run.rows.slice(0, 4) : [];
  const asOfDate = run.asOfDate ? new Date(`${run.asOfDate}T00:00:00`) : null;
  const createdAt = run.createdAt ? new Date(run.createdAt) : null;
  return `
    <article class="options-screener-history-card">
      <div class="options-screener-history-head">
        <div>
          <p class="meta-label">Run #${run.runId}</p>
          <strong class="options-screener-history-title">${asOfDate && !Number.isNaN(asOfDate.getTime()) ? formatDate(asOfDate) : "n/a"}</strong>
          <p class="summary-meta">
            ${formatNumber(run.rowCount, 0)} rows · ${formatNumber(run.failureCount, 0)} failures · saved ${createdAt && !Number.isNaN(createdAt.getTime()) ? formatDate(createdAt) : "n/a"}
          </p>
        </div>
        <div class="options-screener-history-chip-row">
          ${renderBadge(`Rich ${formatNumber(run.pricingCounts?.rich || 0, 0)}`, "rich", "options-screener-badge")}
          ${renderBadge(`Cheap ${formatNumber(run.pricingCounts?.cheap || 0, 0)}`, "cheap", "options-screener-badge")}
          ${renderBadge(`Short ${formatNumber(run.candidateCounts?.["short-premium"] || 0, 0)}`, "short-premium", "options-screener-candidate-badge")}
          ${renderBadge(`Long ${formatNumber(run.candidateCounts?.["long-premium"] || 0, 0)}`, "long-premium", "options-screener-candidate-badge")}
        </div>
      </div>
      <div class="options-screener-history-meta">
        <p class="summary-meta">Top direction: ${run.topDirection?.symbol || "n/a"}${run.topDirection?.directionLabel ? ` · ${run.topDirection.directionLabel}` : ""}</p>
        <p class="summary-meta">Top rich: ${run.topRich?.symbol || "n/a"}${Number.isFinite(run.topRich?.ivHv20Ratio) ? ` · ${formatNumber(run.topRich.ivHv20Ratio, 2)}` : ""}</p>
        <p class="summary-meta">Top cheap: ${run.topCheap?.symbol || "n/a"}${Number.isFinite(run.topCheap?.ivHv20Ratio) ? ` · ${formatNumber(run.topCheap.ivHv20Ratio, 2)}` : ""}</p>
      </div>
      <div class="options-screener-history-symbols">
        ${visibleRows
          .map(
            (row) => `
              <span class="options-screener-pill">${row.symbol}</span>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderOptionsScreenerHistory(historyPayload, universeLabel = "current universe") {
  const runs = Array.isArray(historyPayload?.runs) ? historyPayload.runs : [];
  if (!runs.length) {
    return `
      <div class="detail-block options-screener-history-block">
        <h3>Recent Archive</h3>
        <p class="summary-meta">No archived screener runs exist yet for ${universeLabel}. Run the screener once and the local archive will start filling in.</p>
      </div>
    `;
  }

  return `
    <div class="detail-block options-screener-history-block">
      <h3>Recent Archive</h3>
      <p class="summary-meta">Latest locally stored runs for ${universeLabel}. This is the validation substrate for later factor testing.</p>
      <div class="options-screener-history-grid">
        ${runs.map((run) => renderRecentRunCard(run)).join("")}
      </div>
    </div>
  `;
}

function renderOptionsScreenerResults(studyRun) {
  const sortDefinition = getSortDefinition(studyRun.sortKey);
  const selectedPresetLabel = studyRun.presetDefinition?.label || "All Presets";
  const totalPresetMatches = Object.values(studyRun.presetCounts || {}).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
  const tableMarkup = studyRun.filteredRows.length
    ? `
        <div class="rolling-table-wrap">
          <table class="rolling-table options-screener-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Ideas</th>
                <th>Direction</th>
                <th>Pricing</th>
                <th>Candidate</th>
                <th>IV Pctl</th>
                <th>RV Pctl</th>
                <th>VRP</th>
                <th>Term</th>
                <th>Skew</th>
                <th>X-Sect Rank</th>
                <th>Active Sort (${sortDefinition.label})</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              ${studyRun.filteredRows
                .map(
                  (row) => `
                    <tr>
                      <th scope="row">
                        <a href="${buildDrilldownHash(row, studyRun)}">${row.symbol}</a>
                      </th>
                      <td><div class="options-screener-pill-grid">${renderIdeaPills(row.tradeIdeaLabels)}</div></td>
                      <td>${renderBadge(row.directionLabel, row.directionBucket, "options-screener-direction-badge")}</td>
                      <td>${renderBadge(row.pricingLabel, row.pricingBucket, "options-screener-badge")}</td>
                      <td>${renderBadge(row.candidateAdvisory, row.candidateBucket, "options-screener-candidate-badge")}</td>
                      <td>${formatPercent(row.ivPercentile)}</td>
                      <td>${formatPercent(row.rvPercentile)}</td>
                      <td>${formatPercent(row.vrp)}</td>
                      <td>${renderTermStructureValue(row)}</td>
                      <td>${formatPercent(row.normalizedSkew)}</td>
                      <td>${renderCrossSectionalSummary(row)}</td>
                      <td>${renderSortMetricValue(row, sortDefinition)}</td>
                      <td>${row.expiry}</td>
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
          No rows match the current pricing <strong>${studyRun.bias}</strong>, candidate <strong>${studyRun.candidateFilter}</strong>, and preset <strong>${selectedPresetLabel}</strong> filters. Change the filters or rerun the universe.
        </div>
      `;

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Screener Exports</p>
          <p class="summary-meta">
            Export the filtered options screen for ${studyRun.universe.label}, including the new IV/RV/VRP, curve, skew, and preset columns.
          </p>
        </div>
        <div class="results-export-actions">
          <button class="results-export-button" type="button" data-options-screener-export="csv">Export CSV</button>
          <button class="results-export-button" type="button" data-options-screener-export="xls">Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-grid options-screener-summary-grid">
          ${renderMetricCard({
            label: "Rows Loaded",
            value: formatNumber(studyRun.rows.length, 0),
            detail: `${formatNumber(studyRun.filteredRows.length, 0)} shown after active filters`,
          })}
          ${renderMetricCard({
            label: "Preset Filter",
            value: selectedPresetLabel,
            detail: `${formatNumber(totalPresetMatches, 0)} total preset matches across the universe`,
          })}
          ${renderMetricCard({
            label: "Archive",
            value: studyRun.storage?.runId ? `#${studyRun.storage.runId}` : "n/a",
            detail: studyRun.storage
              ? `${formatNumber(studyRun.storage.rowCount, 0)} rows stored locally`
              : studyRun.storageWarning || "This run has not been archived locally.",
          })}
          ${renderMetricCard({
            label: "Top Direction",
            value: studyRun.topDirectionRow?.symbol || "n/a",
            detail: studyRun.topDirectionRow
              ? `${studyRun.topDirectionRow.directionLabel} · score ${formatNumber(studyRun.topDirectionRow.directionScore, 0)}`
              : "No direction leader in this run",
          })}
          ${renderMetricCard({
            label: "Top Rich",
            value: studyRun.topRichRow?.symbol || "n/a",
            detail: studyRun.topRichRow
              ? `VRP ${formatPercent(studyRun.topRichRow.vrp)} · IV/HV20 ${formatNumber(studyRun.topRichRow.ivHv20Ratio, 2)}`
              : "No rich candidate in this run",
          })}
          ${renderMetricCard({
            label: "Top Cheap",
            value: studyRun.topCheapRow?.symbol || "n/a",
            detail: studyRun.topCheapRow
              ? `IV/HV20 ${formatNumber(studyRun.topCheapRow.ivHv20Ratio, 2)}`
              : "No cheap candidate in this run",
          })}
        </div>
      </section>

      ${renderOptionsScreenerInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Ranked Rows</p>
            <p class="summary-meta">
              Sorted by ${sortDefinition.label}. Use the symbol link to open the full monthly-straddle drilldown for that name.
            </p>
          </div>
        </div>
        ${tableMarkup}
      </section>

      <div class="result-details">
        <div class="detail-block">
          <h3>Context</h3>
          <p class="result-detail">Universe: ${studyRun.universe.label}</p>
          <p class="result-detail">As of: ${studyRun.asOfDate ? formatDate(studyRun.asOfDate) : "n/a"}</p>
          <p class="result-detail">Minimum DTE: ${formatNumber(studyRun.minimumDte, 0)}</p>
          <p class="result-detail">Preset filter: ${selectedPresetLabel}</p>
          <p class="result-detail">Rows shown: ${formatNumber(studyRun.filteredRows.length, 0)}</p>
          <p class="result-detail">Local archive: ${studyRun.storage ? `Run #${studyRun.storage.runId} · ${formatNumber(studyRun.storage.rowCount, 0)} stored rows` : "Unavailable"}</p>
          <p class="result-detail">Provider mix: ${studyRun.providerSummary
            .map((entry) => `${entry.providerName} (${formatNumber(entry.count, 0)})`)
            .join(" · ")}</p>
          ${studyRun.storageWarning ? `<p class="result-detail">Archive warning: ${studyRun.storageWarning}</p>` : ""}
        </div>
        <div class="detail-block">
          <h3>Methods</h3>
          <p class="result-detail">Each row uses the nearest standard monthly contract that meets the DTE filter, then compares it against stored front-contract history for IV and RV percentile context.</p>
          <p class="result-detail">VRP uses front straddle IV minus HV20. Term structure steepness normalizes the front-to-back IV slope to a 30-day span so names with different expiries remain comparable.</p>
          <p class="result-detail">Normalized skew approximates downside skew as 25-delta put IV relative to an ATM reference IV from the live chain. Upside skew is calculated too, but the table shows the downside read.</p>
          <p class="result-detail">Cross-sectional ranks rescale each metric from 1 to 100 across the currently loaded universe so today’s relative opportunity set is visible next to each symbol’s own historical percentile reads.</p>
          <p class="result-detail">Each completed run is archived locally so later filters and validation can use normalized screener rows instead of rerunning the full universe.</p>
        </div>
        ${renderFailureBlock(studyRun)}
      </div>
    </div>
  `;
}

function renderUniversePresetInfo(universe) {
  return `
    <div class="options-screener-preset">
      <div>
        <p class="section-label">Universe</p>
        <p class="summary-meta">${universe.note}</p>
        <p class="summary-meta">This study loads its own preset universe and ignores the sidebar active asset.</p>
      </div>
      <div class="options-screener-pill-grid">
        ${universe.symbols
          .map(
            (entry) => `
              <span class="options-screener-pill">${entry.symbol}</span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function optionsScreenerTemplate({
  universeCatalog,
  universeId,
  bias,
  candidateFilter,
  presetId,
  sortKey,
  minimumDteValue,
  presetMarkup,
}) {
  return `
    <div class="card-shell">
      <section class="card intro-card">
        <div>
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Options Screener</h2>
          <p class="summary-meta">
            Front-month daily options screen for rich-versus-cheap vol reads across a small liquid universe.
          </p>
        </div>
        <form id="options-screener-form" class="card-grid options-screener-form-grid">
          <label class="field">
            <span class="field-label">Universe</span>
            <select id="options-screener-universe" class="input">
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
            <span class="field-label">Bias</span>
            <select id="options-screener-bias" class="input">
              <option value="all" ${bias === DEFAULT_OPTIONS_SCREENER_BIAS ? "selected" : ""}>All</option>
              <option value="rich" ${bias === "rich" ? "selected" : ""}>Rich</option>
              <option value="cheap" ${bias === "cheap" ? "selected" : ""}>Cheap</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Candidate</span>
            <select id="options-screener-candidate" class="input">
              <option value="all" ${candidateFilter === DEFAULT_OPTIONS_SCREENER_CANDIDATE_FILTER ? "selected" : ""}>All</option>
              <option value="long-premium" ${candidateFilter === "long-premium" ? "selected" : ""}>Long Premium</option>
              <option value="short-premium" ${candidateFilter === "short-premium" ? "selected" : ""}>Short Premium</option>
              <option value="low-confidence" ${candidateFilter === "low-confidence" ? "selected" : ""}>Low Confidence</option>
              <option value="watch" ${candidateFilter === "watch" ? "selected" : ""}>No Vol Edge</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Trade Idea</span>
            <select id="options-screener-preset" class="input">
              <option value="all" ${presetId === DEFAULT_OPTIONS_SCREENER_PRESET_ID ? "selected" : ""}>All Presets</option>
              ${OPTIONS_SCREENER_PRESET_DEFINITIONS
                .map(
                  (definition) => `
                    <option value="${definition.id}" ${definition.id === presetId ? "selected" : ""}>${definition.label}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Sort By</span>
            <select id="options-screener-sort" class="input">
              ${OPTIONS_SCREENER_SORT_DEFINITIONS
                .map(
                  (definition) => `
                    <option value="${definition.key}" ${definition.key === (sortKey || DEFAULT_OPTIONS_SCREENER_SORT_KEY) ? "selected" : ""}>${definition.label}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Minimum DTE</span>
            <input id="options-screener-min-dte" class="input" type="number" min="7" max="365" step="1" value="${minimumDteValue}">
          </label>
          <div class="study-actions options-screener-form-actions">
            <button class="button primary" type="submit">Run Screener</button>
          </div>
          <p id="options-screener-status" class="status"></p>
        </form>
        <div id="options-screener-preset-root">
          ${presetMarkup}
        </div>
        <div id="options-screener-history-root"></div>
      </section>

      <section id="options-screener-results-root" class="card results-card">
        <div class="empty-state">
          <h2>No screener run is loaded yet.</h2>
          <p>Run the current universe to rank rich and cheap front-month volatility reads and surface trade-idea matches.</p>
        </div>
      </section>
    </div>
  `;
}

export {
  optionsScreenerTemplate,
  renderOptionsScreenerHistory,
  renderOptionsScreenerResults,
  renderUniversePresetInfo,
};
