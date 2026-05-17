import {
  STUDY_PLAN_VERSION,
  buildStudyPlanFromRouteHash,
} from "./studyPlan.js";
import {
  STUDY_RUN_EXPLANATION_VERSION,
  buildStudyRunExplanationSeed,
  getStudyRunExplanationExamples,
} from "./studyRunExplanation.js";

const STUDY_RUN_HANDOFF_VERSION = "study-run-handoff-v1";

const STUDY_RUN_HANDOFF_ISSUE_CODES = Object.freeze({
  RUN_MISSING: "run.missing",
  REPLAY_ROUTE_MISSING: "replay.route_missing",
  REPLAY_ROUTE_BLOCKED: "replay.route_blocked",
  EXPLANATION_BLOCKED: "explanation.blocked",
  EXPLANATION_CAVEATS_PRESENT: "explanation.caveats_present",
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildIssue(code, severity, message, metadata = {}) {
  return {
    code,
    severity,
    message,
    metadata,
  };
}

function buildReplayStudyPlan(routeHash) {
  const normalizedRouteHash = cleanText(routeHash);
  if (!normalizedRouteHash) {
    return {
      routeHash: "",
      ok: false,
      normalizedRouteHash: "",
      rawPlan: null,
      normalizedPlan: null,
      issues: [
        buildIssue(
          STUDY_RUN_HANDOFF_ISSUE_CODES.REPLAY_ROUTE_MISSING,
          "warning",
          "No route hash was recorded, so the run cannot be replayed as a StudyPlan.",
        ),
      ],
      errors: [],
      warnings: ["No route hash was recorded."],
    };
  }

  const replay = buildStudyPlanFromRouteHash(normalizedRouteHash);
  return {
    routeHash: normalizedRouteHash,
    ok: Boolean(replay.ok),
    normalizedRouteHash: replay.normalizedRouteHash || normalizedRouteHash,
    rawPlan: replay.rawPlan || null,
    normalizedPlan: replay.normalizedPlan || null,
    issues: Array.isArray(replay.issues) ? replay.issues : [],
    errors: Array.isArray(replay.errors) ? replay.errors : [],
    warnings: Array.isArray(replay.warnings) ? replay.warnings : [],
  };
}

function buildStudyRunAssistantHandoff(run) {
  const hasRun = isPlainObject(run);
  const explanationSeed = buildStudyRunExplanationSeed(run);
  const replayStudyPlan = buildReplayStudyPlan(hasRun ? run.routeHash : "");
  const issues = [];

  if (!hasRun) {
    issues.push(
      buildIssue(
        STUDY_RUN_HANDOFF_ISSUE_CODES.RUN_MISSING,
        "error",
        "A durable study-run ledger record is required to build an assistant handoff.",
      ),
    );
  }

  if (!replayStudyPlan.routeHash) {
    issues.push(...replayStudyPlan.issues);
  } else if (!replayStudyPlan.ok) {
    issues.push(
      buildIssue(
        STUDY_RUN_HANDOFF_ISSUE_CODES.REPLAY_ROUTE_BLOCKED,
        "warning",
        "The recorded route hash could not be converted into a route-safe StudyPlan.",
        { routeHash: replayStudyPlan.routeHash },
      ),
    );
  }

  if (!explanationSeed.canExplain) {
    issues.push(
      buildIssue(
        STUDY_RUN_HANDOFF_ISSUE_CODES.EXPLANATION_BLOCKED,
        "error",
        "The run cannot be explained as a completed result conclusion.",
      ),
    );
  }

  if (Array.isArray(explanationSeed.caveats) && explanationSeed.caveats.length) {
    issues.push(
      buildIssue(
        STUDY_RUN_HANDOFF_ISSUE_CODES.EXPLANATION_CAVEATS_PRESENT,
        "warning",
        "The explanation seed contains caveats that must be included in assistant prose.",
        {
          caveatCodes: explanationSeed.caveats.map((issue) => issue.code),
        },
      ),
    );
  }

  return {
    version: STUDY_RUN_HANDOFF_VERSION,
    source: "study_run_ledger",
    contractVersions: {
      studyPlan: STUDY_PLAN_VERSION,
      studyRunExplanation: STUDY_RUN_EXPLANATION_VERSION,
    },
    readyForResultExplanation: Boolean(explanationSeed.canExplain),
    readyForReplay: Boolean(replayStudyPlan.ok),
    attentionRequired: issues.length > 0,
    runId: explanationSeed.run?.runId ?? null,
    explanationSeed,
    replayStudyPlan,
    issues,
    consumerInstructions: [
      "Use explanationSeed for result commentary; do not infer from rendered UI text.",
      "Use replayStudyPlan.normalizedPlan for rerun handoff; do not rebuild params manually.",
      "Carry explanationSeed.sourcePolicy exactly; never upgrade blocked proxy TRI or missing policy into approved total-return evidence.",
      "If readyForResultExplanation is false, explain the failure state only.",
      "If explanation caveats exist, include them explicitly in assistant output.",
      "If readyForReplay is false, do not offer a one-click rerun without user correction.",
    ],
  };
}

function serializeStudyRunAssistantHandoff(run) {
  return `${JSON.stringify(buildStudyRunAssistantHandoff(run), null, 2)}\n`;
}

function getStudyRunHandoffExamples() {
  return getStudyRunExplanationExamples().map((example) => ({
    id: example.id,
    description: example.description,
    handoff: buildStudyRunAssistantHandoff(example.run),
  }));
}

function getStudyRunHandoffContractManifest() {
  return {
    version: STUDY_RUN_HANDOFF_VERSION,
    purpose:
      "Single deterministic payload for future assistant result explanation and rerun handoff.",
    sourceRecord: "study_runs ledger payload returned by GET /api/study-runs",
    dependsOn: [
      "app/studyBuilder/studyRunExplanation.js",
      "app/studyBuilder/studyPlan.js",
    ],
    outputFields: [
      "version",
      "source",
      "contractVersions",
      "readyForResultExplanation",
      "readyForReplay",
      "attentionRequired",
      "runId",
      "explanationSeed",
      "replayStudyPlan",
      "issues",
      "consumerInstructions",
    ],
    issueCodes: Object.values(STUDY_RUN_HANDOFF_ISSUE_CODES),
    helperFunctions: [
      "buildStudyRunAssistantHandoff(run)",
      "serializeStudyRunAssistantHandoff(run)",
    ],
    examples: getStudyRunHandoffExamples(),
    invariants: [
      "The handoff must come from a durable study-run ledger record.",
      "Result explanation must use explanationSeed, not rendered UI prose.",
      "Source policy must be preserved as recorded by the ledger.",
      "Replay handoff must use replayStudyPlan.normalizedPlan from the StudyPlan validator.",
      "Failed runs may be explained only as failures, not as investment conclusions.",
      "Caveats in explanationSeed are mandatory assistant context.",
    ],
  };
}

export {
  STUDY_RUN_HANDOFF_ISSUE_CODES,
  STUDY_RUN_HANDOFF_VERSION,
  buildStudyRunAssistantHandoff,
  getStudyRunHandoffContractManifest,
  getStudyRunHandoffExamples,
  serializeStudyRunAssistantHandoff,
};
