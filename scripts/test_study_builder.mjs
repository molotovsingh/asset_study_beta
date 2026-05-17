import { fileURLToPath } from "node:url";

import { checkAssistantContractSync } from "./export_assistant_contract.mjs";
import { checkIntentPlannerContractSync } from "./export_intent_planner_contract.mjs";
import { checkStudyCatalogManifestSync } from "./export_study_catalog_manifest.mjs";
import { checkStudyPlanContractSync } from "./export_study_plan_contract.mjs";
import { checkStudyPlanRecipeContractSync } from "./export_study_plan_recipe_contract.mjs";
import { checkStudyRunExplanationContractSync } from "./export_study_run_explanation_contract.mjs";
import { checkStudyRunExplanationBriefContractSync } from "./export_study_run_explanation_brief_contract.mjs";
import { checkStudyRunHandoffContractSync } from "./export_study_run_handoff_contract.mjs";
import {
  buildStudyBuilderPlanPayload,
  buildStudyBuilderValidationPayload,
} from "./build_study_builder_payload.mjs";
import { buildAssistantContractBundle } from "./build_assistant_contract_bundle.mjs";
import { buildStudyRunAssistantPayload } from "./build_study_run_assistant_payload.mjs";
import {
  METRIC_PRESENTATION,
  buildRiskMetricPresentation,
} from "../app/lib/metricRegistry.js";
import {
  STUDY_PLAN_ISSUE_CODES,
  STUDY_PLAN_VERSION,
  buildStudyPlanConfirmationPreview,
  buildStudyPlanFromRouteHash,
  getStudyPlanContractManifest,
  getStudyPlanParamDefinition,
  normalizeStudyRouteHashInput,
  validateStudyPlan,
} from "../app/studyBuilder/studyPlan.js";
import {
  STUDY_CATALOG_MANIFEST_VERSION,
  getStudyCatalogEntry,
  getStudyCatalogManifest,
} from "../app/studyBuilder/studyCatalog.js";
import {
  ASSISTANT_CONTRACT_VERSION,
  getAssistantContractManifest,
} from "../app/studyBuilder/assistantContract.js";
import {
  INTENT_PLANNER_DIAGNOSTIC_CODES,
  INTENT_PLANNER_EXAMPLES,
  INTENT_PLANNER_VERSION,
  draftStudyPlanFromIntent,
  getIntentPlannerContractManifest,
} from "../app/studyBuilder/intentPlanner.js";
import {
  STUDY_PLAN_RECIPE_STORAGE_KEY,
  deleteStudyPlanRecipe,
  getStudyPlanRecipeContractManifest,
  loadStudyPlanRecipes,
  saveStudyPlanRecipe,
} from "../app/studyBuilder/studyPlanRecipes.js";
import {
  STUDY_RUN_EXPLANATION_CONFIDENCE,
  STUDY_RUN_EXPLANATION_ISSUE_CODES,
  buildStudyRunExplanationSeed,
  getStudyRunExplanationExamples,
  getStudyRunExplanationContractManifest,
  serializeStudyRunExplanationSeed,
} from "../app/studyBuilder/studyRunExplanation.js";
import {
  STUDY_RUN_HANDOFF_ISSUE_CODES,
  buildStudyRunAssistantHandoff,
  getStudyRunHandoffContractManifest,
  getStudyRunHandoffExamples,
  serializeStudyRunAssistantHandoff,
} from "../app/studyBuilder/studyRunHandoff.js";
import {
  STUDY_RUN_EXPLANATION_BRIEF_ACTIONS,
  STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES,
  STUDY_RUN_EXPLANATION_BRIEF_MODES,
  buildStudyRunExplanationBriefFromHandoff,
  buildStudyRunExplanationBriefFromRun,
  getStudyRunExplanationBriefContractManifest,
  getStudyRunExplanationBriefExamples,
  serializeStudyRunExplanationBriefFromHandoff,
} from "../app/studyBuilder/studyRunExplanationBrief.js";
import {
  EXAMPLE_STUDY_INTENT,
  EXAMPLE_STUDY_PLAN,
  EXAMPLE_STUDY_ROUTE_HASH,
  renderStudyBuilderSettingsPage,
} from "../app/settings/studyBuilderSettings.js";

let assertionCount = 0;

function createMemoryStorage() {
  const items = new Map();
  return {
    getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      items.set(key, String(value));
    },
    removeItem(key) {
      items.delete(key);
    },
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  assertionCount += 1;
}

function toLocalInputDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function runStudyBuilderChecks() {
  const validPlan = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "overview",
    params: {
      subject: "Nifty 50",
      start: "2021-04-08",
      end: "2026-04-08",
      rf: "5.50",
      demo: "0",
    },
    requiresConfirmation: true,
  });

  assert(validPlan.ok, "valid risk study plan should pass");
  assert(
    validPlan.routeHash ===
      "#risk-adjusted-return/overview?subject=Nifty+50&start=2021-04-08&end=2026-04-08&rf=5.50&demo=0",
    "valid risk study plan should build the expected route hash",
  );
  const validPreview = buildStudyPlanConfirmationPreview(validPlan.normalizedPlan);
  assert(validPreview.canRun, "valid study plan preview should be runnable after confirmation");
  assert(
    validPreview.studyTitle === "Risk-Adjusted Return" &&
      validPreview.viewLabel === "Overview",
    "valid study plan preview should expose human study and view labels",
  );
  assert(
    validPreview.paramItems.some(
      (item) =>
        item.key === "subject" &&
        item.label === "Subject" &&
        item.value === "Nifty 50",
    ),
    "valid study plan preview should expose labeled route params for confirmation",
  );
  const routeRoundTrip = buildStudyPlanFromRouteHash(
    "#risk-adjusted-return/relative?subject=Nifty+50&benchmark=Sensex&start=2021-01-01&end=2024-12-31&rf=5.5",
  );
  assert(
    routeRoundTrip.ok &&
      routeRoundTrip.normalizedRouteHash ===
        "#risk-adjusted-return/relative?subject=Nifty+50&benchmark=Sensex&start=2021-01-01&end=2024-12-31&rf=5.5" &&
      routeRoundTrip.rawPlan.studyId === "risk-adjusted-return" &&
      routeRoundTrip.normalizedPlan.studyId === "risk-adjusted-return" &&
      routeRoundTrip.normalizedPlan.viewId === "relative" &&
      routeRoundTrip.normalizedPlan.params.benchmark === "Sensex" &&
      routeRoundTrip.routeHash ===
        "#risk-adjusted-return/relative?subject=Nifty+50&benchmark=Sensex&start=2021-01-01&end=2024-12-31&rf=5.5",
    "study route hash should round-trip into a validated StudyPlan",
  );
  const fullUrlRoundTrip = buildStudyPlanFromRouteHash(
    "http://127.0.0.1:8000/#risk-adjusted-return/overview?subject=Nifty+50&start=2021-04-08",
  );
  assert(
    fullUrlRoundTrip.ok &&
      fullUrlRoundTrip.input.startsWith("http://127.0.0.1:8000/") &&
      fullUrlRoundTrip.normalizedRouteHash ===
        "#risk-adjusted-return/overview?subject=Nifty+50&start=2021-04-08" &&
      fullUrlRoundTrip.normalizedPlan.params.subject === "Nifty 50",
    "study route hash conversion should accept full copied app URLs",
  );
  assert(
    normalizeStudyRouteHashInput("/rolling-returns/overview?subject=Nifty+50") ===
      "#rolling-returns/overview?subject=Nifty+50",
    "study route input normalization should accept slash-prefixed hashes",
  );
  const invalidRouteRoundTrip = buildStudyPlanFromRouteHash(
    "#risk-adjusted-return/overview?subject=Nifty+50&hallucinated=yes",
  );
  assert(
    !invalidRouteRoundTrip.ok &&
      invalidRouteRoundTrip.issues.some(
        (issue) => issue.code === STUDY_PLAN_ISSUE_CODES.PARAM_UNSUPPORTED,
      ),
    "study route hash conversion should still reject unsupported params",
  );
  const unknownRouteRoundTrip = buildStudyPlanFromRouteHash(
    "#settings/automations?ignored=yes",
  );
  assert(
    !unknownRouteRoundTrip.ok &&
      unknownRouteRoundTrip.rawPlan.studyId === "settings" &&
      unknownRouteRoundTrip.rawPlan.viewId === "automations" &&
      unknownRouteRoundTrip.issues.some(
        (issue) => issue.code === STUDY_PLAN_ISSUE_CODES.STUDY_UNKNOWN,
      ),
    "study route hash conversion should preserve the raw parsed route when validation fails",
  );

  const defaultedViewPlan = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "rolling-returns",
    params: { subject: "Nifty 50" },
    requiresConfirmation: true,
  });
  assert(defaultedViewPlan.ok, "missing viewId should default for known studies");
  assert(
    defaultedViewPlan.warnings.some((warning) => warning.includes("viewId defaulted")),
    "defaulted viewId should be visible as a warning",
  );

  const unknownStudy = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "invented-study",
    viewId: "overview",
    requiresConfirmation: true,
  });
  assert(!unknownStudy.ok, "unknown study plan should fail");

  const unsupportedView = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "made-up-view",
    requiresConfirmation: true,
  });
  assert(
    !unsupportedView.ok &&
      unsupportedView.errors.some((error) => error.includes("Unsupported viewId")),
    "unsupported view should fail",
  );

  const unsupportedParam = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "overview",
    params: { subject: "Nifty 50", hallucinated: "yes" },
    requiresConfirmation: true,
  });
  assert(
    !unsupportedParam.ok &&
      unsupportedParam.errors.some((error) => error.includes("Unsupported param")),
    "unsupported params should fail",
  );
  assert(
    unsupportedParam.issues.some(
      (issue) => issue.code === STUDY_PLAN_ISSUE_CODES.PARAM_UNSUPPORTED,
    ),
    "unsupported params should expose a machine-readable issue code",
  );

  const invalidDates = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "overview",
    params: { subject: "Nifty 50", start: "2026-04-08", end: "2021-04-08" },
    requiresConfirmation: true,
  });
  assert(
    !invalidDates.ok &&
      invalidDates.errors.some((error) => error.includes("start must be on or before end")),
    "date range inversion should fail",
  );
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const futureDates = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "rolling-returns",
    viewId: "overview",
    params: { subject: "Nifty 50", start: "2021-01-01", end: toLocalInputDate(tomorrow) },
    requiresConfirmation: true,
  });
  assert(
    !futureDates.ok &&
      futureDates.issues.some(
        (issue) => issue.code === STUDY_PLAN_ISSUE_CODES.DATE_FUTURE,
      ),
    "future explicit dates should fail before assistant route handoff",
  );
  const invalidOptionsSort = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "options-screener",
    viewId: "overview",
    params: { u: "us-liquid-10", sort: "iv_hv20" },
    requiresConfirmation: true,
  });
  assert(
    !invalidOptionsSort.ok &&
      invalidOptionsSort.issues.some(
        (issue) =>
          issue.code === STUDY_PLAN_ISSUE_CODES.PARAM_VALUE_INVALID &&
          issue.field === "sort",
      ),
    "non-canonical options sort values should fail validation",
  );
  const validOptionsSort = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "options-screener",
    viewId: "overview",
    params: {
      u: "us-liquid-10",
      bias: "all",
      advice: "all",
      preset: "all",
      sort: "ivHv20Ratio",
    },
    requiresConfirmation: true,
  });
  assert(validOptionsSort.ok, "canonical options screener params should validate");

  const noConfirmation = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "overview",
    params: { subject: "Nifty 50" },
    requiresConfirmation: false,
  });
  assert(
    !noConfirmation.ok &&
      noConfirmation.errors.some((error) => error.includes("requiresConfirmation")),
    "plans must require confirmation",
  );

  const shortRiskPresentation = buildRiskMetricPresentation({
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    metrics: {
      totalReturn: 0.08,
      annualizedReturn: 0.38,
      maxDrawdown: -0.04,
      periodicObservations: 61,
    },
  });
  const unsafeMetricPlan = validateStudyPlan({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "overview",
    params: { subject: "Nifty 50" },
    requiresConfirmation: true,
    metricProposals: [
      {
        metricId: shortRiskPresentation.secondaryReturn.id,
        proposedStatus: METRIC_PRESENTATION.HEADLINE,
        proposedExportable: true,
        evaluatedDecision: shortRiskPresentation.secondaryReturn,
      },
    ],
  });
  assert(
    !unsafeMetricPlan.ok &&
      unsafeMetricPlan.errors.some((error) => error.includes("expected diagnostic")),
    "study plan should reject unsafe metric headline proposals",
  );
  const unsafeMetricPreview = buildStudyPlanConfirmationPreview({
    version: STUDY_PLAN_VERSION,
    studyId: "risk-adjusted-return",
    viewId: "overview",
    params: { subject: "Nifty 50" },
    requiresConfirmation: true,
    metricProposals: [
      {
        metricId: shortRiskPresentation.secondaryReturn.id,
        proposedStatus: METRIC_PRESENTATION.HEADLINE,
        proposedExportable: true,
        evaluatedDecision: shortRiskPresentation.secondaryReturn,
      },
    ],
  });
  assert(
    unsafeMetricPreview.canRun === false &&
      unsafeMetricPreview.metricErrors.some((error) => error.includes("expected diagnostic")),
    "study plan preview should block unsafe metric proposals",
  );
  assert(
    unsafeMetricPreview.issues.some(
      (issue) => issue.code === STUDY_PLAN_ISSUE_CODES.METRIC_POLICY_ERROR,
    ),
    "study plan preview should expose metric policy issue codes",
  );

  const manifest = getStudyPlanContractManifest();
  assert(
    manifest.version === STUDY_PLAN_VERSION,
    "study plan manifest should expose the schema version",
  );
  assert(
    manifest.routeParamRules["risk-adjusted-return"].overview.includes("subject"),
    "study plan manifest should expose allowed route params",
  );
  assert(
    manifest.confirmationPreviewFields.includes("routeHash"),
    "study plan manifest should expose confirmation preview fields",
  );
  assert(
    manifest.routeConversionFields.includes("rawPlan") &&
      manifest.routeConversionFields.includes("normalizedPlan") &&
      manifest.routeConversionFields.includes("normalizedRouteHash"),
    "study plan manifest should expose route conversion fields",
  );
  assert(
    manifest.routeInputFormats.some((format) => format.includes("http://127.0.0.1:8000/")),
    "study plan manifest should expose accepted route input formats",
  );
  assert(
    manifest.issueCodes.includes(STUDY_PLAN_ISSUE_CODES.PARAM_UNSUPPORTED),
    "study plan manifest should expose machine-readable issue codes",
  );
  assert(
    manifest.paramDefinitions.rf.type === "percent" &&
      manifest.paramDefinitions.rf.min === 0 &&
      manifest.paramDefinitions.rf.max === 100,
    "study plan manifest should expose route parameter semantics",
  );
  assert(
    getStudyPlanParamDefinition("dte").label === "Minimum DTE",
    "study plan param definitions should be queryable by key",
  );
  assert(
    checkStudyPlanContractSync().ok,
    "docs/study-plan-contract.json should stay generated from the JS study-plan contract",
  );
  const recipeStorage = createMemoryStorage();
  const savedRecipe = saveStudyPlanRecipe({
    name: "Nifty 50 Risk Overview",
    plan: validPlan.normalizedPlan,
    storage: recipeStorage,
    now: "2026-05-15T00:00:00.000Z",
  });
  assert(
    savedRecipe.ok &&
      savedRecipe.recipe.routeHash === validPlan.routeHash &&
      savedRecipe.recipe.plan.studyId === "risk-adjusted-return",
    "valid StudyPlans should save as reusable recipes",
  );
  assert(
    JSON.parse(recipeStorage.getItem(STUDY_PLAN_RECIPE_STORAGE_KEY)).recipes.length === 1,
    "recipe storage should persist saved recipes under the recipe storage key",
  );
  const invalidRecipe = saveStudyPlanRecipe({
    name: "Bad recipe",
    plan: { version: STUDY_PLAN_VERSION, studyId: "invented-study", requiresConfirmation: true },
    storage: recipeStorage,
  });
  assert(
    !invalidRecipe.ok &&
      loadStudyPlanRecipes(recipeStorage).length === 1,
    "invalid StudyPlans should not be saved as recipes",
  );
  const deletedRecipes = deleteStudyPlanRecipe(savedRecipe.recipe.id, recipeStorage);
  assert(
    deletedRecipes.length === 0 &&
      loadStudyPlanRecipes(recipeStorage).length === 0,
    "saved StudyPlan recipes should be deletable",
  );
  const recipeContract = getStudyPlanRecipeContractManifest();
  assert(
    recipeContract.storageKey === STUDY_PLAN_RECIPE_STORAGE_KEY &&
      recipeContract.recordFields.includes("routeHash"),
    "study plan recipe contract should expose storage key and record fields",
  );
  assert(
    checkStudyPlanRecipeContractSync().ok,
    "docs/study-plan-recipe-contract.json should stay generated from the JS recipe contract",
  );
  const explanationSeed = buildStudyRunExplanationSeed({
    runId: 42,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    viewId: "overview",
    selectionLabel: "Nifty 50",
    subjectQuery: "Nifty 50",
    status: "success",
    routeHash: "#risk-adjusted-return/overview?subject=Nifty+50",
    requestedStartDate: "2026-01-01",
    requestedEndDate: "2026-05-15",
    actualStartDate: "2026-01-02",
    actualEndDate: "2026-04-08",
    resolvedParams: {
      warningMessages: [
        "Loaded data is marked as a Price proxy for TRI.",
      ],
    },
    warningCount: 1,
    summaryItems: [
      {
        summaryKey: "cagr",
        label: "CAGR",
        valueNumber: 0.42,
        valueKind: "percent",
      },
      {
        summaryKey: "total-return",
        label: "Total Return",
        valueNumber: 0.09,
        valueKind: "percent",
      },
    ],
    links: [
      {
        linkType: "evidence-source",
        targetKind: "study_run",
        targetId: "42",
      },
    ],
    dataSnapshotRefs: [{ kind: "cache-series", symbol: "NIFTY50" }],
    providerSummary: {
      primaryProviderName: "Yahoo Finance",
      symbol: "^NSEI",
      targetSeriesType: "TRI",
      sourceSeriesType: "Price",
      returnBasis: "price_proxy",
      sourcePolicy: "blocked_proxy_tri",
      sourceName: "Yahoo Finance Close via yfinance",
      licenseNote: "Price-only proxy data cannot be used as approved TRI evidence.",
    },
  });
  assert(
    explanationSeed.canExplain &&
      explanationSeed.confidence === STUDY_RUN_EXPLANATION_CONFIDENCE.MEDIUM &&
      explanationSeed.sourcePolicy.sourcePolicy === "blocked_proxy_tri" &&
      explanationSeed.window.clipped &&
      explanationSeed.issues.some(
        (issue) => issue.code === STUDY_RUN_EXPLANATION_ISSUE_CODES.WINDOW_CLIPPED,
      ) &&
      explanationSeed.issues.some(
        (issue) =>
          issue.code ===
          STUDY_RUN_EXPLANATION_ISSUE_CODES.SOURCE_POLICY_BLOCKED_PROXY_TRI,
      ) &&
      explanationSeed.issues.some(
        (issue) =>
          issue.code === STUDY_RUN_EXPLANATION_ISSUE_CODES.SHORT_WINDOW_ANNUALIZED,
      ) &&
      explanationSeed.explanationBullets.some((bullet) => bullet.includes("Run 42")),
    "study-run explanation seed should expose real window, warning, and annualization caveats",
  );
  assert(
    explanationSeed.explanationBullets.some((bullet) =>
      bullet.includes("Source policy: Blocked proxy TRI"),
    ),
    "study-run explanation seed should expose source-policy bullets",
  );
  const warningBullet = explanationSeed.explanationBullets.find((bullet) =>
    bullet.startsWith("Recorded warning(s):"),
  );
  assert(
    warningBullet ===
      "Recorded warning(s): Loaded data is marked as a Price proxy for TRI.",
    "study-run explanation warning bullets should not add duplicate punctuation",
  );
  const topLevelWarningSeed = buildStudyRunExplanationSeed({
    runId: 43,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Nifty 50",
    subjectQuery: "Nifty 50",
    status: "success",
    warningMessages: ["Top-level warning.", "Top-level warning.", ""],
    warningCount: 0,
  });
  assert(
    topLevelWarningSeed.run.warningCount === 1 &&
      topLevelWarningSeed.run.warningMessages.length === 1 &&
      topLevelWarningSeed.explanationBullets.includes(
        "Recorded warning(s): Top-level warning.",
      ),
    "study-run explanation seed should normalize top-level warning messages defensively",
  );
  const serializedExplanationSeed = serializeStudyRunExplanationSeed({
    runId: 42,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Nifty 50",
    status: "success",
    summaryItems: [{ label: "Total Return", valueNumber: 0.09 }],
  });
  assert(
    serializedExplanationSeed.endsWith("\n") &&
      JSON.parse(serializedExplanationSeed).version === "study-run-explanation-v1",
    "study-run explanation seeds should serialize as stable JSON payloads",
  );
  const failedExplanationSeed = buildStudyRunExplanationSeed({
    runId: 43,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Fake Symbol",
    subjectQuery: "ZZZNOTREAL123",
    status: "failed",
    errorMessage: "No history found.",
  });
  assert(
    !failedExplanationSeed.canExplain &&
      failedExplanationSeed.confidence === STUDY_RUN_EXPLANATION_CONFIDENCE.BLOCKED &&
      failedExplanationSeed.issues.some(
        (issue) => issue.code === STUDY_RUN_EXPLANATION_ISSUE_CODES.STATUS_FAILED,
      ),
    "failed study runs should block result-conclusion explanations",
  );
  const explanationContract = getStudyRunExplanationContractManifest();
  const explanationExamples = getStudyRunExplanationExamples();
  assert(
    explanationContract.issueCodes.includes(
      STUDY_RUN_EXPLANATION_ISSUE_CODES.SHORT_WINDOW_ANNUALIZED,
    ) &&
      explanationContract.issueCodes.includes(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.SOURCE_POLICY_BLOCKED_PROXY_TRI,
      ) &&
      explanationContract.outputFields.includes("sourcePolicy") &&
      explanationContract.outputFields.includes("explanationBullets") &&
      explanationContract.helperFunctions.includes("serializeStudyRunExplanationSeed(run)") &&
      explanationContract.examples.length === explanationExamples.length,
    "study-run explanation contract should expose issue codes, output fields, and examples",
  );
  assert(
    explanationExamples.some(
      (example) =>
        example.id === "short-window-annualized-caveat" &&
        example.seed.issues.some(
          (issue) =>
            issue.code === STUDY_RUN_EXPLANATION_ISSUE_CODES.SHORT_WINDOW_ANNUALIZED,
        ),
    ) &&
      explanationExamples.some(
        (example) =>
          example.id === "failed-ledger-run" &&
          example.seed.confidence === STUDY_RUN_EXPLANATION_CONFIDENCE.BLOCKED,
      ),
    "study-run explanation examples should cover annualized caveats and failed runs",
  );
  assert(
    checkStudyRunExplanationContractSync().ok,
    "docs/study-run-explanation-contract.json should stay generated from the JS explanation contract",
  );
  const assistantHandoff = buildStudyRunAssistantHandoff({
    runId: 44,
    studyId: "options-screener",
    studyTitle: "Options Screener",
    viewId: "overview",
    selectionLabel: "US Liquid 10",
    subjectQuery: "us-liquid-10",
    status: "success",
    routeHash: "#options-screener/overview?u=us-liquid-10",
    summaryItems: [{ label: "Filtered Rows", valueNumber: 7, valueKind: "integer" }],
    links: [{ linkType: "evidence-source", targetKind: "options_screener_run", targetId: "44" }],
  });
  assert(
    assistantHandoff.readyForResultExplanation &&
      assistantHandoff.readyForReplay &&
      assistantHandoff.explanationSeed.run.runId === 44 &&
      assistantHandoff.replayStudyPlan.normalizedPlan.studyId === "options-screener" &&
      assistantHandoff.replayStudyPlan.normalizedPlan.params.u === "us-liquid-10",
    "study-run handoff should combine explanation seed and replay StudyPlan",
  );
  const serializedAssistantHandoff = serializeStudyRunAssistantHandoff({
    runId: 44,
    studyId: "options-screener",
    studyTitle: "Options Screener",
    selectionLabel: "US Liquid 10",
    subjectQuery: "us-liquid-10",
    status: "success",
    routeHash: "#options-screener/overview?u=us-liquid-10",
  });
  assert(
    serializedAssistantHandoff.endsWith("\n") &&
      JSON.parse(serializedAssistantHandoff).version === "study-run-handoff-v1",
    "study-run handoff should serialize as a stable JSON payload",
  );
  const missingRouteHandoff = buildStudyRunAssistantHandoff({
    runId: 45,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Nifty 50",
    status: "success",
    summaryItems: [{ label: "Total Return", valueNumber: 0.09 }],
  });
  assert(
    missingRouteHandoff.readyForResultExplanation &&
      !missingRouteHandoff.readyForReplay &&
      missingRouteHandoff.issues.some(
        (issue) => issue.code === STUDY_RUN_HANDOFF_ISSUE_CODES.REPLAY_ROUTE_MISSING,
      ),
    "study-run handoff should allow explanation while blocking replay when route is missing",
  );
  const handoffContract = getStudyRunHandoffContractManifest();
  const handoffExamples = getStudyRunHandoffExamples();
  assert(
    handoffContract.outputFields.includes("explanationSeed") &&
      handoffContract.outputFields.includes("replayStudyPlan") &&
      handoffContract.helperFunctions.includes("serializeStudyRunAssistantHandoff(run)") &&
      handoffContract.examples.length === handoffExamples.length,
    "study-run handoff contract should expose payload fields, helper functions, and examples",
  );
  assert(
    checkStudyRunHandoffContractSync().ok,
    "docs/study-run-handoff-contract.json should stay generated from the JS handoff contract",
  );
  const cleanBrief = buildStudyRunExplanationBriefFromHandoff(assistantHandoff);
  assert(
    cleanBrief.mode === STUDY_RUN_EXPLANATION_BRIEF_MODES.RESULT_WITH_CAVEATS &&
      cleanBrief.resultConclusionAllowed &&
      cleanBrief.replay.canReplay &&
      cleanBrief.allowedAssistantActions.includes(
        STUDY_RUN_EXPLANATION_BRIEF_ACTIONS.EXPLAIN_RESULT_WITH_CAVEATS,
      ) &&
      cleanBrief.allowedAssistantActions.includes(
        STUDY_RUN_EXPLANATION_BRIEF_ACTIONS.OFFER_REPLAY_CONFIRMATION,
      ),
    "study-run explanation brief should allow result prose and replay only from a ready handoff",
  );
  const caveatBrief = buildStudyRunExplanationBriefFromRun({
    runId: 46,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Nifty 50",
    subjectQuery: "Nifty 50",
    status: "success",
    routeHash: "#risk-adjusted-return/overview?subject=Nifty+50&start=2026-01-01&end=2026-04-08",
    requestedStartDate: "2026-01-01",
    requestedEndDate: "2026-04-08",
    actualStartDate: "2026-01-03",
    actualEndDate: "2026-04-08",
    warningCount: 1,
    summaryItems: [{ label: "CAGR", valueText: "42.0%", valueKind: "percent" }],
    providerSummary: {
      primaryProviderName: "Yahoo Finance",
      symbol: "^NSEI",
      targetSeriesType: "TRI",
      sourceSeriesType: "Price",
      returnBasis: "price_proxy",
      sourcePolicy: "blocked_proxy_tri",
      sourceName: "Yahoo Finance Close via yfinance",
    },
  });
  assert(
    caveatBrief.requiredCaveats.length > 0 &&
      caveatBrief.sourcePolicy.sourcePolicy === "blocked_proxy_tri" &&
      caveatBrief.issues.some(
        (issue) => issue.code === STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES.CAVEATS_REQUIRED,
      ),
    "study-run explanation brief should force generated prose to carry handoff caveats",
  );
  const failedBrief = buildStudyRunExplanationBriefFromRun({
    runId: 47,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Fake Symbol",
    subjectQuery: "ZZZNOTREAL123",
    status: "failed",
    errorMessage: "No history found.",
  });
  assert(
    failedBrief.mode === STUDY_RUN_EXPLANATION_BRIEF_MODES.FAILURE_ONLY &&
      !failedBrief.resultConclusionAllowed &&
      failedBrief.allowedAssistantActions.includes(
        STUDY_RUN_EXPLANATION_BRIEF_ACTIONS.EXPLAIN_FAILURE_ONLY,
      ),
    "study-run explanation brief should block result conclusions for failed runs",
  );
  const serializedBrief = serializeStudyRunExplanationBriefFromHandoff(assistantHandoff);
  assert(
    serializedBrief.endsWith("\n") &&
      JSON.parse(serializedBrief).version === "study-run-explanation-brief-v1",
    "study-run explanation brief should serialize as a stable JSON payload",
  );
  const bridgeFixtureRun = {
    runId: 48,
    studyId: "options-screener",
    studyTitle: "Options Screener",
    viewId: "overview",
    selectionLabel: "US Liquid 10",
    subjectQuery: "us-liquid-10",
    status: "success",
    routeHash: "#options-screener/overview?u=us-liquid-10",
    summaryItems: [{ label: "Filtered Rows", valueNumber: 7, valueKind: "integer" }],
  };
  const bridgePayload = buildStudyRunAssistantPayload(bridgeFixtureRun);
  const directHandoff = buildStudyRunAssistantHandoff(bridgeFixtureRun);
  const directBrief = buildStudyRunExplanationBriefFromHandoff(directHandoff);
  assert(
    JSON.stringify(bridgePayload.handoff) === JSON.stringify(directHandoff) &&
      JSON.stringify(bridgePayload.explanationBrief) === JSON.stringify(directBrief),
    "study-run assistant bridge should match direct JS handoff and brief builders",
  );
  const failedBridgeFixtureRun = {
    runId: 49,
    studyId: "risk-adjusted-return",
    studyTitle: "Risk-Adjusted Return",
    selectionLabel: "Fake Symbol",
    subjectQuery: "ZZZNOTREAL123",
    status: "failed",
    errorMessage: "No history found.",
    routeHash: "#risk-adjusted-return/overview?subject=ZZZNOTREAL123",
  };
  const failedBridgePayload = buildStudyRunAssistantPayload(failedBridgeFixtureRun);
  const directFailedHandoff = buildStudyRunAssistantHandoff(failedBridgeFixtureRun);
  const directFailedBrief = buildStudyRunExplanationBriefFromHandoff(directFailedHandoff);
  assert(
    JSON.stringify(failedBridgePayload.handoff) === JSON.stringify(directFailedHandoff) &&
      JSON.stringify(failedBridgePayload.explanationBrief) ===
        JSON.stringify(directFailedBrief) &&
      failedBridgePayload.explanationBrief.mode ===
        STUDY_RUN_EXPLANATION_BRIEF_MODES.FAILURE_ONLY,
    "study-run assistant bridge should match direct builders for failed runs",
  );
  const briefContract = getStudyRunExplanationBriefContractManifest();
  const briefExamples = getStudyRunExplanationBriefExamples();
  assert(
    briefContract.outputFields.includes("allowedAssistantActions") &&
      briefContract.outputFields.includes("prohibitedClaims") &&
      briefContract.outputFields.includes("sourcePolicy") &&
      briefContract.examples.length === briefExamples.length,
    "study-run explanation brief contract should expose assistant prose permissions",
  );
  assert(
    checkStudyRunExplanationBriefContractSync().ok,
    "docs/study-run-explanation-brief-contract.json should stay generated from the JS brief contract",
  );
  const catalogManifest = getStudyCatalogManifest();
  assert(
    catalogManifest.version === STUDY_CATALOG_MANIFEST_VERSION,
    "study catalog manifest should expose the manifest version",
  );
  assert(
    catalogManifest.studies.length >= 10,
    "study catalog manifest should include registered studies",
  );
  assert(
    getStudyCatalogEntry("risk-adjusted-return").views.some(
      (view) => view.id === "relative",
    ),
    "study catalog manifest should expose study views",
  );
  assert(
    !JSON.stringify(catalogManifest).includes("function"),
    "study catalog manifest should be JSON-safe and omit mount functions",
  );
  assert(
    checkStudyCatalogManifestSync().ok,
    "docs/study-catalog-manifest.json should stay generated from the JS study catalog",
  );
  const assistantContract = getAssistantContractManifest();
  assert(
    assistantContract.version === ASSISTANT_CONTRACT_VERSION,
    "assistant contract should expose the top-level contract version",
  );
  assert(
    assistantContract.contracts.some((contract) => contract.id === "metric-registry"),
    "assistant contract should point to the metric registry",
  );
  assert(
    assistantContract.hardStops.some((item) => item.includes("Do not invent study IDs")),
    "assistant contract should expose non-negotiable hard stops",
  );
  assert(
    assistantContract.contracts.some((contract) => contract.id === "intent-planner"),
    "assistant contract should expose the deterministic intent planner harness",
  );
  assert(
    assistantContract.contracts.some((contract) => contract.id === "study-proposal"),
    "assistant contract should expose the read-only study proposal contract",
  );
  assert(
    assistantContract.contracts.some(
      (contract) => contract.id === "study-run-explanation",
    ) &&
      assistantContract.contracts.some(
        (contract) => contract.id === "study-run-handoff",
      ) &&
      assistantContract.contracts.some(
        (contract) => contract.id === "study-run-explanation-brief",
      ) &&
      assistantContract.hardStops.some((item) =>
        item.includes("durable study-run ledger record"),
      ) &&
      assistantContract.hardStops.some((item) =>
        item.includes("rebuild replay parameters manually"),
      ) &&
      assistantContract.hardStops.some((item) =>
        item.includes("explanation brief blocks"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "GET" &&
          endpoint.path === "/api/assistant/contract" &&
          endpoint.successResponseFields.includes("hardStops"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "GET" &&
          endpoint.path === "/api/assistant/contract-bundle" &&
          endpoint.successResponseFields.includes("contracts"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "GET" &&
          endpoint.path === "/api/assistant/readiness" &&
          endpoint.successResponseFields.includes("liveAiTesting"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/assistant/study-plan-dry-run" &&
          endpoint.successResponseFields.includes("readiness") &&
          endpoint.successResponseFields.includes("execution"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/assistant/study-plan-live-draft" &&
          endpoint.successResponseFields.includes("modelResult") &&
          endpoint.successResponseFields.includes("execution"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/assistant/study-run-brief" &&
          endpoint.successResponseFields.includes("explanationBrief") &&
          endpoint.errorStatuses.some((error) => error.status === 400) &&
          endpoint.errorStatuses.some((error) => error.status === 404) &&
          endpoint.errorStatuses.some((error) => error.status === 502),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/study-builder/plan" &&
          endpoint.successResponseFields.includes("plannerResult"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/study-factory/proposal" &&
          endpoint.successResponseFields.includes("proposal") &&
          endpoint.successResponseFields.includes("execution"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/study-builder/validate" &&
          endpoint.successResponseFields.includes("preview"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "GET" &&
          endpoint.path === "/api/study-builder/recipes" &&
          endpoint.successResponseFields.includes("recipes"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/study-builder/recipes/save" &&
          endpoint.successResponseFields.includes("validation"),
      ) &&
      assistantContract.backendEndpoints.some(
        (endpoint) =>
          endpoint.method === "POST" &&
          endpoint.path === "/api/study-builder/recipes/delete" &&
          endpoint.successResponseFields.includes("recipes"),
      ),
    "assistant contract should require durable backend handoff records before result explanation and replay",
  );
  assert(
    checkAssistantContractSync().ok,
    "docs/assistant-contract.json should stay generated from the JS assistant contract",
  );
  const assistantBundle = buildAssistantContractBundle();
  assert(
    assistantBundle.version === "assistant-contract-bundle-v1" &&
      assistantBundle.contracts.assistant.version === "assistant-contract-v1" &&
      assistantBundle.contracts.metricRegistry.rules.length > 0 &&
      assistantBundle.contracts.studyCatalog.studies.length > 0 &&
      assistantBundle.contracts.studyProposal.version === "study-proposal-v1" &&
      assistantBundle.contracts.studyPlan.version === STUDY_PLAN_VERSION,
    "assistant contract bundle should expose all deterministic assistant inputs from JS sources",
  );
  const intentPlannerManifest = getIntentPlannerContractManifest();
  assert(
    intentPlannerManifest.version === INTENT_PLANNER_VERSION &&
      intentPlannerManifest.templateRules.some((rule) => rule.id === "risk-relative"),
    "intent planner manifest should expose deterministic template rules",
  );
  assert(
    intentPlannerManifest.examples.length === INTENT_PLANNER_EXAMPLES.length,
    "intent planner manifest should expose deterministic example fixtures",
  );
  assert(
    intentPlannerManifest.diagnosticCodes.includes(
      INTENT_PLANNER_DIAGNOSTIC_CODES.TEMPLATE_DEFAULTED,
    ),
    "intent planner manifest should expose stable diagnostic codes",
  );
  assert(
    intentPlannerManifest.confidenceValues.includes("needs-review"),
    "intent planner manifest should expose stable confidence values",
  );
  INTENT_PLANNER_EXAMPLES.forEach((example) => {
    const draft = draftStudyPlanFromIntent(example.intent);
    assert(
      draft.plan.studyId === example.expectedStudyId &&
        draft.plan.viewId === example.expectedViewId,
      `intent planner example should draft expected target for ${example.id}`,
    );
  });
  assert(
    checkIntentPlannerContractSync().ok,
    "docs/intent-planner-contract.json should stay generated from the JS intent planner contract",
  );
  const relativeDraft = draftStudyPlanFromIntent(
    "Compare Nifty 50 against Sensex from 2021 to 2024",
  );
  assert(
    relativeDraft.preview.canRun &&
      relativeDraft.confidence === "draft" &&
      relativeDraft.plan.studyId === "risk-adjusted-return" &&
      relativeDraft.plan.viewId === "relative" &&
      relativeDraft.plan.params.subject === "Nifty 50" &&
      relativeDraft.plan.params.benchmark === "Sensex" &&
      relativeDraft.plan.params.start === "2021-01-01" &&
      relativeDraft.plan.params.end === "2024-12-31",
    "intent planner should draft a validated relative risk StudyPlan from natural language",
  );
  const drawdownDraft = draftStudyPlanFromIntent("Show TSLA drawdown recovery");
  assert(
    drawdownDraft.preview.canRun &&
      drawdownDraft.confidence === "needs-review" &&
      drawdownDraft.plan.studyId === "drawdown-study" &&
      drawdownDraft.plan.params.subject === "TSLA",
    "intent planner should route drawdown language to the drawdown study",
  );
  const emptyDraft = draftStudyPlanFromIntent("");
  assert(
    emptyDraft.confidence === "blocked" &&
      emptyDraft.diagnostics.some((issue) => issue.code === "intent.empty"),
    "intent planner should return deterministic diagnostics for empty intent",
  );
  const defaultedDraft = draftStudyPlanFromIntent("Analyze this market setup");
  assert(
    defaultedDraft.plan.studyId === "risk-adjusted-return" &&
      defaultedDraft.confidence === "needs-review" &&
      defaultedDraft.diagnostics.some((issue) => issue.code === "intent.template_defaulted"),
    "intent planner fallback should be visible as a deterministic diagnostic",
  );
  const backendPlanPayload = buildStudyBuilderPlanPayload({
    intent: "Compare Nifty 50 against Sensex from 2021 to 2024",
  });
  assert(
    backendPlanPayload.version === "study-builder-plan-response-v1" &&
      JSON.stringify(backendPlanPayload.plannerResult) === JSON.stringify(relativeDraft) &&
      backendPlanPayload.preview.canRun,
    "study-builder plan bridge should match direct intent planner output",
  );
  const directValidation = validateStudyPlan(EXAMPLE_STUDY_PLAN);
  const backendValidationPayload = buildStudyBuilderValidationPayload({
    plan: EXAMPLE_STUDY_PLAN,
  });
  assert(
    backendValidationPayload.version === "study-builder-validation-response-v1" &&
      backendValidationPayload.mode === "plan" &&
      JSON.stringify(backendValidationPayload.validation) === JSON.stringify(directValidation) &&
      backendValidationPayload.preview.canRun,
    "study-builder validation bridge should match direct StudyPlan validation output",
  );
  const backendRoutePayload = buildStudyBuilderValidationPayload({
    routeHash: "#drawdown-study/overview?subject=TSLA",
  });
  assert(
    backendRoutePayload.mode === "route" &&
      backendRoutePayload.route.ok &&
      backendRoutePayload.preview.normalizedPlan.studyId === "drawdown-study",
    "study-builder validation bridge should convert route hashes through the StudyPlan validator",
  );
  const validSettingsHtml = renderStudyBuilderSettingsPage({
    intentText: EXAMPLE_STUDY_INTENT,
    routeHashText: EXAMPLE_STUDY_ROUTE_HASH,
    planText: JSON.stringify(EXAMPLE_STUDY_PLAN, null, 2),
    plannerResult: relativeDraft,
    preview: validPreview,
    recipes: [savedRecipe.recipe],
    statusMessage: "Plan validated.",
  });
  assert(
    validSettingsHtml.includes("Study Builder Preview") &&
      validSettingsHtml.includes("Backend-owned harness") &&
      validSettingsHtml.includes("Experimental: Live AI Draft") &&
      validSettingsHtml.includes("Intent Draft") &&
      validSettingsHtml.includes("Both paths stop at StudyPlan validation") &&
      validSettingsHtml.includes("Convert Route") &&
      validSettingsHtml.includes("Saved Recipes") &&
      validSettingsHtml.includes("Nifty 50 Risk Overview") &&
      validSettingsHtml.includes("Backend recipes when the local server is available") &&
      validSettingsHtml.includes("copied app URLs") &&
      validSettingsHtml.includes("Matched Template") &&
      validSettingsHtml.includes("Go to route") &&
      validSettingsHtml.includes("Subject"),
    "study builder settings page should render intent drafting and a labeled confirmation preview",
  );
  const liveDraftSettingsHtml = renderStudyBuilderSettingsPage({
    intentText: EXAMPLE_STUDY_INTENT,
    routeHashText: EXAMPLE_STUDY_ROUTE_HASH,
    planText: JSON.stringify(EXAMPLE_STUDY_PLAN, null, 2),
    preview: validPreview,
    liveDraftResult: {
      provider: "openai",
      model: "gpt-test",
      modelResult: { responseId: "resp_test" },
      validation: { ok: true },
      preview: validPreview,
      execution: { executed: false },
    },
    statusMessage: "Live AI drafted a valid non-executing StudyPlan.",
  });
  assert(
    liveDraftSettingsHtml.includes("Experimental Live AI Draft") &&
      liveDraftSettingsHtml.includes("gpt-test") &&
      liveDraftSettingsHtml.includes("resp_test") &&
      liveDraftSettingsHtml.includes("Validated by StudyPlan contract") &&
      liveDraftSettingsHtml.includes("no study execution") &&
      liveDraftSettingsHtml.includes("Valid Draft"),
    "study builder settings page should render live AI draft metadata without implying execution",
  );
  const blockedSettingsHtml = renderStudyBuilderSettingsPage({
    intentText: "",
    routeHashText: EXAMPLE_STUDY_ROUTE_HASH,
    planText: "{}",
    preview: unsafeMetricPreview,
    statusMessage: "Plan blocked.",
  });
  assert(
    blockedSettingsHtml.includes("Blocked") &&
      blockedSettingsHtml.includes("metric.policy_error"),
    "study builder settings page should render deterministic issue codes for blocked plans",
  );

  return assertionCount;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const checks = runStudyBuilderChecks();
    console.log(`study builder checks passed (${checks} assertions)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { runStudyBuilderChecks };
