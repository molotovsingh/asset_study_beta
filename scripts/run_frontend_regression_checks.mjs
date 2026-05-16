import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLumpsumVsSipStudy } from "../app/lib/lumpsumVsSip.js";
import { buildDrawdownStudy } from "../app/lib/drawdownStudy.js";
import {
  buildStudyViewHash,
  parseStudyViewHash,
  renderStudyShell,
} from "../app/studies/studyShell.js";
import {
  DEFAULT_SETTINGS_SECTION,
  STUDY_BUILDER_SETTINGS_SECTION,
  buildSettingsRouteHash,
  parseAppRouteHash,
} from "../app/appRoute.js";
import {
  renderAutomationSettingsPage,
  renderAutomationSidebarSummary,
} from "../app/settings/automationSettings.js";
import { renderRunHistorySettingsPage } from "../app/settings/studyRunHistorySettings.js";
import {
  EXAMPLE_STUDY_PLAN,
  mountStudyBuilderSettingsPage,
  renderStudyBuilderSettingsPage,
} from "../app/settings/studyBuilderSettings.js";
import { recordLocalStudyRun } from "../app/studies/shared/studyRunHistory.js";
import { buildStudyPlanConfirmationPreview } from "../app/studyBuilder/studyPlan.js";
import { STUDY_PLAN_RECIPE_STORAGE_KEY } from "../app/studyBuilder/studyPlanRecipes.js";
import {
  DEFAULT_ACTIVE_SUBJECT_QUERY,
  adoptActiveSubjectQuery,
  getActiveSubjectQuery,
  setActiveSubjectQuery,
  subscribeActiveSubject,
} from "../app/studies/shared/activeSubject.js";
import {
  MAX_RUN_HISTORY_ITEMS,
  clearRunHistory,
  getRecentRuns,
  mergeStudyRuns,
  recordStudyRun,
  subscribeRunHistory,
} from "../app/studies/shared/runHistory.js";
import {
  buildCommonIndexParams,
  readCommonIndexParams,
} from "../app/studies/shared/shareableInputs.js";
import { getStudyKickerLabel } from "../app/studies/shared/studyOrdinal.js";
import {
  renderRiskInterpretation,
  renderSeasonalityInterpretation,
} from "../app/studies/shared/interpretation.js";
import {
  buildReturnBasisWarning,
  normalizeReturnBasis,
} from "../app/studies/shared/returnBasis.js";
import {
  buildAvailableStudyWindow,
  toInputDate,
} from "../app/studies/shared/overviewUtils.js";
import { renderResults as renderRiskResults } from "../app/studies/riskAdjustedReturnView.js";
import { renderRelativeResults } from "../app/studies/riskAdjustedReturnRelative.js";
import { renderSeasonalityResults } from "../app/studies/seasonalityView.js";
import { renderRollingReturnsResults } from "../app/studies/rollingReturnsView.js";
import { renderSipSimulatorResults } from "../app/studies/sipSimulatorView.js";
import { renderLumpsumVsSipResults } from "../app/studies/lumpsumVsSipView.js";
import { renderDrawdownStudyResults } from "../app/studies/drawdownStudyView.js";
import {
  buildCsvRows as buildLumpsumVsSipCsvRows,
  buildWorkbookXml as buildLumpsumVsSipWorkbookXml,
} from "../app/lib/lumpsumVsSipExport.js";
import {
  buildCsvRows as buildDrawdownCsvRows,
  buildWorkbookXml as buildDrawdownWorkbookXml,
} from "../app/lib/drawdownStudyExport.js";
import { buildRollingReturnsStudy } from "../app/lib/rollingReturns.js";
import { computeRelativeMetrics } from "../app/lib/relativeStats.js";
import {
  buildCsvRows as buildRollingCsvRows,
  buildWorkbookXml as buildRollingWorkbookXml,
} from "../app/lib/rollingReturnsExport.js";
import { buildSeasonalityStudy } from "../app/lib/seasonality.js";
import { buildSipStudy } from "../app/lib/sipSimulator.js";
import {
  buildCsvRows as buildSipCsvRows,
  buildWorkbookXml as buildSipWorkbookXml,
} from "../app/lib/sipSimulatorExport.js";
import {
  buildCsvRows as buildRelativeCsvRows,
  buildWorkbookXml as buildRelativeWorkbookXml,
} from "../app/lib/relativeStudyExport.js";
import {
  buildCsvRows as buildSeasonalityCsvRows,
  buildWorkbookXml as buildSeasonalityWorkbookXml,
} from "../app/lib/seasonalityExport.js";
import {
  buildCsvRows as buildStudyCsvRows,
  buildWorkbookXml as buildStudyWorkbookXml,
  serializeCsv,
  toIsoDate,
} from "../app/lib/studyExport.js";
import {
  buildStudyFactoryProposal,
  deleteStudyPlanRecipe,
  dryRunAssistantStudyPlan,
  draftStudyBuilderPlan,
  fetchAssistantContract,
  fetchAssistantContractBundle,
  fetchAssistantReadiness,
  fetchStudyPlanRecipes,
  fetchStudyRunBrief,
  liveDraftAssistantStudyPlan,
  saveStudyPlanRecipe,
  validateStudyBuilderPlan,
} from "../app/lib/syncedData.js";
import { computeRiskAdjustedMetrics } from "../app/lib/stats.js";
import { runMetricRegistryChecks } from "./test_metric_registry.mjs";
import { runStudyBuilderChecks } from "./test_study_builder.mjs";
import { runSymbolDiscoveryChecks } from "./test_symbol_discovery.mjs";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(REPO_ROOT, "data", "snapshots", "yfinance", "index");
const FIXED_END = new Date("2026-04-09T00:00:00");
const FIVE_YEAR_START = new Date("2021-04-09T00:00:00");
const ONE_YEAR_START = new Date("2025-04-09T00:00:00");
const CONSTANT_RISK_FREE_RATE = 0.055;
const EXPORTED_AT = new Date("2026-04-09T12:00:00");
const TOLERANCE = 1e-10;

let assertionCount = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }

  assertionCount += 1;
}

function assertClose(actual, expected, label, tolerance = TOLERANCE) {
  if (actual === null || expected === null) {
    assert(actual === expected, `${label}: expected ${expected}, received ${actual}`);
    return;
  }

  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    assert(
      Object.is(actual, expected),
      `${label}: expected ${expected}, received ${actual}`,
    );
    return;
  }

  const delta = Math.abs(actual - expected);
  assert(
    delta <= tolerance,
    `${label}: expected ${expected}, received ${actual} (delta ${delta})`,
  );
}

function assertDateEqual(actual, expected, label) {
  assert(
    toIsoDate(actual) === toIsoDate(expected),
    `${label}: expected ${toIsoDate(expected)}, received ${toIsoDate(actual)}`,
  );
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

function testActiveSubjectStore() {
  assert(
    getActiveSubjectQuery() === DEFAULT_ACTIVE_SUBJECT_QUERY,
    "active subject should default to Nifty 50",
  );
  assert(
    setActiveSubjectQuery("AAPL") === true,
    "active subject should update when changed",
  );
  assert(
    getActiveSubjectQuery() === "AAPL",
    "active subject should return the latest query",
  );
  assert(
    setActiveSubjectQuery("AAPL") === false,
    "active subject should not report unchanged writes",
  );

  const session = { indexQuery: "Nifty 50" };
  assert(
    adoptActiveSubjectQuery(session) === true,
    "study session should adopt the active subject",
  );
  assert(
    session.indexQuery === "AAPL",
    "study session should receive the active subject query",
  );
  let observedSubject = "";
  const unsubscribe = subscribeActiveSubject((query) => {
    observedSubject = query;
  });
  setActiveSubjectQuery("Sensex");
  assert(
    observedSubject === "Sensex",
    "active subject listeners should observe changes",
  );
  unsubscribe();

  setActiveSubjectQuery(DEFAULT_ACTIVE_SUBJECT_QUERY);
  console.log("ok active subject");
}

async function testRunHistoryStore() {
  clearRunHistory();
  let observedRunCount = null;
  const unsubscribe = subscribeRunHistory((runs) => {
    observedRunCount = runs.length;
  });

  assert(
    recordStudyRun({
      studyId: "risk-adjusted-return",
      studyTitle: "Risk-Adjusted Return",
      subjectQuery: "AAPL",
      selectionLabel: "Apple Inc.",
      symbol: "AAPL",
      requestedStartDate: new Date("2021-01-01T00:00:00"),
      requestedEndDate: "2026-01-01",
      actualStartDate: "2021-01-04",
      actualEndDate: "2025-12-31",
      completedAt: "2026-04-10T07:30:00.000Z",
    }) === true,
    "run history should accept a valid run",
  );
  assert(observedRunCount === 1, "run history listener should observe writes");
  assert(
    getRecentRuns()[0].requestedStartDate === "2021-01-01",
    "run history should normalize start dates",
  );
  assert(
    getRecentRuns()[0].actualEndDate === "2025-12-31",
    "run history should preserve actual loaded coverage dates",
  );
  assert(
    getRecentRuns()[0].routeHash === "",
    "legacy run history entries should default routeHash safely",
  );

  recordStudyRun({
    studyId: "options-screener",
    studyTitle: "Options Screener",
    subjectQuery: "us-liquid-10",
    selectionLabel: "US Liquid 10",
    detailLabel: "10 rows · IV/HV20 · 25D minimum",
    routeHash: "#options-screener/overview?u=us-liquid-10&sort=ivHv20Ratio&dte=25",
    completedAt: "2026-04-10T08:30:00.000Z",
  });
  assert(
    getRecentRuns()[0].routeHash ===
      "#options-screener/overview?u=us-liquid-10&sort=ivHv20Ratio&dte=25",
    "run history should preserve route hashes for non-index studies",
  );
  assert(
    getRecentRuns()[0].detailLabel === "10 rows · IV/HV20 · 25D minimum",
    "run history should preserve optional detail labels",
  );
  assert(
    mergeStudyRuns([
      {
        studyId: "monthly-straddle",
        studyTitle: "Monthly Straddle",
        subjectQuery: "AAPL",
        selectionLabel: "AAPL",
        detailLabel: "25D minimum · 4 contract(s)",
        routeHash: "#monthly-straddle/overview?subject=AAPL",
        completedAt: "2026-04-10T09:30:00.000Z",
      },
    ]) === true,
    "run history should merge durable backend runs",
  );
  assert(
    getRecentRuns()[0].studyId === "monthly-straddle",
    "merged backend runs should sort by completion time",
  );

  for (let index = 0; index < MAX_RUN_HISTORY_ITEMS + 2; index += 1) {
    recordStudyRun({
      studyId: "rolling-returns",
      studyTitle: "Rolling Returns",
      subjectQuery: `SYM${index}`,
      completedAt: `2026-04-10T07:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
  assert(
    getRecentRuns().length === MAX_RUN_HISTORY_ITEMS,
    "run history should cap retained runs",
  );

  clearRunHistory();
  const originalFetch = globalThis.fetch;
  let capturedLedgerRequest = null;
  let resolveLedgerRequest;
  const ledgerRequestSeen = new Promise((resolve) => {
    resolveLedgerRequest = resolve;
  });
  globalThis.fetch = async (_url, requestInit = {}) => {
    capturedLedgerRequest = JSON.parse(requestInit.body || "{}");
    resolveLedgerRequest();
    return new Response(
      JSON.stringify({
        run: {
          studyId: capturedLedgerRequest.studyId,
          completedAt: capturedLedgerRequest.completedAt,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  assert(
    recordLocalStudyRun({
      study: { id: "risk-adjusted-return", title: "Risk-Adjusted Return" },
      subjectQuery: "Nifty 50",
      selectionLabel: "Nifty 50",
      resolvedParams: { warnings: 1 },
      warnings: ["Loaded data is marked as a Price proxy for TRI."],
      completedAt: "2026-04-10T10:30:00.000Z",
    }) === true,
    "local study-run recording should accept warning messages",
  );
  await ledgerRequestSeen;
  globalThis.fetch = originalFetch;
  assert(
    capturedLedgerRequest.resolvedParams.warningMessages[0].includes("proxy for TRI"),
    "durable ledger request should preserve warning message text in resolved params",
  );

  unsubscribe();
  clearRunHistory();
  console.log("ok run history");
}

function testAvailableStudyWindow() {
  const window = buildAvailableStudyWindow({
    selection: {
      range: {
        startDate: "2021-04-08",
        endDate: "2026-04-08",
      },
    },
    fallbackBaseDate: new Date("2026-05-14T00:00:00"),
  });
  assert(
    toInputDate(window.startDate) === "2021-04-08",
    "available window should anchor the start date to the first available market date when needed",
  );
  assert(
    toInputDate(window.endDate) === "2026-04-08",
    "available window should anchor the end date to the latest available market date",
  );
  console.log("ok available window");
}

function testStudyKickerLabels() {
  assert(
    getStudyKickerLabel("risk-adjusted-return") === "Study 01",
    "risk-adjusted-return should derive its ordinal from the registry",
  );
  assert(
    getStudyKickerLabel("options-screener") === "Study 04",
    "options screener should derive its ordinal from the registry",
  );
  assert(
    getStudyKickerLabel("options-validation") === "Study 05",
    "options validation should derive its ordinal from the registry",
  );
  console.log("ok study kicker labels");
}

function testAppRouteModel() {
  const studyRoute = parseAppRouteHash("#risk-adjusted-return/overview?subject=Nifty+50");
  assert(studyRoute.kind === "study", "study hashes should parse as study routes");
  assert(
    studyRoute.studyId === "risk-adjusted-return" && studyRoute.viewId === "overview",
    "study routes should preserve study/view ids",
  );

  const settingsRoute = parseAppRouteHash("#settings/automations");
  assert(settingsRoute.kind === "settings", "settings hash should parse as settings route");
  assert(
    settingsRoute.section === DEFAULT_SETTINGS_SECTION,
    "settings route should preserve the automations section",
  );

  const unknownSettingsRoute = parseAppRouteHash("#settings/unknown");
  assert(
    unknownSettingsRoute.section === DEFAULT_SETTINGS_SECTION,
    "unknown settings sections should normalize to automations",
  );

  assert(
    buildSettingsRouteHash("automations") === "#settings/automations",
    "settings hash builder should produce the canonical automations route",
  );
  assert(
    buildSettingsRouteHash(STUDY_BUILDER_SETTINGS_SECTION) === "#settings/study-builder",
    "settings hash builder should produce the study-builder route",
  );
  const studyBuilderRoute = parseAppRouteHash("#settings/study-builder");
  assert(
    studyBuilderRoute.kind === "settings" &&
      studyBuilderRoute.section === STUDY_BUILDER_SETTINGS_SECTION,
    "study-builder hash should parse as a settings route",
  );
  const historyRoute = parseAppRouteHash("#settings/history?studyId=options-screener&limit=50");
  assert(historyRoute.kind === "settings", "history hash should parse as settings route");
  assert(historyRoute.section === "history", "history route should preserve the history section");
  assert(
    historyRoute.params.get("studyId") === "options-screener",
    "history route should preserve query params",
  );

  const sidebarSummary = renderAutomationSidebarSummary(
    {
      automations: [{ automationId: "daily-maintenance", isActive: true }],
    },
    {
      summary: {
        totalSymbols: 25,
        attentionSymbolCount: 3,
        syncErrorCount: 1,
        totalCollectionRuns: 4,
      },
      attentionSymbols: [{ symbol: "AAPL", issue: "stale-check" }],
    },
  );
  assert(
    sidebarSummary.includes("Saved automations: 1 total"),
    "sidebar summary should describe configured automation counts",
  );
  assert(
    sidebarSummary.includes("Attention"),
    "sidebar summary should expose the runtime tone",
  );

  const settingsPage = renderAutomationSettingsPage({
    automationState: {
      automations: [],
      defaults: {
        automationId: "daily-maintenance",
        label: "Daily Maintenance",
        intervalMinutes: 1440,
        isActive: true,
        runMarketCollection: true,
        runOptionsCollection: true,
        refreshExchangeSymbolMasters: false,
        marketUniverseIds: ["smoke-aapl"],
        optionsUniverseIds: ["us-liquid-10"],
      },
      catalogs: {
        marketUniverses: [{ universeId: "smoke-aapl", activeMembers: 1 }],
        optionsUniverses: [{ universeId: "us-liquid-10" }],
      },
    },
    automationRuntimeHealth: {
      summary: {
        totalSymbols: 25,
        attentionSymbolCount: 3,
        syncErrorCount: 1,
        totalCollectionRuns: 4,
      },
      attentionSymbols: [{ symbol: "AAPL", issue: "stale-check", historyEndDate: "2026-04-10" }],
      universeHealth: [],
    },
    statusMessage: "Automation completed.",
    selectedAutomationId: "",
  });
  assert(
    settingsPage.includes('id="settings-automation-form"'),
    "settings page should render the automation editor form",
  );
  assert(
    settingsPage.includes("System visibility"),
    "settings page should include runtime health detail",
  );

  const historyPage = renderRunHistorySettingsPage({
    runs: [
      {
        runId: 12,
        studyId: "options-screener",
        studyTitle: "Options Screener",
        selectionLabel: "US Liquid 10",
        subjectQuery: "us-liquid-10",
        status: "success",
        routeHash: "#options-screener/overview?u=us-liquid-10",
        detailLabel: "10 rows · IV/HV20",
        actualStartDate: "2026-04-08T18:30:00.000Z",
        actualEndDate: "2026-04-10T18:30:00.000Z",
        requestedParams: { universeId: "us-liquid-10" },
        resolvedParams: { universeId: "us-liquid-10", limit: 10 },
        providerSummary: { provider: "yfinance" },
        dataSnapshotRefs: [{ kind: "cache-series", symbol: "AAPL" }],
        warningCount: 0,
        runKind: "analysis",
        completedAt: "2026-05-15T10:00:00+00:00",
        summaryItems: [
          { label: "Filtered Rows", valueNumber: 10, valueKind: "integer" },
        ],
        links: [
          {
            linkType: "evidence-source",
            targetKind: "options_screener_run",
            targetId: "42",
            targetLabel: "Run 42",
            metadata: { signalVersion: "options-screener-v2" },
          },
        ],
      },
    ],
    statusMessage: "",
    filters: { studyId: "options-screener", status: "success", limit: 50 },
    selectedRunId: "12",
    isLoading: false,
    assistantPayloadByRunId: {
      12: {
        handoff: {
          version: "study-run-handoff-v1",
          readyForReplay: true,
          source: "backend-assistant-endpoint",
          run: { runId: 12, studyId: "options-screener" },
        },
        explanationBrief: {
          version: "study-run-explanation-brief-v1",
          mode: "result-with-caveats",
          title: "Backend brief",
          summary: "Backend-owned assistant payload.",
          resultConclusionAllowed: true,
          replay: { canReplay: true },
          allowedAssistantActions: ["explain_result_with_caveats"],
          requiredCaveats: [],
          prohibitedClaims: ["Do not invent missing evidence."],
        },
      },
    },
    assistantPayloadStatusByRunId: { 12: "ready" },
  });
  assert(
    historyPage.includes("Ledger query"),
    "history settings page should render the ledger filter controls",
  );
  assert(
    historyPage.includes("Evidence Links"),
    "history settings page should render durable evidence links",
  );
  assert(
    historyPage.includes("Assistant-safe explanation seed"),
    "history settings page should render deterministic explanation seeds",
  );
  assert(
    historyPage.includes("Seed JSON") &&
      historyPage.includes("&quot;version&quot;: &quot;study-run-explanation-v1&quot;"),
    "history settings page should render the machine-readable explanation seed payload",
  );
  assert(
    historyPage.includes("Replay StudyPlan") &&
      historyPage.includes("Route-safe") &&
      historyPage.includes("&quot;studyId&quot;: &quot;options-screener&quot;"),
    "history settings page should render a validated replay StudyPlan from the recorded route",
  );
  assert(
    historyPage.includes("Assistant Handoff JSON") &&
      historyPage.includes("Download Handoff JSON") &&
      historyPage.includes('data-history-handoff-export="12"') &&
      historyPage.includes("&quot;version&quot;: &quot;study-run-handoff-v1&quot;") &&
      historyPage.includes("&quot;readyForReplay&quot;: true"),
    "history settings page should render and expose the combined assistant handoff payload",
  );
  assert(
    historyPage.includes("Assistant Explanation Brief") &&
      historyPage.includes("result-with-caveats") &&
      historyPage.includes("Backend-owned assistant payload.") &&
      historyPage.includes("Allowed assistant actions") &&
      historyPage.includes("Prohibited claims"),
    "history settings page should render the backend assistant prose permission envelope",
  );
  assert(
    historyPage.includes("2026-04-08 to 2026-04-10") &&
      !historyPage.includes("2026-04-08T18:30:00.000Z to 2026-04-10T18:30:00.000Z"),
    "history settings page should render ledger windows as date-only values",
  );
  const studyBuilderPage = renderStudyBuilderSettingsPage({
    planText: JSON.stringify(EXAMPLE_STUDY_PLAN, null, 2),
    preview: buildStudyPlanConfirmationPreview(EXAMPLE_STUDY_PLAN),
    statusMessage: "Plan validated.",
  });
  assert(
    studyBuilderPage.includes("Study Builder Preview") &&
      studyBuilderPage.includes("Assistant Readiness") &&
      studyBuilderPage.includes("Go to route") &&
      studyBuilderPage.includes("#risk-adjusted-return/overview"),
    "study builder settings page should render a deterministic route preview",
  );
  console.log("ok app routes");
}

async function testStudyBuilderBackendRecipeHydration() {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const originalWindow = globalThis.window;
  const storage = createMemoryStorage();
  storage.setItem(
    STUDY_PLAN_RECIPE_STORAGE_KEY,
    JSON.stringify({
      version: "study-plan-recipes-v1",
      recipes: [
        {
          id: "local-only",
          version: "study-plan-recipes-v1",
          name: "Local Only Recipe",
          plan: EXAMPLE_STUDY_PLAN,
          createdAt: "2026-05-15T00:00:00.000Z",
          updatedAt: "2026-05-15T00:00:00.000Z",
        },
      ],
    }),
  );

  let resolveBackendRecipes;
  const backendRecipesPromise = new Promise((resolve) => {
    resolveBackendRecipes = resolve;
  });
  const root = {
    innerHTML: "",
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
  };

  try {
    globalThis.window = { localStorage: storage };
    const unmount = mountStudyBuilderSettingsPage(root, {
      fetchStudyPlanRecipes: () => backendRecipesPromise,
    });

    assert(
      root.innerHTML.includes("Local Only Recipe"),
      "study-builder settings should render browser-local recipes before backend hydration completes",
    );

    resolveBackendRecipes({
      version: "study-plan-recipes-v1",
      recipes: [],
    });
    await Promise.resolve();
    await Promise.resolve();

    assert(
      !root.innerHTML.includes("Local Only Recipe") &&
        root.innerHTML.includes("No saved StudyPlan recipes yet."),
      "study-builder settings should replace stale local recipes with an empty successful backend response",
    );

    unmount();
  } finally {
    if (hadWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }

  console.log("ok study-builder recipe hydration");
}

async function testStudyBuilderReadinessHydration() {
  let resolveReadiness;
  const readinessPromise = new Promise((resolve) => {
    resolveReadiness = resolve;
  });
  const root = {
    innerHTML: "",
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
  };

  const unmount = mountStudyBuilderSettingsPage(root, {
    fetchAssistantReadiness: () => readinessPromise,
  });

  assert(
    root.innerHTML.includes("Checking deterministic assistant rail"),
    "study-builder settings should render assistant readiness loading state",
  );

  resolveReadiness({
    version: "assistant-readiness-v1",
    status: "ok",
    summary: { total: 13, passed: 13, failed: 0 },
    checks: [],
    liveAiTesting: {
      status: "not-required",
      requiredOnlyWhen: "A live LLM smoke test is added.",
    },
  });
  await Promise.resolve();
  await Promise.resolve();

  assert(
    root.innerHTML.includes("Deterministic assistant rail is healthy") &&
      root.innerHTML.includes("13 / 13 checks passed") &&
      root.innerHTML.includes("not-required"),
    "study-builder settings should hydrate backend assistant readiness",
  );

  unmount();
  console.log("ok study-builder readiness hydration");
}

async function testAssistantApiHelpers() {
  const originalFetch = globalThis.fetch;
  const requests = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "assistant-contract-v1",
          contracts: [],
          backendEndpoints: [{ path: "/api/assistant/study-run-brief" }],
          hardStops: ["Do not invent study IDs."],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const contract = await fetchAssistantContract();
    assert(
      contract.version === "assistant-contract-v1",
      "assistant contract helper should return the top-level contract payload",
    );
    assert(
      requests[0].url.endsWith("/api/assistant/contract") &&
        !requests[0].init.method,
      "assistant contract helper should call the backend contract endpoint with GET semantics",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "assistant-contract-bundle-v1",
          contracts: {
            assistant: { version: "assistant-contract-v1" },
            metricRegistry: { rules: [] },
            studyCatalog: { studies: [] },
            studyPlan: { version: "study-plan-v1" },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const contractBundle = await fetchAssistantContractBundle();
    assert(
      contractBundle.version === "assistant-contract-bundle-v1" &&
        requests[0].url.endsWith("/api/assistant/contract-bundle") &&
        !requests[0].init.method,
      "assistant contract bundle helper should call the backend bundle endpoint with GET semantics",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "assistant-readiness-v1",
          status: "ok",
          summary: { total: 3, passed: 3, failed: 0 },
          checks: [],
          liveAiTesting: { status: "not-required" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const readinessPayload = await fetchAssistantReadiness({ artifactChecks: false });
    assert(
      readinessPayload.version === "assistant-readiness-v1" &&
        requests[0].url.endsWith("/api/assistant/readiness?artifactChecks=false") &&
        !requests[0].init.method,
      "assistant readiness helper should call the backend readiness endpoint with GET semantics",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          run: { runId: 12 },
          handoff: { version: "study-run-handoff-v1" },
          explanationBrief: { version: "study-run-explanation-brief-v1" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const payload = await fetchStudyRunBrief({ runId: 12 });
    assert(payload.run.runId === 12, "assistant brief helper should return the run payload");
    assert(
      payload.handoff.version === "study-run-handoff-v1" &&
        payload.explanationBrief.version === "study-run-explanation-brief-v1",
      "assistant brief helper should return handoff and explanation brief payloads",
    );
    assert(
      requests[0].url.endsWith("/api/assistant/study-run-brief"),
      "assistant brief helper should call the backend assistant endpoint",
    );
    assert(
      requests[0].init.method === "POST" &&
        JSON.parse(requests[0].init.body).runId === 12,
      "assistant brief helper should POST the durable run id as JSON",
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "runId must be a positive integer." }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      });
    let badRequestMessage = "";
    try {
      await fetchStudyRunBrief({ runId: "abc" });
    } catch (error) {
      badRequestMessage = error?.message || "";
    }
    assert(
      badRequestMessage === "runId must be a positive integer.",
      "assistant brief helper should preserve backend validation errors",
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ run: { runId: 12 }, handoff: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    let invalidPayloadMessage = "";
    try {
      await fetchStudyRunBrief({ runId: 12 });
    } catch (error) {
      invalidPayloadMessage = error?.message || "";
    }
    assert(
      invalidPayloadMessage.includes("invalid assistant run brief payload"),
      "assistant brief helper should reject incomplete success payloads",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "assistant-study-plan-dry-run-v1",
          mode: "intent",
          intent: "Compare Nifty 50 against Sensex",
          readiness: { version: "assistant-readiness-v1", status: "ok" },
          plannerResult: { version: "intent-planner-v1" },
          plan: { version: "study-plan-v1" },
          validation: { ok: true },
          preview: { canRun: true },
          execution: { executed: false },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const dryRunPayload = await dryRunAssistantStudyPlan({
      intent: "Compare Nifty 50 against Sensex",
    });
    assert(
      dryRunPayload.version === "assistant-study-plan-dry-run-v1" &&
        dryRunPayload.execution.executed === false &&
        requests[0].url.endsWith("/api/assistant/study-plan-dry-run") &&
        JSON.parse(requests[0].init.body).intent.includes("Sensex"),
      "assistant dry-run helper should POST intent and return a non-executing payload",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "assistant-study-plan-live-draft-v1",
          provider: "openai",
          model: "gpt-test",
          mode: "intent",
          intent: "Compare Nifty 50 against Sensex",
          readiness: { version: "assistant-readiness-v1", status: "ok" },
          modelResult: { responseId: "resp_test", parsedJson: true },
          plan: { version: "study-plan-v1" },
          validation: { ok: true },
          preview: { canRun: true },
          execution: { executed: false },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const liveDraftPayload = await liveDraftAssistantStudyPlan({
      intent: "Compare Nifty 50 against Sensex",
    });
    assert(
      liveDraftPayload.version === "assistant-study-plan-live-draft-v1" &&
        liveDraftPayload.provider === "openai" &&
        liveDraftPayload.execution.executed === false &&
        requests[0].url.endsWith("/api/assistant/study-plan-live-draft") &&
        JSON.parse(requests[0].init.body).intent.includes("Sensex"),
      "assistant live-draft helper should POST intent and return a validated non-executing payload",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "study-proposal-response-v1",
          mode: "read-only",
          proposal: {
            version: "study-proposal-v1",
            feasibility: { status: "needs-evidence-archive" },
          },
          execution: { executed: false, generatedCode: false },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const proposalPayload = await buildStudyFactoryProposal({
      idea: "Can RBI policy headlines move bank index volatility?",
    });
    assert(
      proposalPayload.version === "study-proposal-response-v1" &&
        proposalPayload.execution.executed === false &&
        requests[0].url.endsWith("/api/study-factory/proposal") &&
        JSON.parse(requests[0].init.body).idea.includes("RBI"),
      "study-factory proposal helper should POST an idea and return a read-only proposal",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "study-builder-plan-response-v1",
          plannerResult: { version: "intent-planner-v1" },
          plan: { version: "study-plan-v1" },
          preview: { canRun: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const draftPayload = await draftStudyBuilderPlan({ intent: "Compare Nifty 50 against Sensex" });
    assert(
      draftPayload.version === "study-builder-plan-response-v1" &&
        requests[0].url.endsWith("/api/study-builder/plan") &&
        JSON.parse(requests[0].init.body).intent.includes("Nifty 50"),
      "study-builder draft helper should POST intent to the backend planner endpoint",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "study-builder-validation-response-v1",
          mode: "route",
          validation: { ok: true },
          preview: { canRun: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const validationPayload = await validateStudyBuilderPlan({
      routeHash: "#drawdown-study/overview?subject=TSLA",
    });
    assert(
      validationPayload.mode === "route" &&
        requests[0].url.endsWith("/api/study-builder/validate") &&
        JSON.parse(requests[0].init.body).routeHash.includes("drawdown-study"),
      "study-builder validation helper should POST plans or route hashes to the backend validator endpoint",
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ version: "study-builder-validation-response-v1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    let invalidStudyBuilderPayloadMessage = "";
    try {
      await validateStudyBuilderPlan({ plan: {} });
    } catch (error) {
      invalidStudyBuilderPayloadMessage = error?.message || "";
    }
    assert(
      invalidStudyBuilderPayloadMessage.includes("invalid study-builder validation payload"),
      "study-builder validation helper should reject incomplete success payloads",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          version: "study-plan-recipes-v1",
          limit: 50,
          recipes: [{ id: "risk", name: "Risk", plan: { version: "study-plan-v1" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const recipePayload = await fetchStudyPlanRecipes({ limit: 10 });
    assert(
      recipePayload.recipes.length === 1 &&
        requests[0].url.endsWith("/api/study-builder/recipes?limit=10") &&
        !requests[0].init.method,
      "study-plan recipe helper should GET backend recipes with query params",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          ok: true,
          recipe: { id: "risk" },
          recipes: [{ id: "risk" }],
          validation: { ok: true },
          preview: { canRun: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const saveRecipePayload = await saveStudyPlanRecipe({
      name: "Risk",
      plan: { version: "study-plan-v1" },
    });
    assert(
      saveRecipePayload.ok &&
        requests[0].url.endsWith("/api/study-builder/recipes/save") &&
        JSON.parse(requests[0].init.body).name === "Risk",
      "study-plan recipe save helper should POST recipes to the backend",
    );

    requests.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ ok: true, recipes: [] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const deleteRecipePayload = await deleteStudyPlanRecipe({ id: "risk" });
    assert(
      deleteRecipePayload.ok &&
        requests[0].url.endsWith("/api/study-builder/recipes/delete") &&
        JSON.parse(requests[0].init.body).id === "risk",
      "study-plan recipe delete helper should POST recipe ids to the backend",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("ok assistant api helpers");
}

function testShareableInputUrls() {
  const hash = buildStudyViewHash("sip-simulator", "overview", {
    subject: "AAPL",
    start: "2021-01-01",
    end: "2026-01-01",
    contribution: "25000",
  });
  const route = parseStudyViewHash(hash);
  assert(route.studyId === "sip-simulator", "share URL study id mismatch");
  assert(route.viewId === "overview", "share URL view id mismatch");
  assert(
    route.params.get("subject") === "AAPL",
    "share URL subject param mismatch",
  );
  assert(
    route.params.get("contribution") === "25000",
    "share URL contribution param mismatch",
  );

  const session = {
    indexQuery: "Nifty 50",
    startDateValue: "2020-01-01",
    endDateValue: "2025-01-01",
  };
  const applied = readCommonIndexParams(session, route.params);
  assert(applied.changed === true, "share URL params should change session");
  assert(applied.subject === true, "share URL should mark subject as present");
  assert(session.indexQuery === "AAPL", "share URL should restore subject");
  assert(session.startDateValue === "2021-01-01", "share URL should restore start");
  assert(session.endDateValue === "2026-01-01", "share URL should restore end");

  const unchanged = readCommonIndexParams(session, route.params);
  assert(
    unchanged.changed === false && unchanged.subject === true,
    "share URL should preserve subject presence even when unchanged",
  );
  assert(
    buildCommonIndexParams(session).subject === "AAPL",
    "share URL common params should serialize subject",
  );

  const shellHtml = renderStudyShell(
    {
      id: "risk-adjusted-return",
      views: [
        {
          id: "overview",
          label: "Overview",
          summary: "Overview",
          status: "ready",
        },
        {
          id: "visuals",
          label: "Visuals",
          summary: "Visuals",
          status: "ready",
        },
      ],
    },
    "overview",
    route.params,
  );
  assert(
    shellHtml.includes("#risk-adjusted-return/visuals?subject=AAPL"),
    "study view links should preserve active subject params",
  );
  console.log("ok shareable inputs");
}

function testInterpretationPanels() {
  const riskHtml = renderRiskInterpretation({
    annualizedReturn: 0.11,
    totalReturn: 0.68,
    annualizedVolatility: 0.18,
    maxDrawdown: -0.22,
    maxDrawdownDurationDays: 180,
    sharpeRatio: 0.74,
    sortinoRatio: 1.08,
  });
  assert(
    riskHtml.includes("What This Means"),
    "risk interpretation should render the shared panel heading",
  );
  assert(
    riskHtml.includes("not a forecast or recommendation"),
    "interpretation copy should retain the non-advisory framing",
  );

  const seasonalityHtml = renderSeasonalityInterpretation({
    seasonalitySpread: 0.044,
    yearsObserved: 5,
    monthsUsed: 60,
    thinMonthCount: 0,
    mostConsistentMonth: {
      monthLabel: "Apr",
      consistencyScore: 0.8,
    },
    clearSignalCount: 2,
  });
  assert(
    seasonalityHtml.includes("Seasonality Spread"),
    "seasonality interpretation should include spread context",
  );
  assert(
    seasonalityHtml.includes("confidence bands"),
    "seasonality interpretation should explain confidence bands",
  );

  console.log("ok interpretation panels");
}

function testReturnBasisPolicy() {
  assert(
    normalizeReturnBasis({
      returnBasis: "total_return",
      targetSeriesType: "TRI",
      sourceSeriesType: "Price",
    }) === "proxy",
    "frontend return-basis policy should fail safe to proxy when source and target differ",
  );
  assert(
    normalizeReturnBasis({
      returnBasis: "total_return",
      targetSeriesType: "Price",
      sourceSeriesType: "Price",
    }) === "price",
    "frontend return-basis policy should not allow price data to claim total-return basis",
  );
  assert(
    buildReturnBasisWarning({
      returnBasis: "proxy",
      targetSeriesType: "TRI",
      sourceSeriesType: "Price",
    }).includes("Do not treat it as true total-return evidence"),
    "proxy return-basis warnings should block total-return over-reading",
  );
  console.log("ok return basis policy");
}

function mean(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleStdDev(values) {
  if (values.length < 2) {
    return null;
  }

  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(values, quantile) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const bounded = Math.min(Math.max(quantile, 0), 1);
  const index = (sorted.length - 1) * bounded;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function sampleSkewness(values) {
  if (values.length < 3) {
    return null;
  }

  const average = mean(values);
  const stdDev = sampleStdDev(values);
  if (average === null || !stdDev) {
    return null;
  }

  const sampleSize = values.length;
  const sum = values.reduce(
    (total, value) => total + ((value - average) / stdDev) ** 3,
    0,
  );

  return (sampleSize / ((sampleSize - 1) * (sampleSize - 2))) * sum;
}

function sampleExcessKurtosis(values) {
  if (values.length < 4) {
    return null;
  }

  const average = mean(values);
  const stdDev = sampleStdDev(values);
  if (average === null || !stdDev) {
    return null;
  }

  const sampleSize = values.length;
  const sum = values.reduce(
    (total, value) => total + ((value - average) / stdDev) ** 4,
    0,
  );

  return (
    (sampleSize * (sampleSize + 1) * sum) /
      ((sampleSize - 1) * (sampleSize - 2) * (sampleSize - 3)) -
    (3 * (sampleSize - 1) ** 2) / ((sampleSize - 2) * (sampleSize - 3))
  );
}

function inferPeriodsPerYear(series) {
  if (series.length < 3) {
    return 12;
  }

  const gaps = [];
  for (let index = 1; index < series.length; index += 1) {
    const days = (series[index].date - series[index - 1].date) / 86400000;
    if (days > 0) {
      gaps.push(days);
    }
  }

  if (!gaps.length) {
    return 12;
  }

  const sorted = [...gaps].sort((left, right) => left - right);
  const medianGap = sorted[Math.floor(sorted.length / 2)];
  if (medianGap > 270) {
    return 1;
  }
  if (medianGap > 80) {
    return 4;
  }
  if (medianGap > 25) {
    return 12;
  }
  if (medianGap > 5) {
    return 52;
  }
  return 252;
}

function annualRateToPeriodLogReturn(annualRate, days) {
  return Math.log1p(annualRate) * (days / 365);
}

function shiftDateByYears(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() - years);
  return nextDate;
}

function filterSeriesByDate(series, startDate, endDate) {
  return series.filter((point) => point.date >= startDate && point.date <= endDate);
}

function buildMonthlyStartPointsIndependent(series) {
  const monthlyPoints = [];
  let previousKey = null;

  for (const point of series) {
    const key = `${point.date.getFullYear()}-${point.date.getMonth()}`;
    if (key === previousKey) {
      continue;
    }

    monthlyPoints.push(point);
    previousKey = key;
  }

  return monthlyPoints;
}

function shiftDateForwardByYearsIndependent(date, years) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() + years);
  return nextDate;
}

function findLatestPointOnOrBeforeIndependent(series, targetDate) {
  let best = null;

  for (const point of series) {
    if (point.date <= targetDate) {
      best = point;
    } else {
      break;
    }
  }

  return best;
}

function countLumpsumVsSipCohortsIndependent(series, monthlyPoints, horizonYears) {
  const minimumContributionCount = Math.max(2, horizonYears * 12 - 1);
  let cohortCount = 0;

  for (const startPoint of monthlyPoints) {
    const targetEndDate = shiftDateForwardByYearsIndependent(
      startPoint.date,
      horizonYears,
    );
    const endPoint = findLatestPointOnOrBeforeIndependent(series, targetEndDate);

    if (!endPoint || endPoint.date <= startPoint.date) {
      continue;
    }

    const endGapDays = (targetEndDate - endPoint.date) / 86400000;
    if (endGapDays > 10) {
      continue;
    }

    const contributionCount = monthlyPoints.filter(
      (point) => point.date >= startPoint.date && point.date < endPoint.date,
    ).length;
    if (contributionCount >= minimumContributionCount) {
      cohortCount += 1;
    }
  }

  return cohortCount;
}

function toPeriodicReturns(series) {
  const rows = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const simpleReturn = current.value / previous.value - 1;
    rows.push({
      startDate: previous.date,
      endDate: current.date,
      days: (current.date - previous.date) / 86400000,
      simpleReturn,
      logReturn: Math.log1p(simpleReturn),
    });
  }
  return rows;
}

function maxDrawdown(series) {
  let peak = series[0].value;
  let maxDepth = 0;

  for (const point of series) {
    peak = Math.max(peak, point.value);
    maxDepth = Math.min(maxDepth, point.value / peak - 1);
  }

  return maxDepth;
}

function ulcerIndex(series) {
  let peak = series[0].value;
  const squared = [];

  for (const point of series) {
    peak = Math.max(peak, point.value);
    squared.push(Math.min(point.value / peak - 1, 0) ** 2);
  }

  return Math.sqrt(mean(squared) ?? 0);
}

function getDrawdownDurationStats(series) {
  if (series.length < 2) {
    return {
      maxDrawdownDurationDays: 0,
      maxDrawdownDurationPeriods: 0,
    };
  }

  let peakValue = series[0].value;
  let peakDate = series[0].date;
  let peakIndex = 0;
  let currentDrawdownStartDate = null;
  let currentDrawdownStartIndex = null;
  let maxDrawdownDurationDays = 0;
  let maxDrawdownDurationPeriods = 0;

  for (let index = 1; index < series.length; index += 1) {
    const point = series[index];
    if (point.value >= peakValue) {
      if (currentDrawdownStartDate !== null) {
        maxDrawdownDurationDays = Math.max(
          maxDrawdownDurationDays,
          (point.date - currentDrawdownStartDate) / 86400000,
        );
        maxDrawdownDurationPeriods = Math.max(
          maxDrawdownDurationPeriods,
          index - currentDrawdownStartIndex,
        );
      }

      peakValue = point.value;
      peakDate = point.date;
      peakIndex = index;
      currentDrawdownStartDate = null;
      currentDrawdownStartIndex = null;
      continue;
    }

    if (currentDrawdownStartDate === null) {
      currentDrawdownStartDate = peakDate;
      currentDrawdownStartIndex = peakIndex;
    }
  }

  if (currentDrawdownStartDate !== null) {
    const lastPoint = series[series.length - 1];
    maxDrawdownDurationDays = Math.max(
      maxDrawdownDurationDays,
      (lastPoint.date - currentDrawdownStartDate) / 86400000,
    );
    maxDrawdownDurationPeriods = Math.max(
      maxDrawdownDurationPeriods,
      series.length - 1 - currentDrawdownStartIndex,
    );
  }

  return {
    maxDrawdownDurationDays,
    maxDrawdownDurationPeriods,
  };
}

function computeRiskMetricsIndependent(series, annualRiskFreeRate) {
  const periodicReturns = toPeriodicReturns(series);
  const periodsPerYear = inferPeriodsPerYear(series);
  const logReturns = periodicReturns.map((period) => period.logReturn);
  const simpleReturns = periodicReturns.map((period) => period.simpleReturn);
  const annualizedVolatility =
    (sampleStdDev(logReturns) ?? 0) * Math.sqrt(periodsPerYear);
  const annualizedLogRiskFreeRate = Math.log1p(annualRiskFreeRate);
  const excessLogReturns = periodicReturns.map(
    (period) =>
      period.logReturn -
      annualRateToPeriodLogReturn(annualRiskFreeRate, period.days),
  );
  const startValue = series[0].value;
  const endValue = series[series.length - 1].value;
  const elapsedDays =
    (series[series.length - 1].date - series[0].date) / 86400000;
  const totalReturn = endValue / startValue - 1;
  const annualizedLogReturn = Math.log(endValue / startValue) * (365 / elapsedDays);
  const annualizedReturn = Math.expm1(annualizedLogReturn);
  const annualizedExcessLogReturn = (mean(excessLogReturns) ?? 0) * periodsPerYear;
  const downsideDeviation =
    Math.sqrt(mean(excessLogReturns.map((value) => Math.min(value, 0) ** 2)) ?? 0) *
    Math.sqrt(periodsPerYear);
  const maxDrawdownValue = maxDrawdown(series);
  const ulcerIndexValue = ulcerIndex(series);
  const valueAtRisk95 = percentile(logReturns, 0.05);
  const cvarSample = logReturns.filter(
    (value) => valueAtRisk95 !== null && value <= valueAtRisk95,
  );
  const rankedPeriods = [...periodicReturns].sort(
    (left, right) => left.logReturn - right.logReturn,
  );
  const drawdownDurations = getDrawdownDurationStats(series);
  const positivePeriods = periodicReturns.filter((period) => period.logReturn > 0).length;

  return {
    totalReturn,
    annualizedLogReturn,
    annualizedReturn,
    annualizedExcessLogReturn,
    annualizedVolatility,
    downsideDeviation,
    maxDrawdown: maxDrawdownValue,
    ulcerIndex: ulcerIndexValue,
    sharpeRatio:
      annualizedVolatility > 0
        ? annualizedExcessLogReturn / annualizedVolatility
        : null,
    sortinoRatio:
      downsideDeviation > 0
        ? annualizedExcessLogReturn / downsideDeviation
        : null,
    calmarRatio:
      maxDrawdownValue < 0
        ? annualizedReturn / Math.abs(maxDrawdownValue)
        : null,
    martinRatio:
      ulcerIndexValue > 0
        ? (annualizedReturn - annualRiskFreeRate) / ulcerIndexValue
        : null,
    averageAnnualRiskFreeRate: annualRiskFreeRate,
    averageAnnualLogRiskFreeRate: annualizedLogRiskFreeRate,
    averagePeriodReturn: mean(logReturns),
    medianPeriodReturn: median(logReturns),
    simpleAveragePeriodReturn: mean(simpleReturns),
    simpleMedianPeriodReturn: median(simpleReturns),
    valueAtRisk95,
    conditionalValueAtRisk95: mean(cvarSample),
    skewness: sampleSkewness(logReturns),
    excessKurtosis: sampleExcessKurtosis(logReturns),
    periodsPerYear,
    observations: series.length,
    periodicObservations: periodicReturns.length,
    positivePeriods,
    nonPositivePeriods: periodicReturns.length - positivePeriods,
    winRate:
      periodicReturns.length > 0 ? positivePeriods / periodicReturns.length : null,
    bestPeriod: rankedPeriods.length
      ? {
          ...rankedPeriods[rankedPeriods.length - 1],
          value: rankedPeriods[rankedPeriods.length - 1].simpleReturn,
        }
      : null,
    worstPeriod: rankedPeriods.length
      ? {
          ...rankedPeriods[0],
          value: rankedPeriods[0].simpleReturn,
        }
      : null,
    ...drawdownDurations,
  };
}

function sampleCovariance(leftValues, rightValues) {
  if (leftValues.length !== rightValues.length || leftValues.length < 2) {
    return null;
  }

  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  return (
    leftValues.reduce(
      (sum, value, index) =>
        sum + (value - leftMean) * (rightValues[index] - rightMean),
      0,
    ) /
    (leftValues.length - 1)
  );
}

function toDateKey(date) {
  return toIsoDate(date);
}

function alignSeries(assetSeries, benchmarkSeries) {
  const assetByDate = new Map(assetSeries.map((point) => [toDateKey(point.date), point]));
  const benchmarkByDate = new Map(
    benchmarkSeries.map((point) => [toDateKey(point.date), point]),
  );
  const alignedKeys = [...assetByDate.keys()]
    .filter((dateKey) => benchmarkByDate.has(dateKey))
    .sort();

  return {
    alignedAssetSeries: alignedKeys.map((key) => assetByDate.get(key)),
    alignedBenchmarkSeries: alignedKeys.map((key) => benchmarkByDate.get(key)),
  };
}

function buildCaptureRatio(assetPeriods, benchmarkPeriods, direction) {
  const indexedPairs = assetPeriods
    .map((period, index) => ({ assetPeriod: period, benchmarkPeriod: benchmarkPeriods[index] }))
    .filter(({ benchmarkPeriod }) =>
      direction === "up"
        ? benchmarkPeriod.logReturn > 0
        : benchmarkPeriod.logReturn < 0,
    );

  if (!indexedPairs.length) {
    return null;
  }

  const assetCumulative = Math.expm1(
    indexedPairs.reduce((sum, pair) => sum + pair.assetPeriod.logReturn, 0),
  );
  const benchmarkCumulative = Math.expm1(
    indexedPairs.reduce((sum, pair) => sum + pair.benchmarkPeriod.logReturn, 0),
  );

  if (!benchmarkCumulative) {
    return null;
  }

  return assetCumulative / benchmarkCumulative;
}

function buildRelativeWealthSeries(assetSeries, benchmarkSeries) {
  const assetBase = assetSeries[0]?.value ?? null;
  const benchmarkBase = benchmarkSeries[0]?.value ?? null;

  if (!assetBase || !benchmarkBase) {
    return [];
  }

  return assetSeries.map((point, index) => ({
    date: point.date,
    value:
      point.value / assetBase / (benchmarkSeries[index].value / benchmarkBase) - 1,
  }));
}

function maxRelativeDrawdown(relativeWealthSeries) {
  let peak = 1 + (relativeWealthSeries[0]?.value ?? 0);
  let maxValue = 0;

  for (const point of relativeWealthSeries) {
    const wealth = 1 + point.value;
    peak = Math.max(peak, wealth);
    maxValue = Math.min(maxValue, wealth / peak - 1);
  }

  return maxValue;
}

function computeAnnualizedGrowth(startValue, endValue, elapsedDays) {
  const totalReturn = endValue / startValue - 1;
  const annualizedLogReturn = Math.log(endValue / startValue) * (365 / elapsedDays);

  return {
    totalReturn,
    annualizedLogReturn,
    annualizedReturn: Math.expm1(annualizedLogReturn),
  };
}

function buildRollingWindowRowsIndependent(series, windowYears) {
  const rows = [];
  let startIndex = 0;

  for (let endIndex = 0; endIndex < series.length; endIndex += 1) {
    const endPoint = series[endIndex];
    const targetStartDate = shiftDateByYears(endPoint.date, windowYears);

    while (
      startIndex + 1 < endIndex &&
      series[startIndex + 1].date <= targetStartDate
    ) {
      startIndex += 1;
    }

    const startPoint = series[startIndex];
    if (!startPoint || startPoint.date > targetStartDate) {
      continue;
    }

    const elapsedDays = (endPoint.date - startPoint.date) / 86400000;
    if (elapsedDays <= 0) {
      continue;
    }

    rows.push({
      windowYears,
      windowLabel: `${windowYears}Y`,
      startDate: startPoint.date,
      endDate: endPoint.date,
      elapsedDays,
      ...computeAnnualizedGrowth(startPoint.value, endPoint.value, elapsedDays),
    });
  }

  return rows;
}

function buildRollingSummaryIndependent(windowYears, rows) {
  const annualizedReturns = rows.map((row) => row.annualizedReturn);
  const latestWindow = rows[rows.length - 1] || null;
  const bestWindow = rows.reduce(
    (best, row) =>
      !best || row.annualizedReturn > best.annualizedReturn ? row : best,
    null,
  );
  const worstWindow = rows.reduce(
    (worst, row) =>
      !worst || row.annualizedReturn < worst.annualizedReturn ? row : worst,
    null,
  );
  const positiveWindows = rows.filter((row) => row.annualizedReturn > 0).length;

  return {
    windowYears,
    windowLabel: `${windowYears}Y`,
    observations: rows.length,
    latestCagr: latestWindow?.annualizedReturn ?? null,
    medianCagr: median(annualizedReturns),
    percentile25Cagr: percentile(annualizedReturns, 0.25),
    percentile75Cagr: percentile(annualizedReturns, 0.75),
    bestCagr: bestWindow?.annualizedReturn ?? null,
    worstCagr: worstWindow?.annualizedReturn ?? null,
    positiveRate: rows.length ? positiveWindows / rows.length : null,
    cagrRange:
      bestWindow && worstWindow
        ? bestWindow.annualizedReturn - worstWindow.annualizedReturn
        : null,
  };
}

function buildRollingStudyIndependent(series, windowYears = [1, 3, 5, 10]) {
  const elapsedDays = (series.at(-1).date - series[0].date) / 86400000;
  const fullPeriodGrowth = computeAnnualizedGrowth(
    series[0].value,
    series.at(-1).value,
    elapsedDays,
  );
  const windowSummaries = windowYears.map((windowYearsValue) =>
    buildRollingSummaryIndependent(
      windowYearsValue,
      buildRollingWindowRowsIndependent(series, windowYearsValue),
    ),
  );

  return {
    fullPeriodCagr: fullPeriodGrowth.annualizedReturn,
    fullPeriodTotalReturn: fullPeriodGrowth.totalReturn,
    windowSummaries,
    availableWindowSummaries: windowSummaries.filter(
      (windowSummary) => windowSummary.observations > 0,
    ),
    unavailableWindowSummaries: windowSummaries.filter(
      (windowSummary) => windowSummary.observations === 0,
    ),
  };
}

function computeRelativeMetricsIndependent(assetSeries, benchmarkSeries, annualRiskFreeRate) {
  const { alignedAssetSeries, alignedBenchmarkSeries } = alignSeries(
    assetSeries,
    benchmarkSeries,
  );
  const assetMetrics = computeRiskMetricsIndependent(
    alignedAssetSeries,
    annualRiskFreeRate,
  );
  const benchmarkMetrics = computeRiskMetricsIndependent(
    alignedBenchmarkSeries,
    annualRiskFreeRate,
  );
  const assetPeriods = toPeriodicReturns(alignedAssetSeries);
  const benchmarkPeriods = toPeriodicReturns(alignedBenchmarkSeries);
  const assetLogReturns = assetPeriods.map((period) => period.logReturn);
  const benchmarkLogReturns = benchmarkPeriods.map((period) => period.logReturn);
  const excessLogReturns = assetLogReturns.map(
    (value, index) => value - benchmarkLogReturns[index],
  );
  const covariance = sampleCovariance(assetLogReturns, benchmarkLogReturns);
  const benchmarkStdDev = sampleStdDev(benchmarkLogReturns);
  const benchmarkVariance =
    benchmarkStdDev !== null ? benchmarkStdDev ** 2 : null;
  const assetStdDev = sampleStdDev(assetLogReturns);
  const trackingError = (sampleStdDev(excessLogReturns) ?? 0) * Math.sqrt(
    assetMetrics.periodsPerYear,
  );
  const annualizedExcessLogReturn =
    (mean(excessLogReturns) ?? 0) * assetMetrics.periodsPerYear;
  const relativeWealthSeries = buildRelativeWealthSeries(
    alignedAssetSeries,
    alignedBenchmarkSeries,
  );

  return {
    overlapObservations: alignedAssetSeries.length,
    overlapReturnObservations: assetPeriods.length,
    overlapStartDate: alignedAssetSeries[0].date,
    overlapEndDate: alignedAssetSeries[alignedAssetSeries.length - 1].date,
    periodsPerYear: assetMetrics.periodsPerYear,
    annualizedExcessLogReturn,
    correlation:
      covariance !== null && assetStdDev && benchmarkStdDev
        ? covariance / (assetStdDev * benchmarkStdDev)
        : null,
    beta:
      covariance !== null && benchmarkVariance
        ? covariance / benchmarkVariance
        : null,
    trackingError,
    informationRatio:
      trackingError > 0 ? annualizedExcessLogReturn / trackingError : null,
    outperformanceRate:
      assetPeriods.length > 0
        ? assetPeriods.filter(
            (period, index) =>
              period.logReturn > benchmarkPeriods[index].logReturn,
          ).length / assetPeriods.length
        : null,
    upsideCapture: buildCaptureRatio(assetPeriods, benchmarkPeriods, "up"),
    downsideCapture: buildCaptureRatio(assetPeriods, benchmarkPeriods, "down"),
    relativeWealth:
      (1 + assetMetrics.totalReturn) / (1 + benchmarkMetrics.totalReturn) - 1,
    cagrSpread:
      assetMetrics.annualizedReturn - benchmarkMetrics.annualizedReturn,
    relativeDrawdown: maxRelativeDrawdown(relativeWealthSeries),
    alignedPeriods: assetPeriods.map((assetPeriod, index) => ({
      startDate: assetPeriod.startDate,
      endDate: assetPeriod.endDate,
      days: assetPeriod.days,
      assetSimpleReturn: assetPeriod.simpleReturn,
      assetLogReturn: assetPeriod.logReturn,
      benchmarkSimpleReturn: benchmarkPeriods[index].simpleReturn,
      benchmarkLogReturn: benchmarkPeriods[index].logReturn,
      excessSimpleReturn:
        assetPeriod.simpleReturn - benchmarkPeriods[index].simpleReturn,
      excessLogReturn: assetPeriod.logReturn - benchmarkPeriods[index].logReturn,
    })),
    assetMetrics,
    benchmarkMetrics,
  };
}

function monthLabel(monthNumber) {
  return MONTH_LABELS[monthNumber - 1];
}

function buildMonthAnchors(series) {
  const anchors = [];
  let activeMonthId = null;
  let activeAnchor = null;

  for (const point of series) {
    const year = point.date.getFullYear();
    const monthIndex = point.date.getMonth();
    const monthNumber = monthIndex + 1;
    const monthId = `${year}-${String(monthNumber).padStart(2, "0")}`;

    if (monthId !== activeMonthId) {
      if (activeAnchor) {
        anchors.push(activeAnchor);
      }

      activeMonthId = monthId;
      activeAnchor = {
        monthId,
        year,
        monthIndex,
        monthNumber,
        monthLabel: monthLabel(monthNumber),
        date: point.date,
        value: point.value,
      };
      continue;
    }

    activeAnchor = {
      ...activeAnchor,
      date: point.date,
      value: point.value,
    };
  }

  if (activeAnchor) {
    anchors.push(activeAnchor);
  }

  return anchors;
}

function monthDistance(leftAnchor, rightAnchor) {
  return (
    (rightAnchor.year - leftAnchor.year) * 12 +
    (rightAnchor.monthIndex - leftAnchor.monthIndex)
  );
}

function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}

function endOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function shouldIncludeMonthlyRow(row, startDate, endDate, includePartialBoundaryMonths) {
  if (includePartialBoundaryMonths) {
    return row.endDate >= startDate && row.endDate <= endDate;
  }

  return startDate <= row.monthStart && endDate >= row.monthEnd;
}

function buildSeasonalityIndependent(series, startDate, endDate, includePartialBoundaryMonths) {
  const anchors = buildMonthAnchors(series);
  const monthlyRows = [];
  let skippedTransitions = 0;

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (monthDistance(previous, current) !== 1) {
      skippedTransitions += 1;
      continue;
    }

    const monthStart = startOfMonth(current.year, current.monthIndex);
    const monthEnd = endOfMonth(current.year, current.monthIndex);
    const simpleReturn = current.value / previous.value - 1;
    const logReturn = Math.log1p(simpleReturn);
    const row = {
      year: current.year,
      monthNumber: current.monthNumber,
      monthLabel: current.monthLabel,
      monthStart,
      monthEnd,
      startDate: previous.date,
      endDate: current.date,
      simpleReturn,
      logReturn,
      isBoundaryPartial: startDate > monthStart || endDate < monthEnd,
      isPositive: logReturn > 0,
    };

    if (
      shouldIncludeMonthlyRow(row, startDate, endDate, includePartialBoundaryMonths)
    ) {
      monthlyRows.push(row);
    }
  }

  const bucketStats = MONTH_LABELS.map((label, monthIndex) => {
    const monthNumber = monthIndex + 1;
    const rows = monthlyRows.filter((row) => row.monthNumber === monthNumber);
    const logReturns = rows.map((row) => row.logReturn);
    return {
      monthLabel: label,
      monthNumber,
      observations: rows.length,
      averageLogReturn: mean(logReturns),
      winRate:
        rows.length > 0 ? rows.filter((row) => row.isPositive).length / rows.length : null,
      volatility: sampleStdDev(logReturns),
    };
  });

  const populated = bucketStats.filter((bucket) => bucket.observations > 0);
  const strongestMonth = populated.reduce(
    (best, bucket) =>
      !best || bucket.averageLogReturn > best.averageLogReturn ? bucket : best,
    null,
  );
  const weakestMonth = populated.reduce(
    (worst, bucket) =>
      !worst || bucket.averageLogReturn < worst.averageLogReturn ? bucket : worst,
    null,
  );
  const bestHitRateMonth = populated.reduce(
    (best, bucket) => (!best || bucket.winRate > best.winRate ? bucket : best),
    null,
  );
  const mostVolatileMonth = populated.reduce(
    (best, bucket) =>
      !best || bucket.volatility > best.volatility ? bucket : best,
    null,
  );

  return {
    monthlyRows,
    bucketStats,
    skippedTransitions,
    summary: {
      monthsUsed: monthlyRows.length,
      yearsObserved: new Set(monthlyRows.map((row) => row.year)).size,
      seasonalitySpread:
        strongestMonth && weakestMonth
          ? strongestMonth.averageLogReturn - weakestMonth.averageLogReturn
          : null,
      strongestMonth,
      weakestMonth,
      bestHitRateMonth,
      mostVolatileMonth,
    },
  };
}

async function loadSnapshot(datasetId) {
  const snapshotPath = path.join(SNAPSHOT_DIR, `${datasetId}.json`);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const series = snapshot.points.map(([date, value]) => ({
    date: new Date(`${date}T00:00:00`),
    value,
  }));

  return { snapshot, series };
}

function buildSelection(snapshot, currency = "INR") {
  return {
    label: snapshot.label,
    symbol: snapshot.symbol,
    providerName: snapshot.providerName,
    targetSeriesType: snapshot.targetSeriesType,
    sourceSeriesType: snapshot.sourceSeriesType,
    returnBasis: snapshot.returnBasis,
    currency,
  };
}

function buildRiskPayload(snapshot, series, metrics) {
  return {
    studyTitle: "Risk-Adjusted Return",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    metrics,
    warnings: [],
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    annualRiskFreeRate: CONSTANT_RISK_FREE_RATE,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    useDemoData: false,
    exportedAt: EXPORTED_AT,
  };
}

function buildSeasonalityPayload(snapshot, series, seasonalityModel, warnings = []) {
  return {
    studyTitle: "Seasonality",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    bucketStats: seasonalityModel.bucketStats,
    monthlyRows: seasonalityModel.monthlyRows,
    heatmap: seasonalityModel.heatmap,
    summary: seasonalityModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    includePartialBoundaryMonths: false,
    monthlyReturnMode: seasonalityModel.monthlyReturnMode,
    confidenceLevel: seasonalityModel.confidenceLevel,
    exportedAt: EXPORTED_AT,
  };
}

function buildSipPayload(snapshot, series, sipModel, monthlyContribution, warnings = []) {
  return {
    studyTitle: "SIP Simulator",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    monthlyPoints: sipModel.monthlyPoints,
    cohorts: sipModel.cohorts,
    summary: sipModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    monthlyContribution,
    minContributions: sipModel.summary.minContributions,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    endMonthLabel:
      sipModel.monthlyPoints[sipModel.monthlyPoints.length - 1]?.monthLabel ?? null,
    exportedAt: EXPORTED_AT,
  };
}

function buildLumpsumVsSipPayload(
  snapshot,
  series,
  comparisonModel,
  totalInvestment,
  horizonYears,
  warnings = [],
) {
  return {
    studyTitle: "Lumpsum vs SIP",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    monthlyPoints: comparisonModel.monthlyPoints,
    cohorts: comparisonModel.cohorts,
    summary: comparisonModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    totalInvestment,
    horizonYears,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    exportedAt: EXPORTED_AT,
  };
}

function buildDrawdownPayload(snapshot, series, drawdownModel, warnings = []) {
  return {
    studyTitle: "Drawdown Study",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    indexSeries: series,
    underwaterSeries: drawdownModel.underwaterSeries,
    episodes: drawdownModel.episodes,
    episodesByDepth: drawdownModel.episodesByDepth,
    summary: drawdownModel.summary,
    warnings,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series[series.length - 1].date,
    exportedAt: EXPORTED_AT,
  };
}

function buildRelativePayload(assetSnapshot, benchmarkSnapshot, relativeMetrics) {
  return {
    studyTitle: "Risk-Adjusted Relative Performance",
    assetSelection: buildSelection(assetSnapshot),
    assetLabel: assetSnapshot.label,
    assetMethodLabel: `Bundled snapshot using ${assetSnapshot.symbol}`,
    benchmarkSelection: buildSelection(benchmarkSnapshot),
    benchmarkLabel: benchmarkSnapshot.label,
    benchmarkMethodLabel: `Bundled snapshot using ${benchmarkSnapshot.symbol}`,
    comparisonBasis: "local",
    comparisonBasisLabel: "Local currency",
    baseCurrency: null,
    assetCurrencyPath: "INR local",
    benchmarkCurrencyPath: "INR local",
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    overlapStartDate: relativeMetrics.overlapStartDate,
    overlapEndDate: relativeMetrics.overlapEndDate,
    relativeMetrics,
    warnings: [],
    exportedAt: EXPORTED_AT,
  };
}

function extractWorksheetNames(workbookXml) {
  return [...workbookXml.matchAll(/<Worksheet ss:Name="([^"]+)">/g)].map(
    (match) => match[1],
  );
}

function compareRiskMetrics(label, actual, expected) {
  const numericKeys = [
    "totalReturn",
    "annualizedLogReturn",
    "annualizedReturn",
    "annualizedExcessLogReturn",
    "annualizedVolatility",
    "downsideDeviation",
    "maxDrawdown",
    "ulcerIndex",
    "sharpeRatio",
    "sortinoRatio",
    "calmarRatio",
    "martinRatio",
    "averageAnnualRiskFreeRate",
    "averageAnnualLogRiskFreeRate",
    "averagePeriodReturn",
    "medianPeriodReturn",
    "simpleAveragePeriodReturn",
    "simpleMedianPeriodReturn",
    "valueAtRisk95",
    "conditionalValueAtRisk95",
    "skewness",
    "excessKurtosis",
    "winRate",
  ];
  const integerKeys = [
    "periodsPerYear",
    "observations",
    "periodicObservations",
    "positivePeriods",
    "nonPositivePeriods",
    "maxDrawdownDurationDays",
    "maxDrawdownDurationPeriods",
  ];

  for (const key of numericKeys) {
    assertClose(actual[key], expected[key], `${label} ${key}`);
  }

  for (const key of integerKeys) {
    assert(actual[key] === expected[key], `${label} ${key}: expected ${expected[key]}, received ${actual[key]}`);
  }

  assertDateEqual(actual.bestPeriod.startDate, expected.bestPeriod.startDate, `${label} bestPeriod start`);
  assertDateEqual(actual.bestPeriod.endDate, expected.bestPeriod.endDate, `${label} bestPeriod end`);
  assertClose(actual.bestPeriod.value, expected.bestPeriod.value, `${label} bestPeriod value`);
  assertDateEqual(actual.worstPeriod.startDate, expected.worstPeriod.startDate, `${label} worstPeriod start`);
  assertDateEqual(actual.worstPeriod.endDate, expected.worstPeriod.endDate, `${label} worstPeriod end`);
  assertClose(actual.worstPeriod.value, expected.worstPeriod.value, `${label} worstPeriod value`);
  assert(actual.periodicReturnMode === "log", `${label} periodicReturnMode should be log`);
}

function compareRelativeMetrics(label, actual, expected) {
  const keys = [
    "annualizedExcessLogReturn",
    "correlation",
    "beta",
    "trackingError",
    "informationRatio",
    "outperformanceRate",
    "upsideCapture",
    "downsideCapture",
    "relativeWealth",
    "cagrSpread",
    "relativeDrawdown",
  ];

  for (const key of keys) {
    assertClose(actual[key], expected[key], `${label} ${key}`);
  }

  assert(actual.overlapObservations === expected.overlapObservations, `${label} overlapObservations mismatch`);
  assert(actual.overlapReturnObservations === expected.overlapReturnObservations, `${label} overlapReturnObservations mismatch`);
  assert(actual.periodsPerYear === expected.periodsPerYear, `${label} periodsPerYear mismatch`);
  assertDateEqual(actual.overlapStartDate, expected.overlapStartDate, `${label} overlapStartDate`);
  assertDateEqual(actual.overlapEndDate, expected.overlapEndDate, `${label} overlapEndDate`);
  assert(actual.alignedPeriods.length === expected.alignedPeriods.length, `${label} alignedPeriods length mismatch`);
}

async function runRiskRegressionChecks() {
  const datasets = ["nifty-50", "sensex"];
  const windows = [
    { label: "5y", startDate: FIVE_YEAR_START, endDate: FIXED_END },
    { label: "1y", startDate: ONE_YEAR_START, endDate: FIXED_END },
  ];

  for (const datasetId of datasets) {
    const { snapshot, series } = await loadSnapshot(datasetId);

    for (const window of windows) {
      const filteredSeries = filterSeriesByDate(series, window.startDate, window.endDate);
      const actual = computeRiskAdjustedMetrics(filteredSeries, {
        constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
      });
      const expected = computeRiskMetricsIndependent(
        filteredSeries,
        CONSTANT_RISK_FREE_RATE,
      );
      compareRiskMetrics(`${datasetId} ${window.label}`, actual, expected);

      if (datasetId === "nifty-50" && window.label === "5y") {
        const html = renderRiskResults({
          metrics: actual,
          startDate: filteredSeries[0].date,
          endDate: filteredSeries.at(-1).date,
          methodLabel: "Regression snapshot",
          warnings: [],
        });
        assert(
          html.includes("What This Means"),
          "risk result view should include interpretation panel",
        );
      }

      if (datasetId === "nifty-50" && window.label === "1y") {
        const html = renderRiskResults({
          metrics: actual,
          startDate: filteredSeries[0].date,
          endDate: filteredSeries.at(-1).date,
          methodLabel: "Regression snapshot",
          warnings: [],
        });
        assert(
          html.includes("CAGR"),
          "full-year risk window should keep CAGR available as a headline",
        );
      }
    }
  }

  const { snapshot: shortSnapshot, series: shortSeriesAll } = await loadSnapshot("nifty-50");
  const shortSeries = filterSeriesByDate(
    shortSeriesAll,
    new Date("2026-01-01T00:00:00"),
    FIXED_END,
  );
  const shortMetrics = computeRiskAdjustedMetrics(shortSeries, {
    constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
  });
  const shortHtml = renderRiskResults({
    metrics: shortMetrics,
    startDate: shortSeries[0].date,
    endDate: shortSeries.at(-1).date,
    methodLabel: "Regression snapshot",
    warnings: [],
  });
  assert(
    shortHtml.includes("Annualized Pace"),
    "short risk window should demote CAGR to annualized pace",
  );
  assert(
    shortHtml.includes("Primary return for short or thin windows"),
    "short risk window should explain that period return is primary",
  );
  const shortWorkbookXml = buildStudyWorkbookXml(
    buildRiskPayload(shortSnapshot, shortSeries, shortMetrics),
  );
  assert(
    shortWorkbookXml.includes("Annualized Pace") &&
      shortWorkbookXml.includes("Return / Max DD"),
    "short risk workbook should use demoted annualized labels",
  );
  assert(
    shortWorkbookXml.includes("Period truth first; annualized values diagnostic"),
    "short risk workbook should record the annualized headline policy",
  );
  assert(
    shortWorkbookXml.includes("return observations"),
    "risk workbook should include sample-count notes for annualized diagnostics",
  );

  console.log("ok risk metrics");
}

async function runSeasonalityRegressionChecks() {
  const { snapshot, series } = await loadSnapshot("nifty-50");
  const filteredSeries = filterSeriesByDate(series, FIVE_YEAR_START, FIXED_END);
  const modelWithoutPartials = buildSeasonalityStudy(series, {
    startDate: FIVE_YEAR_START,
    endDate: FIXED_END,
    includePartialBoundaryMonths: false,
  });
  const expectedWithoutPartials = buildSeasonalityIndependent(
    filteredSeries,
    FIVE_YEAR_START,
    FIXED_END,
    false,
  );
  const modelWithPartials = buildSeasonalityStudy(series, {
    startDate: FIVE_YEAR_START,
    endDate: FIXED_END,
    includePartialBoundaryMonths: true,
  });
  const expectedWithPartials = buildSeasonalityIndependent(
    filteredSeries,
    FIVE_YEAR_START,
    FIXED_END,
    true,
  );

  assert(
    modelWithoutPartials.monthlyRows.length ===
      expectedWithoutPartials.monthlyRows.length,
    "seasonality monthlyRows length mismatch without partials",
  );
  assert(
    modelWithPartials.monthlyRows.length === expectedWithPartials.monthlyRows.length,
    "seasonality monthlyRows length mismatch with partials",
  );
  assert(
    modelWithPartials.monthlyRows.length - modelWithoutPartials.monthlyRows.length === 1,
    "seasonality partial boundary toggle should add one row for the fixed regression window",
  );
  assert(
    modelWithoutPartials.summary.monthsUsed === modelWithoutPartials.monthlyRows.length,
    "seasonality summary monthsUsed should equal monthlyRows length",
  );
  assert(
    modelWithoutPartials.summary.monthsUsed === expectedWithoutPartials.summary.monthsUsed,
    "seasonality monthsUsed mismatch",
  );
  assert(
    modelWithoutPartials.summary.yearsObserved === expectedWithoutPartials.summary.yearsObserved,
    "seasonality yearsObserved mismatch",
  );
  const seasonalityBucketCounts = modelWithoutPartials.bucketStats
    .map((bucket) => bucket.observations)
    .filter((observations) => observations > 0);
  assert(
    modelWithoutPartials.summary.minBucketObservations === Math.min(...seasonalityBucketCounts),
    "seasonality min bucket observations mismatch",
  );
  assert(
    modelWithoutPartials.summary.maxBucketObservations === Math.max(...seasonalityBucketCounts),
    "seasonality max bucket observations mismatch",
  );
  assert(
    Number.isFinite(modelWithoutPartials.summary.medianBucketObservations),
    "seasonality median bucket observations should be finite",
  );
  assert(
    modelWithoutPartials.summary.skippedTransitions ===
      expectedWithoutPartials.skippedTransitions,
    "seasonality skippedTransitions mismatch",
  );
  assert(
    modelWithoutPartials.summary.strongestMonth.monthLabel ===
      expectedWithoutPartials.summary.strongestMonth.monthLabel,
    "seasonality strongestMonth mismatch",
  );
  assert(
    modelWithoutPartials.summary.weakestMonth.monthLabel ===
      expectedWithoutPartials.summary.weakestMonth.monthLabel,
    "seasonality weakestMonth mismatch",
  );
  assert(
    modelWithoutPartials.summary.bestHitRateMonth.monthLabel ===
      expectedWithoutPartials.summary.bestHitRateMonth.monthLabel,
    "seasonality bestHitRateMonth mismatch",
  );
  assert(
    modelWithoutPartials.summary.mostVolatileMonth.monthLabel ===
      expectedWithoutPartials.summary.mostVolatileMonth.monthLabel,
    "seasonality mostVolatileMonth mismatch",
  );
  assertClose(
    modelWithoutPartials.summary.seasonalitySpread,
    expectedWithoutPartials.summary.seasonalitySpread,
    "seasonality spread",
  );

  for (const expectedBucket of expectedWithoutPartials.bucketStats) {
    const actualBucket = modelWithoutPartials.bucketStats.find(
      (bucket) => bucket.monthNumber === expectedBucket.monthNumber,
    );
    assert(actualBucket, `seasonality bucket missing for ${expectedBucket.monthLabel}`);
    assert(
      actualBucket.observations === expectedBucket.observations,
      `seasonality bucket observations mismatch for ${expectedBucket.monthLabel}`,
    );
    assertClose(
      actualBucket.averageLogReturn,
      expectedBucket.averageLogReturn,
      `seasonality bucket averageLogReturn ${expectedBucket.monthLabel}`,
    );
  }

  assert(
    modelWithoutPartials.heatmap.rows.length === modelWithoutPartials.summary.yearsObserved,
    "seasonality heatmap row count should equal yearsObserved",
  );

  const payload = buildSeasonalityPayload(
    snapshot,
    filteredSeries,
    modelWithoutPartials,
  );
  const resultHtml = renderSeasonalityResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "seasonality result view should include interpretation panel",
  );
  assert(
    resultHtml.includes("Sample Depth"),
    "seasonality result view should headline sample depth",
  );
  assert(
    resultHtml.includes("Per-month sample depth"),
    "seasonality result view should explain per-month sample depth",
  );
  assert(
    !resultHtml.includes("<p class=\"meta-label\">Years Observed</p>"),
    "seasonality result view should not headline years observed",
  );
  const csvRows = buildSeasonalityCsvRows(payload);
  const workbookXml = buildSeasonalityWorkbookXml(payload);
  assert(
    csvRows.length === modelWithoutPartials.monthlyRows.length + 1,
    "seasonality CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") ===
      "Summary|Month Buckets|Year-Month Heatmap|Monthly Rows|Warnings",
    `seasonality worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );
  assert(
    workbookXml.includes("Min Bucket Observations"),
    "seasonality workbook should include bucket-depth rows",
  );

  console.log("ok seasonality");
}

async function runRelativeRegressionChecks() {
  const { snapshot: assetSnapshot, series: assetSeriesAll } = await loadSnapshot(
    "nifty-50",
  );
  const { snapshot: benchmarkSnapshot, series: benchmarkSeriesAll } =
    await loadSnapshot("sensex");
  const assetSeries = filterSeriesByDate(assetSeriesAll, FIVE_YEAR_START, FIXED_END);
  const benchmarkSeries = filterSeriesByDate(
    benchmarkSeriesAll,
    FIVE_YEAR_START,
    FIXED_END,
  );
  const actual = computeRelativeMetrics(assetSeries, benchmarkSeries, {
    constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
  });
  const expected = computeRelativeMetricsIndependent(
    assetSeries,
    benchmarkSeries,
    CONSTANT_RISK_FREE_RATE,
  );

  compareRelativeMetrics("relative 5y", actual, expected);

  const payload = buildRelativePayload(assetSnapshot, benchmarkSnapshot, actual);
  const resultHtml = renderRelativeResults(payload);
  assert(
    resultHtml.includes("Relative Read"),
    "relative result view should include interpretation panel",
  );
  assert(
    resultHtml.includes("CAGR Spread"),
    "full-year relative window should keep CAGR spread available",
  );
  const csvRows = buildRelativeCsvRows(payload);
  const workbookXml = buildRelativeWorkbookXml(payload);
  assert(
    csvRows.length === actual.alignedPeriods.length + 1,
    "relative CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Metrics|Aligned Periods|Warnings",
    `relative worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  const shortAssetSeries = filterSeriesByDate(
    assetSeriesAll,
    new Date("2026-01-01T00:00:00"),
    FIXED_END,
  );
  const shortBenchmarkSeries = filterSeriesByDate(
    benchmarkSeriesAll,
    new Date("2026-01-01T00:00:00"),
    FIXED_END,
  );
  const shortRelativeMetrics = computeRelativeMetrics(
    shortAssetSeries,
    shortBenchmarkSeries,
    {
      constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
    },
  );
  const shortRelativeHtml = renderRelativeResults(
    buildRelativePayload(assetSnapshot, benchmarkSnapshot, shortRelativeMetrics),
  );
  assert(
    shortRelativeHtml.includes("Annualized Pace Spread"),
    "short relative window should demote CAGR spread to annualized pace spread",
  );
  assert(
    shortRelativeHtml.includes("First-pass period truth first"),
    "short relative window should promote period truth in summary copy",
  );
  const shortRelativeWorkbookXml = buildRelativeWorkbookXml(
    buildRelativePayload(assetSnapshot, benchmarkSnapshot, shortRelativeMetrics),
  );
  assert(
    shortRelativeWorkbookXml.includes("Annualized Pace Spread"),
    "short relative workbook should demote CAGR spread to annualized pace spread",
  );
  assert(
    shortRelativeWorkbookXml.includes("Terminal wealth difference across the overlap"),
    "relative workbook should explain relative wealth as the primary period read",
  );

  console.log("ok relative");
}

async function runRollingRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const actual = buildRollingReturnsStudy(series);
  const expected = buildRollingStudyIndependent(series);

  assertClose(actual.fullPeriodCagr, expected.fullPeriodCagr, "rolling fullPeriodCagr");
  assertClose(actual.fullPeriodTotalReturn, expected.fullPeriodTotalReturn, "rolling fullPeriodTotalReturn");
  assert(
    actual.availableWindowSummaries.length === expected.availableWindowSummaries.length,
    "rolling availableWindowSummaries length mismatch",
  );
  assert(
    actual.unavailableWindowSummaries.length === expected.unavailableWindowSummaries.length,
    "rolling unavailableWindowSummaries length mismatch",
  );

  for (const expectedSummary of expected.windowSummaries) {
    const actualSummary = actual.windowSummaries.find(
      (windowSummary) => windowSummary.windowYears === expectedSummary.windowYears,
    );
    assert(actualSummary, `rolling summary missing for ${expectedSummary.windowLabel}`);
    assert(
      actualSummary.observations === expectedSummary.observations,
      `rolling observations mismatch for ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.latestCagr,
      expectedSummary.latestCagr,
      `rolling latestCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.medianCagr,
      expectedSummary.medianCagr,
      `rolling medianCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.percentile25Cagr,
      expectedSummary.percentile25Cagr,
      `rolling percentile25Cagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.percentile75Cagr,
      expectedSummary.percentile75Cagr,
      `rolling percentile75Cagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.bestCagr,
      expectedSummary.bestCagr,
      `rolling bestCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.worstCagr,
      expectedSummary.worstCagr,
      `rolling worstCagr ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.positiveRate,
      expectedSummary.positiveRate,
      `rolling positiveRate ${expectedSummary.windowLabel}`,
    );
    assertClose(
      actualSummary.cagrRange,
      expectedSummary.cagrRange,
      `rolling cagrRange ${expectedSummary.windowLabel}`,
    );
  }

  const payload = {
    studyTitle: "Rolling Returns",
    selection: buildSelection(snapshot),
    seriesLabel: snapshot.label,
    methodLabel: `Bundled snapshot using ${snapshot.symbol}`,
    requestedStartDate: FIVE_YEAR_START,
    requestedEndDate: FIXED_END,
    actualStartDate: series[0].date,
    actualEndDate: series.at(-1).date,
    warnings: [],
    exportedAt: EXPORTED_AT,
    ...actual,
  };
  const resultHtml = renderRollingReturnsResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "rolling result view should include interpretation panel",
  );
  const csvRows = buildRollingCsvRows(payload);
  const workbookXml = buildRollingWorkbookXml(payload);
  assert(
    csvRows.length ===
      actual.availableWindowSummaries.reduce(
        (sum, windowSummary) => sum + windowSummary.observations,
        0,
      ) + 1,
    "rolling CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Window Stats|Rolling Rows|Warnings",
    `rolling worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );

  console.log("ok rolling returns");
}

async function runSipRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const monthlyContribution = 10000;
  const actual = buildSipStudy(series, {
    monthlyContribution,
    minContributions: 12,
  });
  const expectedMonthlyPoints = buildMonthlyStartPointsIndependent(series);
  const expectedMonthlyAnchorCount = expectedMonthlyPoints.length;
  const expectedSipCohortCount = Math.max(0, expectedMonthlyAnchorCount - 12 + 1);

  assert(
    actual.monthlyPoints.length === expectedMonthlyAnchorCount,
    `sip monthly anchor count mismatch: ${actual.monthlyPoints.length}`,
  );
  assert(
    actual.cohorts.length === expectedSipCohortCount,
    `sip cohort count mismatch: ${actual.cohorts.length}`,
  );
  assert(
    actual.summary.totalCohorts === actual.cohorts.length,
    "sip total cohort summary mismatch",
  );
  assert(
    actual.summary.fullWindowCohort.contributionCount === actual.monthlyPoints.length,
    "sip full-window contribution count mismatch",
  );
  assertClose(
    actual.summary.fullWindowCohort.totalInvested,
    actual.monthlyPoints.length * monthlyContribution,
    "sip full-window total invested",
  );
  assertClose(
    actual.summary.fullWindowCohort.path.at(-1).portfolioValue,
    actual.summary.fullWindowCohort.terminalValue,
    "sip full-window terminal path value",
  );
  assert(
    actual.cohorts[1].path === undefined &&
      actual.cohorts[1].cashFlows === undefined,
    "sip should trim detailed paths from non-representative cohorts",
  );
  assertDateEqual(
    actual.summary.fullWindowCohort.startDate,
    actual.monthlyPoints[0].date,
    "sip full-window start date",
  );
  assertDateEqual(
    actual.summary.shortestIncludedCohort.startDate,
    actual.monthlyPoints[actual.monthlyPoints.length - 12].date,
    "sip shortest included cohort start date",
  );
  assert(
    actual.summary.bestCohort.xirr >= actual.summary.worstCohort.xirr,
    "sip best cohort should beat worst cohort",
  );
  assert(
    actual.summary.positiveRate >= 0 && actual.summary.positiveRate <= 1,
    "sip positive rate should be bounded",
  );
  assert(
    actual.summary.percentile25Xirr <= actual.summary.percentile75Xirr,
    "sip XIRR percentiles should be ordered",
  );

  const payload = buildSipPayload(
    snapshot,
    series,
    actual,
    monthlyContribution,
  );
  const resultHtml = renderSipSimulatorResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "sip result view should include interpretation panel",
  );
  assert(
    resultHtml.includes("Best XIRR Cohort") &&
      resultHtml.includes("Worst XIRR Cohort"),
    "sip result view should label start-month rankings as cohort XIRR reads",
  );
  assert(
    resultHtml.includes("same-terminal comparisons, not fixed-horizon start-month rankings"),
    "sip result view should explain same-terminal cohort semantics",
  );
  const csvRows = buildSipCsvRows(payload);
  const workbookXml = buildSipWorkbookXml(payload);
  assert(
    csvRows.length === actual.cohorts.length + 1,
    "sip CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") ===
      "Summary|Cohorts|Full Window Path|Cash Flows|Warnings",
    `sip worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );
  assert(
    workbookXml.includes("Cohort Comparison Mode"),
    "sip workbook should record the cohort comparison mode",
  );

  console.log("ok sip simulator");
}

async function runLumpsumVsSipRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const totalInvestment = 600000;
  const horizonYears = 3;
  const actual = buildLumpsumVsSipStudy(series, {
    totalInvestment,
    horizonYears,
  });
  const expectedMonthlyPoints = buildMonthlyStartPointsIndependent(series);
  const expectedMonthlyAnchorCount = expectedMonthlyPoints.length;
  const expectedLumpsumVsSipCohortCount = countLumpsumVsSipCohortsIndependent(
    series,
    expectedMonthlyPoints,
    horizonYears,
  );

  assert(
    actual.monthlyPoints.length === expectedMonthlyAnchorCount,
    `lumpsum vs sip monthly anchor count mismatch: ${actual.monthlyPoints.length}`,
  );
  assert(
    actual.cohorts.length === expectedLumpsumVsSipCohortCount,
    `lumpsum vs sip cohort count mismatch: ${actual.cohorts.length}`,
  );
  assert(
    actual.summary.totalCohorts === actual.cohorts.length,
    "lumpsum vs sip total cohort summary mismatch",
  );
  assertClose(
    actual.summary.lumpsumWinRate + actual.summary.sipWinRate + actual.summary.tieRate,
    1,
    "lumpsum vs sip win rates should sum to one",
  );
  assert(
    actual.summary.medianAdvantageRate >= actual.summary.percentile25AdvantageRate &&
      actual.summary.medianAdvantageRate <= actual.summary.percentile75AdvantageRate,
    "lumpsum vs sip median advantage should sit inside IQR",
  );

  const firstCohort = actual.summary.firstCohort;
  assertDateEqual(
    firstCohort.startDate,
    actual.monthlyPoints[0].date,
    "lumpsum vs sip first cohort start date",
  );
  assertClose(
    firstCohort.lumpsumTerminalValue,
    (totalInvestment / firstCohort.startIndexValue) * firstCohort.endIndexValue,
    "lumpsum vs sip first cohort terminal value",
  );
  assertClose(
    firstCohort.sipPath.at(-1).portfolioValue,
    firstCohort.sipTerminalValue,
    "lumpsum vs sip first cohort terminal SIP path value",
  );
  assertClose(
    firstCohort.sipPath
      .filter((row) => !row.terminalOnly)
      .reduce((sum, row) => sum + row.contributionAmount, 0),
    totalInvestment,
    "lumpsum vs sip SIP deployed capital should equal total investment",
  );
  assert(
    actual.cohorts[1].sipPath === undefined &&
      actual.cohorts[1].sipCashFlows === undefined,
    "lumpsum vs sip should trim detailed paths from non-representative cohorts",
  );
  assert(
    actual.summary.bestLumpsumAdvantage.advantageRate >=
      actual.summary.bestSipAdvantage.advantageRate,
    "lumpsum vs sip best/worst advantage ordering mismatch",
  );

  const payload = buildLumpsumVsSipPayload(
    snapshot,
    series,
    actual,
    totalInvestment,
    horizonYears,
  );
  const resultHtml = renderLumpsumVsSipResults(payload);
  assert(
    resultHtml.includes("What This Means"),
    "lumpsum vs sip result view should include interpretation panel",
  );
  assert(
    resultHtml.includes("Win rate and advantage use terminal wealth"),
    "lumpsum vs sip result view should state the terminal-wealth win criterion",
  );
  assert(
    resultHtml.includes("CAGR and XIRR are not directly comparable"),
    "lumpsum vs sip result view should warn against comparing CAGR and XIRR directly",
  );
  const csvRows = buildLumpsumVsSipCsvRows(payload);
  const workbookXml = buildLumpsumVsSipWorkbookXml(payload);
  assert(
    csvRows.length === actual.cohorts.length + 1,
    "lumpsum vs sip CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") ===
      "Summary|Cohorts|Representative SIP Path|Warnings",
    `lumpsum vs sip worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );
  assert(
    workbookXml.includes("Win Criterion") &&
      workbookXml.includes("Terminal wealth"),
    "lumpsum vs sip workbook should record the win criterion",
  );

  console.log("ok lumpsum vs sip");
}

async function runDrawdownRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const actual = buildDrawdownStudy(series);

  assert(
    actual.underwaterSeries.length === series.length,
    "drawdown underwater series should align with index observations",
  );
  assertClose(
    actual.underwaterSeries[0].depth,
    0,
    "drawdown underwater series should start at zero",
  );
  assert(
    actual.underwaterSeries.every((point) => point.depth <= 0),
    "drawdown underwater points should be non-positive",
  );
  assert(
    actual.episodes.length === actual.episodesByDepth.length,
    "drawdown ranked episode count mismatch",
  );
  assert(
    actual.summary.totalEpisodes === actual.episodes.length,
    "drawdown summary total episodes mismatch",
  );
  assert(
    actual.summary.recoveredEpisodes + actual.summary.unrecoveredEpisodes ===
      actual.summary.totalEpisodes,
    "drawdown recovered/unrecovered split mismatch",
  );
  assert(
    actual.summary.timeUnderwaterRate >= 0 &&
      actual.summary.timeUnderwaterRate <= 1,
    "drawdown time underwater rate should be bounded",
  );
  assertClose(
    actual.summary.materialityThreshold,
    0.001,
    "drawdown materiality threshold mismatch",
  );

  for (const [index, episode] of actual.episodesByDepth.entries()) {
    assert(
      episode.depthRank === index + 1,
      "drawdown depth rank sequence mismatch",
    );
    if (index > 0) {
      assert(
        actual.episodesByDepth[index - 1].maxDepth <= episode.maxDepth,
        "drawdown depth ranking should be sorted from deepest to shallowest",
      );
    }
    assert(
      episode.peakDate <= episode.troughDate &&
        episode.troughDate <= episode.endDate,
      "drawdown episode dates should be ordered",
    );
    if (episode.recovered) {
      assert(
        episode.recoveryDate !== null && episode.recoveryDate >= episode.troughDate,
        "drawdown recovered episode should have a recovery date",
      );
    } else {
      assert(
        episode.recoveryDate === null &&
          toIsoDate(episode.endDate) === toIsoDate(series.at(-1).date),
        "drawdown open episode should end at the latest observation",
      );
    }
  }

  const payload = buildDrawdownPayload(snapshot, series, actual);
  const resultHtml = renderDrawdownStudyResults(payload);
  assert(
    resultHtml.includes("Ranked Episodes"),
    "drawdown result view should include ranked episode table",
  );
  assert(
    resultHtml.includes("Materiality threshold"),
    "drawdown result view should explain the materiality threshold",
  );
  const csvRows = buildDrawdownCsvRows(payload);
  const workbookXml = buildDrawdownWorkbookXml(payload);
  assert(
    csvRows.length === actual.episodesByDepth.length + 1,
    "drawdown CSV row count mismatch",
  );
  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Episodes|Underwater|Warnings",
    `drawdown worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );
  assert(
    workbookXml.includes("Materiality Threshold"),
    "drawdown workbook should include the materiality threshold row",
  );

  const microSeries = [
    { date: new Date("2026-01-01T00:00:00"), value: 100 },
    { date: new Date("2026-01-02T00:00:00"), value: 99.96 },
    { date: new Date("2026-01-03T00:00:00"), value: 100.01 },
  ];
  const microDrawdown = buildDrawdownStudy(microSeries);
  assert(
    microDrawdown.episodes.length === 0,
    "sub-threshold drawdowns should not form counted episodes",
  );
  assertClose(
    microDrawdown.summary.timeUnderwaterRate,
    0,
    "sub-threshold drawdowns should not count as underwater time",
  );

  console.log("ok drawdown");
}

async function runExportRegressionChecks() {
  const { snapshot, series: allSeries } = await loadSnapshot("nifty-50");
  const series = filterSeriesByDate(allSeries, FIVE_YEAR_START, FIXED_END);
  const metrics = computeRiskAdjustedMetrics(series, {
    constantRiskFreeRate: CONSTANT_RISK_FREE_RATE,
  });
  const payload = buildRiskPayload(snapshot, series, metrics);
  const csvRows = buildStudyCsvRows(payload);
  const serializedCsv = serializeCsv(csvRows);
  const workbookXml = buildStudyWorkbookXml(payload);

  assert(
    csvRows.length === series.length + 1,
    "risk-adjusted CSV row count mismatch",
  );
  assert(
    csvRows[0].includes("period_log_return_decimal"),
    "risk-adjusted CSV header should include period_log_return_decimal",
  );
  assert(
    serializedCsv.startsWith("\uFEFFstudy,selection_label"),
    "risk-adjusted serialized CSV should start with a UTF-8 BOM and header row",
  );

  const worksheetNames = extractWorksheetNames(workbookXml);
  assert(
    worksheetNames.join("|") === "Summary|Metrics|Series|Periods|Warnings",
    `risk-adjusted worksheet names mismatch: ${worksheetNames.join(", ")}`,
  );
  assert(
    workbookXml.includes("Annualized Log Return"),
    "risk-adjusted workbook should include Annualized Log Return",
  );
  assert(
    workbookXml.includes("Return Basis") && workbookXml.includes("price"),
    "risk-adjusted workbook should include the selection return basis",
  );
  assert(
    workbookXml.includes("Period Risk-Free Log Return"),
    "risk-adjusted workbook should include log risk-free columns",
  );

  console.log("ok exports");
}

async function main() {
  testActiveSubjectStore();
  testAppRouteModel();
  await testStudyBuilderBackendRecipeHydration();
  await testStudyBuilderReadinessHydration();
  await testAssistantApiHelpers();
  assertionCount += runMetricRegistryChecks();
  assertionCount += runStudyBuilderChecks();
  runSymbolDiscoveryChecks();
  await testRunHistoryStore();
  testAvailableStudyWindow();
  testStudyKickerLabels();
  testShareableInputUrls();
  testInterpretationPanels();
  testReturnBasisPolicy();
  await runRiskRegressionChecks();
  await runSeasonalityRegressionChecks();
  await runRelativeRegressionChecks();
  await runRollingRegressionChecks();
  await runSipRegressionChecks();
  await runLumpsumVsSipRegressionChecks();
  await runDrawdownRegressionChecks();
  await runExportRegressionChecks();

  console.log(`frontend regression checks passed (${assertionCount} assertions)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
