import { buildSectorSnapshotStudyRun, flattenSectorSnapshotRows } from "../app/lib/sectorSnapshot.js";
import { buildCsvRows, buildWorkbookXml } from "../app/lib/sectorSnapshotExport.js";
import { getStudyById } from "../app/studies/registry.js";
import {
  renderMarketPresetInfo,
  renderSectorSnapshotResults,
  sectorSnapshotTemplate,
} from "../app/studies/sectorSnapshotView.js";
import { mountSectorSnapshotVisuals } from "../app/studies/sectorSnapshotVisuals.js";

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  assertionCount += 1;
}

function createBusinessDaySeries({
  startDate,
  endDate,
  initialValue,
  drift,
  cycleAmplitude = 0,
  cycleLength = 63,
  shockEvery = 0,
  shockDepth = 0,
}) {
  const series = [];
  let value = initialValue;
  let observationIndex = 0;
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const cycle =
        cycleAmplitude *
        Math.sin((observationIndex / cycleLength) * Math.PI * 2);
      const shock =
        shockEvery > 0 && observationIndex > 0 && observationIndex % shockEvery === 0
          ? shockDepth
          : 0;
      value *= 1 + drift + cycle + shock;
      value = Math.max(value, 5);
      series.push({
        date: new Date(cursor),
        value,
      });
      observationIndex += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return series;
}

function buildLoadedEntry(entry, series, providerName, provider) {
  return {
    entry,
    snapshot: {
      providerName,
      provider,
    },
    series,
  };
}

function buildFixtureStudyRun() {
  const market = {
    id: "india",
    label: "India",
    universeLabel: "Sector Test Basket",
    note: "Synthetic sector universe used for regression coverage.",
    horizons: [1, 5, 10, 20],
    benchmark: {
      id: "nifty-50",
      label: "Nifty 50",
      symbol: "^NSEI",
    },
    sectors: [
      { id: "bank", label: "Bank", symbol: "^NSEBANK" },
      { id: "pharma", label: "Pharma", symbol: "^CNXPHARMA" },
      { id: "auto", label: "Auto", symbol: "^CNXAUTO" },
      { id: "realty", label: "Realty", symbol: "^CNXREALTY" },
    ],
  };

  const benchmarkEntry = market.benchmark;
  const benchmarkSeries = createBusinessDaySeries({
    startDate: "2004-01-01",
    endDate: "2026-04-09",
    initialValue: 100,
    drift: 0.00027,
    cycleAmplitude: 0.0011,
    cycleLength: 66,
    shockEvery: 520,
    shockDepth: -0.038,
  });

  const sectorEntries = [
    buildLoadedEntry(
      market.sectors[0],
      createBusinessDaySeries({
        startDate: "2004-01-01",
        endDate: "2026-04-09",
        initialValue: 100,
        drift: 0.00039,
        cycleAmplitude: 0.0017,
        cycleLength: 58,
        shockEvery: 610,
        shockDepth: -0.045,
      }),
      "Yahoo Finance (yfinance)",
      "yfinance",
    ),
    buildLoadedEntry(
      market.sectors[1],
      createBusinessDaySeries({
        startDate: "2004-01-01",
        endDate: "2026-04-09",
        initialValue: 100,
        drift: 0.00031,
        cycleAmplitude: 0.001,
        cycleLength: 74,
        shockEvery: 760,
        shockDepth: -0.028,
      }),
      "Yahoo Finance (yfinance)",
      "yfinance",
    ),
    buildLoadedEntry(
      market.sectors[2],
      createBusinessDaySeries({
        startDate: "2004-01-01",
        endDate: "2026-04-09",
        initialValue: 100,
        drift: 0.0002,
        cycleAmplitude: 0.0019,
        cycleLength: 61,
        shockEvery: 430,
        shockDepth: -0.065,
      }),
      "Yahoo Finance (RapidAPI yahoo-finance15)",
      "yahoo-finance15",
    ),
    buildLoadedEntry(
      market.sectors[3],
      createBusinessDaySeries({
        startDate: "2012-01-02",
        endDate: "2026-04-09",
        initialValue: 100,
        drift: 0.00026,
        cycleAmplitude: 0.0014,
        cycleLength: 63,
        shockEvery: 690,
        shockDepth: -0.042,
      }),
      "Yahoo Finance (yfinance)",
      "yfinance",
    ),
  ];

  const studyRun = buildSectorSnapshotStudyRun({
    market,
    benchmarkEntry,
    benchmarkSnapshot: {
      providerName: "Yahoo Finance (yfinance)",
      provider: "yfinance",
    },
    benchmarkSeries,
    sectorEntries,
    riskFreeRate: 0.06,
    focusHorizonYears: 5,
    focusMetricKey: "relativeWealth",
    exportedAt: new Date("2026-04-12T00:00:00Z"),
    warnings: [],
  });
  studyRun.warnings = [
    "Some series used fallback providers: Yahoo Finance (RapidAPI yahoo-finance15) (1).",
    "20Y horizon is unavailable for 1 sector because trailing coverage is incomplete.",
  ];
  return studyRun;
}

function testStudyRun() {
  const studyRun = buildFixtureStudyRun();
  assert(studyRun.studyTitle === "Sector Snapshot", "study title mismatch");
  assert(studyRun.horizonResults.length === 4, "expected four configured horizons");
  assert(
    studyRun.focusHorizonResult?.years === 5,
    "focus horizon should resolve to 5Y",
  );
  assert(
    studyRun.focusRows[0]?.label === "Bank",
    "bank should lead the 5Y focus metric in the fixture",
  );
  const twentyYear = studyRun.horizonResults.find((result) => result.years === 20);
  assert(Boolean(twentyYear), "20Y horizon should exist");
  assert(
    twentyYear.unavailableCount === 1,
    "20Y horizon should mark the late-start sector unavailable",
  );
  assert(
    twentyYear.rows.find((row) => row.label === "Realty")?.available === false,
    "late-start sector should be unavailable in 20Y",
  );
  assert(
    studyRun.providerSummary.some(
      (entry) => entry.providerName === "Yahoo Finance (RapidAPI yahoo-finance15)",
    ),
    "provider summary should include the fallback provider",
  );

  const rows = flattenSectorSnapshotRows(studyRun);
  assert(rows.length === 16, "flattened rows should cover sectors across horizons");

  const csvRows = buildCsvRows(studyRun);
  assert(csvRows.length === 17, "csv export should include header plus flattened rows");
  assert(csvRows[0][0] === "Market", "csv header should start with Market");
  assert(csvRows[1][0] === "India", "first csv row should carry the market label");

  const workbookXml = buildWorkbookXml(studyRun);
  assert(
    workbookXml.includes('Worksheet ss:Name="Summary"'),
    "workbook should include the summary sheet",
  );
  assert(
    workbookXml.includes('Worksheet ss:Name="Focus Horizon"'),
    "workbook should include the focus horizon sheet",
  );
  assert(
    workbookXml.includes("Yahoo Finance (RapidAPI yahoo-finance15)"),
    "workbook should include provider names",
  );

  console.log("ok sector snapshot study");
}

function testStudyViews() {
  const studyRun = buildFixtureStudyRun();
  const template = sectorSnapshotTemplate({
    market: studyRun.market,
    focusMetricKey: studyRun.focusMetricKey,
    focusHorizonYears: studyRun.focusHorizonYears,
    riskFreeRateValue: "6.00",
  });
  assert(
    template.includes('id="sector-snapshot-form"'),
    "template should include the sector snapshot form",
  );
  assert(
    template.includes("Try India 5Y relative snapshot"),
    "template should include the India starter link",
  );

  const presetInfo = renderMarketPresetInfo(studyRun.market);
  assert(
    presetInfo.includes("This study ignores the sidebar active asset"),
    "preset info should explain that the study uses its own universe",
  );

  const resultsMarkup = renderSectorSnapshotResults(studyRun);
  assert(
    resultsMarkup.includes("Absolute CAGR Heatmap"),
    "results should include the absolute heatmap section",
  );
  assert(
    resultsMarkup.includes("Relative Wealth Heatmap"),
    "results should include the relative heatmap section",
  );
  assert(
    resultsMarkup.includes("Focus Horizon Table"),
    "results should include the focus table",
  );
  assert(
    resultsMarkup.includes("Export CSV") && resultsMarkup.includes("Export XLS"),
    "results should include both export actions",
  );

  const populatedRoot = { innerHTML: "" };
  const disposeVisuals = mountSectorSnapshotVisuals(populatedRoot, {
    lastStudyRun: studyRun,
  });
  assert(
    populatedRoot.innerHTML.includes("Sector Snapshot Visuals"),
    "visuals mount should render the visuals shell",
  );
  assert(
    populatedRoot.innerHTML.includes("Risk / Return Scatter"),
    "visuals mount should include the scatter section",
  );
  disposeVisuals();

  const emptyRoot = { innerHTML: "" };
  mountSectorSnapshotVisuals(emptyRoot, { lastStudyRun: null });
  assert(
    emptyRoot.innerHTML.includes("No sector snapshot is loaded yet."),
    "visuals empty state should render without a study run",
  );

  console.log("ok sector snapshot views");
}

function testRegistry() {
  const study = getStudyById("sector-snapshot");
  assert(Boolean(study), "registry should return the sector snapshot study");
  assert(study.views.length === 2, "sector snapshot should expose overview and visuals");
  assert(
    study.views.some((view) => view.id === "overview" && view.default === true),
    "overview should remain the default view",
  );
  assert(
    study.views.some((view) => view.id === "visuals"),
    "visuals view should be registered",
  );
  console.log("ok sector snapshot registry");
}

testStudyRun();
testStudyViews();
testRegistry();
console.log(`sector snapshot checks passed (${assertionCount} assertions)`);
