import { buildSettingsRouteHash } from "../appRoute.js";
import {
  STUDY_PLAN_VERSION,
  buildStudyPlanConfirmationPreview,
  buildStudyPlanFromRouteHash,
  validateStudyPlan,
} from "../studyBuilder/studyPlan.js";
import {
  deleteStudyPlanRecipe as deleteLocalStudyPlanRecipe,
  loadStudyPlanRecipes as loadLocalStudyPlanRecipes,
  saveStudyPlanRecipe as saveLocalStudyPlanRecipe,
} from "../studyBuilder/studyPlanRecipes.js";
import { draftStudyPlanFromIntent } from "../studyBuilder/intentPlanner.js";
import { escapeHtml, formatSettingsTimestamp, renderSettingsSectionNav } from "./shared.js";

const EXAMPLE_STUDY_INTENT =
  "Compare Nifty 50 against Sensex from 2021 to 2024 using the risk study.";
const EXAMPLE_STUDY_ROUTE_HASH =
  "#risk-adjusted-return/relative?subject=Nifty+50&benchmark=Sensex&start=2021-01-01&end=2024-12-31";

const EXAMPLE_STUDY_PLAN = {
  version: STUDY_PLAN_VERSION,
  studyId: "risk-adjusted-return",
  viewId: "overview",
  params: {
    subject: "Nifty 50",
    start: "2021-04-08",
    end: "2026-04-08",
    rf: "5.50",
  },
  requiresConfirmation: true,
};

const STUDY_BUILDER_PLAN_RESPONSE_VERSION = "study-builder-plan-response-v1";
const STUDY_BUILDER_VALIDATION_RESPONSE_VERSION = "study-builder-validation-response-v1";

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function parsePlanText(planText) {
  const trimmed = String(planText || "").trim();
  if (!trimmed) {
    throw new Error("Paste a study-plan-v1 JSON object first.");
  }
  return JSON.parse(trimmed);
}

function formatPlannerConfidence(confidence) {
  if (confidence === "needs-review") {
    return "Needs Review";
  }
  if (confidence === "blocked") {
    return "Blocked";
  }
  return "Draft";
}

function getPlannerDraftStatusMessage(plannerResult, preview) {
  if (!preview?.canRun) {
    return "Drafted a StudyPlan, but validation blocked route handoff.";
  }
  if (plannerResult?.confidence === "needs-review") {
    return "Drafted a route-safe StudyPlan with planner diagnostics. Review before route handoff.";
  }
  return "Drafted a route-safe StudyPlan. Review before route handoff.";
}

function appendBackendFallbackNote(message, backendResult) {
  if (!backendResult?.usedFallback) {
    return message;
  }
  return `${message} Used local Study Builder fallback because the backend endpoint was unavailable.`;
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
    request && typeof request === "object" && !Array.isArray(request)
      ? request
      : {};

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

function renderIssueList(title, issues) {
  if (!issues?.length) {
    return "";
  }
  return `
    <div class="settings-study-builder-issues">
      <p class="meta-label">${escapeHtml(title)}</p>
      <div class="settings-detail-list">
        ${issues
          .map(
            (issue) => `
              <div class="settings-detail-item">
                <p class="settings-detail-title">${escapeHtml(issue.code || "issue")}</p>
                <p class="summary-meta">${escapeHtml(issue.message || "")}</p>
                ${
                  issue.field
                    ? `<p class="summary-meta">Field: ${escapeHtml(issue.field)}</p>`
                    : ""
                }
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderPreviewCard(preview) {
  if (!preview) {
    return `
      <section class="card settings-card">
        <div class="settings-card-head">
          <div>
            <p class="meta-label">Confirmation Preview</p>
            <h3 class="settings-card-title">No plan validated yet</h3>
          </div>
        </div>
        <p class="summary-meta">Paste a StudyPlan JSON object and validate it to see the deterministic confirmation card.</p>
      </section>
    `;
  }

  const issueErrors = preview.issues.filter((issue) => issue.severity === "error");
  const issueWarnings = preview.issues.filter((issue) => issue.severity === "warning");

  return `
    <section class="card settings-card">
      <div class="settings-card-head">
        <div>
          <p class="meta-label">Confirmation Preview</p>
          <h3 class="settings-card-title">${
            preview.studyTitle
              ? `${escapeHtml(preview.studyTitle)} · ${escapeHtml(preview.viewLabel)}`
              : "Plan blocked"
          }</h3>
          <p class="summary-meta">${
            preview.canRun
              ? "This plan is route-safe and can be handed off after user confirmation."
              : "This plan cannot run until the listed issues are fixed."
          }</p>
        </div>
        <div class="automation-pill-row">
          <span class="automation-pill ${preview.canRun ? "ok" : "attention"}">
            ${preview.canRun ? "Can Run" : "Blocked"}
          </span>
        </div>
      </div>

      <div class="settings-detail-list">
        <div class="settings-detail-item">
          <p class="settings-detail-title">Route</p>
          <p class="summary-meta">${escapeHtml(preview.routeHash || "No valid route")}</p>
        </div>
        ${
          preview.paramItems.length
            ? `
              <div class="settings-detail-item">
                <p class="settings-detail-title">Parameters</p>
                <div class="settings-study-builder-param-grid">
                  ${preview.paramItems
                    .map(
                      (item) => `
                        <div>
                          <p class="meta-label">${escapeHtml(item.label)}</p>
                          <p>${escapeHtml(item.value)}</p>
                          <p class="summary-meta">${escapeHtml(item.key)} · ${escapeHtml(item.type)}</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </div>

      ${renderIssueList("Errors", issueErrors)}
      ${renderIssueList("Warnings", issueWarnings)}

      <div class="automation-actions">
        <a
          class="button${preview.canRun ? "" : " secondary is-disabled"}"
          href="${preview.canRun ? escapeHtml(preview.routeHash) : "#"}"
          ${preview.canRun ? "" : 'aria-disabled="true" tabindex="-1"'}
          data-study-builder-go
        >Go to route</a>
      </div>
    </section>
  `;
}

function renderRecipeList(recipes) {
  if (!recipes?.length) {
    return `<p class="summary-meta">No saved StudyPlan recipes yet. Validate a plan, then save it here for reuse.</p>`;
  }

  return `
    <div class="settings-detail-list">
      ${recipes
        .map(
          (recipe) => `
            <div class="settings-detail-item">
              <div class="automation-item-head">
                <div>
                  <p class="settings-detail-title">${escapeHtml(recipe.name)}</p>
                  <p class="summary-meta">${escapeHtml(recipe.studyId)} · ${escapeHtml(recipe.viewId)}</p>
                  <p class="summary-meta">${escapeHtml(recipe.routeHash)}</p>
                  <p class="summary-meta">Updated ${escapeHtml(formatSettingsTimestamp(recipe.updatedAt))}</p>
                </div>
                <div class="automation-pill-row">
                  <span class="automation-pill ok">Recipe</span>
                </div>
              </div>
              <div class="automation-item-actions">
                <button class="button secondary" type="button" data-study-builder-load-recipe="${escapeHtml(recipe.id)}">Load</button>
                <button class="button secondary" type="button" data-study-builder-delete-recipe="${escapeHtml(recipe.id)}">Delete</button>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAssistantReadinessCard(readiness, readinessStatusMessage = "") {
  const status = readiness?.status || "loading";
  const isOk = status === "ok";
  const failedChecks = Array.isArray(readiness?.checks)
    ? readiness.checks.filter((check) => !check.ok)
    : [];
  const visibleFailedChecks = failedChecks.slice(0, 4);
  const liveAiTesting = readiness?.liveAiTesting || {};
  const summary = readiness?.summary || {};

  return `
    <section class="card settings-card">
      <div class="settings-card-head">
        <div>
          <p class="meta-label">Assistant Readiness</p>
          <h3 class="settings-card-title">${
            readiness
              ? isOk
                ? "Deterministic assistant rail is healthy"
                : "Assistant rail needs attention"
              : "Checking deterministic assistant rail"
          }</h3>
          <p class="summary-meta">
            Fast keyless preflight for contracts, route wiring, generated artifacts, and future AI testing readiness.
          </p>
        </div>
        <div class="automation-pill-row">
          <span class="automation-pill ${isOk ? "ok" : "attention"}">
            ${readiness ? (isOk ? "OK" : "Attention") : "Loading"}
          </span>
        </div>
      </div>

      <div class="settings-detail-list">
        <div class="settings-detail-item">
          <p class="settings-detail-title">Preflight</p>
          <p class="summary-meta">${
            readiness
              ? `${Number(summary.passed || 0)} / ${Number(summary.total || 0)} checks passed · ${Number(summary.failed || 0)} failed`
              : "Loading backend readiness from the local server..."
          }</p>
        </div>
        <div class="settings-detail-item">
          <p class="settings-detail-title">Live AI Key</p>
          <p class="summary-meta">${
            liveAiTesting.status
              ? `${escapeHtml(liveAiTesting.status)} · ${escapeHtml(liveAiTesting.requiredOnlyWhen || "")}`
              : "Not required for deterministic readiness."
          }</p>
        </div>
        ${
          visibleFailedChecks.length
            ? `
              <div class="settings-detail-item">
                <p class="settings-detail-title">Attention Items</p>
                ${visibleFailedChecks
                  .map(
                    (check) =>
                      `<p class="summary-meta">${escapeHtml(check.id)}: ${escapeHtml(check.detail || "")}</p>`,
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </div>

      <div class="automation-actions">
        <button class="button secondary" type="button" id="settings-study-builder-refresh-readiness">Refresh Readiness</button>
      </div>
      <p class="summary-meta">Run <code>python3 scripts/check_assistant_readiness.py</code> for the full CLI drift check.</p>
      ${
        readinessStatusMessage
          ? `<p class="status ${isOk ? "success" : "info"}">${escapeHtml(readinessStatusMessage)}</p>`
          : ""
      }
    </section>
  `;
}

function renderStudyBuilderSettingsPage({
  intentText = "",
  routeHashText = EXAMPLE_STUDY_ROUTE_HASH,
  planText,
  preview,
  plannerResult = null,
  recipes = [],
  recipeName = "",
  assistantReadiness = null,
  assistantReadinessStatusMessage = "",
  statusMessage = "",
}) {
  return `
    <div class="settings-shell">
      <div class="settings-toolbar">
        <div>
          <p class="section-label">App Settings</p>
          <h2 class="settings-title">Study Builder Preview</h2>
          <p class="summary-meta settings-copy">
            Backend-owned deterministic harness for future AI-generated study plans. No AI calls, no execution.
          </p>
        </div>
        ${renderSettingsSectionNav("study-builder")}
      </div>

      <div class="settings-grid">
        ${renderAssistantReadinessCard(assistantReadiness, assistantReadinessStatusMessage)}

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Intent Draft</p>
              <h3 class="settings-card-title">Describe the study request</h3>
              <p class="summary-meta">This uses the backend Study Builder endpoint when available, with local contract fallback for offline review.</p>
            </div>
          </div>
          <form id="settings-study-builder-intent-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-intent">Research intent</label>
            <textarea
              id="settings-study-builder-intent"
              class="input settings-study-builder-intent"
              spellcheck="true"
              rows="5"
            >${escapeHtml(intentText)}</textarea>
            <div class="automation-actions">
              <button class="button" type="submit">Draft StudyPlan</button>
              <button class="button secondary" type="button" id="settings-study-builder-intent-example">Load Intent Example</button>
            </div>
          </form>
          ${
            plannerResult
              ? `
                <div class="settings-detail-list">
                  <div class="settings-detail-item">
                    <p class="settings-detail-title">Matched Template</p>
                    <p>${escapeHtml(plannerResult.templateLabel || "Unknown")}</p>
                    <p class="summary-meta">${escapeHtml(plannerResult.templateId || "")} · ${escapeHtml(formatPlannerConfidence(plannerResult.confidence))}</p>
                  </div>
                </div>
                ${renderIssueList("Planner Diagnostics", plannerResult.diagnostics || [])}
              `
              : ""
          }
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Route Hash</p>
              <h3 class="settings-card-title">Convert an existing route</h3>
              <p class="summary-meta">Round-trip saved links, copied app URLs, history routes, or manual hashes through the same StudyPlan validator.</p>
            </div>
          </div>
          <form id="settings-study-builder-route-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-route">study route hash or app URL</label>
            <input
              id="settings-study-builder-route"
              class="input"
              spellcheck="false"
              value="${escapeHtml(routeHashText)}"
            />
            <div class="automation-actions">
              <button class="button" type="submit">Convert Route</button>
              <button class="button secondary" type="button" id="settings-study-builder-route-example">Load Route Example</button>
            </div>
          </form>
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">StudyPlan JSON</p>
              <h3 class="settings-card-title">Paste a proposed plan</h3>
            </div>
          </div>
          <form id="settings-study-builder-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-json">study-plan-v1</label>
            <textarea
              id="settings-study-builder-json"
              class="input settings-study-builder-textarea"
              spellcheck="false"
              rows="18"
            >${escapeHtml(planText)}</textarea>
            <div class="automation-actions">
              <button class="button" type="submit">Validate Preview</button>
              <button class="button secondary" type="button" id="settings-study-builder-example">Load Example</button>
              <button class="button secondary" type="button" id="settings-study-builder-clear">Clear</button>
            </div>
            ${
              statusMessage
                ? `<p class="status ${preview?.canRun ? "success" : "info"}">${escapeHtml(statusMessage)}</p>`
                : ""
            }
          </form>
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Saved Recipes</p>
              <h3 class="settings-card-title">Reuse validated plans</h3>
              <p class="summary-meta">Backend recipes when the local server is available, with browser-local fallback for offline review. This is convenience history, not evidence.</p>
            </div>
          </div>
          <form id="settings-study-builder-recipe-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-recipe-name">Recipe name</label>
            <input
              id="settings-study-builder-recipe-name"
              class="input"
              value="${escapeHtml(recipeName)}"
              placeholder="Nifty 50 relative risk"
            />
            <div class="automation-actions">
              <button class="button" type="submit">Save Current Plan</button>
            </div>
          </form>
          ${renderRecipeList(recipes)}
        </section>

        ${renderPreviewCard(preview)}
      </div>
    </div>
  `;
}

function mountStudyBuilderSettingsPage(root, controller = {}) {
  let intentText = EXAMPLE_STUDY_INTENT;
  let routeHashText = EXAMPLE_STUDY_ROUTE_HASH;
  let planText = formatJson(EXAMPLE_STUDY_PLAN);
  let preview = null;
  let plannerResult = null;
  let recipes = loadLocalStudyPlanRecipes();
  let recipeName = "";
  let assistantReadiness = null;
  let assistantReadinessStatusMessage = "";
  let statusMessage = "";
  let isMounted = true;

  function render() {
    if (!isMounted) {
      return;
    }
    root.innerHTML = renderStudyBuilderSettingsPage({
      intentText,
      routeHashText,
      planText,
      preview,
      plannerResult,
      recipes,
      recipeName,
      assistantReadiness,
      assistantReadinessStatusMessage,
      statusMessage,
    });
  }

  function setJsonErrorPreview(error) {
    preview = {
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

  async function refreshBackendRecipes({ showStatus = false } = {}) {
    if (typeof controller?.fetchStudyPlanRecipes !== "function") {
      return;
    }
    try {
      const payload = await controller.fetchStudyPlanRecipes();
      if (!isMounted) {
        return;
      }
      recipes = payload.recipes;
      if (showStatus) {
        statusMessage = "Loaded backend StudyPlan recipes.";
      }
      render();
    } catch (error) {
      if (!isMounted || !showStatus) {
        return;
      }
      statusMessage = "Could not load backend recipes. Keeping browser-local fallback.";
      render();
    }
  }

  async function refreshAssistantReadiness({ showStatus = false } = {}) {
    if (typeof controller?.fetchAssistantReadiness !== "function") {
      assistantReadinessStatusMessage =
        "Backend readiness endpoint is unavailable in this context. Local contracts remain inspectable.";
      render();
      return;
    }
    try {
      const payload = await controller.fetchAssistantReadiness({ artifactChecks: false });
      if (!isMounted) {
        return;
      }
      assistantReadiness = payload;
      assistantReadinessStatusMessage = "Loaded keyless backend assistant readiness.";
      render();
    } catch (error) {
      if (!isMounted) {
        return;
      }
      assistantReadiness = null;
      assistantReadinessStatusMessage =
        error?.message || "Could not load backend assistant readiness.";
      render();
    }
  }

  async function saveCurrentRecipe({ name, plan }) {
    if (typeof controller?.saveStudyPlanRecipe === "function") {
      try {
        return {
          ...(await controller.saveStudyPlanRecipe({ name, plan })),
          usedFallback: false,
        };
      } catch (error) {
        const localResult = saveLocalStudyPlanRecipe({ name, plan });
        return { ...localResult, usedFallback: true, error };
      }
    }
    return { ...saveLocalStudyPlanRecipe({ name, plan }), usedFallback: false };
  }

  async function deleteCurrentRecipe(recipeId) {
    if (typeof controller?.deleteStudyPlanRecipe === "function") {
      try {
        return {
          ...(await controller.deleteStudyPlanRecipe({ id: recipeId })),
          usedFallback: false,
        };
      } catch (error) {
        return {
          ok: true,
          recipes: deleteLocalStudyPlanRecipe(recipeId),
          usedFallback: true,
          error,
        };
      }
    }
    return {
      ok: true,
      recipes: deleteLocalStudyPlanRecipe(recipeId),
      usedFallback: false,
    };
  }

  async function validateCurrentPlan() {
    try {
      const plan = parsePlanText(planText);
      const backendResult = await requestValidationPayload(controller, { plan });
      preview = backendResult.payload.preview;
      statusMessage = appendBackendFallbackNote(
        preview.canRun
          ? "Plan validated. Review the deterministic preview before route handoff."
          : "Plan blocked. Fix the deterministic issues listed in the preview.",
        backendResult,
      );
    } catch (error) {
      setJsonErrorPreview(error);
      statusMessage = "Could not parse StudyPlan JSON.";
    }
  }

  async function handleSubmit(event) {
    const recipeForm = event.target.closest("#settings-study-builder-recipe-form");
    if (recipeForm) {
      event.preventDefault();
      recipeName = root.querySelector("#settings-study-builder-recipe-name")?.value || "";
      planText = root.querySelector("#settings-study-builder-json")?.value || planText;
      try {
        const plan = parsePlanText(planText);
        const result = await saveCurrentRecipe({ name: recipeName, plan });
        recipes = result.recipes;
        preview = result.preview || buildStudyPlanConfirmationPreview(result.recipe?.plan || plan);
        statusMessage = appendBackendFallbackNote(
          result.ok
            ? "StudyPlan recipe saved."
            : "Only validated StudyPlans can be saved as recipes.",
          result,
        );
      } catch (error) {
        setJsonErrorPreview(error);
        statusMessage = error?.message || "Could not save StudyPlan recipe.";
      }
      render();
      return;
    }

    const routeForm = event.target.closest("#settings-study-builder-route-form");
    if (routeForm) {
      event.preventDefault();
      routeHashText = root.querySelector("#settings-study-builder-route")?.value || "";
      const backendResult = await requestValidationPayload(controller, { routeHash: routeHashText });
      if (!isMounted) {
        return;
      }
      const routeValidation = backendResult.payload.route || buildStudyPlanFromRouteHash(routeHashText);
      const routePlan = routeValidation.normalizedPlan || routeValidation.rawPlan;
      planText = formatJson(routePlan);
      preview = backendResult.payload.preview || buildStudyPlanConfirmationPreview(routePlan);
      statusMessage = appendBackendFallbackNote(
        routeValidation.ok
          ? "Route converted into a validated StudyPlan. Review before route handoff."
          : "Route converted, but validation blocked route handoff.",
        backendResult,
      );
      plannerResult = null;
      render();
      return;
    }

    const intentForm = event.target.closest("#settings-study-builder-intent-form");
    if (intentForm) {
      event.preventDefault();
      intentText = root.querySelector("#settings-study-builder-intent")?.value || "";
      const backendResult = await requestPlannerPayload(controller, intentText);
      if (!isMounted) {
        return;
      }
      plannerResult = backendResult.payload.plannerResult;
      planText = formatJson(backendResult.payload.plan);
      preview = backendResult.payload.preview;
      statusMessage = appendBackendFallbackNote(
        getPlannerDraftStatusMessage(plannerResult, preview),
        backendResult,
      );
      render();
      return;
    }

    const form = event.target.closest("#settings-study-builder-form");
    if (!form) {
      return;
    }
    event.preventDefault();
    planText = root.querySelector("#settings-study-builder-json")?.value || "";
    await validateCurrentPlan();
    render();
  }

  async function handleClick(event) {
    if (event.target.closest("#settings-study-builder-intent-example")) {
      intentText = EXAMPLE_STUDY_INTENT;
      plannerResult = null;
      statusMessage = "Loaded an example research intent.";
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-route-example")) {
      routeHashText = EXAMPLE_STUDY_ROUTE_HASH;
      statusMessage = "Loaded an example study route hash.";
      render();
      return;
    }

    const loadRecipeButton = event.target.closest("[data-study-builder-load-recipe]");
    if (loadRecipeButton) {
      const recipeId = loadRecipeButton.getAttribute("data-study-builder-load-recipe");
      const recipe = recipes.find((item) => item.id === recipeId);
      if (recipe) {
        planText = formatJson(recipe.plan);
        preview = buildStudyPlanConfirmationPreview(recipe.plan);
        recipeName = recipe.name;
        plannerResult = null;
        statusMessage = "Loaded saved StudyPlan recipe.";
        render();
      }
      return;
    }

    const deleteRecipeButton = event.target.closest("[data-study-builder-delete-recipe]");
    if (deleteRecipeButton) {
      const recipeId = deleteRecipeButton.getAttribute("data-study-builder-delete-recipe");
      const result = await deleteCurrentRecipe(recipeId);
      if (!isMounted) {
        return;
      }
      recipes = result.recipes;
      statusMessage = appendBackendFallbackNote("StudyPlan recipe deleted.", result);
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-refresh-readiness")) {
      assistantReadinessStatusMessage = "Refreshing assistant readiness...";
      render();
      await refreshAssistantReadiness({ showStatus: true });
      return;
    }

    if (event.target.closest("#settings-study-builder-example")) {
      planText = formatJson(EXAMPLE_STUDY_PLAN);
      preview = null;
      statusMessage = "Loaded an example study-plan-v1 payload.";
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-clear")) {
      planText = "";
      preview = null;
      statusMessage = "";
      render();
      return;
    }

    const blockedRoute = event.target.closest("[data-study-builder-go][aria-disabled='true']");
    if (blockedRoute) {
      event.preventDefault();
    }
  }

  root.addEventListener("submit", handleSubmit);
  root.addEventListener("click", handleClick);
  render();
  refreshAssistantReadiness();
  refreshBackendRecipes();

  return () => {
    isMounted = false;
    root.removeEventListener("submit", handleSubmit);
    root.removeEventListener("click", handleClick);
  };
}

export {
  EXAMPLE_STUDY_INTENT,
  EXAMPLE_STUDY_PLAN,
  EXAMPLE_STUDY_ROUTE_HASH,
  mountStudyBuilderSettingsPage,
  renderStudyBuilderSettingsPage,
};
