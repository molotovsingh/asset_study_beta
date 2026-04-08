import { getIndexById } from "../catalog/indexCatalog.js";
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
  describeFreshness,
  describeSyncSource,
  getManifestCacheKey,
  getManifestDataset,
  getSnapshotFreshness,
  loadSyncManifest,
  loadSyncedSeries,
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

const manifestSyncConfig = {
  provider: "yfinance",
  datasetType: "index",
  datasetId: "catalog",
};

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildYahooQuoteUrl(symbol) {
  return `https://finance.yahoo.com/quote/${symbol}`;
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function buildCustomSymbolCommand(symbol, label) {
  const trimmedSymbol = symbol.trim();
  const trimmedLabel = label.trim();

  if (!trimmedSymbol || !trimmedLabel) {
    return null;
  }

  return `./.venv/bin/python scripts/add_yfinance_symbol.py --symbol ${quoteShellArg(trimmedSymbol)} --label ${quoteShellArg(trimmedLabel)} --refresh --period 5y`;
}

function buildIndexEntry(datasetId, manifestDataset) {
  const catalogEntry = getIndexById(datasetId);
  const symbol = manifestDataset?.symbol || catalogEntry?.sync?.symbol || "";
  const sourceSeriesType =
    manifestDataset?.sourceSeriesType ||
    catalogEntry?.sync?.sourceSeriesType ||
    manifestDataset?.targetSeriesType ||
    catalogEntry?.seriesType ||
    "Price";

  if (!catalogEntry && !manifestDataset) {
    return null;
  }

  return {
    id: datasetId,
    label: manifestDataset?.label || catalogEntry?.label || datasetId,
    provider:
      catalogEntry?.provider || manifestDataset?.providerName || "Yahoo Finance",
    family: catalogEntry?.family || manifestDataset?.family || "Custom",
    seriesType:
      catalogEntry?.seriesType || manifestDataset?.targetSeriesType || "Price",
    sourceUrl:
      catalogEntry?.sourceUrl ||
      manifestDataset?.sourceUrl ||
      (symbol ? buildYahooQuoteUrl(symbol) : "https://finance.yahoo.com"),
    sync: {
      provider: "yfinance",
      datasetType: "index",
      datasetId,
      symbol,
      sourceSeriesType,
      note: manifestDataset?.note || catalogEntry?.sync?.note || null,
    },
  };
}

function renderSyncSummary(indexEntry, manifestDataset, manifestState, useDemoData) {
  if (!indexEntry) {
    return `
      <div class="note-box">
        <p>No synced snapshot is configured for this selection.</p>
      </div>
    `;
  }

  let syncStatusHtml = `
    <div class="sync-summary-row">
      <span class="summary-pill unknown">Manifest unavailable</span>
      <span class="summary-meta">The app could not inspect pull freshness yet.</span>
    </div>
  `;

  if (manifestState === "loading") {
    syncStatusHtml = `
      <div class="sync-summary-row">
        <span class="summary-pill unknown">Loading manifest</span>
        <span class="summary-meta">Inspecting the latest pull metadata.</span>
      </div>
    `;
  } else if (manifestState === "ready" && manifestDataset) {
    const freshness = getSnapshotFreshness(manifestDataset);
    const latestDate = freshness.latestDate
      ? formatDate(freshness.latestDate)
      : "n/a";
    const generatedAt = manifestDataset.generatedAt
      ? formatDateTime(new Date(manifestDataset.generatedAt))
      : "n/a";
    const rangeStart = manifestDataset.range?.startDate
      ? formatDate(new Date(`${manifestDataset.range.startDate}T00:00:00`))
      : "n/a";
    const rangeEnd = manifestDataset.range?.endDate
      ? formatDate(new Date(`${manifestDataset.range.endDate}T00:00:00`))
      : "n/a";
    const observations = manifestDataset.range?.observations ?? "n/a";
    const demoNote = useDemoData
      ? `<p class="summary-meta">Demo mode is active. Synced pull metadata is shown below for reference only.</p>`
      : "";

    syncStatusHtml = `
      <div class="sync-summary-grid">
        <div class="sync-summary-row">
          <span class="summary-pill ${freshness.status}">${describeFreshness(freshness)}</span>
          <span class="summary-meta">Latest market date: ${latestDate}</span>
        </div>
        ${demoNote}
        <p class="summary-meta">Symbol: <span class="mono">${manifestDataset.symbol}</span></p>
        <p class="summary-meta">Last synced: ${generatedAt}</p>
        <p class="summary-meta">Snapshot range: ${rangeStart} to ${rangeEnd}</p>
        <p class="summary-meta">Observations: ${observations}</p>
      </div>
    `;
  } else if (manifestState === "ready") {
    syncStatusHtml = `
      <div class="sync-summary-row">
        <span class="summary-pill unknown">Dataset missing</span>
        <span class="summary-meta">The provider manifest loaded, but this dataset was not listed in it.</span>
      </div>
    `;
  } else if (manifestState === "error") {
    syncStatusHtml = `
      <div class="sync-summary-row">
        <span class="summary-pill stale">Manifest error</span>
        <span class="summary-meta">Run the yfinance sync again if the repo metadata is missing or stale.</span>
      </div>
    `;
  }

  return `
    <div class="note-box">
      <p><span class="section-label">Matched Index</span>${indexEntry.label}</p>
      <p>${indexEntry.provider} · ${indexEntry.family} · ${indexEntry.seriesType}</p>
      <p>Official source: <a href="${indexEntry.sourceUrl}" target="_blank" rel="noreferrer">${indexEntry.sourceUrl}</a></p>
      <p>${describeSyncSource(indexEntry)}</p>
      ${syncStatusHtml}
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
      `Latest synced market date is ${formatDate(freshness.latestDate)}, which is ${freshness.marketLagDays} days behind today.`,
    );
  }

  if (freshness.syncAgeDays !== null && freshness.syncAgeDays > 2) {
    warnings.push(
      `This snapshot was generated ${freshness.syncAgeDays} days ago. Run the yfinance sync again if you need fresher data.`,
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
            Test supported Indian indices with a synced workflow. Pick the
            index, choose whether to use live synced data or demo data, fill the
            annual risk-free rate manually, and run the study.
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
              <label class="field-label" for="index-id">Index</label>
              <select id="index-id" class="input" disabled>
                <option value="">Loading synced catalog...</option>
              </select>
              <p class="helper">
                Any dataset written into the yfinance manifest will appear here,
                including user-added symbols after a refresh.
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
              <label for="use-demo-data">Use synthetic demo data instead of synced snapshots</label>
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
            <li>NSE indices and TRI files: <a href="https://www.niftyindices.com/reports/historical-data" target="_blank" rel="noreferrer">niftyindices.com</a></li>
            <li>BSE index archive: <a href="https://www.bseindia.com/indices/IndexArchiveData.html" target="_blank" rel="noreferrer">bseindia.com</a></li>
            <li>Risk-free reference: RBI 91-day T-bill data at <a href="https://data.rbi.org.in" target="_blank" rel="noreferrer">data.rbi.org.in</a></li>
            <li>Add and sync custom symbol: <span class="mono">./.venv/bin/python scripts/add_yfinance_symbol.py --symbol AAPL --label "Apple" --refresh --period 5y</span></li>
            <li>Refresh command: <span class="mono">./scripts/refresh_yfinance.sh --period 5y</span></li>
          </ul>

          <div class="note-box onboarding-panel">
            <p class="section-label">Add Any yfinance Symbol</p>
            <p class="helper">
              This app cannot write repo config directly. Use this builder to
              generate a one-shot terminal command that registers the symbol and
              refreshes snapshots from the repo root.
            </p>
            <div class="onboarding-grid">
              <div>
                <label class="field-label" for="custom-symbol">Symbol</label>
                <input id="custom-symbol" class="input" type="text" placeholder="AAPL or ETH-USD" autocomplete="off">
              </div>
              <div>
                <label class="field-label" for="custom-symbol-label">Label</label>
                <input id="custom-symbol-label" class="input" type="text" placeholder="Apple Inc" autocomplete="off">
              </div>
            </div>
            <p class="field-label command-label">Generated Command</p>
            <pre id="custom-symbol-command" class="command-block mono">Fill symbol and label to generate the command.</pre>
            <div class="command-actions">
              <button id="copy-custom-symbol-command" class="button secondary" type="button" disabled>Copy Command</button>
              <p id="custom-symbol-status" class="helper">
                This command registers the symbol and refreshes snapshots in one run.
              </p>
            </div>
          </div>

          <p class="section-label">System Notes</p>
          <p class="helper">
            This shell is built so later studies can ask for entirely different
            inputs, files, or calculations. Each study becomes one module in the
            registry instead of another branch in one giant page.
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
    "Compute CAGR, volatility, Sharpe, Sortino, and drawdown from synced index data.",
  inputSummary:
    "Synced index selection, date window, and a manually entered annual risk-free rate.",
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
    const indexIdInput = root.querySelector("#index-id");
    const indexSummary = root.querySelector("#index-summary");
    const startDateInput = root.querySelector("#start-date");
    const endDateInput = root.querySelector("#end-date");
    const useDemoDataInput = root.querySelector("#use-demo-data");
    const constantRateInput = root.querySelector("#constant-rate");
    const customSymbolInput = root.querySelector("#custom-symbol");
    const customSymbolLabelInput = root.querySelector("#custom-symbol-label");
    const customSymbolCommand = root.querySelector("#custom-symbol-command");
    const copyCustomSymbolCommandButton = root.querySelector(
      "#copy-custom-symbol-command",
    );
    const customSymbolStatus = root.querySelector("#custom-symbol-status");
    const status = root.querySelector("#study-status");
    const resultsRoot = root.querySelector("#results-root");
    const lastFiveYearsButton = root.querySelector("#load-five-year-window");
    const manifestsByKey = new Map();
    const manifestStateByKey = new Map();

    function getCurrentManifest() {
      return manifestsByKey.get(getManifestCacheKey(manifestSyncConfig)) || null;
    }

    function getSelectedManifestDataset() {
      return (
        getCurrentManifest()?.datasets?.find(
          (dataset) => dataset.datasetId === indexIdInput.value,
        ) || null
      );
    }

    function getSelectedIndexEntry() {
      return buildIndexEntry(indexIdInput.value, getSelectedManifestDataset());
    }

    function populateIndexOptions() {
      const manifest = getCurrentManifest();
      const datasets = manifest?.datasets || [];
      const previousValue = indexIdInput.value;

      if (!datasets.length) {
        indexIdInput.innerHTML = `<option value="">Loading synced catalog...</option>`;
        indexIdInput.disabled = true;
        return;
      }

      indexIdInput.innerHTML = datasets
        .map(
          (dataset) =>
            `<option value="${dataset.datasetId}">${dataset.label}</option>`,
        )
        .join("");
      indexIdInput.disabled = false;

      const preserved = datasets.some(
        (dataset) => dataset.datasetId === previousValue,
      );
      indexIdInput.value = preserved ? previousValue : datasets[0].datasetId;
    }

    function updateIndexSummary() {
      const indexEntry = getSelectedIndexEntry();
      const manifestKey = getManifestCacheKey(manifestSyncConfig);
      const manifest = manifestsByKey.get(manifestKey) || null;
      const manifestState = manifestStateByKey.get(manifestKey) || "idle";
      const manifestDataset =
        manifest && indexEntry
          ? getManifestDataset(manifest, indexEntry.sync)
          : null;

      indexSummary.innerHTML = renderSyncSummary(
        indexEntry,
        manifestDataset,
        manifestState,
        useDemoDataInput.checked,
      );
    }

    function setStatus(message, state = "info") {
      status.className = `status ${state}`;
      status.textContent = message;
    }

    function updateCustomSymbolBuilderStatus(message) {
      customSymbolStatus.textContent = message;
    }

    function updateCustomSymbolBuilder() {
      const command = buildCustomSymbolCommand(
        customSymbolInput.value,
        customSymbolLabelInput.value,
      );

      if (!command) {
        customSymbolCommand.textContent =
          "Fill symbol and label to generate the command.";
        copyCustomSymbolCommandButton.disabled = true;
        updateCustomSymbolBuilderStatus(
          "The generated command will register the symbol and refresh snapshots in one run.",
        );
        return;
      }

      customSymbolCommand.textContent = command;
      copyCustomSymbolCommandButton.disabled = false;
      updateCustomSymbolBuilderStatus(
        "Run this command in the repo root. It will register the symbol and refresh snapshots so the dataset appears in the selector.",
      );
    }

    async function handleCopyCustomSymbolCommand() {
      const command = buildCustomSymbolCommand(
        customSymbolInput.value,
        customSymbolLabelInput.value,
      );

      if (!command) {
        updateCustomSymbolBuilderStatus(
          "Fill both fields before copying a command.",
        );
        return;
      }

      try {
        await navigator.clipboard.writeText(command);
        updateCustomSymbolBuilderStatus(
          "Command copied. Run it in the repo root to register the symbol and refresh snapshots.",
        );
      } catch (error) {
        updateCustomSymbolBuilderStatus(
          "Clipboard copy failed. Select and copy the command manually.",
        );
      }
    }

    async function handleSubmit(event) {
      event.preventDefault();
      setStatus("Running study...", "info");

      try {
        const chosenIndex = getSelectedIndexEntry();
        const start = new Date(`${startDateInput.value}T00:00:00`);
        const end = new Date(`${endDateInput.value}T00:00:00`);

        if (!chosenIndex) {
          throw new Error("Wait for the synced catalog to load before running the study.");
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
          const syncConfig = chosenIndex?.sync;
          const syncedSnapshot = await loadSyncedSeries(syncConfig);

          indexSeries = filterSeriesByDate(syncedSnapshot.series, start, end);
          methodLabel = `Synced snapshot from ${syncedSnapshot.snapshot.provider} using ${syncedSnapshot.snapshot.symbol}`;
          appendCoverageWarnings(indexSeries, start, end, warnings);
          appendSnapshotWarnings(syncedSnapshot.snapshot, warnings);

          if (syncedSnapshot.snapshot.sourceSeriesType !== chosenIndex?.seriesType) {
            warnings.push(
              `Synced data currently uses ${syncedSnapshot.snapshot.sourceSeriesType} series as a bootstrap proxy for ${chosenIndex.seriesType}.`,
            );
          }

          if (syncedSnapshot.snapshot.note) {
            warnings.push(syncedSnapshot.snapshot.note);
          }
        }

        if (indexSeries.length < 2) {
          throw new Error("The selected date range leaves fewer than two index observations.");
        }

        const metrics = computeRiskAdjustedMetrics(indexSeries, {
          constantRiskFreeRate: riskFreeRate / 100,
        });

        if (chosenIndex?.seriesType !== "TRI") {
          warnings.push("This catalog entry is not marked as TRI. Dividend exclusion can understate long-run return quality.");
        }

        resultsRoot.innerHTML = renderResults({
          metrics,
          indexName: chosenIndex?.label || "Selected Index",
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

    async function ensureManifest(syncConfig) {
      const manifestKey = getManifestCacheKey(syncConfig);
      const existingState = manifestStateByKey.get(manifestKey);

      if (!syncConfig || existingState === "loading" || existingState === "ready") {
        return;
      }

      manifestStateByKey.set(manifestKey, "loading");
      updateIndexSummary();

      try {
        const manifest = await loadSyncManifest(syncConfig);
        manifestsByKey.set(manifestKey, manifest);
        manifestStateByKey.set(manifestKey, "ready");
        populateIndexOptions();
      } catch (error) {
        manifestStateByKey.set(manifestKey, "error");
        setStatus(error.message, "error");
      }

      updateIndexSummary();
    }

    function handleIndexChange() {
      const manifestKey = getManifestCacheKey(manifestSyncConfig);
      const manifestState = manifestStateByKey.get(manifestKey) || "idle";

      if (manifestState === "ready" || manifestState === "error") {
        updateIndexSummary();
      }

      ensureManifest(manifestSyncConfig);
    }

    indexIdInput.addEventListener("change", handleIndexChange);
    useDemoDataInput.addEventListener("change", updateIndexSummary);
    customSymbolInput.addEventListener("input", updateCustomSymbolBuilder);
    customSymbolLabelInput.addEventListener("input", updateCustomSymbolBuilder);
    copyCustomSymbolCommandButton.addEventListener(
      "click",
      handleCopyCustomSymbolCommand,
    );
    form.addEventListener("submit", handleSubmit);
    lastFiveYearsButton.addEventListener("click", applyLastFiveYears);

    ensureManifest(manifestSyncConfig);
    updateIndexSummary();
    updateCustomSymbolBuilder();

    return () => {
      form.removeEventListener("submit", handleSubmit);
      indexIdInput.removeEventListener("change", handleIndexChange);
      useDemoDataInput.removeEventListener("change", updateIndexSummary);
      customSymbolInput.removeEventListener("input", updateCustomSymbolBuilder);
      customSymbolLabelInput.removeEventListener(
        "input",
        updateCustomSymbolBuilder,
      );
      copyCustomSymbolCommandButton.removeEventListener(
        "click",
        handleCopyCustomSymbolCommand,
      );
      lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    };
  },
};

export { riskAdjustedReturnStudy };
