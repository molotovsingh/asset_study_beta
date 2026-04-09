import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
} from "../lib/format.js";
import {
  exportStudyCsv,
  exportStudyXls,
} from "../lib/studyExport.js";
import {
  inferPeriodsPerYear,
  toPeriodicReturns,
} from "../lib/stats.js";

const OVERVIEW_HASH = "#risk-adjusted-return/overview";
const CHART_WIDTH = 720;
const CHART_HEIGHT = 248;
const CHART_PADDING = {
  top: 18,
  right: 18,
  bottom: 30,
  left: 52,
};

function sampleStdDev(values) {
  if (values.length < 2) {
    return null;
  }

  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function withPadding(minimum, maximum, paddingRatio = 0.08) {
  if (minimum === maximum) {
    const base = Math.abs(minimum) || 1;
    return {
      min: minimum - base * 0.14,
      max: maximum + base * 0.14,
    };
  }

  const span = maximum - minimum;
  return {
    min: minimum - span * paddingRatio,
    max: maximum + span * paddingRatio,
  };
}

function buildTickValues(minimum, maximum, segments = 4) {
  if (segments <= 0) {
    return [minimum];
  }

  const step = (maximum - minimum) / segments;
  return Array.from({ length: segments + 1 }, (_, index) => minimum + step * index);
}

function buildRebasedSeries(indexSeries, baseValue = 100) {
  const startingValue = indexSeries[0]?.value ?? null;
  if (!startingValue) {
    return [];
  }

  return indexSeries.map((point) => ({
    date: point.date,
    value: (point.value / startingValue) * baseValue,
  }));
}

function buildDrawdownSeries(indexSeries) {
  let peak = indexSeries[0]?.value ?? 0;

  return indexSeries.map((point) => {
    peak = Math.max(peak, point.value);
    return {
      date: point.date,
      value: point.value / peak - 1,
    };
  });
}

function resolveRollingWindowSize(periodsPerYear, observationCount) {
  const preferredWindow =
    periodsPerYear >= 200
      ? 63
      : periodsPerYear >= 52
        ? 13
        : periodsPerYear >= 12
          ? 6
          : 3;

  return Math.max(3, Math.min(preferredWindow, observationCount));
}

function buildRollingVolatilitySeries(indexSeries) {
  const periodicReturns = toPeriodicReturns(indexSeries);
  const periodsPerYear = inferPeriodsPerYear(indexSeries);
  const windowSize = resolveRollingWindowSize(
    periodsPerYear,
    periodicReturns.length,
  );

  if (periodicReturns.length < windowSize) {
    return {
      windowSize,
      periodsPerYear,
      series: [],
    };
  }

  const series = [];

  for (let index = windowSize - 1; index < periodicReturns.length; index += 1) {
    const slice = periodicReturns.slice(index - windowSize + 1, index + 1);
    const stdDev = sampleStdDev(slice.map((period) => period.logReturn));
    if (!stdDev) {
      continue;
    }

    series.push({
      date: slice[slice.length - 1].endDate,
      value: stdDev * Math.sqrt(periodsPerYear),
    });
  }

  return {
    windowSize,
    periodsPerYear,
    series,
  };
}

function buildHistogramBins(periodicReturns, binCount = 14) {
  if (!periodicReturns.length) {
    return [];
  }

  const values = periodicReturns.map((period) => period.logReturn);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);

  if (minimum === maximum) {
    return [
      {
        start: minimum,
        end: maximum,
        count: values.length,
      },
    ];
  }

  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: minimum + width * index,
    end: index === binCount - 1 ? maximum : minimum + width * (index + 1),
    count: 0,
  }));

  values.forEach((value) => {
    const rawIndex = Math.floor((value - minimum) / width);
    const boundedIndex = Math.max(0, Math.min(binCount - 1, rawIndex));
    bins[boundedIndex].count += 1;
  });

  return bins;
}

function createTimeScale(series) {
  const startTime = series[0]?.date?.getTime?.() ?? 0;
  const endTime = series[series.length - 1]?.date?.getTime?.() ?? startTime + 1;
  const span = Math.max(endTime - startTime, 1);
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;

  return (date) =>
    CHART_PADDING.left +
    (plotWidth * (date.getTime() - startTime)) / span;
}

function createValueScale(minimum, maximum) {
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const span = Math.max(maximum - minimum, Number.EPSILON);

  return (value) =>
    CHART_PADDING.top + ((maximum - value) / span) * plotHeight;
}

function buildLinePath(series, xScale, yScale) {
  return series
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xScale(point.date).toFixed(2)},${yScale(point.value).toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(series, xScale, yScale, baselineY) {
  if (!series.length) {
    return "";
  }

  const linePath = buildLinePath(series, xScale, yScale);
  const startX = xScale(series[0].date).toFixed(2);
  const endX = xScale(series[series.length - 1].date).toFixed(2);
  return `${linePath} L${endX},${baselineY.toFixed(2)} L${startX},${baselineY.toFixed(2)} Z`;
}

function renderYAxis(ticks, yScale, formatter) {
  const lineStart = CHART_PADDING.left;
  const lineEnd = CHART_WIDTH - CHART_PADDING.right;

  return ticks
    .map(
      (tick) => `
        <g>
          <line
            class="chart-grid-line"
            x1="${lineStart}"
            x2="${lineEnd}"
            y1="${yScale(tick)}"
            y2="${yScale(tick)}"
          />
          <text
            class="chart-axis-label"
            x="${CHART_PADDING.left - 10}"
            y="${yScale(tick) + 4}"
            text-anchor="end"
          >${formatter(tick)}</text>
        </g>
      `,
    )
    .join("");
}

function renderLineChart({
  title,
  summary,
  series,
  minimum,
  maximum,
  formatter,
  statLabel,
  statValue,
  lineClass,
  areaClass = "",
  baselineValue = null,
}) {
  if (series.length < 2) {
    return `
      <section class="card visual-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">${title}</p>
            <p class="summary-meta">${summary}</p>
          </div>
        </div>
        <div class="empty-state visual-chart-empty">
          Not enough observations in the current window to plot this chart.
        </div>
      </section>
    `;
  }

  const xScale = createTimeScale(series);
  const yScale = createValueScale(minimum, maximum);
  const linePath = buildLinePath(series, xScale, yScale);
  const baselineY =
    baselineValue === null
      ? CHART_HEIGHT - CHART_PADDING.bottom
      : yScale(baselineValue);
  const areaPath = areaClass
    ? buildAreaPath(series, xScale, yScale, baselineY)
    : "";
  const ticks = buildTickValues(minimum, maximum);

  return `
    <section class="card visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">${statLabel}</span>
          <strong>${statValue}</strong>
        </div>
      </div>
      <svg
        class="chart-svg"
        viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"
        role="img"
        aria-label="${title}"
      >
        ${renderYAxis(ticks, yScale, formatter)}
        ${
          baselineValue === null
            ? ""
            : `
              <line
                class="chart-baseline"
                x1="${CHART_PADDING.left}"
                x2="${CHART_WIDTH - CHART_PADDING.right}"
                y1="${baselineY}"
                y2="${baselineY}"
              />
            `
        }
        ${areaPath ? `<path class="${areaClass}" d="${areaPath}" />` : ""}
        <path class="${lineClass}" d="${linePath}" />
      </svg>
      <div class="visual-card-foot">
        <span>${formatDate(series[0].date)}</span>
        <span>${formatDate(series[series.length - 1].date)}</span>
      </div>
    </section>
  `;
}

function renderHistogramChart({ title, summary, bins, statLabel, statValue }) {
  if (!bins.length) {
    return `
      <section class="card visual-card">
        <div class="visual-card-head">
          <div>
            <p class="section-label">${title}</p>
            <p class="summary-meta">${summary}</p>
          </div>
        </div>
        <div class="empty-state visual-chart-empty">
          Not enough return observations in the current window to plot this histogram.
        </div>
      </section>
    `;
  }

  const maximumCount = Math.max(...bins.map((bin) => bin.count), 1);
  const yScale = createValueScale(0, maximumCount);
  const ticks = buildTickValues(0, maximumCount);
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const barWidth = plotWidth / bins.length;

  return `
    <section class="card visual-card">
      <div class="visual-card-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
        <div class="visual-card-stat">
          <span class="visual-card-stat-label">${statLabel}</span>
          <strong>${statValue}</strong>
        </div>
      </div>
      <svg
        class="chart-svg"
        viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"
        role="img"
        aria-label="${title}"
      >
        ${renderYAxis(ticks, yScale, (value) => formatNumber(value, 0))}
        ${bins
          .map((bin, index) => {
            const height = (bin.count / maximumCount) * plotHeight;
            const x = CHART_PADDING.left + index * barWidth + 3;
            const width = Math.max(barWidth - 6, 2);
            const y = CHART_HEIGHT - CHART_PADDING.bottom - height;

            return `
              <rect
                class="chart-bar"
                x="${x}"
                y="${y}"
                width="${width}"
                height="${height}"
                rx="5"
              />
            `;
          })
          .join("")}
      </svg>
      <div class="visual-card-foot">
        <span>${formatPercent(bins[0].start)}</span>
        <span>${formatPercent(bins[bins.length - 1].end)}</span>
      </div>
    </section>
  `;
}

function buildVisualModel(studyRun) {
  const { indexSeries, metrics } = studyRun;
  const periodicReturns = toPeriodicReturns(indexSeries);
  const rebasedSeries = buildRebasedSeries(indexSeries);
  const drawdownSeries = buildDrawdownSeries(indexSeries);
  const rollingVolatility = buildRollingVolatilitySeries(indexSeries);
  const histogramBins = buildHistogramBins(periodicReturns);
  const rebasedValues = rebasedSeries.map((point) => point.value);
  const drawdownValues = drawdownSeries.map((point) => point.value);
  const rollingValues = rollingVolatility.series.map((point) => point.value);
  const latestRollingVolatility =
    rollingVolatility.series[rollingVolatility.series.length - 1]?.value ?? null;
  const latestDrawdown =
    drawdownSeries[drawdownSeries.length - 1]?.value ?? metrics.maxDrawdown;

  return {
    rebasedSeries,
    rebasedDomain: withPadding(
      Math.min(...rebasedValues),
      Math.max(...rebasedValues),
      0.1,
    ),
    drawdownSeries,
    drawdownDomain: {
      min: Math.min(...drawdownValues, metrics.maxDrawdown) * 1.08,
      max: 0,
    },
    rollingVolatility,
    rollingVolatilityDomain: rollingValues.length
      ? withPadding(Math.min(...rollingValues), Math.max(...rollingValues), 0.12)
      : { min: 0, max: 1 },
    histogramBins,
    latestRollingVolatility,
    latestDrawdown,
    periodicReturnCount: periodicReturns.length,
  };
}

function renderSummaryCards(studyRun, visualModel) {
  const summaryCards = [
    {
      label: "Selection",
      value: studyRun.seriesLabel,
      detail: formatDateRange(studyRun.actualStartDate, studyRun.actualEndDate),
    },
    {
      label: "Growth Of 100",
      value: formatNumber(
        visualModel.rebasedSeries[visualModel.rebasedSeries.length - 1]?.value ?? 100,
        1,
      ),
      detail: "Rebased level at the end of the active window",
    },
    {
      label: "Latest Drawdown",
      value: formatPercent(visualModel.latestDrawdown),
      detail: "Current peak-to-trough distance from the latest high",
    },
    {
      label: "Rolling Volatility",
      value: formatPercent(visualModel.latestRollingVolatility),
      detail: `${visualModel.rollingVolatility.windowSize}-period annualized window`,
    },
  ];

  return `
    <div class="visuals-summary-grid">
      ${summaryCards
        .map(
          (card) => `
            <section class="card visuals-summary-card">
              <p class="meta-label">${card.label}</p>
              <strong class="visuals-summary-value">${card.value}</strong>
              <p class="summary-meta">${card.detail}</p>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderVisualsShell(studyRun, visualModel) {
  const { metrics, methodLabel, warnings } = studyRun;

  return `
    <div class="visuals-shell">
      <section class="card visuals-hero">
        <div class="visuals-copy">
          <p class="study-kicker">Study 01</p>
          <h2>Visuals</h2>
          <p class="summary-meta">
            Read the last completed run as path, stress, and dispersion without leaving the study.
          </p>
          <p class="summary-meta">
            ${studyRun.seriesLabel} · ${formatDateRange(
              studyRun.actualStartDate,
              studyRun.actualEndDate,
            )} · ${methodLabel}
          </p>
        </div>
        <div class="visuals-actions">
          <a class="study-view-link" href="${OVERVIEW_HASH}">Overview</a>
          <button
            class="results-export-button"
            type="button"
            data-visual-export="csv"
          >Export CSV</button>
          <button
            class="results-export-button"
            type="button"
            data-visual-export="xls"
          >Export XLS</button>
        </div>
      </section>

      ${renderSummaryCards(studyRun, visualModel)}

      <section class="card visuals-context">
        <div class="visuals-context-grid">
          <div>
            <p class="section-label">Run Context</p>
            <p class="summary-meta">
              Return mode: log returns for volatility, tail risk, and distribution charts.
            </p>
            <p class="summary-meta">
              Sampling frequency: ${formatNumber(metrics.periodsPerYear, 0)} periods per year.
            </p>
            <p class="summary-meta">
              Return observations: ${formatNumber(visualModel.periodicReturnCount, 0)}.
            </p>
          </div>
          <div>
            <p class="section-label">Visual Window</p>
            <p class="summary-meta">
              Rolling volatility uses a ${visualModel.rollingVolatility.windowSize}-period annualized window.
            </p>
            <p class="summary-meta">
              Distribution bins use the active period-level log returns from the same study run.
            </p>
          </div>
        </div>
        <p id="visuals-status" class="status visuals-status"></p>
        ${
          warnings.length
            ? `
              <div class="visuals-warning-strip">
                ${warnings
                  .slice(0, 2)
                  .map(
                    (warning) => `
                      <span class="visuals-warning-pill">${warning}</span>
                    `,
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </section>

      <div class="visuals-chart-grid">
        ${renderLineChart({
          title: "Growth Of 100",
          summary: "Price path rebased to 100 at the start of the active window.",
          series: visualModel.rebasedSeries,
          minimum: visualModel.rebasedDomain.min,
          maximum: visualModel.rebasedDomain.max,
          formatter: (value) => formatNumber(value, 0),
          statLabel: "End Level",
          statValue: formatNumber(
            visualModel.rebasedSeries[visualModel.rebasedSeries.length - 1]?.value ?? 100,
            1,
          ),
          lineClass: "chart-line chart-line-growth",
          areaClass: "chart-area chart-area-growth",
        })}
        ${renderLineChart({
          title: "Underwater",
          summary: "Drawdown depth from the prior peak across the current window.",
          series: visualModel.drawdownSeries,
          minimum: visualModel.drawdownDomain.min,
          maximum: visualModel.drawdownDomain.max,
          formatter: (value) => formatPercent(value, 0),
          statLabel: "Worst Drawdown",
          statValue: formatPercent(metrics.maxDrawdown),
          lineClass: "chart-line chart-line-drawdown",
          areaClass: "chart-area chart-area-drawdown",
          baselineValue: 0,
        })}
        ${renderLineChart({
          title: "Rolling Volatility",
          summary: "Annualized realized log-return volatility across a rolling window.",
          series: visualModel.rollingVolatility.series,
          minimum: visualModel.rollingVolatilityDomain.min,
          maximum: visualModel.rollingVolatilityDomain.max,
          formatter: (value) => formatPercent(value, 0),
          statLabel: "Latest",
          statValue: formatPercent(visualModel.latestRollingVolatility),
          lineClass: "chart-line chart-line-volatility",
        })}
        ${renderHistogramChart({
          title: "Log Return Distribution",
          summary: "Histogram of the period-level log returns used by the study.",
          bins: visualModel.histogramBins,
          statLabel: "Win Rate",
          statValue: formatPercent(metrics.winRate),
        })}
      </div>
    </div>
  `;
}

function renderEmptyState(root) {
  root.innerHTML = `
    <div class="empty-state visual-empty">
      <p class="study-kicker">Visuals Need A Run</p>
      <h2>No completed study is available yet.</h2>
      <p class="summary-meta">
        Run the overview once, then return here for growth, drawdown, volatility, and return-distribution charts.
      </p>
      <div class="visuals-actions">
        <a class="study-view-link is-active" href="${OVERVIEW_HASH}">Go To Overview</a>
      </div>
    </div>
  `;
}

function mountRiskAdjustedReturnVisuals(root, session) {
  const studyRun = session.lastStudyRun;
  if (!studyRun) {
    renderEmptyState(root);
    return () => {};
  }

  const visualModel = buildVisualModel(studyRun);
  root.innerHTML = renderVisualsShell(studyRun, visualModel);

  const status = root.querySelector("#visuals-status");

  function setStatus(message, statusState = "info") {
    status.className = `status visuals-status ${statusState}`;
    status.textContent = message;
  }

  function handleClick(event) {
    const exportTrigger = event.target.closest("[data-visual-export]");
    if (!exportTrigger) {
      return;
    }

    try {
      if (exportTrigger.dataset.visualExport === "csv") {
        exportStudyCsv(studyRun);
        setStatus("Downloaded the CSV export.", "success");
        return;
      }

      if (exportTrigger.dataset.visualExport === "xls") {
        exportStudyXls(studyRun);
        setStatus("Downloaded the XLS export.", "success");
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  root.addEventListener("click", handleClick);
  return () => {
    root.removeEventListener("click", handleClick);
  };
}

export { mountRiskAdjustedReturnVisuals };
