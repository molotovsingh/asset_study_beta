import { STUDY_PLAN_VERSION, buildStudyPlanConfirmationPreview } from "./studyPlan.js";

const INTENT_PLANNER_VERSION = "intent-planner-v1";

const DEFAULT_SUBJECT = "Nifty 50";
const DEFAULT_BENCHMARK = "Sensex";

const INTENT_PLANNER_DIAGNOSTIC_CODES = Object.freeze({
  INTENT_EMPTY: "intent.empty",
  SUBJECT_DEFAULTED: "intent.subject_defaulted",
  TEMPLATE_DEFAULTED: "intent.template_defaulted",
  BENCHMARK_DEFAULTED: "intent.benchmark_defaulted",
  DATE_DEFAULTED: "intent.date_defaulted",
});

const KNOWN_SUBJECT_PATTERNS = Object.freeze([
  { pattern: /\bnifty\s*500\b/i, label: "Nifty 500" },
  { pattern: /\bnifty\s*50\b/i, label: "Nifty 50" },
  { pattern: /\bsensex\b/i, label: "Sensex" },
  { pattern: /\bspx\b|\bs&p\s*500\b/i, label: "S&P 500" },
  { pattern: /\bspy\b/i, label: "SPY" },
  { pattern: /\bqqq\b/i, label: "QQQ" },
  { pattern: /\baapl\b|\bapple\b/i, label: "AAPL" },
  { pattern: /\btsla\b|\btesla\b/i, label: "TSLA" },
  { pattern: /\bmsft\b|\bmicrosoft\b/i, label: "MSFT" },
  { pattern: /\bnvda\b|\bnvidia\b/i, label: "NVDA" },
]);

const TEMPLATE_RULES = Object.freeze([
  {
    id: "risk-relative",
    label: "Risk relative comparison",
    studyId: "risk-adjusted-return",
    viewId: "relative",
    keywords: ["compare", "versus", " vs ", "against", "relative", "benchmark"],
  },
  {
    id: "options-validation",
    label: "Options validation evidence",
    studyId: "options-validation",
    viewId: "overview",
    keywords: ["validation", "evidence", "matured", "beat implied"],
  },
  {
    id: "options-screener",
    label: "Options screener",
    studyId: "options-screener",
    viewId: "overview",
    keywords: ["options screener", "vrp", "cheap vol", "rich vol", "sell vega", "buy gamma"],
  },
  {
    id: "monthly-straddle",
    label: "Monthly straddle",
    studyId: "monthly-straddle",
    viewId: "overview",
    keywords: ["straddle", "implied move", "option chain", "front month"],
  },
  {
    id: "sector-snapshot",
    label: "Sector snapshot",
    studyId: "sector-snapshot",
    viewId: "overview",
    keywords: ["sector", "sectors", "industry"],
  },
  {
    id: "lumpsum-vs-sip",
    label: "Lumpsum versus SIP",
    studyId: "lumpsum-vs-sip",
    viewId: "overview",
    keywords: ["lumpsum", "lump sum", "versus sip", "vs sip"],
  },
  {
    id: "sip-simulator",
    label: "SIP simulator",
    studyId: "sip-simulator",
    viewId: "overview",
    keywords: ["sip", "monthly contribution", "installment"],
  },
  {
    id: "rolling-returns",
    label: "Rolling returns",
    studyId: "rolling-returns",
    viewId: "overview",
    keywords: ["rolling", "rolling return"],
  },
  {
    id: "seasonality",
    label: "Seasonality",
    studyId: "seasonality",
    viewId: "overview",
    keywords: ["seasonality", "month", "monthly pattern", "best month"],
  },
  {
    id: "drawdown-study",
    label: "Drawdown study",
    studyId: "drawdown-study",
    viewId: "overview",
    keywords: ["drawdown", "underwater", "recovery"],
  },
  {
    id: "risk-overview",
    label: "Risk overview",
    studyId: "risk-adjusted-return",
    viewId: "overview",
    keywords: ["risk", "sharpe", "sortino", "return", "cagr"],
  },
]);

const INTENT_PLANNER_EXAMPLES = Object.freeze([
  {
    id: "compare-risk-relative",
    intent: "Compare Nifty 50 against Sensex from 2021 to 2024",
    expectedStudyId: "risk-adjusted-return",
    expectedViewId: "relative",
  },
  {
    id: "screen-options-vrp",
    intent: "Run the options screener for rich vol VRP opportunities",
    expectedStudyId: "options-screener",
    expectedViewId: "overview",
  },
  {
    id: "validate-options-evidence",
    intent: "Validate options evidence by candidate bucket over 10 days",
    expectedStudyId: "options-validation",
    expectedViewId: "overview",
  },
  {
    id: "inspect-front-straddle",
    intent: "Show AAPL front month straddle implied move",
    expectedStudyId: "monthly-straddle",
    expectedViewId: "overview",
  },
  {
    id: "review-drawdown",
    intent: "Show TSLA drawdown recovery",
    expectedStudyId: "drawdown-study",
    expectedViewId: "overview",
  },
]);

function normalizeIntent(intentText) {
  return String(intentText || "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTemplate(normalizedIntent) {
  const lowerIntent = ` ${normalizedIntent.toLowerCase()} `;
  const template = TEMPLATE_RULES.find((rule) =>
    rule.keywords.some((keyword) => lowerIntent.includes(keyword.toLowerCase())),
  );
  return {
    template: template || TEMPLATE_RULES[TEMPLATE_RULES.length - 1],
    defaulted: !template,
  };
}

function detectKnownSubjects(text) {
  const matches = [];
  KNOWN_SUBJECT_PATTERNS.forEach((entry) => {
    if (entry.pattern.test(text) && !matches.includes(entry.label)) {
      matches.push(entry.label);
    }
  });
  return matches;
}

function extractComparisonPair(text, knownSubjects) {
  const comparisonMatch = text.match(
    /\bcompare\s+(.+?)\s+(?:against|versus|vs\.?|with)\s+(.+?)(?:\s+from\b|\s+between\b|\s+over\b|\s+for\b|$)/i,
  );
  if (comparisonMatch) {
    return {
      subject: cleanupExtractedSubject(comparisonMatch[1]) || knownSubjects[0] || DEFAULT_SUBJECT,
      benchmark:
        cleanupExtractedSubject(comparisonMatch[2]) ||
        knownSubjects.find((label) => label !== knownSubjects[0]) ||
        DEFAULT_BENCHMARK,
    };
  }

  return {
    subject: knownSubjects[0] || DEFAULT_SUBJECT,
    benchmark:
      knownSubjects.find((label) => label !== (knownSubjects[0] || DEFAULT_SUBJECT)) ||
      DEFAULT_BENCHMARK,
  };
}

function cleanupExtractedSubject(value) {
  const cleaned = String(value || "")
    .replace(/\b(the|index|stock|asset)\b/gi, " ")
    .replace(/[^a-z0-9&.\-\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  const knownMatch = detectKnownSubjects(cleaned)[0];
  return knownMatch || cleaned;
}

function extractDateParams(text) {
  const params = {};
  const isoDates = [...text.matchAll(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/g)].map(
    (match) => match[0],
  );
  if (isoDates.length >= 1) {
    params.start = isoDates[0];
  }
  if (isoDates.length >= 2) {
    params.end = isoDates[1];
  }

  const yearRange = text.match(/\b(?:from|between)\s+(20\d{2}|19\d{2})\s+(?:to|and|-)\s+(20\d{2}|19\d{2})\b/i);
  if (yearRange && !params.start && !params.end) {
    params.start = `${yearRange[1]}-01-01`;
    params.end = `${yearRange[2]}-12-31`;
  }

  return params;
}

function extractNumericParam(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function buildParamsForTemplate(template, text, knownSubjects) {
  const dateParams = extractDateParams(text);
  const comparison = extractComparisonPair(text, knownSubjects);
  const subject = comparison.subject;

  if (template.id === "risk-relative") {
    return {
      subject,
      benchmark: comparison.benchmark,
      ...dateParams,
    };
  }
  if (template.id === "sector-snapshot") {
    return {
      market: /india|nifty/i.test(text) ? "india-nse" : "us-sector-etfs",
    };
  }
  if (template.id === "options-screener") {
    return {
      u: /liquid|default|us/i.test(text) ? "us-liquid-10" : "us-liquid-10",
      bias: /cheap|buy gamma|buy vega/i.test(text) ? "cheap" : /rich|sell vega/i.test(text) ? "rich" : "",
      sort: /vrp/i.test(text) ? "vrp" : /iv\/?hv|iv hv/i.test(text) ? "ivHv20Ratio" : "",
    };
  }
  if (template.id === "options-validation") {
    return {
      u: "us-liquid-10",
      group: /signal|version/i.test(text) ? "signalVersion" : "candidateBucket",
      h: /20/i.test(text) ? "20" : /10/i.test(text) ? "10" : /5/i.test(text) ? "5" : "",
    };
  }
  if (template.id === "monthly-straddle") {
    return {
      subject,
      dte: extractNumericParam(text, [/\b(\d{1,3})\s*dte\b/i, /\bminimum\s+(\d{1,3})\s+days\b/i]),
    };
  }
  if (template.id === "sip-simulator") {
    return {
      subject,
      ...dateParams,
      contribution: extractNumericParam(text, [/\b(?:rs\.?|inr|\$)?\s?(\d{3,9})\s*(?:per month|monthly|sip)\b/i]),
    };
  }
  if (template.id === "lumpsum-vs-sip") {
    return {
      subject,
      ...dateParams,
      total: extractNumericParam(text, [/\b(?:rs\.?|inr|\$)?\s?(\d{4,12})\s*(?:total|lumpsum|lump sum)\b/i]),
      horizon: extractNumericParam(text, [/\b(\d{1,2})\s*(?:year|yr|years|yrs)\b/i]),
    };
  }

  return {
    subject,
    ...dateParams,
  };
}

function dropEmptyParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ""),
  );
}

function draftStudyPlanFromIntent(intentText) {
  const normalizedIntent = normalizeIntent(intentText);
  const diagnostics = [];

  if (!normalizedIntent) {
    diagnostics.push({
      code: INTENT_PLANNER_DIAGNOSTIC_CODES.INTENT_EMPTY,
      severity: "error",
      message: "Enter a research request before drafting a plan.",
    });
  }

  const templateMatch = matchTemplate(normalizedIntent || "risk");
  const template = templateMatch.template;
  const knownSubjects = detectKnownSubjects(normalizedIntent);
  const params = dropEmptyParams(buildParamsForTemplate(template, normalizedIntent, knownSubjects));
  const plan = {
    version: STUDY_PLAN_VERSION,
    studyId: template.studyId,
    viewId: template.viewId,
    params,
    requiresConfirmation: true,
  };

  if (!knownSubjects.length && !["sector-snapshot", "options-screener", "options-validation"].includes(template.id)) {
    diagnostics.push({
      code: INTENT_PLANNER_DIAGNOSTIC_CODES.SUBJECT_DEFAULTED,
      severity: "warning",
      message: `No known subject was detected; defaulted to ${DEFAULT_SUBJECT}.`,
    });
  }
  if (normalizedIntent && templateMatch.defaulted) {
    diagnostics.push({
      code: INTENT_PLANNER_DIAGNOSTIC_CODES.TEMPLATE_DEFAULTED,
      severity: "warning",
      message: "No specific study keyword was detected; defaulted to Risk Overview.",
    });
  }
  if (template.id === "risk-relative" && !normalizedIntent.match(/\b(against|versus|vs\.?|with)\b/i)) {
    diagnostics.push({
      code: INTENT_PLANNER_DIAGNOSTIC_CODES.BENCHMARK_DEFAULTED,
      severity: "warning",
      message: `No benchmark phrase was detected; defaulted to ${DEFAULT_BENCHMARK}.`,
    });
  }
  if (!params.start && !params.end && !["sector-snapshot", "options-screener", "options-validation", "monthly-straddle"].includes(template.id)) {
    diagnostics.push({
      code: INTENT_PLANNER_DIAGNOSTIC_CODES.DATE_DEFAULTED,
      severity: "warning",
      message: "No explicit date range was detected; the study will use its current/default dates.",
    });
  }

  const preview = buildStudyPlanConfirmationPreview(plan);
  const hasErrorDiagnostics = diagnostics.some((issue) => issue.severity === "error");
  const hasWarningDiagnostics = diagnostics.some((issue) => issue.severity === "warning");
  return {
    version: INTENT_PLANNER_VERSION,
    intent: normalizedIntent,
    templateId: template.id,
    templateLabel: template.label,
    confidence: hasErrorDiagnostics ? "blocked" : hasWarningDiagnostics ? "needs-review" : "draft",
    plan,
    preview,
    diagnostics,
  };
}

function getIntentPlannerContractManifest() {
  return {
    version: INTENT_PLANNER_VERSION,
    purpose:
      "Deterministic planning harness that maps simple user intents into study-plan-v1 drafts without AI calls.",
    outputFields: [
      "version",
      "intent",
      "templateId",
      "templateLabel",
      "confidence",
      "plan",
      "preview",
      "diagnostics",
    ],
    diagnosticCodes: Object.values(INTENT_PLANNER_DIAGNOSTIC_CODES).sort(),
    confidenceValues: ["draft", "needs-review", "blocked"],
    hardLimits: [
      "Planner output is only a draft.",
      "StudyPlan validation remains authoritative.",
      "Route handoff still requires the confirmation preview.",
      "Unknown subjects are defaulted or surfaced as diagnostics; they are not provider-verified here.",
    ],
    templateRules: TEMPLATE_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      studyId: rule.studyId,
      viewId: rule.viewId,
      keywords: [...rule.keywords],
    })),
    examples: INTENT_PLANNER_EXAMPLES.map((example) => ({ ...example })),
  };
}

export {
  INTENT_PLANNER_DIAGNOSTIC_CODES,
  INTENT_PLANNER_VERSION,
  INTENT_PLANNER_EXAMPLES,
  draftStudyPlanFromIntent,
  getIntentPlannerContractManifest,
};
