import { indexCatalog, findIndexByName } from "../catalog/indexCatalog.js";
import { parseIndexSeriesCsv, parseRiskFreeCsv } from "../lib/csv.js";
import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  filterSeriesByDate,
  computeRiskAdjustedMetrics,
} from "../lib/stats.js";

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

const demoRiskFreeSeries = [
  ["2021-04-07", 6.15],
  ["2021-07-07", 5.95],
  ["2021-10-07", 5.8],
  ["2022-01-07", 5.6],
  ["2022-04-07", 5.35],
  ["2022-07-07", 5.2],
  ["2022-10-07", 5.3],
  ["2023-01-07", 6.1],
  ["2023-04-07", 6.65],
  ["2023-07-07", 6.8],
  ["2023-10-07", 6.9],
  ["2024-01-07", 7.05],
  ["2024-04-07", 6.92],
  ["2024-07-07", 6.76],
  ["2024-10-07", 6.65],
  ["2025-01-07", 6.48],
  ["2025-04-07", 6.24],
  ["2025-07-07", 6.02],
  ["2025-10-07", 5.74],
  ["2026-01-07", 5.52],
  ["2026-04-07", 5.4],
].map(([date, value]) => ({ date: new Date(`${date}T00:00:00`), value }));

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function renderIndexSummary(indexEntry) {
  if (!indexEntry) {
    return `
      <div class="note-box">
        <p>Type any index name. If it is not in the seeded catalog yet, you can still run the study using a manual CSV upload.</p>
      </div>
    `;
  }

  return `
    <div class="note-box">
      <p><span class="section-label">Matched Index</span>${indexEntry.label}</p>
      <p>${indexEntry.provider} · ${indexEntry.family} · ${indexEntry.seriesType}</p>
      <p>Official source: <a href="${indexEntry.sourceUrl}" target="_blank" rel="noreferrer">${indexEntry.sourceUrl}</a></p>
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

async function parseFile(file, parser) {
  if (!file) {
    return null;
  }

  const text = await file.text();
  return parser(text);
}

function studyTemplate(defaultStartDate, defaultEndDate) {
  const datalistOptions = indexCatalog
    .map((entry) => `<option value="${entry.label}"></option>`)
    .join("");

  return `
    <div class="study-layout">
      <div class="study-header">
        <div class="study-copy">
          <p class="study-kicker">Study 01</p>
          <h2>Risk-Adjusted Return</h2>
          <p>
            Test any Indian index with a simple workflow. Type the index, upload
            the index series CSV, plug in the risk-free series or a fixed annual
            rate, and run the study.
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
              <label class="field-label" for="index-name">Index</label>
              <input id="index-name" class="input" list="index-catalog" value="Nifty 50 TRI" placeholder="Type any index name">
              <datalist id="index-catalog">${datalistOptions}</datalist>
              <p class="helper">
                The catalog is only a seed list. If your index is missing, keep
                the name you want and upload the correct CSV.
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
              <label for="use-demo-data">Use synthetic demo data instead of uploaded CSVs</label>
            </div>

            <div class="card-wide">
              <label class="field-label" for="index-file">Index Series CSV</label>
              <input id="index-file" class="file-input" type="file" accept=".csv,text/csv">
              <p class="helper">
                Expected columns can include
                <span class="mono">Date</span> and
                <span class="mono">Close</span>,
                <span class="mono">Total Returns Index</span>,
                or a similar value field.
              </p>
            </div>

            <div>
              <label class="field-label" for="risk-free-mode">Risk-Free Input</label>
              <select id="risk-free-mode" class="input">
                <option value="constant">Constant annual rate</option>
                <option value="csv">Upload RBI yield CSV</option>
              </select>
            </div>

            <div id="constant-rate-group">
              <label class="field-label" for="constant-rate">Annual Rate %</label>
              <input id="constant-rate" class="input" type="number" step="0.01" value="5.50">
            </div>

            <div id="risk-free-file-group" hidden>
              <label class="field-label" for="risk-free-file">Risk-Free CSV</label>
              <input id="risk-free-file" class="file-input" type="file" accept=".csv,text/csv">
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
          </ul>

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
    "Compute CAGR, volatility, Sharpe, Sortino, and drawdown from uploaded index data.",
  inputSummary:
    "Index name, date window, index CSV, and either a fixed annual risk-free rate or an RBI yield CSV.",
  mount(root) {
    const today = new Date();
    const endDate = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    );
    const startDate = new Date(endDate);
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 5);

    root.innerHTML = studyTemplate(toInputDate(startDate), toInputDate(endDate));

    const form = root.querySelector("#risk-study-form");
    const indexNameInput = root.querySelector("#index-name");
    const indexSummary = root.querySelector("#index-summary");
    const startDateInput = root.querySelector("#start-date");
    const endDateInput = root.querySelector("#end-date");
    const useDemoDataInput = root.querySelector("#use-demo-data");
    const indexFileInput = root.querySelector("#index-file");
    const riskFreeModeInput = root.querySelector("#risk-free-mode");
    const constantRateGroup = root.querySelector("#constant-rate-group");
    const constantRateInput = root.querySelector("#constant-rate");
    const riskFreeFileGroup = root.querySelector("#risk-free-file-group");
    const riskFreeFileInput = root.querySelector("#risk-free-file");
    const status = root.querySelector("#study-status");
    const resultsRoot = root.querySelector("#results-root");
    const lastFiveYearsButton = root.querySelector("#load-five-year-window");

    function updateIndexSummary() {
      indexSummary.innerHTML = renderIndexSummary(
        findIndexByName(indexNameInput.value),
      );
    }

    function updateRiskFreeMode() {
      const useCsv = riskFreeModeInput.value === "csv";
      constantRateGroup.hidden = useCsv;
      riskFreeFileGroup.hidden = !useCsv;
    }

    function setStatus(message, state = "info") {
      status.className = `status ${state}`;
      status.textContent = message;
    }

    async function handleSubmit(event) {
      event.preventDefault();
      setStatus("Running study...", "info");

      try {
        const chosenIndex = findIndexByName(indexNameInput.value);
        const start = new Date(`${startDateInput.value}T00:00:00`);
        const end = new Date(`${endDateInput.value}T00:00:00`);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          throw new Error("Pick a valid start date and end date.");
        }
        if (start >= end) {
          throw new Error("Start date must be earlier than end date.");
        }

        let indexSeries = [];
        let riskFreeSeries = null;
        const warnings = [];
        let methodLabel = "";

        if (useDemoDataInput.checked) {
          indexSeries = filterSeriesByDate(demoIndexSeries, start, end);
          riskFreeSeries =
            riskFreeModeInput.value === "csv"
              ? filterSeriesByDate(demoRiskFreeSeries, start, end)
              : null;
          methodLabel = "Synthetic demo data";
          warnings.push("Demo mode uses synthetic data only. It is for UI testing, not analysis.");
        } else {
          const indexFile = indexFileInput.files[0];
          const parsedIndex = await parseFile(indexFile, parseIndexSeriesCsv);
          if (!parsedIndex) {
            throw new Error("Upload an index CSV or enable demo mode.");
          }

          indexSeries = filterSeriesByDate(parsedIndex.series, start, end);
          methodLabel = `Uploaded CSV using ${parsedIndex.detectedColumns.date} + ${parsedIndex.detectedColumns.value}`;

          if (riskFreeModeInput.value === "csv") {
            const parsedRiskFree = await parseFile(
              riskFreeFileInput.files[0],
              parseRiskFreeCsv,
            );
            if (!parsedRiskFree) {
              throw new Error("Upload a risk-free CSV or switch to a constant annual rate.");
            }

            riskFreeSeries = filterSeriesByDate(parsedRiskFree.series, start, end);
            methodLabel += `; risk-free from ${parsedRiskFree.detectedColumns.value}`;
          }
        }

        if (indexSeries.length < 2) {
          throw new Error("The selected date range leaves fewer than two index observations.");
        }

        const metrics = computeRiskAdjustedMetrics(indexSeries, {
          riskFreeSeries,
          constantRiskFreeRate:
            riskFreeModeInput.value === "constant"
              ? Number(constantRateInput.value) / 100
              : 0,
        });

        if (!chosenIndex || chosenIndex.id === "custom") {
          warnings.push("This run depends entirely on the uploaded CSV. No catalog validation was applied.");
        } else if (chosenIndex.seriesType !== "TRI") {
          warnings.push("This catalog entry is not marked as TRI. Dividend exclusion can understate long-run return quality.");
        }

        resultsRoot.innerHTML = renderResults({
          metrics,
          indexName: indexNameInput.value.trim() || "Custom Index",
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

    indexNameInput.addEventListener("input", updateIndexSummary);
    riskFreeModeInput.addEventListener("change", updateRiskFreeMode);
    form.addEventListener("submit", handleSubmit);
    lastFiveYearsButton.addEventListener("click", applyLastFiveYears);

    updateIndexSummary();
    updateRiskFreeMode();

    return () => {
      form.removeEventListener("submit", handleSubmit);
      indexNameInput.removeEventListener("input", updateIndexSummary);
      riskFreeModeInput.removeEventListener("change", updateRiskFreeMode);
      lastFiveYearsButton.removeEventListener("click", applyLastFiveYears);
    };
  },
};

export { riskAdjustedReturnStudy };
