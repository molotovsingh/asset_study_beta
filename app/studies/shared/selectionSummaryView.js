import {
  formatDate,
  formatDateTime,
} from "../../lib/format.js";
import {
  LOCAL_API_COMMAND,
  describeFreshness,
  getSnapshotFreshness,
} from "../../lib/syncedData.js";
import { renderInstrumentProfile } from "./instrumentProfileView.js";
import {
  buildReturnBasisWarning,
  getReturnBasisLabel,
  normalizeReturnBasis,
} from "./returnBasis.js";

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
  instrumentProfileState = null,
) {
  if (!selection) {
    return `
      <div class="note-box">
        <p>Choose a bundled dataset like Nifty 50 or enter a market symbol like AAPL.</p>
      </div>
    `;
  }

  const sourceUrl = runtimeSnapshot?.sourceUrl || selection.sourceUrl;
  const providerName = runtimeSnapshot?.providerName || selection.providerName;
  const family = runtimeSnapshot?.family || selection.family;
  const currency = runtimeSnapshot?.currency || selection.currency || null;
  const targetSeriesType =
    runtimeSnapshot?.targetSeriesType || selection.targetSeriesType;
  const sourceSeriesType =
    runtimeSnapshot?.sourceSeriesType || selection.sourceSeriesType;
  const returnBasis = normalizeReturnBasis({
    returnBasis: runtimeSnapshot?.returnBasis || selection.returnBasis,
    targetSeriesType,
    sourceSeriesType,
  });
  const note = runtimeSnapshot?.note || selection.note || null;
  const sourceLabel =
    selection.kind === "builtin"
      ? "Built-in"
      : selection.kind === "bundled"
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
  } else if (
    selection.kind === "adhoc" ||
    selection.kind === "remembered" ||
    (selection.kind === "builtin" && !selection.sync)
  ) {
    runtimeMeta =
      backendState === "ready"
        ? selection.kind === "adhoc"
          ? `<p class="summary-meta">Unverified symbol. Run the study once to confirm <span class="mono">${selection.symbol}</span> before profile metadata is shown or the entry is saved locally.</p>`
          : `<p class="summary-meta">Will fetch <span class="mono">${selection.symbol}</span> through the local backend.</p>`
        : `<p class="summary-meta">This selection needs the local backend. Start <span class="mono">${LOCAL_API_COMMAND}</span> first.</p>`;
  } else {
    runtimeMeta = `<p class="summary-meta">Bundled snapshot is ready to load.</p>`;
  }

  const proxyWarningMessage = buildReturnBasisWarning({
    returnBasis,
    targetSeriesType,
    sourceSeriesType,
  });
  const proxyWarning = proxyWarningMessage
    ? `<p class="summary-meta">${proxyWarningMessage}</p>`
    : "";

  return `
    <div class="note-box selection-panel">
      <div class="selection-head">
        <div>
          <p class="section-label">${sourceLabel}</p>
          <h3 class="selection-title">${selection.label}</h3>
        </div>
        <div class="selection-chip-row">
          <span class="selection-chip">${family}</span>
          <span class="selection-chip">${targetSeriesType}</span>
          <span class="selection-chip">${getReturnBasisLabel(returnBasis)}</span>
          ${currency ? `<span class="selection-chip">${currency}</span>` : ""}
        </div>
      </div>
      <p class="summary-meta">${providerName} · Symbol <span class="mono">${selection.symbol}</span></p>
      <p class="summary-meta">History source: <a href="${sourceUrl}" target="_blank" rel="noreferrer">Open source</a></p>
      ${proxyWarning}
      ${note ? `<p class="summary-meta">${note}</p>` : ""}
      ${runtimeMeta}
      ${renderInstrumentProfile(instrumentProfileState)}
    </div>
  `;
}

export { renderSelectionDetails };
