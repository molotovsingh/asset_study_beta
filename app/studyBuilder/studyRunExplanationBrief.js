import {
  STUDY_RUN_HANDOFF_VERSION,
  buildStudyRunAssistantHandoff,
  getStudyRunHandoffExamples,
} from "./studyRunHandoff.js";

const STUDY_RUN_EXPLANATION_BRIEF_VERSION = "study-run-explanation-brief-v1";

const STUDY_RUN_EXPLANATION_BRIEF_MODES = Object.freeze({
  RESULT_WITH_CAVEATS: "result-with-caveats",
  FAILURE_ONLY: "failure-only",
  BLOCKED: "blocked",
});

const STUDY_RUN_EXPLANATION_BRIEF_ACTIONS = Object.freeze({
  EXPLAIN_RESULT_WITH_CAVEATS: "explain_result_with_caveats",
  EXPLAIN_FAILURE_ONLY: "explain_failure_only",
  OFFER_REPLAY_CONFIRMATION: "offer_replay_confirmation",
});

const STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES = Object.freeze({
  HANDOFF_MISSING: "handoff.missing",
  HANDOFF_VERSION_UNSUPPORTED: "handoff.version_unsupported",
  RESULT_BLOCKED: "result.blocked",
  CAVEATS_REQUIRED: "caveats.required",
  REPLAY_BLOCKED: "replay.blocked",
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildIssue(code, severity, message, metadata = {}) {
  return {
    code,
    severity,
    message,
    metadata,
  };
}

function normalizeIssue(issue) {
  if (!isPlainObject(issue)) {
    return null;
  }
  const code = cleanText(issue.code);
  const message = cleanText(issue.message);
  if (!code && !message) {
    return null;
  }
  return {
    code: code || "unknown",
    severity: cleanText(issue.severity) || "info",
    message: message || code,
    metadata: isPlainObject(issue.metadata) ? cloneJson(issue.metadata) : {},
  };
}

function normalizeIssues(issues) {
  return (Array.isArray(issues) ? issues : []).map(normalizeIssue).filter(Boolean);
}

function buildBlockedBrief(issues) {
  const normalizedIssues = normalizeIssues(issues);
  return {
    version: STUDY_RUN_EXPLANATION_BRIEF_VERSION,
    source: "assistant_handoff",
    sourceHandoffVersion: null,
    mode: STUDY_RUN_EXPLANATION_BRIEF_MODES.BLOCKED,
    readyForAssistantProse: false,
    resultConclusionAllowed: false,
    runId: null,
    title: "No explainable run selected",
    summary: "A valid assistant handoff is required before result prose is allowed.",
    bulletItems: [],
    requiredCaveats: normalizedIssues,
    allowedAssistantActions: [],
    prohibitedClaims: [
      "Do not explain investment results without a valid assistant handoff.",
      "Do not infer run details from visible UI text or screenshots.",
    ],
    replay: {
      canReplay: false,
      routeHash: "",
      normalizedPlan: null,
      issues: [],
    },
    sourceEvidence: {
      linkCount: 0,
      snapshotRefCount: 0,
      links: [],
      dataSnapshotRefs: [],
    },
    sourcePolicy: null,
    issues: normalizedIssues,
  };
}

function buildStudyRunExplanationBriefFromHandoff(handoff) {
  if (!isPlainObject(handoff)) {
    return buildBlockedBrief([
      buildIssue(
        STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES.HANDOFF_MISSING,
        "error",
        "A study-run assistant handoff is required before building an explanation brief.",
      ),
    ]);
  }

  const issues = normalizeIssues(handoff.issues);
  if (handoff.version !== STUDY_RUN_HANDOFF_VERSION) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES.HANDOFF_VERSION_UNSUPPORTED,
        "error",
        "The assistant handoff version is not supported by this explanation brief contract.",
        {
          expectedVersion: STUDY_RUN_HANDOFF_VERSION,
          receivedVersion: cleanText(handoff.version) || null,
        },
      ),
    );
  }

  const seed = isPlainObject(handoff.explanationSeed) ? handoff.explanationSeed : {};
  const run = isPlainObject(seed.run) ? seed.run : {};
  const evidence = isPlainObject(seed.evidence) ? seed.evidence : {};
  const sourcePolicy = isPlainObject(seed.sourcePolicy)
    ? cloneJson(seed.sourcePolicy)
    : null;
  const replay = isPlainObject(handoff.replayStudyPlan) ? handoff.replayStudyPlan : {};
  const caveats = normalizeIssues(seed.caveats);
  const canExplainResult = Boolean(handoff.readyForResultExplanation && seed.canExplain);
  const canReplay = Boolean(handoff.readyForReplay && replay.ok);

  if (!canExplainResult) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES.RESULT_BLOCKED,
        "error",
        "Result conclusions are blocked; the assistant may explain only the failure or missing-evidence state.",
      ),
    );
  }
  if (caveats.length) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES.CAVEATS_REQUIRED,
        "warning",
        "The assistant must explicitly mention the required caveats.",
        { caveatCodes: caveats.map((issue) => issue.code) },
      ),
    );
  }
  if (!canReplay) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES.REPLAY_BLOCKED,
        "info",
        "Replay is not route-safe from this handoff without user correction.",
      ),
    );
  }

  const mode = canExplainResult
    ? STUDY_RUN_EXPLANATION_BRIEF_MODES.RESULT_WITH_CAVEATS
    : STUDY_RUN_EXPLANATION_BRIEF_MODES.FAILURE_ONLY;
  const title = canExplainResult
    ? `${cleanText(run.studyTitle || run.studyId) || "Study"} run ${run.runId ?? "n/a"}`
    : `Failure-only brief for run ${run.runId ?? "n/a"}`;
  const bulletItems = Array.isArray(seed.explanationBullets)
    ? seed.explanationBullets.map(cleanText).filter(Boolean)
    : [];
  const allowedAssistantActions = canExplainResult
    ? [STUDY_RUN_EXPLANATION_BRIEF_ACTIONS.EXPLAIN_RESULT_WITH_CAVEATS]
    : [STUDY_RUN_EXPLANATION_BRIEF_ACTIONS.EXPLAIN_FAILURE_ONLY];
  if (canReplay) {
    allowedAssistantActions.push(
      STUDY_RUN_EXPLANATION_BRIEF_ACTIONS.OFFER_REPLAY_CONFIRMATION,
    );
  }

  return {
    version: STUDY_RUN_EXPLANATION_BRIEF_VERSION,
    source: "assistant_handoff",
    sourceHandoffVersion: cleanText(handoff.version) || null,
    mode,
    readyForAssistantProse: handoff.version === STUDY_RUN_HANDOFF_VERSION,
    resultConclusionAllowed: canExplainResult,
    runId: run.runId ?? handoff.runId ?? null,
    title,
    summary: bulletItems[0] || "No summary bullet was available from the explanation seed.",
    bulletItems,
    requiredCaveats: caveats,
    allowedAssistantActions,
    prohibitedClaims: [
      "Do not add unsupported causes, predictions, or trading advice.",
      "Do not hide clipped windows, warnings, missing evidence, or short-window annualization caveats.",
      "Do not upgrade blocked proxy TRI or missing source policy into approved total-return evidence.",
      "Do not offer replay as one-click safe unless replay.canReplay is true.",
    ],
    replay: {
      canReplay,
      routeHash: cleanText(replay.routeHash),
      normalizedPlan: isPlainObject(replay.normalizedPlan)
        ? cloneJson(replay.normalizedPlan)
        : null,
      issues: normalizeIssues(replay.issues),
    },
    sourceEvidence: {
      linkCount: Number.isFinite(Number(evidence.linkCount)) ? Number(evidence.linkCount) : 0,
      snapshotRefCount: Number.isFinite(Number(evidence.snapshotRefCount))
        ? Number(evidence.snapshotRefCount)
        : 0,
      links: Array.isArray(evidence.links) ? cloneJson(evidence.links) : [],
      dataSnapshotRefs: Array.isArray(evidence.dataSnapshotRefs)
        ? cloneJson(evidence.dataSnapshotRefs)
        : [],
    },
    sourcePolicy,
    issues,
  };
}

function buildStudyRunExplanationBriefFromRun(run) {
  return buildStudyRunExplanationBriefFromHandoff(buildStudyRunAssistantHandoff(run));
}

function serializeStudyRunExplanationBriefFromHandoff(handoff) {
  return `${JSON.stringify(buildStudyRunExplanationBriefFromHandoff(handoff), null, 2)}\n`;
}

function getStudyRunExplanationBriefExamples() {
  return getStudyRunHandoffExamples().map((example) => ({
    id: example.id,
    description: example.description,
    handoff: cloneJson(example.handoff),
    brief: buildStudyRunExplanationBriefFromHandoff(example.handoff),
  }));
}

function getStudyRunExplanationBriefContractManifest() {
  return {
    version: STUDY_RUN_EXPLANATION_BRIEF_VERSION,
    purpose:
      "Deterministic assistant prose guardrail derived from a study-run handoff before any generated explanation is allowed.",
    sourceRecord: "study-run-handoff-v1 payload",
    dependsOn: ["app/studyBuilder/studyRunHandoff.js"],
    outputFields: [
      "version",
      "source",
      "sourceHandoffVersion",
      "mode",
      "readyForAssistantProse",
      "resultConclusionAllowed",
      "runId",
      "title",
      "summary",
      "bulletItems",
      "requiredCaveats",
      "allowedAssistantActions",
      "prohibitedClaims",
      "replay",
      "sourceEvidence",
      "sourcePolicy",
      "issues",
    ],
    modes: Object.values(STUDY_RUN_EXPLANATION_BRIEF_MODES),
    allowedActions: Object.values(STUDY_RUN_EXPLANATION_BRIEF_ACTIONS),
    issueCodes: Object.values(STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES),
    helperFunctions: [
      "buildStudyRunExplanationBriefFromHandoff(handoff)",
      "buildStudyRunExplanationBriefFromRun(run)",
      "serializeStudyRunExplanationBriefFromHandoff(handoff)",
    ],
    examples: getStudyRunExplanationBriefExamples(),
    invariants: [
      "The brief must be derived from a study-run handoff, not from visible UI text.",
      "Result conclusions are allowed only when resultConclusionAllowed is true.",
      "Every required caveat must be included in generated assistant prose.",
      "Source-policy facts must be carried from the explanation seed and must not be inferred from UI text.",
      "Replay can be offered only through replay.normalizedPlan when replay.canReplay is true.",
      "The brief is a permission envelope; it is not trading advice.",
    ],
  };
}

export {
  STUDY_RUN_EXPLANATION_BRIEF_ACTIONS,
  STUDY_RUN_EXPLANATION_BRIEF_ISSUE_CODES,
  STUDY_RUN_EXPLANATION_BRIEF_MODES,
  STUDY_RUN_EXPLANATION_BRIEF_VERSION,
  buildStudyRunExplanationBriefFromHandoff,
  buildStudyRunExplanationBriefFromRun,
  getStudyRunExplanationBriefContractManifest,
  getStudyRunExplanationBriefExamples,
  serializeStudyRunExplanationBriefFromHandoff,
};
