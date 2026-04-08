import { getRunnableIndexCatalog } from "../catalog/indexCatalog.js";
import {
  formatDate,
  formatDateTime,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  filterSeriesByDate,
  computeRiskAdjustedMetrics,
} from "../lib/stats.js";
import {
  LOCAL_API_COMMAND,
  buildLocalApiUnavailableMessage,
  describeFreshness,
  fetchIndexSeries,
  getSnapshotFreshness,
  loadRememberedIndexCatalog,
} from "../lib/syncedData.js";

const demoIndexSeries = [
  ["2021-04-07", 14500],
  ["2021-07-07", 15680],
  ["2021-10-07", 17220],
  ["2022-01-07", 18340],
  ["2022-04-07", 17860],
  ["2022-07-07", 16210],
  ["2022-10-07", 17040],
  ["2023-01-07", 18120],
  ["2023-04-07", 17780],
  ["2023-07-07", 19650],
  ["2023-10-07", 20340],
  ["2024-01-07", 21620],
  ["2024-04-07", 22480],
  ["2024-07-07", 24750],
  ["2024-10-07", 26120],
  ["2025-01-07", 25240],
  ["2025-04-07", 26980],
  ["2025-07-07", 27560],
  ["2025-10-07", 28890],
  ["2026-01-07", 27980],
  ["2026-04-07", 29520],
].map(([date, value]) => ({ date: new Date(`${date}T00:00:00`), value }));

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildYahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function normalizeQuery(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildBuiltInSelection(entry) {
  return {
    kind: "builtin",
    id: entry.id,
    label: entry.label,
    symbol: entry.sync.symbol,
    providerName: entry.provider,
    family: entry.family,
    targetSeriesType: entry.seriesType,
    sourceSeriesType: entry.sync.sourceSeriesType || entry.seriesType,
    sourceUrl: entry.sourceUrl,
    note: entry.sync.note || null,
    aliases: entry.aliases || [],
    generatedAt: null,
    range: null,
  };
}

function buildRememberedSelection(entry) {
  return {
    kind: "remembered",
    id: entry.datasetId,
    label: entry.label || entry.symbol,
    symbol: entry.symbol,
    providerName: entry.providerName || "Yahoo Finance",
    family: entry.family || "Remembered",
    targetSeriesType: entry.targetSeriesType || "Price",
    sourceSeriesType: entry.sourceSeriesType || entry.targetSeriesType || "Price",
    sourceUrl: entry.sourceUrl || buildYahooQuoteUrl(entry.symbol),
    note: entry.note || null,
    aliases: [],
    generatedAt: entry.generatedAt || null,
    range: entry.range || null,
  };
}

function buildAdHocSelection(rawValue) {
  const symbol = rawValue.trim();

  return {
    kind: "adhoc",
    id: `adhoc:${symbol}`,
    label: symbol,
    symbol,
    providerName: "Yahoo Finance",
    family: "Ad hoc",
    targetSeriesType: "Price",
    sourceSeriesType: "Price",
    sourceUrl: buildYahooQuoteUrl(symbol),
    note: null,
    aliases: [],
    generatedAt: null,
    range: null,
  };
}

function buildSelectionSignature(selection) {
  if (!selection) {
    return "none";
  }

  return [
    selection.kind,
    selection.id,
    selection.symbol,
    selection.targetSeriesType,
  ].join("|");
}

function mergeSelectionSuggestions(rememberedCatalog) {
  const builtIns = getRunnableIndexCatalog().map(buildBuiltInSelection);
  const builtInSymbols = new Set(
    builtIns.map((entry) => normalizeQuery(entry.symbol)),
  );
  const remembered = rememberedCatalog
    .map(buildRememberedSelection)
    .filter((entry) => !builtInSymbols.has(normalizeQuery(entry.symbol)));

  return [...builtIns, ...remembered];
}

function findSelectionByQuery(query, suggestions) {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return null;
  }

  const labelMatch = suggestions.find(
    (entry) => normalizeQuery(entry.label) === normalized,
  );
  if (labelMatch) {
    return labelMatch;
  }

  const aliasMatch = suggestions.find((entry) =>
    entry.aliases.some((alias) => normalizeQuery(alias) === normalized),
  );
  if (aliasMatch) {
    return aliasMatch;
  }

  const rememberedSymbolMatch = suggestions.find(
    (entry) =>
      entry.kind === "remembered" && normalizeQuery(entry.symbol) === normalized,
  );
  if (rememberedSymbolMatch) {
    return rememberedSymbolMatch;
  }

  const builtInSymbolMatches = suggestions.filter(
    (entry) =>
      entry.kind === "builtin" && normalizeQuery(entry.symbol) === normalized,
  );
  if (builtInSymbolMatches.length === 1) {
    return builtInSymbolMatches[0];
  }

  return buildAdHocSelection(query);
}

function renderSelectionDetails(selection, runtimeSnapshot, useDemoData) {
  if (!selection) {
    return `
      <div class="note-box">
        <p>Type a built-in name like Nifty 50 or any yfinance symbol like AAPL or ^NSEI.</p>
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
  const generatedAt = runtimeSnapshot?.generatedAt || selection.generatedAt;
  const range = runtimeSnapshot?.range || selection.range;
  const snapshotForFreshness =
    runtimeSnapshot || (generatedAt || range ? { generatedAt, range } : null);

  let runtimeMeta = `
    <p class="summary-meta">Will resolve <span class="mono">${selection.symbol}</span> through the local yfinance backend when you run the study.</p>
  `;

  if (selection.kind === "remembered" && snapshotForFreshness) {
    const freshness = getSnapshotFreshness(snapshotForFreshness);
    const latestDate = freshness.latestDate
      ? formatDate(freshness.latestDate)
      : "n/a";
    const syncedAt = generatedAt
      ? formatDateTime(new Date(generatedAt))
      : "n/a";
    const rangeStart = range?.startDate
      ? formatDate(new Date(`${range.startDate}T00:00:00`))
      : "n/a";
    const rangeEnd = range?.endDate
      ? formatDate(new Date(`${range.endDate}T00:00:00`))
      : "n/a";

    runtimeMeta = `
      <div class="sync-summary-grid">
        <div class="sync-summary-row">
          <span class="summary-pill ${freshness.status}">${describeFreshness(freshness)}</span>
          <span class="summary-meta">Latest market date: ${latestDate}</span>
        </div>
        <p class="summary-meta">Remembered locally. Last fetched: ${syncedAt}</p>
        <p class="summary-meta">Cached range: ${rangeStart} to ${rangeEnd}</p>
        <p class="summary-meta">Observations: ${range?.observations ?? "n/a"}</p>
      </div>
    `;
  }

  if (runtimeSnapshot) {
    const freshness = getSnapshotFreshness(runtimeSnapshot);
    const latestDate = freshness.latestDate
      ? formatDate(freshness.latestDate)
      : "n/a";
    const syncedAt = runtimeSnapshot.generatedAt
      ? formatDateTime(new Date(runtimeSnapshot.generatedAt))
      : "n/a";
    const rangeStart = runtimeSnapshot.range?.startDate
      ? formatDate(new Date(`${runtimeSnapshot.range.startDate}T00:00:00`))
      : "n/a";
    const rangeEnd = runtimeSnapshot.range?.endDate
      ? formatDate(new Date(`${runtimeSnapshot.range.endDate}T00:00:00`))
      : "n/a";
    const demoNote = useDemoData
      ? `<p class="summary-meta">Demo mode is active. Live fetch metadata is shown below for reference only.</p>`
      : "";

    runtimeMeta = `
      <div class="sync-summary-grid">
        <div class="sync-summary-row">
          <span class="summary-pill ${freshness.status}">${describeFreshness(freshness)}</span>
          <span class="summary-meta">Latest market date: ${latestDate}</span>
        </div>
        ${demoNote}
        <p class="summary-meta">Backend fetch: ${runtimeSnapshot.cache?.status || "n/a"}</p>
        <p class="summary-meta">Last fetched: ${syncedAt}</p>
        <p class="summary-meta">Series range: ${rangeStart} to ${rangeEnd}</p>
        <p class="summary-meta">Observations: ${runtimeSnapshot.range?.observations ?? "n/a"}</p>
      </div>
    `;
  }

  const proxyWarning =
    sourceSeriesType && sourceSeriesType !== targetSeriesType
      ? `<p class="summary-meta">Bootstrap uses <span class="mono">${sourceSeriesType}</span> data as a proxy for <span class="mono">${targetSeriesType}</span>.</p>`
      : "";
  const kindLabel =
    selection.kind === "builtin"
      ? "Built-in Mapping"
      : selection.kind === "remembered"
        ? "Remembered Symbol"
        : "Raw Symbol";

  return `
    <div class="note-box">
      <p><span class="section-label">${kindLabel}</span>${selection.label}</p>
      <p>${providerName} · ${family} · ${targetSeriesType}</p>
      <p>Source: <a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceUrl}</a></p>
      <p class="summary-meta">Resolved symbol: <span class="mono">${selection.symbol}</span></p>
      ${proxyWarning}
      ${note ? `<p class="summary-meta">${note}</p>` : ""}
      ${runtimeMeta}
    </div>
  `;
}

function renderResults({
  metrics,
  indexName,
  startDate,
  endDate,
  methodLabel,
  warnings,
}) {
  const warningHtml = warnings.length
    ? `
      <div class="detail-block">
        <h3>Warnings</h3>
        <ul class="warning-list">
          ${warnings.map((warning) => `<li>${warning}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  return `
    <div class="results-shell">
      <div class="results-grid">
        <div class="result-card">
          <p class="meta-label">Sharpe Ratio</p>
          <strong>${formatNumber(metrics.sharpeRatio)}</strong>
          <span>CAGR-based</span>
        </div>
        <div class="result-card">
          <p class="meta-label">Sortino Ratio</p>
          <strong>${formatNumber(metrics.sortinoRatio)}</strong>
          <span>Downside-risk based</span>
        </div>
        <div class="result-card">
          <p class="meta-label">Annualized Return</p>
          <strong>${formatPercent(metrics.annualizedReturn)}</strong>
          <span>${indexName}</span>
        </div>
        <div class="result-card">
          <p class="meta-label">Annualized Volatility</p>
          <strong>${formatPercent(metrics.annualizedVolatility)}</strong>
          <span>${metrics.periodsPerYear} periods per year inferred</span>
        </div>
        <div class="result-card">
          <p class="meta-label">Average Risk-Free Rate</p>
          <strong>${formatPercent(metrics.averageAnnualRiskFreeRate)}</strong>
          <span>Annualized average</span>
        </div>
        <div class="result-card">
          <p class="meta-label">Max Drawdown</p>
          <strong>${formatPercent(metrics.maxDrawdown)}</strong>
          <span>Peak-to-trough</span>
        </div>
      </div>

      <div class="result-details">
        <div class="detail-block">
          <h3>Study Window</h3>
          <p class="result-detail">${formatDateRange(startDate, endDate)}</p>
          <p class="result-detail">Total return: ${formatPercent(metrics.totalReturn)}</p>
          <p class="result-detail">Index observations: ${metrics.observations}</p>
          <p class="result-detail">Return observations: ${metrics.periodicObservations}</p>
          <p class="result-detail">Method: ${methodLabel}</p>
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
        </div>
        ${warningHtml}
      </div>
    </div>
  `;
}

function appendCoverageWarnings(series, startDate, endDate, warnings) {
  if (!series.length) {
    return;
  }

  const firstDate = series[0].date;
  const lastDate = series[series.length - 1].date;

  if (firstDate > startDate) {
    warnings.push(
      `The loaded data starts on ${formatDate(firstDate)}, later than your requested start date.`,
    );
  }

  if (lastDate < endDate) {
    warnings.push(
      `The loaded data ends on ${formatDate(lastDate)}, earlier than your requested end date.`,
    );
  }
}

function appendSnapshotWarnings(snapshot, warnings) {
  const freshness = getSnapshotFreshness(snapshot);

  if (freshness.marketLagDays !== null && freshness.marketLagDays > 5) {
    warnings.push(
      `Latest market date is ${formatDate(freshness.latestDate)}, which is ${freshness.marketLagDays} days behind today.`,
    );
  }

  if (freshness.syncAgeDays !== null && freshness.syncAgeDays > 2) {
    warnings.push(
      `This cached series was fetched ${freshness.syncAgeDays} days ago. The backend will refresh it automatically when the local cache expires.`,
    );
  }
}

function studyTemplate(defaultStartDate, defaultEndDate) {
  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 01</p>
          <h2>Risk-Adjusted Return</h2>
          <p>
            Type a supported index name or any yfinance symbol, choose your
            study window, set the annual risk-free rate manually, and run the
            study. The local backend fetches and caches the series on demand.
          </p>
        </div>
        <div class="note-box">
          <p>
            Formula used:
            <span class="mono">Sharpe = (CAGR - average annual risk-free) / annualized volatility</span>
          </p>
          <p>
            Sortino uses downside deviation built from periodic excess returns.
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
                Type a built-in name like <span class="mono">Nifty 50</span> or any yfinance symbol like <span class="mono">AAPL</span>, <span class="mono">^NSEI</span>, or <span class="mono">ETH-USD</span>.
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
              <label for="use-demo-data">Use synthetic demo data instead of the live backend fetch</label>
            </div>

            <div class="card-wide">
              <label class="field-label" for="constant-rate">Annual Risk-Free Rate %</label>
              <input id="constant-rate" class="input" type="number" step="0.01" value="5.50">
              <p class="helper">
                Fill this manually from the reference you trust, such as the RBI
                91-day T-bill yield on the date you are using as your baseline.
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
          <p class="section-label">Source Hints</p>
          <ul class="source-list">
            <li>Built-in names are resolved to yfinance symbols before the run.</li>
            <li>Any successful ad hoc symbol is remembered locally on this machine.</li>
            <li>Local backend command: <span class="mono">${LOCAL_API_COMMAND}</span></li>
            <li>Risk-free reference: RBI 91-day T-bill data at <a href="https://data.rbi.org.in" target="_blank" rel="noreferrer">data.rbi.org.in</a></li>
          </ul>

          <p class="section-label">System Notes</p>
          <p class="helper">
            The browser no longer reads repo snapshot files directly for this
            study. It asks a local Python backend to fetch and cache symbols on
            demand so the main input can accept built-ins or raw yfinance symbols.
          </p>
        </aside>
      </div>

      <section id="results-root" class="card">
        <div class="empty-state">
          Run the study to see annualized return, volatility, Sharpe ratio,
          Sortino ratio, and drawdown.
        </div>
      </section>
    </div>
  `;
}

const riskAdjustedReturnStudy = {
  id: "risk-adjusted-return",
  title: "Risk-Adjusted Return",
  description:
    "Compute CAGR, volatility, Sharpe, Sortino, and drawdown from an index name or any yfinance symbol.",
  inputSummary:
    "Index name or yfinance symbol, date window, and a manually entered annual risk-free rate.",
  mount(root) {
    const today = new Date();
    const endDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - 5);

    root.innerHTML = studyTemplate(toInputDate(startDate), toInputDate(endDate));

    const form = root.querySelector("#risk-study-form");
    const indexQueryInput = root.querySelector("#index-query");
    const indexSuggestions = root.querySelector("#index-suggestions");
    const indexSummary = root.querySelector("#index-summary");
    const startDateInput = root.querySelector("#start-date");
    const endDateInput = root.querySelector("#end-date");
    const useDemoDataInput = root.querySelector("#use-demo-data");
    const constantRateInput = root.querySelector("#constant-rate");
    const status = root.querySelector("#study-status");
    const resultsRoot = root.querySelector("#results-root");
    const lastFiveYearsButton = root.querySelector("#load-five-year-window");

    let rememberedCatalog = [];
    let lastLoadedSelectionSignature = "none";
    let lastLoadedSnapshot = null;

    function setStatus(message, state = "info") {
      status.className = `status ${state}`;
      status.textContent = message;
    }

    function getSuggestions() {
      return mergeSelectionSuggestions(rememberedCatalog);
    }

    function getCurrentSelection() {
      return findSelectionByQuery(indexQueryInput.value, getSuggestions());
    }

    function populateSuggestionList() {
      indexSuggestions.innerHTML = getSuggestions()
        .map(
          (entry) =>
            `<option value="${entry.label}" label="${entry.symbol} · ${entry.family}"></option>`,
        )
        .join("");
    }

    function updateIndexSummary() {
      const selection = getCurrentSelection();
      const selectionSignature = buildSelectionSignature(selection);
      const runtimeSnapshot =
        selectionSignature === lastLoadedSelectionSignature
          ? lastLoadedSnapshot
          : null;

      indexSummary.innerHTML = renderSelectionDetails(
        selection,
        runtimeSnapshot,
        useDemoDataInput.checked,
      );
    }

    function rememberCatalogEntry(entry) {
      if (!entry?.symbol) {
        return;
      }

      const existingIndex = rememberedCatalog.findIndex(
        (item) => normalizeQuery(item.symbol) === normalizeQuery(entry.symbol),
      );

      if (existingIndex >= 0) {
        rememberedCatalog[existingIndex] = entry;
      } else {
        rememberedCatalog.push(entry);
      }

      populateSuggestionList();
    }

    function buildSeriesRequest(selection) {
      return {
        datasetId: selection.kind === "adhoc" ? undefined : selection.id,
        symbol: selection.symbol,
        label: selection.label,
        providerName: selection.providerName,
        family: selection.family,
        targetSeriesType: selection.targetSeriesType,
        sourceSeriesType: selection.sourceSeriesType,
        sourceUrl: selection.sourceUrl,
        note: selection.note,
        remember: selection.kind !== "builtin",
      };
    }

    async function handleSubmit(event) {
      event.preventDefault();
      setStatus("Running study...", "info");

      try {
        const selection = getCurrentSelection();
        const start = new Date(`${startDateInput.value}T00:00:00`);
        const end = new Date(`${endDateInput.value}T00:00:00`);

        if (!selection) {
          throw new Error("Enter an index name or a yfinance symbol before running the study.");
        }
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          throw new Error("Pick a valid start date and end date.");
        }
        if (start >= end) {
          throw new Error("Start date must be earlier than end date.");
        }

        const riskFreeRate = Number(constantRateInput.value);
        if (!Number.isFinite(riskFreeRate)) {
          throw new Error("Enter a valid annual risk-free rate.");
        }

        let indexSeries = [];
        const warnings = [];
        let methodLabel = "";

        if (useDemoDataInput.checked) {
          indexSeries = filterSeriesByDate(demoIndexSeries, start, end);
          methodLabel = "Synthetic demo data";
          warnings.push("Demo mode uses synthetic data only. It is for UI testing, not analysis.");
          appendCoverageWarnings(indexSeries, start, end, warnings);
        } else {
          const fetched = await fetchIndexSeries(buildSeriesRequest(selection));
          const { snapshot, series, rememberedEntry } = fetched;

          indexSeries = filterSeriesByDate(series, start, end);
          methodLabel = `Local yfinance fetch using ${snapshot.symbol}`;
          appendCoverageWarnings(indexSeries, start, end, warnings);
          appendSnapshotWarnings(snapshot, warnings);

          if (snapshot.sourceSeriesType !== selection.targetSeriesType) {
            warnings.push(
              `Fetched data currently uses ${snapshot.sourceSeriesType} series as a bootstrap proxy for ${selection.targetSeriesType}.`,
            );
          }

          if (snapshot.note) {
            warnings.push(snapshot.note);
          }

          if (rememberedEntry) {
            rememberCatalogEntry(rememberedEntry);
          }

          lastLoadedSelectionSignature = buildSelectionSignature(selection);
          lastLoadedSnapshot = snapshot;
          updateIndexSummary();
        }

        if (indexSeries.length < 2) {
          throw new Error("The selected date range leaves fewer than two index observations.");
        }

        const metrics = computeRiskAdjustedMetrics(indexSeries, {
          constantRiskFreeRate: riskFreeRate / 100,
        });

        if (selection.targetSeriesType !== "TRI") {
          warnings.push("This selection is not marked as TRI. Dividend exclusion can understate long-run return quality.");
        }

        resultsRoot.innerHTML = renderResults({
          metrics,
          indexName: selection.label,
          startDate: indexSeries[0].date,
          endDate: indexSeries[indexSeries.length - 1].date,
          methodLabel,
          warnings,
        });

        setStatus("Study completed.", "success");
      } catch (error) {
        resultsRoot.innerHTML = `
          <div class="empty-state">
            ${error.message}
          </div>
        `;
        setStatus(error.message, "error");
      }
    }

    function applyLastFiveYears() {
      const end = new Date();
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 5);
      startDateInput.value = toInputDate(start);
      endDateInput.value = toInputDate(end);
      setStatus("Loaded a trailing 5-year window.", "info");
    }

    async function loadRememberedSymbols() {
      try {
        rememberedCatalog = await loadRememberedIndexCatalog();
        populateSuggestionList();
        updateIndexSummary();
      } catch (error) {
        rememberedCatalog = [];
        populateSuggestionList();
        updateIndexSummary();
        setStatus(error.message || buildLocalApiUnavailableMessage(), "error");
      }
    }

    function handleSelectionInput() {
      updateIndexSummary();
    }

    indexQueryInput.addEventListener("input", handleSelectionInput);
    indexQueryInput.addEventListener("change", handleSelectionInput);
    useDemoDataInput.addEventListener("change", updateIndexSummary);
    form.addEventListener("submit", handleSubmit);
    lastFiveYearsButton.addEventListener("click", applyLastFiveYears);

    populateSuggestionList();
    updateIndexSummary();
    loadRememberedSymbols();

    return () => {
      form.removeEventListener("submit", handleSubmit);
      indexQueryInput.removeEventListener("input", handleSelectionInput);
      indexQueryInput.removeEventListener("change", handleSelectionInput);
      useDemoDataInput.removeEventListener("change", updateIndexSummary);
      lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    };
  },
};

export { riskAdjustedReturnStudy };
