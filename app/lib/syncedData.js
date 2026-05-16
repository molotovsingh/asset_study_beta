import { ASSISTANT_CONTRACT_VERSION } from "../studyBuilder/assistantContract.js";
import {
  ASSISTANT_CONTRACT_BUNDLE_VERSION,
  ASSISTANT_READINESS_VERSION,
  ASSISTANT_STUDY_PLAN_DRY_RUN_VERSION,
  ASSISTANT_STUDY_PLAN_LIVE_DRAFT_VERSION,
} from "../studyBuilder/assistantApiContract.js";
import {
  STUDY_BUILDER_PLAN_RESPONSE_VERSION,
  STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
} from "../studyBuilder/studyBuilderApiContract.js";
import { INTENT_PLANNER_VERSION } from "../studyBuilder/intentPlanner.js";
import { STUDY_PLAN_VERSION } from "../studyBuilder/studyPlan.js";
import { STUDY_PLAN_RECIPE_STORAGE_VERSION } from "../studyBuilder/studyPlanRecipes.js";
import { STUDY_RUN_EXPLANATION_BRIEF_VERSION } from "../studyBuilder/studyRunExplanationBrief.js";
import { STUDY_RUN_HANDOFF_VERSION } from "../studyBuilder/studyRunHandoff.js";
import {
  STUDY_PROPOSAL_RESPONSE_VERSION,
  STUDY_PROPOSAL_VERSION,
} from "../studyFactory/studyProposal.js";

const LOCAL_API_COMMAND = "./.venv/bin/python scripts/dev_server.py --port 8000";

function buildApiUrl(pathname) {
  return new URL(`../../api${pathname}`, import.meta.url);
}

function buildManifestRelativePath(syncConfig) {
  return `data/snapshots/${syncConfig.provider}/${syncConfig.datasetType}/manifest.json`;
}

function buildManifestUrl(syncConfig) {
  return new URL(
    `../../${buildManifestRelativePath(syncConfig)}`,
    import.meta.url,
  );
}

function buildSnapshotRelativePath(syncConfig, relativePath) {
  if (relativePath) {
    return relativePath.startsWith("data/")
      ? relativePath
      : `data/snapshots/${relativePath}`;
  }

  return `data/snapshots/${syncConfig.provider}/${syncConfig.datasetType}/${syncConfig.datasetId}.json`;
}

function buildSnapshotUrl(syncConfig, relativePath) {
  return new URL(
    `../../${buildSnapshotRelativePath(syncConfig, relativePath)}`,
    import.meta.url,
  );
}

function normalizeSnapshotPoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }

      const [dateValue, numericValue] = point;
      const date = new Date(`${dateValue}T00:00:00`);
      const value = Number(numericValue);

      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) {
        return null;
      }

      return { date, value };
    })
    .filter(Boolean)
    .sort((left, right) => left.date - right.date);
}

function normalizeSnapshotSeries(snapshot, errorMessage) {
  const series = normalizeSnapshotPoints(snapshot?.points);
  if (series.length < 2) {
    throw new Error(errorMessage);
  }

  return series;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(left, right) {
  return Math.floor((startOfDay(left) - startOfDay(right)) / 86400000);
}

function getSnapshotFreshness(snapshot, now = new Date()) {
  const latestDate = snapshot?.range?.endDate
    ? new Date(`${snapshot.range.endDate}T00:00:00`)
    : null;
  const generatedAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null;

  const marketLagDays =
    latestDate && !Number.isNaN(latestDate.getTime())
      ? Math.max(daysBetween(now, latestDate), 0)
      : null;
  const syncAgeDays =
    generatedAt && !Number.isNaN(generatedAt.getTime())
      ? Math.max(daysBetween(now, generatedAt), 0)
      : null;

  let status = "unknown";
  if (marketLagDays !== null) {
    if (marketLagDays <= 2) {
      status = "fresh";
    } else if (marketLagDays <= 5) {
      status = "recent";
    } else {
      status = "stale";
    }
  }

  return {
    status,
    latestDate,
    marketLagDays,
    syncAgeDays,
  };
}

function describeFreshness(freshness) {
  switch (freshness.status) {
    case "fresh":
      return "Fresh";
    case "recent":
      return "Recent";
    case "stale":
      return "Stale";
    default:
      return "Unknown";
  }
}

function buildLocalApiUnavailableMessage() {
  return `Could not reach the local data API. Built-in bundled snapshots still work, but raw symbols need ${LOCAL_API_COMMAND}.`;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function requestJson(
  url,
  {
    requestInit = {},
    onNetworkError = () => "The request could not be completed.",
    onHttpError = (response, payload) =>
      payload?.error || `Request failed (${response.status} ${response.statusText}).`,
  } = {},
) {
  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...requestInit,
    });
  } catch (error) {
    throw new Error(onNetworkError(error));
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(onHttpError(response, payload));
  }

  return payload;
}

async function requestLocalApiJson(
  pathname,
  body,
  {
    onHttpError,
    onNetworkError = () => buildLocalApiUnavailableMessage(),
  } = {},
) {
  return requestJson(buildApiUrl(pathname), {
    requestInit: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    onNetworkError,
    onHttpError,
  });
}

function validateDatasetsPayload(payload, errorMessage) {
  if (!Array.isArray(payload?.datasets)) {
    throw new Error(errorMessage);
  }

  return payload.datasets;
}

async function loadSyncManifest(syncConfig) {
  if (!syncConfig) {
    throw new Error("No synced source is configured for this dataset.");
  }

  const manifest = await requestJson(buildManifestUrl(syncConfig), {
    onHttpError: (response) => {
      if (response.status === 404) {
        return `No bundled manifest was found at ${buildManifestRelativePath(syncConfig)}.`;
      }

      return `Could not load the bundled manifest (${response.status} ${response.statusText}).`;
    },
  });

  validateDatasetsPayload(
    manifest,
    "The bundled manifest does not contain a datasets list.",
  );
  return manifest;
}

function getManifestDataset(manifest, syncConfig) {
  return (
    manifest?.datasets?.find(
      (dataset) => dataset.datasetId === syncConfig?.datasetId,
    ) || null
  );
}

async function loadSyncedSeries(syncConfig, manifestDataset = null) {
  if (!syncConfig) {
    throw new Error("No synced source is configured for this dataset.");
  }

  const snapshot = await requestJson(
    buildSnapshotUrl(syncConfig, manifestDataset?.path),
    {
      onHttpError: (response) => {
        const expectedPath = buildSnapshotRelativePath(
          syncConfig,
          manifestDataset?.path,
        );
        if (response.status === 404) {
          return `No bundled snapshot was found at ${expectedPath}.`;
        }

        return `Could not load the bundled snapshot (${response.status} ${response.statusText}).`;
      },
    },
  );

  return {
    snapshot,
    series: normalizeSnapshotSeries(
      snapshot,
      "The bundled snapshot did not contain enough observations.",
    ),
  };
}

async function loadRememberedIndexCatalog() {
  const payload = await requestJson(buildApiUrl("/yfinance/catalog"), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || buildLocalApiUnavailableMessage(),
  });

  validateDatasetsPayload(
    payload,
    "The local data API returned an invalid catalog payload.",
  );
  return payload.datasets;
}

async function fetchRuntimeHealth() {
  const payload = await requestJson(buildApiUrl("/system/runtime-health"), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || buildLocalApiUnavailableMessage(),
  });
  if (!payload?.summary || !Array.isArray(payload?.attentionSymbols)) {
    throw new Error("The local data API returned an invalid runtime health payload.");
  }
  return payload;
}

async function fetchAutomationState() {
  const payload = await requestJson(buildApiUrl("/automations"), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || buildLocalApiUnavailableMessage(),
  });
  if (!Array.isArray(payload?.automations) || !payload?.catalogs) {
    throw new Error("The local data API returned an invalid automation payload.");
  }
  return payload;
}

function buildQueryString(request) {
  const searchParams = new URLSearchParams();
  Object.entries(request || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      return;
    }
    searchParams.set(key, normalized);
  });
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

async function fetchStudyRuns(request = {}) {
  const payload = await requestJson(buildApiUrl(`/study-runs${buildQueryString(request)}`), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || buildLocalApiUnavailableMessage(),
  });
  if (!Array.isArray(payload?.runs)) {
    throw new Error("The local data API returned an invalid study-runs payload.");
  }
  return payload;
}

async function fetchAssistantContract() {
  const payload = await requestJson(buildApiUrl("/assistant/contract"), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load the assistant contract.",
  });
  if (
    payload?.version !== ASSISTANT_CONTRACT_VERSION ||
    !Array.isArray(payload?.contracts) ||
    !Array.isArray(payload?.backendEndpoints) ||
    !Array.isArray(payload?.hardStops)
  ) {
    throw new Error("The local data API returned an invalid assistant contract payload.");
  }
  return payload;
}

async function fetchAssistantContractBundle() {
  const payload = await requestJson(buildApiUrl("/assistant/contract-bundle"), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load the assistant contract bundle.",
  });
  if (
    payload?.version !== ASSISTANT_CONTRACT_BUNDLE_VERSION ||
    payload?.contracts?.assistant?.version !== ASSISTANT_CONTRACT_VERSION ||
    !payload?.contracts?.metricRegistry ||
    !payload?.contracts?.studyCatalog ||
    payload?.contracts?.studyPlan?.version !== STUDY_PLAN_VERSION
  ) {
    throw new Error("The local data API returned an invalid assistant contract bundle payload.");
  }
  return payload;
}

async function fetchAssistantReadiness(request = {}) {
  const payload = await requestJson(buildApiUrl(`/assistant/readiness${buildQueryString(request)}`), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load assistant readiness.",
  });
  if (
    payload?.version !== ASSISTANT_READINESS_VERSION ||
    !payload?.summary ||
    !Array.isArray(payload?.checks)
  ) {
    throw new Error("The local data API returned an invalid assistant readiness payload.");
  }
  return payload;
}

async function fetchStudyRunBrief(request) {
  const payload = await requestLocalApiJson("/assistant/study-run-brief", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that assistant run brief.",
  });
  if (
    !payload?.run?.runId ||
    payload?.handoff?.version !== STUDY_RUN_HANDOFF_VERSION ||
    payload?.explanationBrief?.version !== STUDY_RUN_EXPLANATION_BRIEF_VERSION
  ) {
    throw new Error("The local data API returned an invalid assistant run brief payload.");
  }
  return payload;
}

async function dryRunAssistantStudyPlan(request) {
  const payload = await requestLocalApiJson("/assistant/study-plan-dry-run", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not dry-run that assistant StudyPlan.",
  });
  if (
    payload?.version !== ASSISTANT_STUDY_PLAN_DRY_RUN_VERSION ||
    payload?.readiness?.version !== ASSISTANT_READINESS_VERSION ||
    payload?.plannerResult?.version !== INTENT_PLANNER_VERSION ||
    payload?.plan?.version !== STUDY_PLAN_VERSION ||
    !payload?.validation ||
    !payload?.preview ||
    payload?.execution?.executed !== false
  ) {
    throw new Error("The local data API returned an invalid assistant StudyPlan dry-run payload.");
  }
  return payload;
}

async function liveDraftAssistantStudyPlan(request) {
  const payload = await requestLocalApiJson("/assistant/study-plan-live-draft", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not live-draft that assistant StudyPlan.",
  });
  if (
    payload?.version !== ASSISTANT_STUDY_PLAN_LIVE_DRAFT_VERSION ||
    payload?.provider !== "openai" ||
    payload?.readiness?.version !== ASSISTANT_READINESS_VERSION ||
    !payload?.modelResult ||
    payload?.plan?.version !== STUDY_PLAN_VERSION ||
    !payload?.validation ||
    !payload?.preview ||
    payload?.execution?.executed !== false
  ) {
    throw new Error("The local data API returned an invalid assistant StudyPlan live-draft payload.");
  }
  return payload;
}

async function buildStudyFactoryProposal(request) {
  const payload = await requestLocalApiJson("/study-factory/proposal", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not build that study proposal.",
  });
  if (
    payload?.version !== STUDY_PROPOSAL_RESPONSE_VERSION ||
    payload?.mode !== "read-only" ||
    payload?.proposal?.version !== STUDY_PROPOSAL_VERSION ||
    payload?.execution?.executed !== false ||
    payload?.execution?.generatedCode !== false
  ) {
    throw new Error("The local data API returned an invalid study proposal payload.");
  }
  return payload;
}

async function draftStudyBuilderPlan(request) {
  const payload = await requestLocalApiJson("/study-builder/plan", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not draft that StudyPlan.",
  });
  if (
    payload?.version !== STUDY_BUILDER_PLAN_RESPONSE_VERSION ||
    payload?.plannerResult?.version !== INTENT_PLANNER_VERSION ||
    payload?.plan?.version !== STUDY_PLAN_VERSION ||
    !payload?.preview
  ) {
    throw new Error("The local data API returned an invalid study-builder plan payload.");
  }
  return payload;
}

async function validateStudyBuilderPlan(request) {
  const payload = await requestLocalApiJson("/study-builder/validate", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not validate that StudyPlan.",
  });
  if (
    payload?.version !== STUDY_BUILDER_VALIDATION_RESPONSE_VERSION ||
    !["plan", "route"].includes(payload?.mode) ||
    !payload?.validation ||
    !payload?.preview ||
    (
      payload?.validation?.normalizedPlan &&
      payload.validation.normalizedPlan.version !== STUDY_PLAN_VERSION
    ) ||
    (
      payload?.normalizedPlan &&
      payload.normalizedPlan.version !== STUDY_PLAN_VERSION
    )
  ) {
    throw new Error("The local data API returned an invalid study-builder validation payload.");
  }
  return payload;
}

async function fetchStudyPlanRecipes(request = {}) {
  const payload = await requestJson(buildApiUrl(`/study-builder/recipes${buildQueryString(request)}`), {
    onNetworkError: () => buildLocalApiUnavailableMessage(),
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load StudyPlan recipes.",
  });
  if (
    payload?.version !== STUDY_PLAN_RECIPE_STORAGE_VERSION ||
    !Array.isArray(payload?.recipes)
  ) {
    throw new Error("The local data API returned an invalid StudyPlan recipe payload.");
  }
  return payload;
}

async function saveStudyPlanRecipe(request) {
  const payload = await requestLocalApiJson("/study-builder/recipes/save", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not save that StudyPlan recipe.",
  });
  if (typeof payload?.ok !== "boolean" || !Array.isArray(payload?.recipes)) {
    throw new Error("The local data API returned an invalid StudyPlan recipe save payload.");
  }
  return payload;
}

async function deleteStudyPlanRecipe(request) {
  const payload = await requestLocalApiJson("/study-builder/recipes/delete", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not delete that StudyPlan recipe.",
  });
  if (typeof payload?.ok !== "boolean" || !Array.isArray(payload?.recipes)) {
    throw new Error("The local data API returned an invalid StudyPlan recipe delete payload.");
  }
  return payload;
}

async function saveAutomationConfig(request) {
  const payload = await requestLocalApiJson("/automations/save", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not save that automation.",
  });
  if (!payload?.automation || !payload?.state) {
    throw new Error("The local data API returned an invalid automation save payload.");
  }
  return payload;
}

async function deleteAutomationConfig(request) {
  const payload = await requestLocalApiJson("/automations/delete", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not delete that automation.",
  });
  if (!payload?.state) {
    throw new Error("The local data API returned an invalid automation delete payload.");
  }
  return payload;
}

async function runAutomationNow(request) {
  const payload = await requestLocalApiJson("/automations/run", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not run that automation.",
  });
  if (!payload?.automation || !payload?.state || !payload?.result) {
    throw new Error("The local data API returned an invalid automation run payload.");
  }
  return payload;
}

async function recordStudyRunLedgerEntry(request) {
  const payload = await requestLocalApiJson("/study-runs/record", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not record that study run.",
  });
  if (!payload?.run?.studyId || !payload?.run?.completedAt) {
    throw new Error("The local data API returned an invalid study-run payload.");
  }
  return payload;
}

async function fetchIndexSeries(request) {
  const payload = await requestLocalApiJson("/yfinance/index-series", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that symbol.",
  });

  const snapshot = payload?.snapshot;
  return {
    snapshot,
    series: normalizeSnapshotSeries(
      snapshot,
      "The fetched series did not contain enough observations.",
    ),
    rememberedEntry: payload?.rememberedEntry || null,
  };
}

async function fetchInstrumentProfile(symbol) {
  const payload = await requestLocalApiJson(
    "/yfinance/instrument-profile",
    { symbol },
    {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that profile.",
    },
  );

  if (!payload?.profile?.symbol) {
    throw new Error("The local data API returned an invalid profile payload.");
  }

  return {
    profile: payload.profile,
    cache: payload.cache || null,
  };
}

async function discoverSymbols(request) {
  const payload = await requestLocalApiJson("/symbols/discover", request, {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not search that symbol.",
  });

  if (!Array.isArray(payload?.results)) {
    throw new Error("The local data API returned an invalid symbol discovery payload.");
  }

  return payload;
}

async function fetchMonthlyStraddleSnapshot(request) {
  const payload = await requestLocalApiJson(
    "/yfinance/monthly-straddle",
    request,
    {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that options snapshot.",
    },
  );

  if (!payload?.snapshot?.symbol || !Array.isArray(payload?.snapshot?.monthlyContracts)) {
    throw new Error("The local data API returned an invalid monthly straddle payload.");
  }

  return payload.snapshot;
}

async function fetchOptionsScreenerSnapshot(request) {
  const payload = await requestLocalApiJson(
    "/options/screener-snapshot",
    request,
    {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load that screener snapshot.",
    },
  );

  if (!Array.isArray(payload?.snapshots) || !Array.isArray(payload?.failures)) {
    throw new Error("The local data API returned an invalid options screener payload.");
  }

  return payload;
}

async function fetchOptionsScreenerHistory(request) {
  const payload = await requestLocalApiJson(
    "/options/screener-history",
    request,
    {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load screener history.",
    },
  );

  if (!Array.isArray(payload?.runs)) {
    throw new Error("The local data API returned an invalid options screener history payload.");
  }

  return payload;
}

async function fetchOptionsValidation(request) {
  const payload = await requestLocalApiJson(
    "/options/screener-validation",
    request,
    {
    onHttpError: (response, parsedPayload) =>
      parsedPayload?.error || "The local data API could not load options validation data.",
    },
  );

  if (!Array.isArray(payload?.observations)) {
    throw new Error("The local data API returned an invalid options validation payload.");
  }

  return payload;
}

export {
  LOCAL_API_COMMAND,
  buildStudyFactoryProposal,
  buildLocalApiUnavailableMessage,
  deleteAutomationConfig,
  deleteStudyPlanRecipe,
  discoverSymbols,
  describeFreshness,
  dryRunAssistantStudyPlan,
  draftStudyBuilderPlan,
  fetchAssistantContract,
  fetchAssistantContractBundle,
  fetchAssistantReadiness,
  fetchAutomationState,
  fetchInstrumentProfile,
  fetchIndexSeries,
  fetchOptionsScreenerHistory,
  fetchOptionsScreenerSnapshot,
  fetchOptionsValidation,
  fetchRuntimeHealth,
  fetchStudyPlanRecipes,
  fetchStudyRunBrief,
  fetchStudyRuns,
  fetchMonthlyStraddleSnapshot,
  getManifestDataset,
  getSnapshotFreshness,
  loadRememberedIndexCatalog,
  loadSyncManifest,
  loadSyncedSeries,
  liveDraftAssistantStudyPlan,
  recordStudyRunLedgerEntry,
  runAutomationNow,
  saveAutomationConfig,
  saveStudyPlanRecipe,
  validateStudyBuilderPlan,
};
