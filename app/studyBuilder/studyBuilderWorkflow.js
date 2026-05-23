import {
  STUDY_PLAN_VERSION,
  buildStudyPlanConfirmationPreview,
  buildStudyPlanFromRouteHash,
  validateStudyPlan,
} from "./studyPlan.js";
import {
  STUDY_BUILDER_PLAN_RESPONSE_VERSION,
  STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
} from "./studyBuilderApiContract.js";
import { draftStudyPlanFromIntent } from "./intentPlanner.js";

function formatStudyPlanJson(value) {
  return JSON.stringify(value, null, 2);
}

function parseStudyPlanJson(planText) {
  const trimmed = String(planText || "").trim();
  if (!trimmed) {
    throw new Error("Paste a study setup JSON object first.");
  }
  return JSON.parse(trimmed);
}

function getPlannerDraftStatusMessage(plannerResult, preview) {
  if (!preview?.canRun) {
    return "Drafted a setup, but it needs changes before it can open a study.";
  }
  if (plannerResult?.confidence === "needs-review") {
    return "Drafted a setup. Review the notes; data is checked after opening the study.";
  }
  return "Drafted a setup. Review it; data is checked after opening the study.";
}

function getLiveDraftStatusMessage(payload) {
  if (payload?.preview?.canRun) {
    return "AI drafted a checked setup. Data is checked after opening the study.";
  }
  return "AI drafted a setup, but the app found issues to fix first.";
}

function appendBackendFallbackNote(message, backendResult) {
  if (!backendResult?.usedFallback) {
    return message;
  }
  return `${message} Used the browser copy because the local server was unavailable.`;
}

function buildLocalPlannerPayload(intent) {
  const plannerResult = draftStudyPlanFromIntent(intent);
  return {
    version: STUDY_BUILDER_PLAN_RESPONSE_VERSION,
    plannerResult,
    plan: plannerResult.plan,
    preview: plannerResult.preview,
  };
}

function buildLocalValidationPayload(request = {}) {
  const safeRequest =
    request && typeof request === "object" && !Array.isArray(request) ? request : {};

  if (Object.hasOwn(safeRequest, "routeHash")) {
    const route = buildStudyPlanFromRouteHash(safeRequest.routeHash);
    const routePlan = route.normalizedPlan || route.rawPlan;
    return {
      version: STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
      mode: "route",
      route,
      validation: validateStudyPlan(routePlan),
      preview: buildStudyPlanConfirmationPreview(routePlan),
    };
  }

  const plan = Object.hasOwn(safeRequest, "plan") ? safeRequest.plan : request;
  return {
    version: STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
    mode: "plan",
    validation: validateStudyPlan(plan),
    preview: buildStudyPlanConfirmationPreview(plan),
  };
}

async function requestPlannerPayload(controller, intent) {
  if (typeof controller?.draftStudyBuilderPlan !== "function") {
    return { payload: buildLocalPlannerPayload(intent), usedFallback: false };
  }

  try {
    return {
      payload: await controller.draftStudyBuilderPlan({ intent }),
      usedFallback: false,
    };
  } catch (error) {
    return {
      payload: buildLocalPlannerPayload(intent),
      usedFallback: true,
      error,
    };
  }
}

async function requestValidationPayload(controller, request) {
  if (typeof controller?.validateStudyBuilderPlan !== "function") {
    return { payload: buildLocalValidationPayload(request), usedFallback: false };
  }

  try {
    return {
      payload: await controller.validateStudyBuilderPlan(request),
      usedFallback: false,
    };
  } catch (error) {
    return {
      payload: buildLocalValidationPayload(request),
      usedFallback: true,
      error,
    };
  }
}

async function requestLiveDraftPayload(controller, intent) {
  if (typeof controller?.liveDraftAssistantStudyPlan !== "function") {
    throw new Error(
      "Ask AI to Draft needs the local server to be running.",
    );
  }
  return controller.liveDraftAssistantStudyPlan({ intent });
}

function buildJsonErrorPreview(error) {
  return {
    ok: false,
    canRun: false,
    version: STUDY_PLAN_VERSION,
    studyId: "",
    studyTitle: "",
    viewId: "",
    viewLabel: "",
    routeHash: "",
    requiresConfirmation: false,
    paramItems: [],
    errors: [error?.message || "Invalid JSON."],
    warnings: [],
    issues: [
      {
        code: "json.invalid",
        severity: "error",
        message: error?.message || "Invalid JSON.",
        field: "studyPlanJson",
        metadata: {},
      },
    ],
    metricErrors: [],
    metricWarnings: [],
    normalizedPlan: null,
  };
}

function buildPreviewForPlan(plan) {
  return buildStudyPlanConfirmationPreview(plan);
}

async function validateStudyBuilderPlanText(controller, planText) {
  try {
    const plan = parseStudyPlanJson(planText);
    const backendResult = await requestValidationPayload(controller, { plan });
    const preview = backendResult.payload.preview;
    return {
      preview,
      statusMessage: appendBackendFallbackNote(
        preview?.canRun
          ? "Setup checked. Data is checked after opening the study."
          : "Plan blocked. Fix the listed issues first.",
        backendResult,
      ),
      usedFallback: backendResult.usedFallback,
      validationPayload: backendResult.payload,
    };
  } catch (error) {
    return {
      preview: buildJsonErrorPreview(error),
      statusMessage: "Could not read the study setup JSON.",
      error,
    };
  }
}

async function draftStudyBuilderIntent(controller, intent) {
  const backendResult = await requestPlannerPayload(controller, intent);
  const payload = backendResult.payload;
  return {
    plannerResult: payload.plannerResult,
    liveDraftResult: null,
    planText: formatStudyPlanJson(payload.plan),
    preview: payload.preview,
    statusMessage: appendBackendFallbackNote(
      getPlannerDraftStatusMessage(payload.plannerResult, payload.preview),
      backendResult,
    ),
    usedFallback: backendResult.usedFallback,
    payload,
  };
}

async function convertStudyBuilderRoute(controller, routeHashText) {
  const backendResult = await requestValidationPayload(controller, { routeHash: routeHashText });
  const payload = backendResult.payload;
  const routeValidation = payload.route || buildStudyPlanFromRouteHash(routeHashText);
  const routePlan = routeValidation.normalizedPlan || routeValidation.rawPlan;

  return {
    routeValidation,
    plannerResult: null,
    liveDraftResult: null,
    planText: formatStudyPlanJson(routePlan),
    preview: payload.preview || buildStudyPlanConfirmationPreview(routePlan),
    statusMessage: appendBackendFallbackNote(
      routeValidation.ok
        ? "Link converted into a study setup. Review it before opening the study."
        : "Link converted, but the setup needs changes first.",
      backendResult,
    ),
    usedFallback: backendResult.usedFallback,
    payload,
  };
}

async function runLiveStudyBuilderDraft(controller, intent) {
  if (!String(intent || "").trim()) {
    const errorMessage =
      "Enter a study request before asking AI to draft it.";
    return {
      liveDraftResult: { errorMessage },
      statusMessage: errorMessage,
    };
  }

  try {
    const payload = await requestLiveDraftPayload(controller, intent);
    return {
      liveDraftResult: payload,
      planText: formatStudyPlanJson(payload.plan),
      preview: payload.preview,
      statusMessage: getLiveDraftStatusMessage(payload),
      payload,
    };
  } catch (error) {
    const errorMessage = error?.message || "AI draft failed.";
    return {
      liveDraftResult: { errorMessage },
      statusMessage: errorMessage,
      error,
    };
  }
}

export {
  appendBackendFallbackNote,
  buildJsonErrorPreview,
  buildLocalPlannerPayload,
  buildLocalValidationPayload,
  buildPreviewForPlan,
  convertStudyBuilderRoute,
  draftStudyBuilderIntent,
  formatStudyPlanJson,
  getLiveDraftStatusMessage,
  getPlannerDraftStatusMessage,
  parseStudyPlanJson,
  requestLiveDraftPayload,
  requestPlannerPayload,
  requestValidationPayload,
  runLiveStudyBuilderDraft,
  validateStudyBuilderPlanText,
};
