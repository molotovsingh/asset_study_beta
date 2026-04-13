import {
  DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  getOptionsScreenerUniverseById,
  optionsScreenerUniverseCatalog,
} from "../catalog/optionsScreenerCatalog.js";
import {
  DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
  DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS,
  buildOptionsValidationStudyRun,
  normalizeGroupKey,
  normalizeHorizonDays,
} from "../lib/optionsValidation.js";
import {
  exportOptionsValidationCsv,
  exportOptionsValidationXls,
} from "../lib/optionsValidationExport.js";
import { fetchOptionsValidation } from "../lib/syncedData.js";
import { createExportClickHandler } from "./shared/exportClickHandler.js";
import {
  getCurrentRouteParams,
  readTextParam,
  replaceRouteInputParams,
} from "./shared/shareableInputs.js";
import {
  optionsValidationTemplate,
  renderOptionsValidationResults,
} from "./optionsValidationView.js";
import { renderOptionsValidationVisuals } from "./optionsValidationVisuals.js";

const optionsValidationSession = {
  universeId: DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID,
  groupKey: DEFAULT_OPTIONS_VALIDATION_GROUP_KEY,
  horizonDaysValue: String(DEFAULT_OPTIONS_VALIDATION_HORIZON_DAYS),
  lastStudyRun: null,
  lastRunSignature: "",
};

function buildRunSignature(session) {
  return [session.universeId, session.groupKey, session.horizonDaysValue].join("|");
}

function normalizeUniverseId(value) {
  return (
    getOptionsScreenerUniverseById(value)?.id ||
    DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID
  );
}

function applyRouteParams() {
  const params = getCurrentRouteParams();
  const nextUniverseId = normalizeUniverseId(readTextParam(params, "u"));
  const nextGroupKey = normalizeGroupKey(readTextParam(params, "group"));
  const nextHorizonDays = String(normalizeHorizonDays(readTextParam(params, "h")));
  let changed = false;

  if (optionsValidationSession.universeId !== nextUniverseId) {
    optionsValidationSession.universeId = nextUniverseId;
    changed = true;
  }

  if (optionsValidationSession.groupKey !== nextGroupKey) {
    optionsValidationSession.groupKey = nextGroupKey;
    changed = true;
  }

  if (optionsValidationSession.horizonDaysValue !== nextHorizonDays) {
    optionsValidationSession.horizonDaysValue = nextHorizonDays;
    changed = true;
  }

  if (
    changed &&
    optionsValidationSession.lastRunSignature !==
      buildRunSignature(optionsValidationSession)
  ) {
    optionsValidationSession.lastStudyRun = null;
  }
}

function replaceOptionsValidationRouteParams(viewId = "overview") {
  replaceRouteInputParams(optionsValidationStudy.id, viewId, {
    u: optionsValidationSession.universeId,
    group: optionsValidationSession.groupKey,
    h: optionsValidationSession.horizonDaysValue,
  });
}

function mountOptionsValidationView(root, { viewId = "overview", renderResults, loadingCopy }) {
  applyRouteParams();
  const universe =
    getOptionsScreenerUniverseById(optionsValidationSession.universeId) ||
    getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
  if (!universe) {
    throw new Error("Options validation universe catalog is unavailable.");
  }

  root.innerHTML = optionsValidationTemplate({
    universeCatalog: optionsScreenerUniverseCatalog,
    universeId: universe.id,
    groupKey: optionsValidationSession.groupKey,
    horizonDaysValue: optionsValidationSession.horizonDaysValue,
  });

  const form = root.querySelector("#options-validation-form");
  const universeSelect = root.querySelector("#options-validation-universe");
  const groupSelect = root.querySelector("#options-validation-group");
  const horizonSelect = root.querySelector("#options-validation-horizon");
  const statusEl = root.querySelector("#options-validation-status");
  const resultsRoot = root.querySelector("#options-validation-results-root");

  function setStatus(message, state = "info") {
    statusEl.className = `status ${state}`;
    statusEl.textContent = message;
  }

  const handleExportClick = createExportClickHandler({
    triggerSelector: "[data-options-validation-export]",
    datasetKey: "optionsValidationExport",
    getPayload: () => optionsValidationSession.lastStudyRun,
    exporters: {
      csv: exportOptionsValidationCsv,
      xls: exportOptionsValidationXls,
    },
    setStatus,
    missingPayloadMessage: "Load validation before exporting.",
  });

  function persistFormState() {
    optionsValidationSession.universeId = normalizeUniverseId(universeSelect.value);
    optionsValidationSession.groupKey = normalizeGroupKey(groupSelect.value);
    optionsValidationSession.horizonDaysValue = String(
      normalizeHorizonDays(horizonSelect.value),
    );
    replaceOptionsValidationRouteParams(viewId);
  }

  function maybeRenderExistingRun() {
    if (
      optionsValidationSession.lastStudyRun &&
      optionsValidationSession.lastRunSignature ===
        buildRunSignature(optionsValidationSession)
    ) {
      resultsRoot.innerHTML = renderResults(optionsValidationSession.lastStudyRun);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    persistFormState();

    try {
      const currentUniverse =
        getOptionsScreenerUniverseById(optionsValidationSession.universeId) ||
        getOptionsScreenerUniverseById(DEFAULT_OPTIONS_SCREENER_UNIVERSE_ID);
      const horizonDays = normalizeHorizonDays(
        optionsValidationSession.horizonDaysValue,
      );
      setStatus(
        `Loading ${currentUniverse.label} validation for ${horizonDays} trading days...`,
        "info",
      );
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${loadingCopy(currentUniverse, horizonDays)}
        </div>
      `;

      const payload = await fetchOptionsValidation({
        universeId: currentUniverse.id,
        horizonDays,
        limitRuns: 120,
        rowLimit: 50,
      });
      const studyRun = buildOptionsValidationStudyRun({
        universe: currentUniverse,
        validationPayload: payload,
        groupKey: optionsValidationSession.groupKey,
        horizonDays,
      });

      optionsValidationSession.lastStudyRun = studyRun;
      optionsValidationSession.lastRunSignature = buildRunSignature(
        optionsValidationSession,
      );
      resultsRoot.innerHTML = renderResults(studyRun);
      setStatus("Options validation loaded.", "success");
    } catch (error) {
      optionsValidationSession.lastStudyRun = null;
      resultsRoot.innerHTML = `
        <div class="empty-state">
          ${error.message}
        </div>
      `;
      setStatus(error.message, "error");
    }
  }

  function handleFieldChange() {
    const previousSignature = buildRunSignature(optionsValidationSession);
    persistFormState();
    if (previousSignature !== buildRunSignature(optionsValidationSession)) {
      optionsValidationSession.lastStudyRun = null;
    }
    setStatus("Inputs updated. Load validation to refresh outcomes.", "info");
  }

  maybeRenderExistingRun();

  form.addEventListener("submit", handleSubmit);
  universeSelect.addEventListener("change", handleFieldChange);
  groupSelect.addEventListener("change", handleFieldChange);
  horizonSelect.addEventListener("change", handleFieldChange);
  resultsRoot.addEventListener("click", handleExportClick);

  return () => {
    form.removeEventListener("submit", handleSubmit);
    universeSelect.removeEventListener("change", handleFieldChange);
    groupSelect.removeEventListener("change", handleFieldChange);
    horizonSelect.removeEventListener("change", handleFieldChange);
    resultsRoot.removeEventListener("click", handleExportClick);
  };
}

function mountOptionsValidationOverview(root) {
  return mountOptionsValidationView(root, {
    viewId: "overview",
    renderResults: renderOptionsValidationResults,
    loadingCopy: (universe) =>
      `Loading archived screener outcomes for ${universe.label}...`,
  });
}

function mountOptionsValidationVisuals(root) {
  return mountOptionsValidationView(root, {
    viewId: "visuals",
    renderResults: renderOptionsValidationVisuals,
    loadingCopy: (universe, horizonDays) =>
      `Loading ${universe.label} validation visuals for ${horizonDays} trading days...`,
  });
}

const optionsValidationStudy = {
  id: "options-validation",
  title: "Options Validation",
  description:
    "Archived screener rows grouped by pricing, candidate, or direction buckets and measured against forward underlying outcomes.",
  inputSummary:
    "Universe preset, grouping bucket, and forward trading-day horizon.",
  capabilities: {
    exports: ["csv", "xls"],
  },
  views: [
    {
      id: "overview",
      label: "Overview",
      summary:
        "Grouped forward outcomes from archived screener rows for the selected universe and horizon.",
      description:
        "Use the local screener archive to see which evidence buckets have actually worked in the underlying.",
      status: "ready",
      default: true,
      mount: mountOptionsValidationOverview,
    },
    {
      id: "visuals",
      label: "Visuals",
      summary:
        "Grouped forward-return bars, win-rate context, and return-versus-move maps from archived screener rows.",
      description:
        "Use the archive to see how validation buckets have behaved visually before drilling into the grouped tables.",
      status: "ready",
      mount: mountOptionsValidationVisuals,
    },
  ],
};

export { optionsValidationStudy };
