import { getMetricRegistryManifest } from "../lib/metricRegistry.js";
import { draftStudyPlanFromIntent } from "../studyBuilder/intentPlanner.js";
import { getStudyCatalogManifest } from "../studyBuilder/studyCatalog.js";

const STUDY_PROPOSAL_VERSION = "study-proposal-v1";
const STUDY_PROPOSAL_RESPONSE_VERSION = "study-proposal-response-v1";
const TOOL_CATALOG_VERSION = "tool-catalog-v1";

const DEFAULT_TOOL_CATALOG = Object.freeze([
  {
    id: "bundled-yfinance-index-snapshots",
    label: "Bundled yfinance index snapshots",
    kind: "market-data",
    status: "approved",
    evidenceRole: "historical_price_series",
    capabilities: ["daily_prices", "index_history", "offline_repeatability"],
    limitations: ["snapshot_staleness", "limited_builtin_universe"],
  },
  {
    id: "local-yfinance-backend",
    label: "Local yfinance backend",
    kind: "market-data",
    status: "approved",
    evidenceRole: "ad_hoc_price_series",
    capabilities: ["daily_prices", "profiles", "option_chains"],
    limitations: ["provider_availability", "not_an_exchange_master"],
  },
  {
    id: "runtime-store",
    label: "Local SQLite runtime store",
    kind: "storage",
    status: "approved",
    evidenceRole: "durable_local_ledger",
    capabilities: ["study_runs", "symbol_universes", "options_evidence", "runtime_health"],
    limitations: ["local_first", "not_shared_by_default"],
  },
  {
    id: "options-evidence-ledger",
    label: "Options evidence ledger",
    kind: "options-evidence",
    status: "approved",
    evidenceRole: "archived_options_signals_and_marks",
    capabilities: ["screener_archive", "tracked_straddles", "trade_validation"],
    limitations: ["requires_collector_history", "front_straddles_only_in_v1"],
  },
  {
    id: "finnhub-symbol-discovery",
    label: "Finnhub symbol discovery",
    kind: "symbol-discovery",
    status: "approved",
    evidenceRole: "symbol_master_lookup",
    capabilities: ["exchange_symbols", "search"],
    limitations: ["not_a_study_result_source"],
  },
]);

const STUDY_DOMAIN_BY_STUDY_ID = Object.freeze({
  "risk-adjusted-return": "risk-adjusted-return",
  "sector-snapshot": "relative-performance",
  "monthly-straddle": "monthly-straddle",
  "options-screener": "options-screener",
  "options-validation": "options-screener",
  seasonality: "seasonality",
  "rolling-returns": "risk-adjusted-return",
  "sip-simulator": "sip-simulator",
  "lumpsum-vs-sip": "lumpsum-vs-sip",
  "drawdown-study": "drawdown-study",
});

const IDEA_SIGNAL_RULES = Object.freeze([
  {
    id: "news-event-study",
    patterns: [
      /\bnews\b/i,
      /\bheadline/i,
      /\bevent\b/i,
      /\brbi\b/i,
      /\bfed\b/i,
      /\bpolicy\b/i,
      /\bearnings\b/i,
      /\bannouncement\b/i,
    ],
    requiredToolKinds: ["news", "market-data", "storage"],
    caveat:
      "News or event ideas require archived source IDs, timestamps, extraction rules, and market-data alignment before conclusions are allowed.",
  },
  {
    id: "options-evidence-study",
    patterns: [/\boption/i, /\biv\b/i, /\bvrp\b/i, /\bstraddle\b/i, /\bvol\b/i],
    requiredToolKinds: ["options-evidence", "market-data", "storage"],
    caveat:
      "Options ideas should use archived screener rows or tracked marks; live option chains alone are not historical evidence.",
  },
  {
    id: "macro-data-study",
    patterns: [/\binflation\b/i, /\brates?\b/i, /\bgdp\b/i, /\bcpi\b/i, /\byield\b/i],
    requiredToolKinds: ["economic-data", "market-data", "storage"],
    caveat:
      "Macro studies need release calendars, vintage awareness, and timestamp alignment to avoid lookahead.",
  },
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeApprovedTools(approvedTools = []) {
  const customTools = Array.isArray(approvedTools) ? approvedTools : [];
  const normalizedCustomTools = customTools
    .filter(isPlainObject)
    .map((tool) => ({
      id: cleanText(tool.id),
      label: cleanText(tool.label || tool.id),
      kind: cleanText(tool.kind || "external"),
      status: cleanText(tool.status || "approved") || "approved",
      evidenceRole: cleanText(tool.evidenceRole || "external_input"),
      capabilities: Array.isArray(tool.capabilities) ? tool.capabilities.map(cleanText).filter(Boolean) : [],
      limitations: Array.isArray(tool.limitations) ? tool.limitations.map(cleanText).filter(Boolean) : [],
    }))
    .filter((tool) => tool.id && tool.label);

  const toolById = new Map();
  [...DEFAULT_TOOL_CATALOG, ...normalizedCustomTools].forEach((tool) => {
    toolById.set(tool.id, JSON.parse(JSON.stringify(tool)));
  });
  return [...toolById.values()];
}

function matchIdeaSignals(idea) {
  return IDEA_SIGNAL_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(idea)),
  );
}

function findToolsByKinds(toolCatalog, kinds) {
  const kindSet = new Set(kinds);
  return toolCatalog.filter((tool) => kindSet.has(tool.kind));
}

function summarizeMissingToolKinds(toolCatalog, kinds) {
  const availableKinds = new Set(toolCatalog.map((tool) => tool.kind));
  return [...new Set(kinds)].filter((kind) => !availableKinds.has(kind));
}

function getStudyMetrics(studyId) {
  const domain = STUDY_DOMAIN_BY_STUDY_ID[studyId] || studyId;
  return getMetricRegistryManifest().rules
    .filter((rule) => Array.isArray(rule.domains) && rule.domains.includes(domain))
    .slice(0, 6)
    .map((rule) => ({
      id: rule.id,
      label: rule.label,
      defaultStatus: rule.defaultStatus,
      exportBehavior: rule.exportBehavior,
    }));
}

function findCatalogStudy(studyId) {
  return getStudyCatalogManifest().studies.find((study) => study.id === studyId) || null;
}

function buildHypothesis(idea, signals, plannerResult) {
  if (signals.some((signal) => signal.id === "news-event-study")) {
    return `Test whether dated events described by "${idea}" are followed by measurable market or volatility changes after controlling for data availability and timestamp alignment.`;
  }
  if (signals.some((signal) => signal.id === "options-evidence-study")) {
    return `Test whether the options setup described by "${idea}" has archived signal evidence and measurable forward outcomes.`;
  }
  return `Evaluate "${idea}" using the closest existing study workflow before proposing a new study.`;
}

function buildExistingCoverage(plannerResult) {
  const study = findCatalogStudy(plannerResult.plan?.studyId);
  if (!study || plannerResult.confidence === "blocked") {
    return {
      coverage: "unknown",
      studies: [],
      note: "No existing study was confidently mapped.",
    };
  }
  return {
    coverage: plannerResult.confidence === "draft" ? "existing-study" : "existing-study-needs-review",
    studies: [
      {
        studyId: study.id,
        title: study.title,
        viewId: plannerResult.plan.viewId,
        templateId: plannerResult.templateId,
        confidence: plannerResult.confidence,
      },
    ],
    note:
      plannerResult.confidence === "draft"
        ? "The idea maps to an existing study route."
        : "The idea maps to an existing route with deterministic planner diagnostics.",
  };
}

function buildFeasibility({ signals, missingToolKinds, existingCoverage }) {
  if (missingToolKinds.length) {
    return {
      status: "needs-data-contract",
      recommendation: "defer-until-data-contract",
      reasons: missingToolKinds.map((kind) => `Missing approved ${kind} tool for this idea.`),
    };
  }
  if (signals.some((signal) => signal.id === "news-event-study" || signal.id === "macro-data-study")) {
    return {
      status: "needs-evidence-archive",
      recommendation: "design-read-only-proposal",
      reasons: [
        "The idea can be shaped, but source events and timestamps must be archived before conclusions.",
      ],
    };
  }
  if (existingCoverage.coverage.startsWith("existing-study")) {
    return {
      status: "testable-now",
      recommendation: "use-existing-study-first",
      reasons: ["An existing deterministic study route can test the core idea."],
    };
  }
  return {
    status: "needs-review",
    recommendation: "draft-study-proposal",
    reasons: ["The idea needs human review before implementation scope is proposed."],
  };
}

function buildRequiredData(signals, plannerResult) {
  const data = [
    {
      id: "market-price-history",
      label: "Market price history",
      minimumViableHistory: "Enough observations for the selected metric maturity rules.",
      archiveRequired: true,
    },
  ];
  if (plannerResult.plan?.studyId?.includes("options") || signals.some((signal) => signal.id === "options-evidence-study")) {
    data.push({
      id: "options-signal-and-mark-history",
      label: "Archived options signals and tracked marks",
      minimumViableHistory: "Matured screener rows or tracked positions for the chosen horizon.",
      archiveRequired: true,
    });
  }
  if (signals.some((signal) => signal.id === "news-event-study")) {
    data.push({
      id: "news-event-archive",
      label: "News/event source archive",
      minimumViableHistory: "Source IDs, publication timestamps, query terms, and extracted event labels.",
      archiveRequired: true,
    });
  }
  if (signals.some((signal) => signal.id === "macro-data-study")) {
    data.push({
      id: "macro-release-history",
      label: "Macro release history",
      minimumViableHistory: "Release timestamps and vintage-aware values.",
      archiveRequired: true,
    });
  }
  return data;
}

function buildCaveats(signals, missingToolKinds, plannerResult) {
  const caveats = [
    "This is a study proposal, not evidence and not a result.",
    "No external data was fetched and no study was executed.",
    "Any future implementation must pass the metric registry and archive evidence before conclusions.",
  ];
  signals.forEach((signal) => caveats.push(signal.caveat));
  missingToolKinds.forEach((kind) => caveats.push(`Approved ${kind} tooling is missing from the request/tool catalog.`));
  (plannerResult.diagnostics || []).forEach((diagnostic) => {
    caveats.push(`Planner diagnostic ${diagnostic.code}: ${diagnostic.message}`);
  });
  return [...new Set(caveats)];
}

function buildStudyProposal(request = {}) {
  if (!isPlainObject(request)) {
    throw new Error("Study proposal request must be a JSON object.");
  }
  const idea = cleanText(request.idea || request.intent);
  if (!idea) {
    throw new Error("idea is required.");
  }

  const toolCatalog = normalizeApprovedTools(request.approvedTools);
  const plannerResult = draftStudyPlanFromIntent(idea);
  const signals = matchIdeaSignals(idea);
  const requiredToolKinds = [...new Set(signals.flatMap((signal) => signal.requiredToolKinds))];
  const requiredTools = findToolsByKinds(toolCatalog, requiredToolKinds);
  const missingToolKinds = summarizeMissingToolKinds(toolCatalog, requiredToolKinds);
  const existingCoverage = buildExistingCoverage(plannerResult);
  const feasibility = buildFeasibility({ signals, missingToolKinds, existingCoverage });
  const proposedMetrics = getStudyMetrics(plannerResult.plan?.studyId);

  return {
    version: STUDY_PROPOSAL_VERSION,
    status: "draft",
    idea,
    hypothesis: buildHypothesis(idea, signals, plannerResult),
    existingCoverage,
    feasibility,
    requiredTools,
    missingToolKinds,
    requiredData: buildRequiredData(signals, plannerResult),
    proposedMetrics,
    studyPlanCandidate: {
      plannerResult,
      plan: plannerResult.plan,
      preview: plannerResult.preview,
    },
    validationRules: [
      "Do not execute a study from a proposal without explicit confirmation.",
      "Do not treat proposal text, news text, or model output as evidence.",
      "Archive data inputs, source timestamps, and derived signals before validation.",
      "Apply metric registry maturity rules before headline or export use.",
    ],
    caveats: buildCaveats(signals, missingToolKinds, plannerResult),
    nonGoals: [
      "No code generation.",
      "No external API calls.",
      "No study execution.",
      "No result prose.",
      "No trading advice.",
    ],
    nextSteps:
      feasibility.recommendation === "use-existing-study-first"
        ? [
            "Review the StudyPlan candidate.",
            "Run the existing study only after user confirmation.",
            "Record the completed run in the durable ledger.",
          ]
        : [
            "Define the missing data/tool contract.",
            "Archive source evidence before metric validation.",
            "Return for implementation only after the proposal is reviewable.",
          ],
  };
}

function buildStudyProposalResponse(request = {}) {
  const proposal = buildStudyProposal(request);
  return {
    version: STUDY_PROPOSAL_RESPONSE_VERSION,
    mode: "read-only",
    proposal,
    execution: {
      executed: false,
      generatedCode: false,
      fetchedExternalData: false,
      reason: "Read-only proposal. No code was generated, no external tools were called, and no study was executed.",
    },
  };
}

function getToolCatalogManifest() {
  return {
    version: TOOL_CATALOG_VERSION,
    purpose: "Approved tool descriptors for read-only study proposal feasibility checks.",
    tools: JSON.parse(JSON.stringify(DEFAULT_TOOL_CATALOG)),
  };
}

function getStudyProposalContractManifest() {
  return {
    version: STUDY_PROPOSAL_VERSION,
    responseVersion: STUDY_PROPOSAL_RESPONSE_VERSION,
    toolCatalogVersion: TOOL_CATALOG_VERSION,
    purpose:
      "Read-only contract for evaluating whether a new study idea is testable before code, execution, or conclusions.",
    requestShape: {
      idea: "required natural-language study idea",
      approvedTools: "optional array of approved tool descriptors with id, label, kind, capabilities, and limitations",
    },
    responseFields: [
      "version",
      "status",
      "idea",
      "hypothesis",
      "existingCoverage",
      "feasibility",
      "requiredTools",
      "missingToolKinds",
      "requiredData",
      "proposedMetrics",
      "studyPlanCandidate",
      "validationRules",
      "caveats",
      "nonGoals",
      "nextSteps",
    ],
    hardStops: [
      "A proposal is not evidence.",
      "No external tools are called by the deterministic proposal builder.",
      "News or event text must be archived with source IDs and timestamps before conclusions.",
      "Generated implementation scope must not be applied without human confirmation.",
    ],
    toolCatalog: getToolCatalogManifest(),
  };
}

export {
  STUDY_PROPOSAL_RESPONSE_VERSION,
  STUDY_PROPOSAL_VERSION,
  TOOL_CATALOG_VERSION,
  buildStudyProposal,
  buildStudyProposalResponse,
  getStudyProposalContractManifest,
  getToolCatalogManifest,
};
