const STUDY_RUN_EXPLANATION_VERSION = "study-run-explanation-v1";

const STUDY_RUN_EXPLANATION_CONFIDENCE = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  BLOCKED: "blocked",
});

const STUDY_RUN_EXPLANATION_ISSUE_CODES = Object.freeze({
  RUN_MISSING: "run.missing",
  STATUS_FAILED: "run.status_failed",
  ERROR_RECORDED: "run.error_recorded",
  WARNINGS_RECORDED: "run.warnings_recorded",
  WINDOW_MISSING: "window.missing",
  WINDOW_CLIPPED: "window.clipped",
  SUMMARY_MISSING: "summary.missing",
  EVIDENCE_LINKS_MISSING: "evidence_links.missing",
  SNAPSHOT_REFS_MISSING: "snapshot_refs.missing",
  SHORT_WINDOW_ANNUALIZED: "metric.short_window_annualized",
});

const STUDY_RUN_EXPLANATION_ANNUALIZED_SIGNALS = Object.freeze([
  "annualized",
  "cagr",
  "calmar",
  "information ratio",
  "sharpe",
  "sortino",
  "tracking error",
]);

const STUDY_RUN_EXPLANATION_EXAMPLE_RUNS = Object.freeze([
  Object.freeze({
    id: "clean-ledger-run",
    description: "Successful full-window run with summaries and evidence references.",
    run: Object.freeze({
      runId: 101,
      studyId: "rolling-returns",
      studyTitle: "Rolling Returns",
      viewId: "overview",
      selectionLabel: "Nifty 50",
      subjectQuery: "Nifty 50",
      status: "success",
      routeHash: "#rolling-returns/overview?subject=Nifty+50&start=2021-04-08&end=2026-04-08",
      requestedStartDate: "2021-04-08",
      requestedEndDate: "2026-04-08",
      actualStartDate: "2021-04-08",
      actualEndDate: "2026-04-08",
      warningCount: 0,
      summaryItems: Object.freeze([
        Object.freeze({
          summaryKey: "median-return",
          label: "Median Rolling Return",
          valueText: "12.4%",
          valueKind: "percent",
        }),
      ]),
      links: Object.freeze([
        Object.freeze({
          linkType: "evidence-source",
          targetKind: "study_run",
          targetId: "101",
          targetLabel: "Rolling Returns run 101",
        }),
      ]),
      dataSnapshotRefs: Object.freeze([
        Object.freeze({ kind: "cache-series", symbol: "NIFTY50" }),
      ]),
      completedAt: "2026-05-15T10:00:00+00:00",
    }),
  }),
  Object.freeze({
    id: "short-window-annualized-caveat",
    description: "Successful but clipped sub-1-year run with an annualized metric caveat.",
    run: Object.freeze({
      runId: 102,
      studyId: "risk-adjusted-return",
      studyTitle: "Risk-Adjusted Return",
      viewId: "overview",
      selectionLabel: "Nifty 50",
      subjectQuery: "Nifty 50",
      status: "success",
      routeHash: "#risk-adjusted-return/overview?subject=Nifty+50&start=2026-01-01&end=2026-05-15",
      requestedStartDate: "2026-01-01",
      requestedEndDate: "2026-05-15",
      actualStartDate: "2026-01-02",
      actualEndDate: "2026-04-08",
      warningCount: 1,
      summaryItems: Object.freeze([
        Object.freeze({
          summaryKey: "cagr",
          label: "CAGR",
          valueText: "42.0%",
          valueKind: "percent",
        }),
      ]),
      links: Object.freeze([
        Object.freeze({
          linkType: "evidence-source",
          targetKind: "study_run",
          targetId: "102",
        }),
      ]),
      dataSnapshotRefs: Object.freeze([
        Object.freeze({ kind: "cache-series", symbol: "NIFTY50" }),
      ]),
      completedAt: "2026-05-15T10:00:00+00:00",
    }),
  }),
  Object.freeze({
    id: "failed-ledger-run",
    description: "Failed run that must not be explained as an investment conclusion.",
    run: Object.freeze({
      runId: 103,
      studyId: "risk-adjusted-return",
      studyTitle: "Risk-Adjusted Return",
      selectionLabel: "Fake Symbol",
      subjectQuery: "ZZZNOTREAL123",
      status: "failed",
      errorMessage: "No history found.",
      completedAt: "2026-05-15T10:00:00+00:00",
    }),
  }),
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseIsoDate(value) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return null;
  }
  const date = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value) {
  return cleanText(value).slice(0, 10);
}

function calendarDayCount(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || end.getTime() < start.getTime()) {
    return null;
  }
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function formatSummaryValue(item) {
  if (!item) {
    return "";
  }
  const valueText = cleanText(item.valueText);
  if (valueText) {
    return valueText;
  }
  const valueNumber = cleanNumber(item.valueNumber);
  if (valueNumber === null) {
    return "";
  }
  if (item.valueKind === "integer") {
    return String(Math.round(valueNumber));
  }
  return Number(valueNumber).toFixed(2).replace(/\.00$/, "");
}

function normalizeSummaryItem(item, index) {
  if (!isPlainObject(item)) {
    return null;
  }
  const label = cleanText(item.label || item.summaryKey || item.key);
  if (!label) {
    return null;
  }
  return {
    summaryKey: cleanText(item.summaryKey || item.key || `summary-${index + 1}`),
    label,
    valueText: cleanText(item.valueText) || null,
    valueNumber: cleanNumber(item.valueNumber),
    valueKind: cleanText(item.valueKind) || "text",
    displayValue: formatSummaryValue(item) || "n/a",
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
  };
}

function normalizeSummaryItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeSummaryItem)
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function normalizeLinks(links) {
  return (Array.isArray(links) ? links : [])
    .filter(isPlainObject)
    .map((link, index) => ({
      linkType: cleanText(link.linkType),
      targetKind: cleanText(link.targetKind),
      targetId: cleanText(link.targetId),
      targetLabel: cleanText(link.targetLabel),
      metadata: isPlainObject(link.metadata) ? link.metadata : {},
      sortOrder: Number.isFinite(Number(link.sortOrder)) ? Number(link.sortOrder) : index,
    }))
    .filter((link) => link.linkType && link.targetKind && link.targetId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function normalizeSnapshotRefs(refs) {
  return (Array.isArray(refs) ? refs : []).filter(isPlainObject);
}

function normalizeWarningMessages(run) {
  const resolvedParams = isPlainObject(run?.resolvedParams) ? run.resolvedParams : {};
  const candidates = Array.isArray(resolvedParams.warningMessages)
    ? resolvedParams.warningMessages
    : Array.isArray(resolvedParams.warnings)
      ? resolvedParams.warnings
      : [];
  const seen = new Set();
  return candidates
    .map(cleanText)
    .filter(Boolean)
    .filter((warning) => {
      if (seen.has(warning)) {
        return false;
      }
      seen.add(warning);
      return true;
    });
}

function hasAnnualizedMetric(summaryItems) {
  return summaryItems.some((item) => {
    const haystack = `${item.summaryKey} ${item.label}`.toLowerCase();
    return STUDY_RUN_EXPLANATION_ANNUALIZED_SIGNALS.some((signal) =>
      haystack.includes(signal),
    );
  });
}

function buildIssue(code, severity, message, metadata = {}) {
  return {
    code,
    severity,
    message,
    metadata,
  };
}

function buildWindow(run) {
  const requestedStartDate = dateOnly(run.requestedStartDate);
  const requestedEndDate = dateOnly(run.requestedEndDate);
  const actualStartDate = dateOnly(run.actualStartDate);
  const actualEndDate = dateOnly(run.actualEndDate);
  const effectiveStartDate = actualStartDate || requestedStartDate;
  const effectiveEndDate = actualEndDate || requestedEndDate;
  const effectiveDays = calendarDayCount(effectiveStartDate, effectiveEndDate);
  const clipped = Boolean(
    (requestedStartDate && actualStartDate && requestedStartDate !== actualStartDate) ||
      (requestedEndDate && actualEndDate && requestedEndDate !== actualEndDate),
  );

  return {
    requestedStartDate: requestedStartDate || null,
    requestedEndDate: requestedEndDate || null,
    actualStartDate: actualStartDate || null,
    actualEndDate: actualEndDate || null,
    effectiveStartDate: effectiveStartDate || null,
    effectiveEndDate: effectiveEndDate || null,
    effectiveDays,
    clipped,
  };
}

function buildRunSummary(run) {
  const warningMessages = normalizeWarningMessages(run);
  const warningCount = Math.max(
    Math.max(0, Math.trunc(cleanNumber(run.warningCount) || 0)),
    warningMessages.length,
  );
  return {
    runId: cleanNumber(run.runId),
    studyId: cleanText(run.studyId),
    studyTitle: cleanText(run.studyTitle || run.studyId),
    viewId: cleanText(run.viewId),
    selectionLabel: cleanText(run.selectionLabel || run.subjectQuery),
    subjectQuery: cleanText(run.subjectQuery),
    symbol: cleanText(run.symbol),
    status: cleanText(run.status || "success").toLowerCase(),
    routeHash: cleanText(run.routeHash),
    detailLabel: cleanText(run.detailLabel),
    warningCount,
    warningMessages,
    errorMessage: cleanText(run.errorMessage),
    runKind: cleanText(run.runKind || "analysis"),
    completedAt: cleanText(run.completedAt),
  };
}

function buildExplanationBullets({ runSummary, window, summaryItems, evidence }) {
  const bullets = [
    `Run ${runSummary.runId ?? "n/a"} recorded ${runSummary.studyTitle || "a study"} for ${runSummary.selectionLabel || "the selected subject"}.`,
  ];

  if (window.effectiveStartDate && window.effectiveEndDate) {
    bullets.push(
      `Effective window: ${window.effectiveStartDate} to ${window.effectiveEndDate}.`,
    );
  }

  if (summaryItems.length) {
    bullets.push(
      `Recorded summaries: ${summaryItems
        .slice(0, 4)
        .map((item) => `${item.label} ${item.displayValue}`)
        .join("; ")}.`,
    );
  }

  if (runSummary.warningMessages.length) {
    bullets.push(`Recorded warning(s): ${runSummary.warningMessages.slice(0, 3).join("; ")}.`);
  }

  if (evidence.linkCount || evidence.snapshotRefCount) {
    bullets.push(
      `Evidence recorded: ${evidence.linkCount} link(s), ${evidence.snapshotRefCount} snapshot reference(s).`,
    );
  }

  return bullets;
}

function deriveConfidence({ canExplain, issues }) {
  if (!canExplain) {
    return STUDY_RUN_EXPLANATION_CONFIDENCE.BLOCKED;
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return STUDY_RUN_EXPLANATION_CONFIDENCE.MEDIUM;
  }
  if (issues.some((issue) => issue.severity === "info")) {
    return STUDY_RUN_EXPLANATION_CONFIDENCE.MEDIUM;
  }
  return STUDY_RUN_EXPLANATION_CONFIDENCE.HIGH;
}

function buildStudyRunExplanationSeed(run) {
  if (!isPlainObject(run)) {
    const issues = [
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.RUN_MISSING,
        "error",
        "A durable study-run record is required before generating an explanation seed.",
      ),
    ];
    return {
      version: STUDY_RUN_EXPLANATION_VERSION,
      source: "study_run_ledger",
      canExplain: false,
      confidence: STUDY_RUN_EXPLANATION_CONFIDENCE.BLOCKED,
      run: null,
      window: null,
      summaryItems: [],
      evidence: { linkCount: 0, snapshotRefCount: 0, links: [], dataSnapshotRefs: [] },
      issues,
      caveats: issues,
      explanationBullets: [],
    };
  }

  const runSummary = buildRunSummary(run);
  const window = buildWindow(run);
  const summaryItems = normalizeSummaryItems(run.summaryItems);
  const links = normalizeLinks(run.links);
  const dataSnapshotRefs = normalizeSnapshotRefs(run.dataSnapshotRefs);
  const evidence = {
    linkCount: links.length,
    snapshotRefCount: dataSnapshotRefs.length,
    links,
    dataSnapshotRefs,
  };
  const issues = [];
  const statusFailed = runSummary.status && runSummary.status !== "success";

  if (statusFailed) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.STATUS_FAILED,
        "error",
        "This run did not complete successfully; explain the failure, not study conclusions.",
        { status: runSummary.status },
      ),
    );
  }
  if (runSummary.errorMessage) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.ERROR_RECORDED,
        statusFailed ? "error" : "warning",
        "The run recorded an error message.",
        { errorMessage: runSummary.errorMessage },
      ),
    );
  }
  if (runSummary.warningCount > 0) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.WARNINGS_RECORDED,
        "warning",
        "The run recorded warning(s); an explanation must mention that caveat.",
        {
          warningCount: runSummary.warningCount,
          warningMessages: runSummary.warningMessages,
        },
      ),
    );
  }
  if (!window.effectiveStartDate || !window.effectiveEndDate) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.WINDOW_MISSING,
        "warning",
        "No complete effective date window was recorded for this run.",
      ),
    );
  }
  if (window.clipped) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.WINDOW_CLIPPED,
        "warning",
        "Requested and actual date windows differ; explain the actual loaded window.",
        {
          requestedStartDate: window.requestedStartDate,
          requestedEndDate: window.requestedEndDate,
          actualStartDate: window.actualStartDate,
          actualEndDate: window.actualEndDate,
        },
      ),
    );
  }
  if (!summaryItems.length) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.SUMMARY_MISSING,
        "warning",
        "No summary items were recorded; avoid drawing metric-level conclusions.",
      ),
    );
  }
  if (!links.length) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.EVIDENCE_LINKS_MISSING,
        "info",
        "No durable evidence links were attached to this run.",
      ),
    );
  }
  if (!dataSnapshotRefs.length) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.SNAPSHOT_REFS_MISSING,
        "info",
        "No data snapshot references were attached to this run.",
      ),
    );
  }
  if (
    Number.isFinite(window.effectiveDays) &&
    window.effectiveDays < 365 &&
    hasAnnualizedMetric(summaryItems)
  ) {
    issues.push(
      buildIssue(
        STUDY_RUN_EXPLANATION_ISSUE_CODES.SHORT_WINDOW_ANNUALIZED,
        "warning",
        "Annualized metrics were recorded on a sub-1-year effective window; do not treat them as long-run compounding evidence.",
        { effectiveDays: window.effectiveDays },
      ),
    );
  }

  const canExplain = !statusFailed;
  return {
    version: STUDY_RUN_EXPLANATION_VERSION,
    source: "study_run_ledger",
    canExplain,
    confidence: deriveConfidence({ canExplain, issues }),
    run: runSummary,
    window,
    summaryItems,
    evidence,
    issues,
    caveats: issues.filter((issue) => issue.severity !== "error"),
    explanationBullets: canExplain
      ? buildExplanationBullets({ runSummary, window, summaryItems, evidence })
      : [],
  };
}

function serializeStudyRunExplanationSeed(run) {
  return `${JSON.stringify(buildStudyRunExplanationSeed(run), null, 2)}\n`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getStudyRunExplanationExamples() {
  return STUDY_RUN_EXPLANATION_EXAMPLE_RUNS.map((example) => ({
    id: example.id,
    description: example.description,
    run: cloneJson(example.run),
    seed: buildStudyRunExplanationSeed(example.run),
  }));
}

function getStudyRunExplanationContractManifest() {
  return {
    version: STUDY_RUN_EXPLANATION_VERSION,
    purpose:
      "Deterministic explanation seed generated from durable study-run ledger records before any assistant prose is allowed.",
    sourceRecord: "study_runs ledger payload returned by GET /api/study-runs",
    outputFields: [
      "version",
      "source",
      "canExplain",
      "confidence",
      "run",
      "window",
      "summaryItems",
      "evidence",
      "issues",
      "caveats",
      "explanationBullets",
    ],
    confidenceValues: Object.values(STUDY_RUN_EXPLANATION_CONFIDENCE),
    issueCodes: Object.values(STUDY_RUN_EXPLANATION_ISSUE_CODES),
    annualizedMetricSignals: [...STUDY_RUN_EXPLANATION_ANNUALIZED_SIGNALS],
    helperFunctions: [
      "buildStudyRunExplanationSeed(run)",
      "serializeStudyRunExplanationSeed(run)",
    ],
    examples: getStudyRunExplanationExamples(),
    invariants: [
      "The seed must be derived from a durable study-run record, not assistant prose.",
      "Failed runs are not explainable as conclusions; they are failure explanations only.",
      "Actual/effective windows must be preferred over requested windows when they differ.",
      "Sub-1-year annualized metric signals must produce a caveat.",
      "Missing summary items or evidence references must be visible to consumers.",
    ],
  };
}

export {
  STUDY_RUN_EXPLANATION_CONFIDENCE,
  STUDY_RUN_EXPLANATION_ISSUE_CODES,
  STUDY_RUN_EXPLANATION_VERSION,
  buildStudyRunExplanationSeed,
  formatSummaryValue as formatStudyRunExplanationSummaryValue,
  getStudyRunExplanationExamples,
  getStudyRunExplanationContractManifest,
  serializeStudyRunExplanationSeed,
};
