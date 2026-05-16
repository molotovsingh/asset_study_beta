import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { draftStudyPlanFromIntent } from "../app/studyBuilder/intentPlanner.js";
import {
  buildStudyPlanConfirmationPreview,
  buildStudyPlanFromRouteHash,
  validateStudyPlan,
} from "../app/studyBuilder/studyPlan.js";

const STUDY_BUILDER_PLAN_RESPONSE_VERSION = "study-builder-plan-response-v1";
const STUDY_BUILDER_VALIDATION_RESPONSE_VERSION = "study-builder-validation-response-v1";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStdinJson() {
  const input = readFileSync(0, "utf8").trim();
  if (!input) {
    throw new Error("Expected one study-builder request JSON object on stdin.");
  }
  return JSON.parse(input);
}

function assertRequestObject(request) {
  if (!isPlainObject(request)) {
    throw new Error("Study builder request must be a JSON object.");
  }
}

function buildStudyBuilderPlanPayload(request) {
  assertRequestObject(request);
  const plannerResult = draftStudyPlanFromIntent(request.intent);
  return {
    version: STUDY_BUILDER_PLAN_RESPONSE_VERSION,
    plannerResult,
    plan: plannerResult.plan,
    preview: plannerResult.preview,
  };
}

function buildStudyBuilderValidationPayload(request) {
  assertRequestObject(request);

  if (Object.hasOwn(request, "routeHash")) {
    const route = buildStudyPlanFromRouteHash(request.routeHash);
    const routePlan = route.normalizedPlan || route.rawPlan;
    return {
      version: STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
      mode: "route",
      route,
      validation: validateStudyPlan(routePlan),
      preview: buildStudyPlanConfirmationPreview(routePlan),
    };
  }

  const plan = Object.hasOwn(request, "plan") ? request.plan : request;
  return {
    version: STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
    mode: "plan",
    validation: validateStudyPlan(plan),
    preview: buildStudyPlanConfirmationPreview(plan),
  };
}

function buildStudyBuilderPayload(mode, request) {
  if (mode === "plan") {
    return buildStudyBuilderPlanPayload(request);
  }
  if (mode === "validate") {
    return buildStudyBuilderValidationPayload(request);
  }
  throw new Error("Expected mode to be plan or validate.");
}

function main() {
  const mode = String(process.argv[2] || "").trim();
  const payload = buildStudyBuilderPayload(mode, readStdinJson());
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || "Could not build study-builder payload.");
    process.exitCode = 1;
  }
}

export {
  STUDY_BUILDER_PLAN_RESPONSE_VERSION,
  STUDY_BUILDER_VALIDATION_RESPONSE_VERSION,
  buildStudyBuilderPayload,
  buildStudyBuilderPlanPayload,
  buildStudyBuilderValidationPayload,
};
