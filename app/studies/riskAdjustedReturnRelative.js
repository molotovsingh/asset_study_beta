import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import { exportRelativeStudyCsv, exportRelativeStudyXls } from "../lib/relativeStudyExport.js";
import { computeRelativeMetrics, convertSeriesCurrency } from "../lib/relativeStats.js";
import {
  buildLocalApiUnavailableMessage,
  fetchIndexSeries,
  getManifestDataset,
  loadRememberedIndexCatalog,
  loadSyncManifest,
  loadSyncedSeries,
} from "../lib/syncedData.js";
import {
  buildSelectionSignature,
  buildSeriesRequest,
  findSelectionByQuery,
  mergeSelectionSuggestions,
  upsertRememberedCatalogEntry,
} from "./riskAdjustedReturnSelection.js";
import { renderSelectionDetails } from "./riskAdjustedReturnView.js";

const BUNDLED_MANIFEST_SYNC_CONFIG = {
  provider: "yfinance",
  datasetType: "index",
};

const OVERVIEW_HASH = "#risk-adjusted-return/overview";

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCurrencyCode(value) {
  return String(value || "").trim().toUpperCase();
}

function filterSeriesToWindow(series, startDate, endDate) {
  return series.filter(
    (point) => point.date >= startDate && point.date <= endDate,
  );
}

function buildFxPairCandidates(fromCurrency, toCurrency) {
  return [
    {
      symbol: `${fromCurrency}${toCurrency}=X`,
      mode: "multiply",
      label: `${fromCurrency}/${toCurrency}`,
    },
    {
      symbol: `${toCurrency}${fromCurrency}=X`,
      mode: "divide",
      label: `${toCurrency}/${fromCurrency}`,
    },
  ];
}

function buildComparisonBasisLabel(basis, baseCurrency) {
  if (basis === "common") {
    return `Common currency (${normalizeCurrencyCode(baseCurrency)})`;
  }

  return "Local currency";
}

function buildStudyRunSignature(studyRun) {
  if (!studyRun) {
    return "none";
  }

  return [
    buildSelectionSignature(studyRun.selection),
    studyRun.requestedStartDate ? toLocalDateKey(studyRun.requestedStartDate) : "",
    studyRun.requestedEndDate ? toLocalDateKey(studyRun.requestedEndDate) : "",
    studyRun.seriesLabel,
  ].join("|");
}

function buildRelativeWarnings({
  studyRun,
  benchmarkSelection,
  benchmarkSeries,
  relativeMetrics,
  comparisonBasis,
  fxConversions = [],
}) {
  const warnings = [];

  if (relativeMetrics.overlapStartDate > studyRun.requestedStartDate) {
    warnings.push(
      `Overlap starts on ${formatDate(relativeMetrics.overlapStartDate)}, later than the requested study window.`,
    );
  }

  if (relativeMetrics.overlapEndDate < studyRun.requestedEndDate) {
    warnings.push(
      `Overlap ends before the requested end date because the asset and benchmark only compare on exact shared dates.`,
    );
  }

  const overlapRatio =
    Math.min(studyRun.indexSeries.length, benchmarkSeries.length) > 0
      ? relativeMetrics.overlapObservations /
        Math.min(studyRun.indexSeries.length, benchmarkSeries.length)
      : 0;
  if (overlapRatio < 0.82) {
    warnings.push(
      "Date overlap is thin for this pair. Cross-market holiday differences can make relative statistics less stable.",
    );
  }

  if (studyRun.selection?.targetSeriesType !== "TRI") {
    warnings.push(
      "The base asset is not marked as TRI. Dividend exclusion can distort relative long-run comparisons.",
    );
  }

  if (benchmarkSelection?.targetSeriesType !== "TRI") {
    warnings.push(
      "The benchmark is not marked as TRI. Price-only data can distort capture ratios and wealth spread.",
    );
  }

  if (comparisonBasis === "common") {
    warnings.push(
      "FX normalization uses the latest available FX rate on or before each market date, not an exact same-day FX join.",
    );
  }

  fxConversions.forEach((conversion) => {
    if (conversion?.usedInversePair) {
      warnings.push(
        `${conversion.fromCurrency} to ${conversion.toCurrency} used the inverse Yahoo FX pair ${conversion.symbol}.`,
      );
    }
  });

  return warnings;
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

function renderRelativeResults(payload) {
  const { relativeMetrics } = payload;

  return `
    <div class="results-shell">
      <div class="results-toolbar">
        <div>
          <p class="section-label">Relative Exports</p>
          <p class="summary-meta">Download the aligned comparison instead of the single-series study.</p>
        </div>
        <div class="results-export-actions">
          <button
            class="results-export-button"
            type="button"
            data-relative-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-relative-export="xls"
          >Export XLS</button>
        </div>
      </div>
      ${renderMetricSection({
        title: "Relative Quick Read",
        summary: "First-pass spread, fit, and benchmark sensitivity.",
        cards: [
          renderMetricCard({
            label: "Asset CAGR",
            value: formatPercent(relativeMetrics.assetMetrics.annualizedReturn),
            detail: `${payload.assetLabel} ${payload.assetComparisonCurrency || ""}`.trim(),
          }),
          renderMetricCard({
            label: "Benchmark CAGR",
            value: formatPercent(
              relativeMetrics.benchmarkMetrics.annualizedReturn,
            ),
            detail: `${payload.benchmarkLabel} ${payload.benchmarkComparisonCurrency || ""}`.trim(),
          }),
          renderMetricCard({
            label: "CAGR Spread",
            value: formatPercent(relativeMetrics.cagrSpread),
            detail: "Asset CAGR minus benchmark CAGR",
          }),
          renderMetricCard({
            label: "Relative Wealth",
            value: formatPercent(relativeMetrics.relativeWealth),
            detail: "Ending relative wealth from the same start base",
          }),
          renderMetricCard({
            label: "Correlation",
            value: formatNumber(relativeMetrics.correlation),
            detail: "Aligned period log returns",
          }),
          renderMetricCard({
            label: "Beta",
            value: formatNumber(relativeMetrics.beta),
            detail: "Asset sensitivity to benchmark moves",
          }),
        ],
      })}
      ${renderMetricSection({
        title: "Relative Risk",
        summary: "How noisy, efficient, and asymmetric the active return stream is.",
        cards: [
          renderMetricCard({
            label: "Tracking Error",
            value: formatPercent(relativeMetrics.trackingError),
            detail: "Annualized std dev of excess log returns",
          }),
          renderMetricCard({
            label: "Information Ratio",
            value: formatNumber(relativeMetrics.informationRatio),
            detail: "Annualized excess log return divided by tracking error",
          }),
          renderMetricCard({
            label: "Outperformance Rate",
            value: formatPercent(relativeMetrics.outperformanceRate),
            detail: "Share of periods where asset beat benchmark",
          }),
          renderMetricCard({
            label: "Upside Capture",
            value: formatNumber(relativeMetrics.upsideCapture),
            detail: "Cumulative response in benchmark up periods",
          }),
          renderMetricCard({
            label: "Downside Capture",
            value: formatNumber(relativeMetrics.downsideCapture),
            detail: "Cumulative response in benchmark down periods",
          }),
          renderMetricCard({
            label: "Relative Drawdown",
            value: formatPercent(relativeMetrics.relativeDrawdown),
            detail: "Worst drawdown of relative wealth",
          }),
        ],
      })}
      <div class="result-details">
        <div class="detail-block">
          <h3>Overlap Context</h3>
          <p class="result-detail">
            Requested window: ${formatDateRange(
              payload.requestedStartDate,
              payload.requestedEndDate,
            )}
          </p>
          <p class="result-detail">
            Overlap window: ${formatDateRange(
              relativeMetrics.overlapStartDate,
              relativeMetrics.overlapEndDate,
            )}
          </p>
          <p class="result-detail">
            Overlap observations: ${formatNumber(relativeMetrics.overlapObservations, 0)}
          </p>
          <p class="result-detail">
            Overlap return observations: ${formatNumber(
              relativeMetrics.overlapReturnObservations,
              0,
            )}
          </p>
          <p class="result-detail">
            Sampling frequency: ${formatNumber(relativeMetrics.periodsPerYear, 0)} periods per year
          </p>
          <p class="result-detail">
            Comparison basis: ${payload.comparisonBasisLabel}
          </p>
        </div>
        <div class="detail-block">
          <h3>Methods</h3>
          <p class="result-detail">Asset method: ${payload.assetMethodLabel}</p>
          <p class="result-detail">
            Benchmark method: ${payload.benchmarkMethodLabel}
          </p>
          <p class="result-detail">
            Alignment rule: exact shared dates only
          </p>
          <p class="result-detail">
            Return basis: aligned period log returns for correlation, beta, tracking error, and information ratio
          </p>
          <p class="result-detail">
            Asset currency path: ${payload.assetCurrencyPath}
          </p>
          <p class="result-detail">
            Benchmark currency path: ${payload.benchmarkCurrencyPath}
          </p>
        </div>
        ${renderWarnings(payload.warnings)}
      </div>
    </div>
  `;
}

function renderEmptyState(message) {
  return `
    <div class="empty-state visual-empty">
      <p class="study-kicker">Relative View</p>
      <h2>${message}</h2>
      <p class="summary-meta">
        Run the overview once to set the base asset, then compare it against any other dataset or symbol.
      </p>
      <div class="visuals-actions">
        <a class="study-view-link is-active" href="${OVERVIEW_HASH}">Go To Overview</a>
      </div>
    </div>
  `;
}

function relativeTemplate({
  studyRun,
  benchmarkQuery = "",
  comparisonBasis = "local",
  baseCurrency = "USD",
}) {
  return `
    <div class="study-layout relative-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 01</p>
          <h2>Relative Performance</h2>
          <p>
            Compare the last completed study run against any other dataset or symbol using exact shared dates.
          </p>
        </div>
        <div class="note-box">
          <p>
            Base asset: <span class="mono">${studyRun.seriesLabel}</span>
          </p>
          <p>
            Window: ${formatDateRange(
              studyRun.requestedStartDate,
              studyRun.requestedEndDate,
            )}
          </p>
        </div>
      </div>

      <section class="card study-primary relative-primary">
        <div class="relative-context-grid">
          ${renderSelectionDetails(
            studyRun.selection,
            studyRun.selection,
            studyRun.useDemoData,
            "ready",
          )}
          <div class="note-box relative-base-note">
            <p class="section-label">Base Run</p>
            <p class="summary-meta">The comparison uses the last completed overview run as the asset series.</p>
            <p class="summary-meta">Re-run the overview any time you want a new base asset, date range, or risk-free input.</p>
          </div>
        </div>

        <form id="relative-study-form" class="card-grid relative-form">
          <div class="card-wide">
            <label class="field-label" for="relative-benchmark-query">Benchmark Dataset Or Symbol</label>
            <input id="relative-benchmark-query" class="input" type="text" list="relative-benchmark-suggestions" value="${benchmarkQuery}" autocomplete="off" spellcheck="false">
            <datalist id="relative-benchmark-suggestions"></datalist>
            <p class="helper">
              Examples: <span class="mono">Sensex</span>, <span class="mono">Nifty 50</span>, <span class="mono">^GSPC</span>, <span class="mono">^N225</span>, <span class="mono">QQQ</span>.
            </p>
            <div id="relative-benchmark-summary"></div>
          </div>

          <div class="inline-row card-wide relative-basis-row">
            <div>
              <label class="field-label" for="relative-comparison-basis">Comparison Basis</label>
              <select id="relative-comparison-basis" class="input">
                <option value="local"${comparisonBasis === "local" ? " selected" : ""}>Local Currency</option>
                <option value="common"${comparisonBasis === "common" ? " selected" : ""}>Common Currency</option>
              </select>
              <p class="helper">
                Local keeps each series in its native currency. Common currency adds FX returns on top of index returns.
              </p>
            </div>

            <div id="relative-base-currency-wrap"${comparisonBasis === "common" ? "" : ' hidden'}>
              <label class="field-label" for="relative-base-currency">Base Currency</label>
              <input id="relative-base-currency" class="input" type="text" maxlength="3" value="${baseCurrency}" autocomplete="off" spellcheck="false">
              <p class="helper">
                Examples: <span class="mono">USD</span>, <span class="mono">INR</span>, <span class="mono">EUR</span>.
              </p>
            </div>
          </div>

          <div class="card-wide">
            <div class="study-actions">
              <button class="button" type="submit">Run Relative View</button>
              <button id="relative-clear-results" class="button secondary" type="button">Clear Relative Run</button>
            </div>
            <p id="relative-status" class="status"></p>
          </div>
        </form>
      </section>

      <section id="relative-results-root" class="card results-card">
        <div class="empty-state">
          Choose a benchmark and run the relative comparison.
        </div>
      </section>

      <aside class="card reference-card">
        <details class="reference-panel" open>
          <summary class="reference-summary">
            <div>
              <p class="section-label">Relative Notes</p>
              <p class="summary-meta">Alignment, benchmark scope, and exports.</p>
            </div>
            <span class="reference-marker" aria-hidden="true"></span>
          </summary>

          <div class="reference-body">
            <ul class="source-list">
              <li>The benchmark can be any bundled dataset, saved symbol, or ad hoc symbol supported by the app.</li>
              <li>Relative metrics only use dates shared by both series.</li>
              <li>Common-currency mode uses Yahoo FX pairs through the local backend when currencies differ.</li>
              <li>The export package is specific to the aligned comparison, not the single-series study.</li>
            </ul>
          </div>
        </details>
      </aside>
    </div>
  `;
}

function mountRiskAdjustedReturnRelative(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    root.innerHTML = renderEmptyState("No base study run is available yet.");
    return () => {};
  }

  if (!session.relativeBenchmarkQuery) {
    session.relativeBenchmarkQuery = "Sensex";
  }

  root.innerHTML = relativeTemplate({
    studyRun,
    benchmarkQuery: session.relativeBenchmarkQuery,
    comparisonBasis: session.relativeBasis || "local",
    baseCurrency: session.relativeBaseCurrency || "USD",
  });

  const form = root.querySelector("#relative-study-form");
  const benchmarkQueryInput = root.querySelector("#relative-benchmark-query");
  const benchmarkSuggestions = root.querySelector("#relative-benchmark-suggestions");
  const benchmarkSummary = root.querySelector("#relative-benchmark-summary");
  const comparisonBasisInput = root.querySelector("#relative-comparison-basis");
  const baseCurrencyWrap = root.querySelector("#relative-base-currency-wrap");
  const baseCurrencyInput = root.querySelector("#relative-base-currency");
  const resultsRoot = root.querySelector("#relative-results-root");
  const status = root.querySelector("#relative-status");
  const clearButton = root.querySelector("#relative-clear-results");

  const state = {
    bundledManifest: session.bundledManifest || null,
    rememberedCatalog: session.rememberedCatalog || [],
    backendState: session.backendState || "unknown",
  };

  function setStatus(message, statusState = "info") {
    status.className = `status ${statusState}`;
    status.textContent = message;
  }

  function updateBasisUi() {
    const isCommon = comparisonBasisInput.value === "common";
    baseCurrencyWrap.hidden = !isCommon;
  }

  function persistRelativeSettings() {
    session.relativeBenchmarkQuery = benchmarkQueryInput.value;
    session.relativeBasis = comparisonBasisInput.value;
    session.relativeBaseCurrency = normalizeCurrencyCode(baseCurrencyInput.value || "USD") || "USD";
    baseCurrencyInput.value = session.relativeBaseCurrency;
  }

  function getSuggestions() {
    return mergeSelectionSuggestions(state.bundledManifest, state.rememberedCatalog);
  }

  function getBenchmarkSelection() {
    return findSelectionByQuery(benchmarkQueryInput.value, getSuggestions());
  }

  function populateSuggestions() {
    benchmarkSuggestions.innerHTML = getSuggestions()
      .map(
        (entry) =>
          `<option value="${entry.label}" label="${entry.symbol} · ${entry.family}"></option>`,
      )
      .join("");
  }

  function updateSummary(runtimeSnapshot = null) {
    benchmarkSummary.innerHTML = renderSelectionDetails(
      getBenchmarkSelection(),
      runtimeSnapshot,
      false,
      state.backendState,
    );
  }

  async function loadBundledManifest() {
    if (state.bundledManifest) {
      populateSuggestions();
      updateSummary();
      return;
    }

    try {
      state.bundledManifest = await loadSyncManifest(BUNDLED_MANIFEST_SYNC_CONFIG);
      session.bundledManifest = state.bundledManifest;
    } catch (error) {
      state.bundledManifest = null;
    }

    populateSuggestions();
    updateSummary();
  }

  async function loadRememberedCatalog() {
    try {
      state.rememberedCatalog = await loadRememberedIndexCatalog();
      state.backendState = "ready";
      session.rememberedCatalog = state.rememberedCatalog;
      session.backendState = "ready";
    } catch (error) {
      state.backendState = "unavailable";
      session.backendState = "unavailable";
      if (!status.textContent) {
        setStatus(buildLocalApiUnavailableMessage(), "info");
      }
    }

    populateSuggestions();
    updateSummary();
  }

  async function loadSelectionData(selection) {
    if (selection.kind === "builtin" || selection.kind === "bundled") {
      const manifestDataset =
        state.bundledManifest && selection.sync
          ? getManifestDataset(state.bundledManifest, selection.sync)
          : null;

      return loadSyncedSeries(selection.sync, manifestDataset);
    }

    return fetchIndexSeries(buildSeriesRequest(selection));
  }

  async function loadFxConversion(fromCurrency, toCurrency) {
    const normalizedFrom = normalizeCurrencyCode(fromCurrency);
    const normalizedTo = normalizeCurrencyCode(toCurrency);

    if (!normalizedFrom || !normalizedTo) {
      throw new Error("Both asset and benchmark need known currencies before FX normalization can run.");
    }

    if (normalizedFrom === normalizedTo) {
      return {
        symbol: null,
        mode: "identity",
        series: [],
        fromCurrency: normalizedFrom,
        toCurrency: normalizedTo,
        usedInversePair: false,
      };
    }

    const cacheKey = `${normalizedFrom}->${normalizedTo}`;
    if (session.fxSeriesCache?.[cacheKey]) {
      return session.fxSeriesCache[cacheKey];
    }

    const candidates = buildFxPairCandidates(normalizedFrom, normalizedTo);
    let lastError = null;

    for (const candidate of candidates) {
      try {
        const { series, snapshot } = await fetchIndexSeries({
          symbol: candidate.symbol,
          label: `${candidate.label} FX`,
          providerName: "Yahoo Finance",
          family: "FX",
          targetSeriesType: "FX",
          sourceSeriesType: "FX",
          remember: false,
        });

        const result = {
          symbol: candidate.symbol,
          mode: candidate.mode,
          series,
          snapshot,
          fromCurrency: normalizedFrom,
          toCurrency: normalizedTo,
          usedInversePair: candidate.mode === "divide",
        };
        session.fxSeriesCache[cacheKey] = result;
        return result;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      lastError?.message ||
        `Could not load an FX pair to convert ${normalizedFrom} into ${normalizedTo}.`,
    );
  }

  function renderStoredRelativeRun() {
    if (
      !session.lastRelativeRun ||
      session.lastRelativeRun.assetStudySignature !== buildStudyRunSignature(studyRun)
    ) {
      return;
    }

    resultsRoot.innerHTML = renderRelativeResults(session.lastRelativeRun);
    setStatus("Loaded the last completed relative run.", "success");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistRelativeSettings();
    setStatus("Running relative comparison...", "info");

    try {
      const benchmarkSelection = getBenchmarkSelection();
      if (!benchmarkSelection) {
        throw new Error("Choose a benchmark dataset or symbol before running the relative view.");
      }

      if (
        buildSelectionSignature(benchmarkSelection) ===
        buildSelectionSignature(studyRun.selection)
      ) {
        throw new Error("Pick a benchmark that is different from the base asset.");
      }

      const { snapshot, series, rememberedEntry } = await loadSelectionData(
        benchmarkSelection,
      );
      const resolvedBenchmarkSelection = {
        ...benchmarkSelection,
        currency: snapshot.currency || benchmarkSelection.currency || null,
      };
      if (rememberedEntry) {
        state.rememberedCatalog = upsertRememberedCatalogEntry(
          state.rememberedCatalog,
          rememberedEntry,
        );
        session.rememberedCatalog = state.rememberedCatalog;
      }
      updateSummary(snapshot);

      const requestedSeries = filterSeriesToWindow(
        series,
        studyRun.requestedStartDate,
        studyRun.requestedEndDate,
      );
      const comparisonBasis = comparisonBasisInput.value;
      const targetCurrency =
        comparisonBasis === "common"
          ? normalizeCurrencyCode(baseCurrencyInput.value || session.relativeBaseCurrency || "USD")
          : null;
      let assetSeriesForComparison = studyRun.indexSeries;
      let benchmarkSeriesForComparison = requestedSeries;
      let assetCurrencyPath = studyRun.selection?.currency || "Unknown";
      let benchmarkCurrencyPath =
        resolvedBenchmarkSelection.currency || "Unknown";
      const fxConversions = [];

      if (comparisonBasis === "common") {
        if (!targetCurrency) {
          throw new Error("Enter a three-letter base currency before running common-currency comparison.");
        }

        const assetCurrency = normalizeCurrencyCode(studyRun.selection?.currency);
        const benchmarkCurrency = normalizeCurrencyCode(
          resolvedBenchmarkSelection.currency,
        );
        if (!assetCurrency || !benchmarkCurrency) {
          throw new Error(
            "Both asset and benchmark need a known currency before common-currency comparison can run.",
          );
        }

        const assetFx = await loadFxConversion(assetCurrency, targetCurrency);
        if (assetFx.mode !== "identity") {
          assetSeriesForComparison = convertSeriesCurrency(
            studyRun.indexSeries,
            assetFx.series,
            assetFx.mode,
          );
          fxConversions.push(assetFx);
          assetCurrencyPath = `${assetCurrency} -> ${targetCurrency} via ${assetFx.symbol}`;
        } else {
          assetCurrencyPath = `${assetCurrency} (already ${targetCurrency})`;
        }

        const benchmarkFx = await loadFxConversion(
          benchmarkCurrency,
          targetCurrency,
        );
        if (benchmarkFx.mode !== "identity") {
          benchmarkSeriesForComparison = convertSeriesCurrency(
            requestedSeries,
            benchmarkFx.series,
            benchmarkFx.mode,
          );
          fxConversions.push(benchmarkFx);
          benchmarkCurrencyPath = `${benchmarkCurrency} -> ${targetCurrency} via ${benchmarkFx.symbol}`;
        } else {
          benchmarkCurrencyPath = `${benchmarkCurrency} (already ${targetCurrency})`;
        }
      } else {
        assetCurrencyPath = studyRun.selection?.currency
          ? `${studyRun.selection.currency} local`
          : "Local currency";
        benchmarkCurrencyPath = resolvedBenchmarkSelection.currency
          ? `${resolvedBenchmarkSelection.currency} local`
          : "Local currency";
      }

      const relativeMetrics = computeRelativeMetrics(
        assetSeriesForComparison,
        benchmarkSeriesForComparison,
        {
          constantRiskFreeRate: studyRun.annualRiskFreeRate,
        },
      );
      const warnings = buildRelativeWarnings(
        {
          studyRun,
          benchmarkSelection: resolvedBenchmarkSelection,
          benchmarkSeries: benchmarkSeriesForComparison,
          relativeMetrics,
          comparisonBasis,
          fxConversions,
        },
      );

      session.lastRelativeRun = {
        studyTitle: "Risk-Adjusted Relative Performance",
        assetStudySignature: buildStudyRunSignature(studyRun),
        assetSelection: studyRun.selection,
        assetLabel: studyRun.seriesLabel,
        assetMethodLabel: studyRun.methodLabel,
        assetComparisonCurrency:
          comparisonBasis === "common"
            ? targetCurrency
            : studyRun.selection?.currency || null,
        benchmarkSelection: resolvedBenchmarkSelection,
        benchmarkLabel: resolvedBenchmarkSelection.label,
        benchmarkMethodLabel: snapshot.cache
          ? `Local yfinance fetch using ${snapshot.symbol}`
          : `Bundled snapshot using ${snapshot.symbol}`,
        benchmarkComparisonCurrency:
          comparisonBasis === "common"
            ? targetCurrency
            : resolvedBenchmarkSelection.currency || null,
        requestedStartDate: studyRun.requestedStartDate,
        requestedEndDate: studyRun.requestedEndDate,
        overlapStartDate: relativeMetrics.overlapStartDate,
        overlapEndDate: relativeMetrics.overlapEndDate,
        comparisonBasis,
        comparisonBasisLabel: buildComparisonBasisLabel(
          comparisonBasis,
          targetCurrency,
        ),
        baseCurrency: targetCurrency,
        assetCurrencyPath,
        benchmarkCurrencyPath,
        relativeMetrics,
        warnings,
        exportedAt: new Date(),
      };

      resultsRoot.innerHTML = renderRelativeResults(session.lastRelativeRun);
      setStatus("Relative comparison completed.", "success");
    } catch (error) {
      session.lastRelativeRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${error.message}
        </div>
      `;
      setStatus(error.message, "error");
    }
  }

  function handleSummaryInput() {
    persistRelativeSettings();
    updateBasisUi();
    updateSummary();
  }

  function handleResultsClick(event) {
    const trigger = event.target.closest("[data-relative-export]");
    if (!trigger || !session.lastRelativeRun) {
      return;
    }

    try {
      if (trigger.dataset.relativeExport === "csv") {
        exportRelativeStudyCsv(session.lastRelativeRun);
        setStatus("Downloaded the relative CSV export.", "success");
        return;
      }

      if (trigger.dataset.relativeExport === "xls") {
        exportRelativeStudyXls(session.lastRelativeRun);
        setStatus("Downloaded the relative XLS export.", "success");
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  function handleClearResults() {
    session.lastRelativeRun = null;
    resultsRoot.innerHTML = `
      <div class="empty-state">
        Choose a benchmark and run the relative comparison.
      </div>
    `;
    setStatus("Cleared the stored relative run.", "info");
  }

  form.addEventListener("submit", handleSubmit);
  benchmarkQueryInput.addEventListener("input", handleSummaryInput);
  benchmarkQueryInput.addEventListener("change", handleSummaryInput);
  comparisonBasisInput.addEventListener("change", handleSummaryInput);
  baseCurrencyInput.addEventListener("input", handleSummaryInput);
  clearButton.addEventListener("click", handleClearResults);
  resultsRoot.addEventListener("click", handleResultsClick);

  updateBasisUi();
  populateSuggestions();
  updateSummary();
  loadBundledManifest();
  loadRememberedCatalog();
  renderStoredRelativeRun();

  return () => {
    form.removeEventListener("submit", handleSubmit);
    benchmarkQueryInput.removeEventListener("input", handleSummaryInput);
    benchmarkQueryInput.removeEventListener("change", handleSummaryInput);
    comparisonBasisInput.removeEventListener("change", handleSummaryInput);
    baseCurrencyInput.removeEventListener("input", handleSummaryInput);
    clearButton.removeEventListener("click", handleClearResults);
    resultsRoot.removeEventListener("click", handleResultsClick);
  };
}

export { mountRiskAdjustedReturnRelative };
