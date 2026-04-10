import { formatNumber, formatPercent } from "../../lib/format.js";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function toneClass(toneId) {
  if (toneId === "positive" || toneId === "caution" || toneId === "neutral") {
    return toneId;
  }

  return "neutral";
}

function renderInterpretationPanel({
  title = "What This Means",
  summary =
    "Deterministic read of this completed run. It explains the sample; it is not a forecast or recommendation.",
  items,
  footnote =
    "Use these cues as context, then check the underlying table, method notes, and exports before relying on the result.",
}) {
  const renderedItems = items
    .filter((item) => item?.text)
    .map(
      (item) => `
        <article class="interpretation-item">
          <div class="interpretation-item-head">
            <p class="meta-label">${item.label}</p>
            <span class="interpretation-badge ${toneClass(item.toneId)}">${item.tone}</span>
          </div>
          <p>${item.text}</p>
        </article>
      `,
    )
    .join("");

  if (!renderedItems) {
    return "";
  }

  return `
    <section class="interpretation-panel" aria-label="${title}">
      <div class="interpretation-head">
        <div>
          <p class="section-label">${title}</p>
          <p class="summary-meta">${summary}</p>
        </div>
      </div>
      <div class="interpretation-grid">
        ${renderedItems}
      </div>
      <p class="interpretation-footnote">${footnote}</p>
    </section>
  `;
}

function classifyReturn(value) {
  if (!isFiniteNumber(value)) {
    return { tone: "No Read", toneId: "neutral" };
  }
  if (value >= 0.12) {
    return { tone: "Strong", toneId: "positive" };
  }
  if (value >= 0.06) {
    return { tone: "Positive", toneId: "positive" };
  }
  if (value >= 0) {
    return { tone: "Low Positive", toneId: "neutral" };
  }
  return { tone: "Negative", toneId: "caution" };
}

function classifyVolatility(value) {
  if (!isFiniteNumber(value)) {
    return { tone: "No Read", toneId: "neutral" };
  }
  if (value <= 0.12) {
    return { tone: "Low Noise", toneId: "positive" };
  }
  if (value <= 0.22) {
    return { tone: "Equity-Like", toneId: "neutral" };
  }
  if (value <= 0.35) {
    return { tone: "Elevated", toneId: "caution" };
  }
  return { tone: "High", toneId: "caution" };
}

function classifyDrawdown(value) {
  if (!isFiniteNumber(value)) {
    return { tone: "No Read", toneId: "neutral" };
  }

  const depth = Math.abs(value);
  if (depth <= 0.1) {
    return { tone: "Shallow", toneId: "positive" };
  }
  if (depth <= 0.25) {
    return { tone: "Moderate", toneId: "neutral" };
  }
  if (depth <= 0.4) {
    return { tone: "Deep", toneId: "caution" };
  }
  return { tone: "Severe", toneId: "caution" };
}

function classifyRatio(value) {
  if (!isFiniteNumber(value)) {
    return { tone: "No Read", toneId: "neutral" };
  }
  if (value >= 1) {
    return { tone: "Strong", toneId: "positive" };
  }
  if (value >= 0.5) {
    return { tone: "Moderate", toneId: "neutral" };
  }
  if (value >= 0) {
    return { tone: "Thin", toneId: "neutral" };
  }
  return { tone: "Negative", toneId: "caution" };
}

function classifyRate(value) {
  if (!isFiniteNumber(value)) {
    return { tone: "No Read", toneId: "neutral" };
  }
  if (value >= 0.7) {
    return { tone: "Broad", toneId: "positive" };
  }
  if (value >= 0.55) {
    return { tone: "Tilted", toneId: "neutral" };
  }
  if (value >= 0.45) {
    return { tone: "Mixed", toneId: "neutral" };
  }
  return { tone: "Weak", toneId: "caution" };
}

function classifySample(count, minimum = 30) {
  if (!isFiniteNumber(count)) {
    return { tone: "No Read", toneId: "neutral" };
  }
  if (count >= minimum) {
    return { tone: "Adequate", toneId: "positive" };
  }
  if (count >= Math.ceil(minimum / 2)) {
    return { tone: "Thin", toneId: "neutral" };
  }
  return { tone: "Very Thin", toneId: "caution" };
}

function renderRiskInterpretation(metrics) {
  const returnTone = classifyReturn(metrics.annualizedReturn);
  const volatilityTone = classifyVolatility(metrics.annualizedVolatility);
  const drawdownTone = classifyDrawdown(metrics.maxDrawdown);
  const ratioTone = classifyRatio(metrics.sharpeRatio);

  return renderInterpretationPanel({
    items: [
      {
        label: "Return",
        ...returnTone,
        text: `CAGR is ${formatPercent(metrics.annualizedReturn)} and total return is ${formatPercent(metrics.totalReturn)}. CAGR makes the start and end values comparable as an annualized path.`,
      },
      {
        label: "Volatility",
        ...volatilityTone,
        text: `Annualized log-return volatility is ${formatPercent(metrics.annualizedVolatility)}. Treat it as the historical noise around the return path, not as direction.`,
      },
      {
        label: "Drawdown",
        ...drawdownTone,
        text: `Max drawdown reached ${formatPercent(metrics.maxDrawdown)} and the longest drawdown span was ${formatNumber(metrics.maxDrawdownDurationDays, 0)} days. This is the historical pain-from-peak measure.`,
      },
      {
        label: "Risk-Adjusted",
        ...ratioTone,
        text: `Sharpe is ${formatNumber(metrics.sharpeRatio)} and Sortino is ${formatNumber(metrics.sortinoRatio)} using the selected risk-free rate. Positive values mean the sample cleared that hurdle after volatility or downside risk.`,
      },
    ],
    footnote:
      "The return, volatility, and ratio bands are broad equity-style heuristics. The relative view is better for judging one asset against another.",
  });
}

function renderRelativeInterpretation({ relativeMetrics, assetLabel, benchmarkLabel }) {
  const spreadTone = classifyReturn(relativeMetrics.cagrSpread);
  const trackingTone = classifyVolatility(relativeMetrics.trackingError);
  const correlationTone =
    Math.abs(relativeMetrics.correlation ?? 0) >= 0.8
      ? { tone: "High Fit", toneId: "positive" }
      : Math.abs(relativeMetrics.correlation ?? 0) >= 0.5
        ? { tone: "Partial Fit", toneId: "neutral" }
        : { tone: "Low Fit", toneId: "caution" };
  const outperformanceTone = classifyRate(relativeMetrics.outperformanceRate);

  return renderInterpretationPanel({
    title: "Relative Read",
    summary:
      "Factual benchmark context from aligned log returns. It explains spread and sensitivity; it does not choose a winner.",
    items: [
      {
        label: "Spread",
        ...spreadTone,
        text: `${assetLabel} CAGR is ${formatPercent(relativeMetrics.cagrSpread)} versus ${benchmarkLabel} over the shared window. Positive spread means the asset compounded faster in this sample.`,
      },
      {
        label: "Fit",
        ...correlationTone,
        text: `Correlation is ${formatNumber(relativeMetrics.correlation)} and beta is ${formatNumber(relativeMetrics.beta)}. Higher correlation means the pair moved together more often on shared dates.`,
      },
      {
        label: "Active Risk",
        ...trackingTone,
        text: `Tracking error is ${formatPercent(relativeMetrics.trackingError)}. This is the annualized volatility of the asset-minus-benchmark return stream.`,
      },
      {
        label: "Hit Rate",
        ...outperformanceTone,
        text: `The asset beat the benchmark in ${formatPercent(relativeMetrics.outperformanceRate)} of aligned periods. This is frequency, not magnitude.`,
      },
    ],
  });
}

function renderSeasonalityInterpretation(summary) {
  const spreadTone =
    isFiniteNumber(summary.seasonalitySpread) && Math.abs(summary.seasonalitySpread) >= 0.05
      ? { tone: "Wide", toneId: "positive" }
      : isFiniteNumber(summary.seasonalitySpread) && Math.abs(summary.seasonalitySpread) >= 0.02
        ? { tone: "Visible", toneId: "neutral" }
        : { tone: "Subtle", toneId: "neutral" };
  const sampleTone =
    summary.thinMonthCount > 0
      ? { tone: "Check Samples", toneId: "caution" }
      : classifySample(summary.yearsObserved, 5);

  return renderInterpretationPanel({
    items: [
      {
        label: "Seasonality Spread",
        ...spreadTone,
        text: `The strongest-minus-weakest month spread is ${formatPercent(summary.seasonalitySpread)}. Larger spreads are easier to notice, but still come from historical buckets.`,
      },
      {
        label: "Evidence",
        ...sampleTone,
        text: `${formatNumber(summary.yearsObserved, 0)} years and ${formatNumber(summary.monthsUsed, 0)} monthly rows are in the sample. ${formatNumber(summary.thinMonthCount, 0)} month buckets are flagged as thin.`,
      },
      {
        label: "Consistency",
        tone: summary.mostConsistentMonth ? "Directional" : "No Read",
        toneId: summary.mostConsistentMonth ? "neutral" : "caution",
        text: summary.mostConsistentMonth
          ? `${summary.mostConsistentMonth.monthLabel} is the most consistent bucket at ${formatPercent(summary.mostConsistentMonth.consistencyScore)} in its dominant direction.`
          : "No populated month had enough observations for a consistency read.",
      },
      {
        label: "Confidence",
        tone: summary.clearSignalCount > 0 ? "Clear Bands" : "Mixed Bands",
        toneId: summary.clearSignalCount > 0 ? "positive" : "neutral",
        text: `${formatNumber(summary.clearSignalCount, 0)} month buckets have confidence bands that stay fully above or below zero. Mixed bands mean the average is not clearly separated from zero in this sample.`,
      },
    ],
  });
}

function renderRollingReturnsInterpretation(studyRun) {
  const { summary } = studyRun;
  const sampleTone = classifySample(summary.totalRollingObservations, 60);
  const returnTone = classifyReturn(studyRun.fullPeriodCagr);
  const rangeTone =
    summary.widestRangeWindow?.cagrRange >= 0.25
      ? { tone: "Wide", toneId: "caution" }
      : { tone: "Contained", toneId: "neutral" };

  return renderInterpretationPanel({
    items: [
      {
        label: "Full Window",
        ...returnTone,
        text: `The full-period CAGR is ${formatPercent(studyRun.fullPeriodCagr)}. Rolling windows show whether that headline was stable across different entry and exit dates.`,
      },
      {
        label: "Latest Window",
        tone: summary.latestLeader ? "Leader" : "No Read",
        toneId: summary.latestLeader ? "neutral" : "caution",
        text: summary.latestLeader
          ? `${summary.latestLeader.windowLabel} has the highest latest rolling CAGR at ${formatPercent(summary.latestLeader.latestCagr)}.`
          : "No rolling horizon is available for the active range.",
      },
      {
        label: "Range",
        ...rangeTone,
        text: summary.widestRangeWindow
          ? `${summary.widestRangeWindow.windowLabel} has the widest best-to-worst CAGR range at ${formatPercent(summary.widestRangeWindow.cagrRange)}. Wide ranges mean entry date mattered more.`
          : "No range can be computed until at least one full rolling horizon is available.",
      },
      {
        label: "Sample",
        ...sampleTone,
        text: `${formatNumber(summary.availableWindowCount, 0)} horizons and ${formatNumber(summary.totalRollingObservations, 0)} rolling windows are available. Longer horizons naturally have fewer observations.`,
      },
    ],
  });
}

function renderSipInterpretation(studyRun) {
  const { summary } = studyRun;
  const fullWindow = summary.fullWindowCohort;
  const medianTone = classifyReturn(summary.medianXirr);
  const positiveTone = classifyRate(summary.positiveRate);
  const spread =
    summary.bestCohort && summary.worstCohort
      ? summary.bestCohort.xirr - summary.worstCohort.xirr
      : null;
  const spreadTone =
    isFiniteNumber(spread) && spread >= 0.15
      ? { tone: "Wide", toneId: "caution" }
      : { tone: "Contained", toneId: "neutral" };

  return renderInterpretationPanel({
    items: [
      {
        label: "Full Window",
        tone: fullWindow ? "Concrete Path" : "No Read",
        toneId: fullWindow ? "neutral" : "caution",
        text: fullWindow
          ? `The full-window SIP XIRR is ${formatPercent(fullWindow.xirr)} from ${fullWindow.startMonthLabel} to the terminal date. This is one path, not the whole distribution.`
          : "No full-window cohort is available for this range.",
      },
      {
        label: "Median Cohort",
        ...medianTone,
        text: `The median eligible cohort XIRR is ${formatPercent(summary.medianXirr)} across ${formatNumber(summary.totalCohorts, 0)} start months.`,
      },
      {
        label: "Hit Rate",
        ...positiveTone,
        text: `${formatPercent(summary.positiveRate)} of included cohorts finished with a positive XIRR. This counts frequency, not the size of gains.`,
      },
      {
        label: "Start-Date Spread",
        ...spreadTone,
        text: isFiniteNumber(spread)
          ? `Best-to-worst cohort XIRR spread is ${formatPercent(spread)}. A wide spread means SIP outcome still depended materially on start month.`
          : "Best and worst cohorts are unavailable for this range.",
      },
    ],
  });
}

function renderLumpsumVsSipInterpretation(studyRun) {
  const { summary } = studyRun;
  const winnerTone =
    summary.lumpsumWinRate > summary.sipWinRate
      ? { tone: "Lumpsum Tilt", toneId: "neutral" }
      : summary.sipWinRate > summary.lumpsumWinRate
        ? { tone: "SIP Tilt", toneId: "neutral" }
        : { tone: "Even", toneId: "neutral" };
  const advantageTone =
    Math.abs(summary.medianAdvantageRate ?? 0) >= 0.1
      ? { tone: "Material", toneId: "caution" }
      : { tone: "Small", toneId: "neutral" };
  const sampleTone = classifySample(summary.totalCohorts, 30);

  return renderInterpretationPanel({
    items: [
      {
        label: "Win Tilt",
        ...winnerTone,
        text: `Lumpsum won ${formatPercent(summary.lumpsumWinRate)} of cohorts and SIP won ${formatPercent(summary.sipWinRate)}. Win rate counts how often each path led, not by how much.`,
      },
      {
        label: "Median Gap",
        ...advantageTone,
        text: `Median advantage is ${formatPercent(summary.medianAdvantageRate)}. Positive means lumpsum finished ahead; negative means SIP finished ahead.`,
      },
      {
        label: "Middle 50%",
        tone: "Distribution",
        toneId: "neutral",
        text: `The middle half of historical start months ranged from ${formatPercent(summary.percentile25AdvantageRate)} to ${formatPercent(summary.percentile75AdvantageRate)} advantage.`,
      },
      {
        label: "Sample",
        ...sampleTone,
        text: `${formatNumber(summary.totalCohorts, 0)} cohorts are available for the ${formatNumber(studyRun.horizonYears, 0)}Y horizon. Fewer cohorts make the comparison more date-sensitive.`,
      },
    ],
  });
}

export {
  renderInterpretationPanel,
  renderLumpsumVsSipInterpretation,
  renderRelativeInterpretation,
  renderRiskInterpretation,
  renderRollingReturnsInterpretation,
  renderSeasonalityInterpretation,
  renderSipInterpretation,
};
