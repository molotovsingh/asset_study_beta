import { STUDY_PLAN_VERSION } from "../studyBuilder/studyPlan.js";
import {
  appendBackendFallbackNote,
  buildPreviewForPlan,
  convertStudyBuilderRoute,
  draftStudyBuilderIntent,
  formatStudyPlanJson,
  parseStudyPlanJson,
  runLiveStudyBuilderDraft,
  validateStudyBuilderPlanText,
} from "../studyBuilder/studyBuilderWorkflow.js";
import {
  deleteStudyPlanRecipeWithFallback,
  loadInitialStudyPlanRecipes,
  refreshStudyPlanRecipes,
  refreshSavedStudyReadinessWithFallback,
  saveStudyPlanRecipeWithFallback,
} from "../studyBuilder/studyPlanRecipeClient.js";
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

function formatPlannerConfidence(confidence) {
  if (confidence === "needs-review") {
    return "Needs Review";
  }
  if (confidence === "blocked") {
    return "Blocked";
  }
  return "Draft";
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

function renderLiveDraftResult(liveDraftResult) {
  if (!liveDraftResult) {
    return "";
  }

  if (liveDraftResult.errorMessage) {
    return `
      <div class="settings-detail-list">
        <div class="settings-detail-item">
          <div class="automation-item-head">
            <div>
              <p class="settings-detail-title">AI Draft Blocked</p>
              <p class="summary-meta">${escapeHtml(liveDraftResult.errorMessage)}</p>
            </div>
            <div class="automation-pill-row">
              <span class="automation-pill attention">Attention</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const validationOk = liveDraftResult.validation?.ok === true;
  const canRun = liveDraftResult.preview?.canRun === true;
  const executed = liveDraftResult.execution?.executed === true;
  return `
    <div class="settings-detail-list">
      <div class="settings-detail-item">
        <div class="automation-item-head">
          <div>
            <p class="settings-detail-title">AI Draft Result</p>
            <p class="summary-meta">
              The AI suggested a study setup. The app checked the setup, not the market data.
            </p>
            <p class="summary-meta">
              ${validationOk ? "Setup OK, data not checked here" : "Needs changes"} ·
              ${executed ? "Unexpected run detected" : "No study was run"}
            </p>
            <p class="summary-meta">
              ${escapeHtml(liveDraftResult.provider || "provider")} ·
              ${escapeHtml(liveDraftResult.model || "model unknown")}
            </p>
          </div>
          <div class="automation-pill-row">
            <span class="automation-pill ${canRun && !executed ? "ok" : "attention"}">
              ${canRun && !executed ? "Setup OK" : "Blocked"}
            </span>
          </div>
        </div>
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
            <p class="meta-label">Preview</p>
            <h3 class="settings-card-title">Your study will appear here</h3>
          </div>
        </div>
        <p class="summary-meta">Describe a study, ask AI to draft one, or paste a saved link. The app will show what it plans to open before anything runs.</p>
      </section>
    `;
  }

  const issueErrors = preview.issues.filter((issue) => issue.severity === "error");
  const issueWarnings = preview.issues.filter((issue) => issue.severity === "warning");

  return `
    <section class="card settings-card">
      <div class="settings-card-head">
        <div>
          <p class="meta-label">Preview</p>
          <h3 class="settings-card-title">${
            preview.studyTitle
              ? `${escapeHtml(preview.studyTitle)} · ${escapeHtml(preview.viewLabel)}`
              : "Plan blocked"
          }</h3>
          <p class="summary-meta">${
            preview.canRun
              ? "This setup can open a study. The study page will check whether the symbol and date range have data."
              : "This setup needs changes before it can open a study."
          }</p>
        </div>
        <div class="automation-pill-row">
          <span class="automation-pill ${preview.canRun ? "ok" : "attention"}">
            ${preview.canRun ? "Setup OK" : "Blocked"}
          </span>
        </div>
      </div>

      <div class="settings-detail-list">
        <div class="settings-detail-item">
          <p class="settings-detail-title">Study link</p>
          <p class="summary-meta">${escapeHtml(preview.routeHash || "No valid route")}</p>
        </div>
        ${
          preview.paramItems.length
            ? `
              <div class="settings-detail-item">
                <p class="settings-detail-title">Study details</p>
                <div class="settings-study-builder-param-grid">
                  ${preview.paramItems
                    .map(
                      (item) => `
                        <div>
                          <p class="meta-label">${escapeHtml(item.label)}</p>
                          <p>${escapeHtml(item.value)}</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
        ${
          preview.canRun
            ? `
              <div class="settings-detail-item">
                <p class="settings-detail-title">Data check</p>
                <p class="summary-meta">Not checked on this page. Opening the study will load the symbol and date range, then show any missing or clipped data.</p>
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
        >Open and check data</a>
      </div>
    </section>
  `;
}

function renderRecipeList(recipes) {
  if (!recipes?.length) {
    return `<p class="summary-meta">No saved studies yet. Build or check a setup, then save it for reuse.</p>`;
  }

  return `
    <div class="settings-detail-list">
      ${recipes
        .map((recipe) => {
          const readiness = recipe.readiness || recipe.savedStudy?.readiness || null;
          const readinessStatus = String(readiness?.status || "unknown");
          const dependencies = recipe.dependencies || recipe.savedStudy?.dependencies || [];
          const dependencyCopy = dependencies.length
            ? `${dependencies.length} data dependencies`
            : "No dependency manifest yet";
          return `
            <div class="settings-detail-item">
              <div class="automation-item-head">
                <div>
                  <p class="settings-detail-title">${escapeHtml(recipe.name)}</p>
                  <p class="summary-meta">${escapeHtml(recipe.studyId)} · ${escapeHtml(recipe.viewId)}</p>
                  <p class="summary-meta">${escapeHtml(recipe.routeHash)}</p>
                  <p class="summary-meta">${escapeHtml(dependencyCopy)} · readiness ${escapeHtml(readinessStatus)}</p>
                  <p class="summary-meta">Updated ${escapeHtml(formatSettingsTimestamp(recipe.updatedAt))}</p>
                </div>
                <div class="automation-pill-row">
                  <span class="automation-pill ${readinessStatus === "ok" ? "ok" : "attention"}">
                    ${readinessStatus === "ok" ? "Ready" : "Needs readiness"}
                  </span>
                </div>
              </div>
              <div class="automation-item-actions">
                <button class="button secondary" type="button" data-study-builder-load-recipe="${escapeHtml(recipe.id)}">Load</button>
                <a class="button secondary" href="${escapeHtml(recipe.routeHash)}">Open</a>
                <button class="button secondary" type="button" data-study-builder-refresh-saved-study="${escapeHtml(recipe.id)}">Refresh Readiness</button>
                <button class="button secondary" type="button" data-study-builder-delete-recipe="${escapeHtml(recipe.id)}">Archive</button>
              </div>
            </div>
          `;
        })
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
          <p class="meta-label">Safety Check</p>
          <h3 class="settings-card-title">${
            readiness
              ? isOk
                ? "Study Builder setup checks are OK"
                : "Study Builder needs attention"
              : "Checking Study Builder"
          }</h3>
          <p class="summary-meta">
            The app checks that AI can only suggest a study setup. It does not prove the market data exists yet.
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
          <p class="settings-detail-title">System check</p>
          <p class="summary-meta">${
            readiness
              ? `${Number(summary.passed || 0)} / ${Number(summary.total || 0)} checks passed · ${Number(summary.failed || 0)} failed`
              : "Checking the local server..."
          }</p>
        </div>
        <div class="settings-detail-item">
          <p class="settings-detail-title">AI draft key</p>
          <p class="summary-meta">${
            liveAiTesting.status
              ? "Needed only when you click Ask AI to Draft."
              : "Not needed for the basic draft."
          }</p>
        </div>
        ${
          visibleFailedChecks.length
            ? `
              <div class="settings-detail-item">
                <p class="settings-detail-title">Needs attention</p>
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
        <button class="button secondary" type="button" id="settings-study-builder-refresh-readiness">Check Again</button>
      </div>
      <p class="summary-meta">Developer check: <code>python3 scripts/check_assistant_readiness.py</code>.</p>
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
  liveDraftResult = null,
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
          <h2 class="settings-title">Build a Study with AI</h2>
          <p class="summary-meta settings-copy">
            Tell the app what you want to study. AI can draft the setup, but the app checks it before anything runs.
          </p>
        </div>
        ${renderSettingsSectionNav("study-builder")}
      </div>

      <div class="settings-grid">
        ${renderAssistantReadinessCard(assistantReadiness, assistantReadinessStatusMessage)}

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Your Request</p>
              <h3 class="settings-card-title">Tell me what you want to study</h3>
              <p class="summary-meta">Example: Compare Nifty 50 against Sensex from 2021 to 2024.</p>
            </div>
          </div>
          <form id="settings-study-builder-intent-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-intent">Study request</label>
            <textarea
              id="settings-study-builder-intent"
              class="input settings-study-builder-intent"
              spellcheck="true"
              rows="5"
            >${escapeHtml(intentText)}</textarea>
            <div class="automation-actions">
              <button class="button" type="submit">Draft without AI</button>
              <button class="button secondary" type="button" id="settings-study-builder-live-draft">Ask AI to Draft</button>
              <button class="button secondary" type="button" id="settings-study-builder-intent-example">Load Example</button>
            </div>
          </form>
          ${renderLiveDraftResult(liveDraftResult)}
          ${
            plannerResult
              ? `
                <div class="settings-detail-list">
                  <div class="settings-detail-item">
                    <p class="settings-detail-title">App chose</p>
                    <p>${escapeHtml(plannerResult.templateLabel || "Unknown")}</p>
                    <p class="summary-meta">${escapeHtml(plannerResult.templateId || "")} · ${escapeHtml(formatPlannerConfidence(plannerResult.confidence))}</p>
                  </div>
                </div>
                ${renderIssueList("Needs your review", plannerResult.diagnostics || [])}
              `
              : ""
          }
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Saved Link</p>
              <h3 class="settings-card-title">Turn a link back into a setup</h3>
              <p class="summary-meta">Paste a saved app link or history link and the app will rebuild the study setup.</p>
            </div>
          </div>
          <form id="settings-study-builder-route-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-route">Saved study link</label>
            <input
              id="settings-study-builder-route"
              class="input"
              spellcheck="false"
              value="${escapeHtml(routeHashText)}"
            />
            <div class="automation-actions">
              <button class="button" type="submit">Convert Link</button>
              <button class="button secondary" type="button" id="settings-study-builder-route-example">Load Example</button>
            </div>
          </form>
        </section>

        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Advanced</p>
              <h3 class="settings-card-title">Edit the study setup JSON</h3>
            </div>
          </div>
          <form id="settings-study-builder-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-json">Study setup JSON</label>
            <textarea
              id="settings-study-builder-json"
              class="input settings-study-builder-textarea"
              spellcheck="false"
              rows="18"
            >${escapeHtml(planText)}</textarea>
            <div class="automation-actions">
              <button class="button" type="submit">Check Setup</button>
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
              <p class="meta-label">Saved Studies</p>
              <h3 class="settings-card-title">Reuse studies you build often</h3>
              <p class="summary-meta">Saved studies are reusable setups, not completed results or evidence.</p>
            </div>
          </div>
          <form id="settings-study-builder-recipe-form" class="automation-form">
            <label class="field-label" for="settings-study-builder-recipe-name">Setup name</label>
            <input
              id="settings-study-builder-recipe-name"
              class="input"
              value="${escapeHtml(recipeName)}"
              placeholder="Nifty 50 relative risk"
            />
            <div class="automation-actions">
              <button class="button" type="submit">Save This Study</button>
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
  let planText = formatStudyPlanJson(EXAMPLE_STUDY_PLAN);
  let preview = null;
  let plannerResult = null;
  let liveDraftResult = null;
  let recipes = loadInitialStudyPlanRecipes();
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
      liveDraftResult,
      recipes,
      recipeName,
      assistantReadiness,
      assistantReadinessStatusMessage,
      statusMessage,
    });
  }

  async function refreshBackendRecipes({ showStatus = false } = {}) {
    try {
      const payload = await refreshStudyPlanRecipes(controller);
      if (payload.skipped) {
        return;
      }
      if (!isMounted) {
        return;
      }
      recipes = payload.recipes;
      if (showStatus) {
        statusMessage = "Loaded saved studies.";
      }
      render();
    } catch (error) {
      if (!isMounted || !showStatus) {
        return;
      }
      statusMessage = "Could not load saved studies from the local server. Keeping browser-saved setups.";
      render();
    }
  }

  async function refreshAssistantReadiness({ showStatus = false } = {}) {
    if (typeof controller?.fetchAssistantReadiness !== "function") {
      assistantReadinessStatusMessage =
        "The local safety check is unavailable here. You can still inspect the setup on this page.";
      render();
      return;
    }
    try {
      const payload = await controller.fetchAssistantReadiness({ artifactChecks: false });
      if (!isMounted) {
        return;
      }
      assistantReadiness = payload;
      assistantReadinessStatusMessage = "Safety check loaded.";
      render();
    } catch (error) {
      if (!isMounted) {
        return;
      }
      assistantReadiness = null;
      assistantReadinessStatusMessage =
        error?.message || "Could not load the safety check.";
      render();
    }
  }

  async function validateCurrentPlan() {
    const result = await validateStudyBuilderPlanText(controller, planText);
    preview = result.preview;
    statusMessage = result.statusMessage;
  }

  async function handleSubmit(event) {
    const recipeForm = event.target.closest("#settings-study-builder-recipe-form");
    if (recipeForm) {
      event.preventDefault();
      recipeName = root.querySelector("#settings-study-builder-recipe-name")?.value || "";
      planText = root.querySelector("#settings-study-builder-json")?.value || planText;
      try {
        const plan = parseStudyPlanJson(planText);
        const result = await saveStudyPlanRecipeWithFallback(controller, {
          name: recipeName,
          plan,
        });
        recipes = result.recipes;
        preview = result.preview || buildPreviewForPlan(result.recipe?.plan || plan);
        statusMessage = appendBackendFallbackNote(
          result.ok
            ? "Saved study stored."
            : "Only checked study setups can be saved.",
          result,
        );
      } catch (error) {
        const validationResult = await validateStudyBuilderPlanText({}, planText);
        preview = validationResult.preview;
        statusMessage = error?.message || "Could not save this study setup.";
      }
      render();
      return;
    }

    const routeForm = event.target.closest("#settings-study-builder-route-form");
    if (routeForm) {
      event.preventDefault();
      routeHashText = root.querySelector("#settings-study-builder-route")?.value || "";
      const result = await convertStudyBuilderRoute(controller, routeHashText);
      if (!isMounted) {
        return;
      }
      planText = result.planText;
      preview = result.preview;
      statusMessage = result.statusMessage;
      plannerResult = result.plannerResult;
      liveDraftResult = result.liveDraftResult;
      render();
      return;
    }

    const intentForm = event.target.closest("#settings-study-builder-intent-form");
    if (intentForm) {
      event.preventDefault();
      intentText = root.querySelector("#settings-study-builder-intent")?.value || "";
      const result = await draftStudyBuilderIntent(controller, intentText);
      if (!isMounted) {
        return;
      }
      plannerResult = result.plannerResult;
      liveDraftResult = result.liveDraftResult;
      planText = result.planText;
      preview = result.preview;
      statusMessage = result.statusMessage;
      render();
      return;
    }

    const form = event.target.closest("#settings-study-builder-form");
    if (!form) {
      return;
    }
    event.preventDefault();
    planText = root.querySelector("#settings-study-builder-json")?.value || "";
    liveDraftResult = null;
    await validateCurrentPlan();
    render();
  }

  async function handleClick(event) {
    if (event.target.closest("#settings-study-builder-live-draft")) {
      intentText = root.querySelector("#settings-study-builder-intent")?.value || "";
      plannerResult = null;
      liveDraftResult = null;
      statusMessage = "Asking AI to draft a study setup...";
      render();
      const result = await runLiveStudyBuilderDraft(controller, intentText);
      if (!isMounted) {
        return;
      }
      liveDraftResult = result.liveDraftResult;
      planText = result.planText || planText;
      preview = result.preview || preview;
      statusMessage = result.statusMessage;
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-intent-example")) {
      intentText = EXAMPLE_STUDY_INTENT;
      plannerResult = null;
      liveDraftResult = null;
      statusMessage = "Loaded an example research intent.";
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-route-example")) {
      routeHashText = EXAMPLE_STUDY_ROUTE_HASH;
      liveDraftResult = null;
      statusMessage = "Loaded an example study route hash.";
      render();
      return;
    }

    const loadRecipeButton = event.target.closest("[data-study-builder-load-recipe]");
    if (loadRecipeButton) {
      const recipeId = loadRecipeButton.getAttribute("data-study-builder-load-recipe");
      const recipe = recipes.find((item) => item.id === recipeId);
      if (recipe) {
        planText = formatStudyPlanJson(recipe.plan);
        preview = buildPreviewForPlan(recipe.plan);
        recipeName = recipe.name;
        plannerResult = null;
        liveDraftResult = null;
        statusMessage = "Loaded saved study.";
        render();
      }
      return;
    }

    const refreshSavedStudyButton = event.target.closest("[data-study-builder-refresh-saved-study]");
    if (refreshSavedStudyButton) {
      const recipeId = refreshSavedStudyButton.getAttribute("data-study-builder-refresh-saved-study");
      statusMessage = "Refreshing saved-study readiness...";
      render();
      const result = await refreshSavedStudyReadinessWithFallback(controller, { recipeId });
      if (!isMounted) {
        return;
      }
      if (Array.isArray(result.recipes)) {
        recipes = result.recipes;
      } else if (Array.isArray(result.savedStudies)) {
        recipes = result.savedStudies.map((savedStudy) => ({
          ...savedStudy,
          id: savedStudy.id,
          plan: savedStudy.plan,
          savedStudy,
          readiness: savedStudy.readiness,
          dependencies: savedStudy.dependencies || [],
        }));
      }
      statusMessage = appendBackendFallbackNote(
        result.ok ? "Saved-study readiness refreshed." : result.statusMessage || "Saved-study readiness was not refreshed.",
        result,
      );
      render();
      return;
    }

    const deleteRecipeButton = event.target.closest("[data-study-builder-delete-recipe]");
    if (deleteRecipeButton) {
      const recipeId = deleteRecipeButton.getAttribute("data-study-builder-delete-recipe");
      const result = await deleteStudyPlanRecipeWithFallback(controller, { recipeId });
      if (!isMounted) {
        return;
      }
      recipes = result.recipes;
      statusMessage = appendBackendFallbackNote("Saved study archived.", result);
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-refresh-readiness")) {
      assistantReadinessStatusMessage = "Checking again...";
      render();
      await refreshAssistantReadiness({ showStatus: true });
      return;
    }

    if (event.target.closest("#settings-study-builder-example")) {
      planText = formatStudyPlanJson(EXAMPLE_STUDY_PLAN);
      preview = null;
      liveDraftResult = null;
      statusMessage = "Loaded an example study setup.";
      render();
      return;
    }

    if (event.target.closest("#settings-study-builder-clear")) {
      planText = "";
      preview = null;
      liveDraftResult = null;
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
