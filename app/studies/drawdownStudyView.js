import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { buildDrawdownMetricPresentation } from "../lib/metricRegistry.js";
import { LOCAL_API_COMMAND } from "../lib/syncedData.js";
import { renderInterpretationPanel } from "./shared/interpretation.js";
import { renderWarnings } from "./shared/resultsViewShared.js";
import { getStudyKickerLabel } from "./shared/studyOrdinal.js";

const STUDY_KICKER_LABEL = getStudyKickerLabel("drawdown-study");

function renderCard({ label, value, detail }) {
  return `
    <div class="result-card">
      <p class="meta-label">${label}</p>
      <strong class="result-value">${value}</strong>
      <span class="result-caption">${detail}</span>
    </div>
  `;
}

function formatRecoveryDate(episode) {
  return episode.recoveryDate ? formatDate(episode.recoveryDate) : "Open";
}

function renderEpisodesTable(episodesByDepth) {
  if (!episodesByDepth.length) {
    return `
      <div class="empty-state visual-empty">
        <h2>No material drawdown episode formed.</h2>
        <p>The active window never moved far enough below a prior peak to clear the study threshold.</p>
      </div>
    `;
  }

  return `
    <div class="rolling-table-wrap">
      <table class="rolling-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Peak</th>
            <th>Trough</th>
            <th>Recovery</th>
            <th>Depth</th>
            <th>Peak-to-Trough</th>
            <th>Total Duration</th>
            <th>Recovery</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${episodesByDepth
            .map((episode) => {
              const tone =
                episode.maxDepth <= -0.25
                  ? "is-unavailable"
                  : "";

              return `
                <tr class="${tone}">
                  <th scope="row">#${episode.depthRank}</th>
                  <td>${formatDate(episode.peakDate)}</td>
                  <td>${formatDate(episode.troughDate)}</td>
                  <td>${formatRecoveryDate(episode)}</td>
                  <td>${formatPercent(episode.maxDepth)}</td>
                  <td>${formatNumber(episode.peakToTroughDays, 0)}d</td>
                  <td>${formatNumber(episode.durationDays, 0)}d</td>
                  <td>${Number.isFinite(episode.recoveryDays) ? `${formatNumber(episode.recoveryDays, 0)}d` : "n/a"}</td>
                  <td>${episode.recovered ? "Recovered" : "Open"}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDrawdownInterpretation(studyRun) {
  const { summary } = studyRun;
  const maxEpisode = summary.maxDrawdownEpisode;
  const longestEpisode = summary.longestEpisode;
  const openEpisode = summary.openEpisode;
  const timeUnderwaterTone =
    summary.timeUnderwaterRate >= 0.6
      ? { tone: "Frequent", toneId: "caution" }
      : summary.timeUnderwaterRate >= 0.35
        ? { tone: "Moderate", toneId: "neutral" }
        : { tone: "Limited", toneId: "positive" };

  return renderInterpretationPanel({
    items: [
      {
        label: "Depth",
        tone:
          maxEpisode && maxEpisode.maxDepth <= -0.4
            ? "Severe"
            : maxEpisode && maxEpisode.maxDepth <= -0.25
              ? "Deep"
              : "Contained",
        toneId:
          maxEpisode && maxEpisode.maxDepth <= -0.25 ? "caution" : "neutral",
        text: maxEpisode
          ? `Worst drawdown reached ${formatPercent(maxEpisode.maxDepth)} from ${formatDate(maxEpisode.peakDate)} to ${formatDate(maxEpisode.troughDate)}.`
          : "No material drawdown episode formed in this sample window.",
      },
      {
        label: "Duration",
        tone:
          longestEpisode && longestEpisode.durationDays >= 365
            ? "Long"
            : "Shorter",
        toneId:
          longestEpisode && longestEpisode.durationDays >= 365
            ? "caution"
            : "neutral",
        text: longestEpisode
          ? `The longest episode lasted ${formatNumber(longestEpisode.durationDays, 0)} days from peak to recovery/end.`
          : "No duration read is available.",
      },
      {
        label: "Time Underwater",
        ...timeUnderwaterTone,
        text: `The index stayed at least ${formatPercent(summary.materialityThreshold)} below prior peaks for ${formatPercent(summary.timeUnderwaterRate)} of observed dates.`,
      },
      {
        label: "Current State",
        tone: openEpisode ? "Still Open" : "Recovered",
        toneId: openEpisode ? "caution" : "positive",
        text: openEpisode
          ? `The latest episode remains open at ${formatPercent(summary.latestDepth)} depth, with no full recovery yet in this window.`
          : "The latest observation is at or above the previous peak.",
      },
    ],
  });
}

function renderDrawdownStudyResults(studyRun) {
  const { summary } = studyRun;
  const maxEpisode = summary.maxDrawdownEpisode;
  const longestEpisode = summary.longestEpisode;
  const longestRecovery = summary.longestRecovery;
  const metricPresentation = buildDrawdownMetricPresentation({ summary });

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Drawdown Exports</p>
          <p class="summary-meta">Download ranked episodes and the full underwater path.</p>
        </div>
        <div class="results-export-actions">
          <button
            class="results-export-button"
            type="button"
            data-drawdown-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-drawdown-export="xls"
          >Export XLS</button>
        </div>
      </div>

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Drawdown Snapshot</p>
            <p class="summary-meta">
              Depth, duration, and recovery metrics for material drawdowns in the active window.
            </p>
          </div>
        </div>
        <div class="results-grid relative-results-grid">
          ${renderCard({
            label: "Max Drawdown",
            value: formatPercent(maxEpisode?.maxDepth),
            detail: maxEpisode
              ? `${formatDate(maxEpisode.peakDate)} to ${formatDate(maxEpisode.troughDate)}`
              : "No episode formed",
          })}
          ${renderCard({
            label: "Longest Episode",
            value: longestEpisode
              ? `${formatNumber(longestEpisode.durationDays, 0)}d`
              : "n/a",
            detail: longestEpisode
              ? `${formatDate(longestEpisode.peakDate)} to ${formatDate(longestEpisode.endDate)}`
              : "No episode formed",
          })}
          ${renderCard({
            label: "Longest Recovery",
            value: longestRecovery
              ? `${formatNumber(longestRecovery.recoveryDays, 0)}d`
              : "n/a",
            detail: longestRecovery
              ? `${formatDate(longestRecovery.troughDate)} to ${formatDate(longestRecovery.recoveryDate)}`
              : "No recovered episode",
          })}
          ${renderCard({
            label: "Time Underwater",
            value: formatPercent(summary.timeUnderwaterRate),
            detail: `${formatNumber(summary.observations, 0)} observations · ${formatPercent(summary.materialityThreshold)} threshold`,
          })}
          ${renderCard({
            label: metricPresentation.materialEpisodes.label,
            value: formatNumber(summary.totalEpisodes, 0),
            detail: `${formatNumber(summary.recoveredEpisodes, 0)} recovered · ${formatNumber(summary.unrecoveredEpisodes, 0)} open · ${metricPresentation.materialEpisodes.detail}`,
          })}
          ${renderCard({
            label: "Latest Depth",
            value: formatPercent(summary.latestDepth),
            detail: summary.openEpisode
              ? "Current drawdown has not recovered yet"
              : "Latest point is at/above the material threshold",
          })}
        </div>
      </section>
      ${renderDrawdownInterpretation(studyRun)}

      <section class="results-section">
        <div class="results-section-head">
          <div>
            <p class="section-label">Ranked Episodes</p>
            <p class="summary-meta">
              Ranked by max depth from worst to shallowest material drawdown.
            </p>
          </div>
        </div>
        ${renderEpisodesTable(studyRun.episodesByDepth)}
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
            Materiality threshold: ${formatPercent(summary.materialityThreshold)} below the prior peak
          </p>
        </div>
        <div class="detail-block">
          <h3>Distribution</h3>
          <p class="result-detail">
            Average episode depth: ${formatPercent(summary.averageEpisodeDepth)}
          </p>
          <p class="result-detail">
            Median episode depth: ${formatPercent(summary.medianEpisodeDepth)}
          </p>
          <p class="result-detail">
            Median episode duration: ${formatNumber(summary.medianEpisodeDurationDays, 0)}d
          </p>
        </div>
        ${renderWarnings(studyRun.warnings)}
      </div>
    </div>
  `;
}

function drawdownStudyTemplate(defaultStartDate, defaultEndDate) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">${STUDY_KICKER_LABEL}</p>
          <h2>Drawdown Study</h2>
          <p>
            Examine peak-to-trough declines, recovery durations, and how often the index stayed underwater.
          </p>
        </div>
        <div class="note-box">
          <p>
            Drawdown is measured from prior peaks on the filtered series.
          </p>
          <p>
            Depth and duration often matter more than average returns during stressful windows.
          </p>
        </div>
      </div>

      <section class="card study-primary">
        <form id="drawdown-study-form" class="card-grid">
          <div class="card-wide study-subject-context">
            <p class="meta-label">Active Asset</p>
            <input id="drawdown-query" type="hidden" value="Nifty 50">
            <datalist id="drawdown-suggestions"></datalist>
            <div id="drawdown-summary"></div>
          </div>

          <div>
            <label class="field-label" for="drawdown-start-date">Start Date</label>
            <input id="drawdown-start-date" class="input" type="date" value="${defaultStartDate}">
          </div>

          <div>
            <label class="field-label" for="drawdown-end-date">End Date</label>
            <input id="drawdown-end-date" class="input" type="date" value="${defaultEndDate}">
          </div>

          <div class="card-wide">
            <div class="study-actions">
              <button class="button" type="submit">Run Study</button>
              <button id="drawdown-load-five-year-window" class="button secondary" type="button">Use Last 5 Years</button>
            </div>
            <p id="drawdown-status" class="status"></p>
          </div>
        </form>
      </section>

      <section id="drawdown-results-root" class="card results-card">
        <div class="empty-state">
          <p>Run the drawdown study to inspect depth, duration, and recovery episodes.</p>
          <div class="empty-state-actions">
            <a class="empty-state-link" href="#drawdown-study/overview?subject=Nifty+50&start=${defaultStartDate}&end=${defaultEndDate}">
              Try Nifty 50 drawdown scan
            </a>
            <a class="empty-state-link" href="#drawdown-study/overview?subject=Sensex&start=${defaultStartDate}&end=${defaultEndDate}">
              Try Sensex drawdown scan
            </a>
          </div>
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel">
          <summary class="reference-summary">
            <div>
              <p class="section-label">Reference</p>
              <p class="summary-meta">Sources, backend path, and drawdown method notes.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>Bundled datasets load from <span class="mono">data/snapshots/</span>.</li>
              <li>Typed symbols use the local backend: <span class="mono">${LOCAL_API_COMMAND}</span>.</li>
              <li>Drawdowns are computed directly on observed prices without interpolation.</li>
            </ul>

            <p class="section-label">Notes</p>
            <p class="helper">
              Use TRI data when possible. Price-only series can overstate drawdown persistence if dividends are excluded.
            </p>
          </div>
        </details>
      </aside>
    </div>
  `;
}

export { drawdownStudyTemplate, renderDrawdownStudyResults };
