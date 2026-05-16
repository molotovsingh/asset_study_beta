import { getStudyById } from "../studies/registry.js";
import {
  buildStudyViewHash,
  getDefaultStudyViewId,
  getStudyViewById,
  getStudyViews,
  parseStudyViewHash,
} from "../studies/studyShell.js";
import {
  validateMetricDecisionProposals,
} from "../lib/metricRegistry.js";

const STUDY_PLAN_VERSION = "study-plan-v1";

const STUDY_PLAN_ISSUE_SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
});

const STUDY_PLAN_ISSUE_CODES = Object.freeze({
  PLAN_NOT_OBJECT: "plan.not_object",
  VERSION_INVALID: "version.invalid",
  STUDY_UNKNOWN: "study.unknown",
  VIEW_DEFAULTED: "view.defaulted",
  VIEW_UNSUPPORTED: "view.unsupported",
  PARAMS_INVALID: "params.invalid",
  PARAM_UNSUPPORTED: "param.unsupported",
  DATE_INVALID: "date.invalid",
  DATE_RANGE_INVALID: "date.range_invalid",
  DATE_PARTIAL: "date.partial",
  NUMERIC_INVALID: "numeric.invalid",
  CONFIRMATION_REQUIRED: "confirmation.required",
  METRIC_PROPOSALS_INVALID: "metric_proposals.invalid",
  METRIC_POLICY_ERROR: "metric.policy_error",
  METRIC_POLICY_WARNING: "metric.policy_warning",
});

const COMMON_INDEX_PARAM_KEYS = new Set(["subject", "start", "end"]);

const STUDY_PLAN_PARAM_DEFINITIONS = Object.freeze({
  subject: Object.freeze({
    label: "Subject",
    type: "text",
    description: "Asset, index, dataset, or symbol query used by index-style studies.",
  }),
  start: Object.freeze({
    label: "Start Date",
    type: "date",
    format: "YYYY-MM-DD",
    description: "Requested start date. Actual loaded coverage may be clipped by available data.",
  }),
  end: Object.freeze({
    label: "End Date",
    type: "date",
    format: "YYYY-MM-DD",
    description: "Requested end date. Actual loaded coverage may be clipped by available data.",
  }),
  rf: Object.freeze({
    label: "Risk-Free Rate",
    type: "percent",
    min: 0,
    max: 100,
    description: "Annual risk-free rate percentage.",
  }),
  demo: Object.freeze({
    label: "Demo Data",
    type: "boolean",
    description: "Whether to use built-in demo data instead of resolved market data.",
  }),
  benchmark: Object.freeze({
    label: "Benchmark",
    type: "text",
    description: "Benchmark dataset or symbol for relative comparison.",
  }),
  basis: Object.freeze({
    label: "Comparison Basis",
    type: "enum",
    allowedValues: ["local", "common"],
    description: "Whether to compare in local currencies or a common base currency.",
  }),
  baseCurrency: Object.freeze({
    label: "Base Currency",
    type: "currency-code",
    description: "Three-letter target currency for common-currency comparison.",
  }),
  market: Object.freeze({
    label: "Market",
    type: "catalog-id",
    description: "Sector snapshot market preset id.",
  }),
  h: Object.freeze({
    label: "Horizon",
    type: "integer",
    description: "Study-specific horizon parameter.",
  }),
  metric: Object.freeze({
    label: "Metric",
    type: "catalog-id",
    description: "Study-specific metric key.",
  }),
  dte: Object.freeze({
    label: "Minimum DTE",
    type: "integer",
    min: 7,
    max: 365,
    description: "Minimum option days to expiry.",
  }),
  count: Object.freeze({
    label: "Contract Count",
    type: "integer",
    min: 1,
    max: 8,
    description: "Number of option expiries/contracts to inspect.",
  }),
  u: Object.freeze({
    label: "Universe",
    type: "catalog-id",
    description: "Options screener or validation universe id.",
  }),
  bias: Object.freeze({
    label: "Bias",
    type: "enum",
    allowedValues: ["rich", "cheap"],
    description: "Options screener volatility bias.",
  }),
  advice: Object.freeze({
    label: "Advice Filter",
    type: "catalog-id",
    description: "Options screener candidate/advice filter.",
  }),
  preset: Object.freeze({
    label: "Preset",
    type: "catalog-id",
    description: "Options trade idea preset id.",
  }),
  sort: Object.freeze({
    label: "Sort",
    type: "catalog-id",
    description: "Options screener sort key.",
  }),
  group: Object.freeze({
    label: "Group",
    type: "catalog-id",
    description: "Options validation grouping key.",
  }),
  partial: Object.freeze({
    label: "Include Partial Months",
    type: "boolean",
    description: "Whether seasonality should include partial boundary months.",
  }),
  contribution: Object.freeze({
    label: "Monthly Contribution",
    type: "number",
    minExclusive: 0,
    description: "Monthly SIP contribution amount.",
  }),
  total: Object.freeze({
    label: "Total Investment",
    type: "number",
    minExclusive: 0,
    description: "Total investment amount for lumpsum versus SIP comparison.",
  }),
  horizon: Object.freeze({
    label: "Horizon Years",
    type: "number",
    minExclusive: 0,
    description: "Comparison horizon in years.",
  }),
});

const STUDY_PLAN_PARAM_RULES = Object.freeze({
  "risk-adjusted-return": Object.freeze({
    overview: new Set(["subject", "start", "end", "rf", "demo"]),
    relative: new Set(["subject", "start", "end", "benchmark", "basis", "baseCurrency", "rf"]),
    visuals: COMMON_INDEX_PARAM_KEYS,
  }),
  "sector-snapshot": Object.freeze({
    overview: new Set(["market", "h", "metric", "rf"]),
    visuals: new Set(["market", "h", "metric", "rf"]),
  }),
  "monthly-straddle": Object.freeze({
    overview: new Set(["subject", "dte", "count"]),
    visuals: new Set(["subject", "dte", "count"]),
  }),
  "options-screener": Object.freeze({
    overview: new Set(["u", "bias", "advice", "preset", "sort", "dte"]),
    visuals: new Set(["u", "bias", "advice", "preset", "sort", "dte"]),
    archive: new Set(["u", "bias", "advice", "preset", "sort", "dte"]),
  }),
  "options-validation": Object.freeze({
    overview: new Set(["u", "group", "h"]),
    visuals: new Set(["u", "group", "h"]),
  }),
  seasonality: Object.freeze({
    overview: new Set(["subject", "start", "end", "partial"]),
    visuals: new Set(["subject", "start", "end", "partial"]),
  }),
  "rolling-returns": Object.freeze({
    overview: COMMON_INDEX_PARAM_KEYS,
    visuals: COMMON_INDEX_PARAM_KEYS,
  }),
  "sip-simulator": Object.freeze({
    overview: new Set(["subject", "start", "end", "contribution"]),
    visuals: new Set(["subject", "start", "end", "contribution"]),
  }),
  "lumpsum-vs-sip": Object.freeze({
    overview: new Set(["subject", "start", "end", "total", "horizon"]),
    visuals: new Set(["subject", "start", "end", "total", "horizon"]),
  }),
  "drawdown-study": Object.freeze({
    overview: COMMON_INDEX_PARAM_KEYS,
    visuals: COMMON_INDEX_PARAM_KEYS,
  }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidInputDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function normalizePlanParams(params) {
  if (!params) {
    return {};
  }
  if (params instanceof URLSearchParams) {
    return Object.fromEntries(params.entries());
  }
  if (!isPlainObject(params)) {
    return null;
  }

  return Object.entries(params).reduce((normalized, [key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      normalized[key] = String(value).trim();
    }
    return normalized;
  }, {});
}

function parsePositiveNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function parseRangeNumber(value, min, max) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= min && numericValue <= max
    ? numericValue
    : null;
}

function addIssue(issues, { code, severity, message, field = "", metadata = {} }) {
  issues.push({
    code,
    severity,
    message,
    field,
    metadata,
  });
}

function getIssueMessages(issues, severity) {
  return issues
    .filter((issue) => issue.severity === severity)
    .map((issue) => issue.message);
}

function validateNumericParams(params, issues) {
  if (params.rf !== undefined && parseRangeNumber(params.rf, 0, 100) === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.NUMERIC_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "rf must be a percentage between 0 and 100",
      field: "rf",
    });
  }
  if (params.dte !== undefined && parseRangeNumber(params.dte, 7, 365) === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.NUMERIC_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "dte must be between 7 and 365",
      field: "dte",
    });
  }
  if (params.count !== undefined && parseRangeNumber(params.count, 1, 8) === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.NUMERIC_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "count must be between 1 and 8",
      field: "count",
    });
  }
  if (params.contribution !== undefined && parsePositiveNumber(params.contribution) === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.NUMERIC_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "contribution must be greater than zero",
      field: "contribution",
    });
  }
  if (params.total !== undefined && parsePositiveNumber(params.total) === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.NUMERIC_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "total must be greater than zero",
      field: "total",
    });
  }
  if (params.horizon !== undefined && parsePositiveNumber(params.horizon) === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.NUMERIC_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "horizon must be greater than zero",
      field: "horizon",
    });
  }
}

function validateDateParams(params, issues) {
  if (params.start !== undefined && !isValidInputDate(params.start)) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.DATE_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "start must use YYYY-MM-DD format",
      field: "start",
    });
  }
  if (params.end !== undefined && !isValidInputDate(params.end)) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.DATE_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "end must use YYYY-MM-DD format",
      field: "end",
    });
  }
  if (isValidInputDate(params.start) && isValidInputDate(params.end) && params.start > params.end) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.DATE_RANGE_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "start must be on or before end",
      field: "start",
    });
  }
  if (params.start && !params.end) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.DATE_PARTIAL,
      severity: STUDY_PLAN_ISSUE_SEVERITY.WARNING,
      message: "start was provided without end; the study will use its current/default end date",
      field: "start",
    });
  }
  if (params.end && !params.start) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.DATE_PARTIAL,
      severity: STUDY_PLAN_ISSUE_SEVERITY.WARNING,
      message: "end was provided without start; the study will use its current/default start date",
      field: "end",
    });
  }
}

function getAllowedParamKeys(studyId, viewId) {
  return STUDY_PLAN_PARAM_RULES[studyId]?.[viewId] || new Set();
}

function getStudyPlanParamDefinition(key) {
  return STUDY_PLAN_PARAM_DEFINITIONS[key] || {
    label: key,
    type: "text",
    description: "",
  };
}

function getMetricDomainForStudyPlan(studyId, viewId) {
  if (studyId === "risk-adjusted-return" && viewId === "relative") {
    return "relative-performance";
  }
  return studyId;
}

function buildStudyPlanRouteHash(plan) {
  return buildStudyViewHash(plan.studyId, plan.viewId, plan.params || {});
}

function normalizeStudyRouteHashInput(routeInput) {
  const input = String(routeInput || "").trim();
  if (!input) {
    return "";
  }

  const hashIndex = input.indexOf("#");
  if (hashIndex >= 0) {
    return input.slice(hashIndex);
  }

  if (input.startsWith("/")) {
    return `#${input.replace(/^\/+/, "")}`;
  }

  return input.startsWith("#") ? input : `#${input}`;
}

function buildStudyPlanFromRouteHash(hashValue) {
  const normalizedRouteHash = normalizeStudyRouteHashInput(hashValue);
  const route = parseStudyViewHash(normalizedRouteHash);
  const plan = {
    version: STUDY_PLAN_VERSION,
    studyId: route.studyId,
    viewId: route.viewId,
    params: route.params,
    requiresConfirmation: true,
  };
  return {
    ...validateStudyPlan(plan),
    input: String(hashValue || "").trim(),
    normalizedRouteHash,
    rawPlan: {
      ...plan,
      params: normalizePlanParams(plan.params) || {},
    },
  };
}

function buildParamPreviewItems(params = {}) {
  return Object.entries(params).map(([key, value]) => ({
    key,
    value,
    label: getStudyPlanParamDefinition(key).label,
    type: getStudyPlanParamDefinition(key).type,
  }));
}

function validateStudyPlan(rawPlan = {}) {
  const issues = [];

  if (!isPlainObject(rawPlan)) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.PLAN_NOT_OBJECT,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "StudyPlan must be an object",
    });
    return {
      ok: false,
      issues,
      errors: getIssueMessages(issues, STUDY_PLAN_ISSUE_SEVERITY.ERROR),
      warnings: getIssueMessages(issues, STUDY_PLAN_ISSUE_SEVERITY.WARNING),
      normalizedPlan: null,
      routeHash: "",
      metricValidation: null,
    };
  }

  if (rawPlan.version !== STUDY_PLAN_VERSION) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.VERSION_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: `version must be ${STUDY_PLAN_VERSION}`,
      field: "version",
    });
  }

  const study = getStudyById(rawPlan.studyId);
  if (!study) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.STUDY_UNKNOWN,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: `Unknown studyId: ${rawPlan.studyId || ""}`,
      field: "studyId",
    });
  }

  const viewId = rawPlan.viewId || (study ? getDefaultStudyViewId(study) : "");
  if (!rawPlan.viewId && study) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.VIEW_DEFAULTED,
      severity: STUDY_PLAN_ISSUE_SEVERITY.WARNING,
      message: `viewId defaulted to ${viewId}`,
      field: "viewId",
      metadata: { viewId },
    });
  }
  const view = study ? getStudyViewById(study, viewId) : null;
  if (study && !view) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.VIEW_UNSUPPORTED,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: `Unsupported viewId "${viewId}" for study "${study.id}"`,
      field: "viewId",
      metadata: { studyId: study.id, viewId },
    });
  }
  const exactViewExists = study
    ? getStudyViews(study).some((candidateView) => candidateView.id === viewId)
    : false;
  if (study && view && !exactViewExists) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.VIEW_UNSUPPORTED,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: `Unsupported viewId "${viewId}" for study "${study.id}"`,
      field: "viewId",
      metadata: { studyId: study.id, viewId },
    });
  }

  const params = normalizePlanParams(rawPlan.params);
  if (params === null) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.PARAMS_INVALID,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "params must be an object or URLSearchParams",
      field: "params",
    });
  }

  if (params && study && view) {
    const allowedParamKeys = getAllowedParamKeys(study.id, view.id);
    Object.keys(params).forEach((key) => {
      if (!allowedParamKeys.has(key)) {
        addIssue(issues, {
          code: STUDY_PLAN_ISSUE_CODES.PARAM_UNSUPPORTED,
          severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
          message: `Unsupported param "${key}" for ${study.id}/${view.id}`,
          field: key,
          metadata: { studyId: study.id, viewId: view.id },
        });
      }
    });
    validateDateParams(params, issues);
    validateNumericParams(params, issues);
  }

  if (rawPlan.requiresConfirmation !== true) {
    addIssue(issues, {
      code: STUDY_PLAN_ISSUE_CODES.CONFIRMATION_REQUIRED,
      severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
      message: "requiresConfirmation must be true",
      field: "requiresConfirmation",
    });
  }

  let metricValidation = null;
  if (rawPlan.metricProposals !== undefined) {
    if (!Array.isArray(rawPlan.metricProposals)) {
      addIssue(issues, {
        code: STUDY_PLAN_ISSUE_CODES.METRIC_PROPOSALS_INVALID,
        severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
        message: "metricProposals must be an array when provided",
        field: "metricProposals",
      });
    } else if (study && view) {
      metricValidation = validateMetricDecisionProposals({
        domain: getMetricDomainForStudyPlan(study.id, view.id),
        proposals: rawPlan.metricProposals,
      });
      metricValidation.errors.forEach((message) => {
        addIssue(issues, {
          code: STUDY_PLAN_ISSUE_CODES.METRIC_POLICY_ERROR,
          severity: STUDY_PLAN_ISSUE_SEVERITY.ERROR,
          message,
          field: "metricProposals",
        });
      });
      metricValidation.warnings.forEach((message) => {
        addIssue(issues, {
          code: STUDY_PLAN_ISSUE_CODES.METRIC_POLICY_WARNING,
          severity: STUDY_PLAN_ISSUE_SEVERITY.WARNING,
          message,
          field: "metricProposals",
        });
      });
    }
  }

  const errors = getIssueMessages(issues, STUDY_PLAN_ISSUE_SEVERITY.ERROR);
  const warnings = getIssueMessages(issues, STUDY_PLAN_ISSUE_SEVERITY.WARNING);

  const normalizedPlan =
    study && view && params
      ? {
          version: STUDY_PLAN_VERSION,
          studyId: study.id,
          viewId: view.id,
          params,
          requiresConfirmation: true,
          metricProposals: Array.isArray(rawPlan.metricProposals)
            ? rawPlan.metricProposals
            : [],
        }
      : null;

  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings,
    normalizedPlan,
    routeHash: normalizedPlan ? buildStudyPlanRouteHash(normalizedPlan) : "",
    metricValidation,
  };
}

function buildStudyPlanConfirmationPreview(rawPlan = {}) {
  const validation = validateStudyPlan(rawPlan);
  const plan = validation.normalizedPlan;
  const study = plan ? getStudyById(plan.studyId) : null;
  const view = study ? getStudyViewById(study, plan.viewId) : null;

  return {
    ok: validation.ok,
    canRun: validation.ok && plan?.requiresConfirmation === true,
    version: STUDY_PLAN_VERSION,
    studyId: plan?.studyId || rawPlan?.studyId || "",
    studyTitle: study?.title || "",
    viewId: plan?.viewId || rawPlan?.viewId || "",
    viewLabel: view?.label || "",
    routeHash: validation.routeHash,
    requiresConfirmation: plan?.requiresConfirmation === true,
    paramItems: plan ? buildParamPreviewItems(plan.params) : [],
    errors: validation.errors,
    warnings: validation.warnings,
    issues: validation.issues,
    metricErrors: validation.metricValidation?.errors || [],
    metricWarnings: validation.metricValidation?.warnings || [],
    normalizedPlan: plan,
  };
}

function getStudyPlanContractManifest() {
  return {
    version: STUDY_PLAN_VERSION,
    purpose:
      "Deterministic contract for AI-generated study route proposals before execution.",
    requiredFields: ["version", "studyId", "requiresConfirmation"],
    optionalFields: ["viewId", "params", "metricProposals"],
    issueSeverities: Object.values(STUDY_PLAN_ISSUE_SEVERITY),
    issueCodes: Object.values(STUDY_PLAN_ISSUE_CODES).sort(),
    paramDefinitions: Object.fromEntries(
      Object.entries(STUDY_PLAN_PARAM_DEFINITIONS).map(([key, definition]) => [
        key,
        { ...definition },
      ]),
    ),
    confirmationPreviewFields: [
      "ok",
      "canRun",
      "studyTitle",
      "viewLabel",
      "routeHash",
      "paramItems",
      "errors",
      "warnings",
      "issues",
      "metricErrors",
      "metricWarnings",
    ],
    routeConversionFields: [
      "ok",
      "input",
      "normalizedRouteHash",
      "rawPlan",
      "normalizedPlan",
      "routeHash",
      "issues",
      "errors",
      "warnings",
    ],
    routeInputFormats: [
      "#studyId/viewId?param=value",
      "studyId/viewId?param=value",
      "/studyId/viewId?param=value",
      "http://127.0.0.1:8000/#studyId/viewId?param=value",
    ],
    routeParamRules: Object.fromEntries(
      Object.entries(STUDY_PLAN_PARAM_RULES).map(([studyId, viewRules]) => [
        studyId,
        Object.fromEntries(
          Object.entries(viewRules).map(([viewId, keys]) => [viewId, [...keys].sort()]),
        ),
      ]),
    ),
  };
}

export {
  STUDY_PLAN_ISSUE_CODES,
  STUDY_PLAN_ISSUE_SEVERITY,
  STUDY_PLAN_VERSION,
  buildStudyPlanConfirmationPreview,
  buildStudyPlanFromRouteHash,
  buildStudyPlanRouteHash,
  getMetricDomainForStudyPlan,
  getStudyPlanContractManifest,
  getStudyPlanParamDefinition,
  normalizeStudyRouteHashInput,
  validateStudyPlan,
};
