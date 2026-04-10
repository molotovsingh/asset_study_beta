import { studyRegistry, getStudyById } from "./studies/registry.js";
import {
  getActiveSubjectQuery,
  setActiveSubjectQuery,
  subscribeActiveSubject,
} from "./studies/shared/activeSubject.js";
import {
  getRecentRuns,
  subscribeRunHistory,
} from "./studies/shared/runHistory.js";
import {
  buildStudyViewHash,
  getDefaultStudyViewId,
  getStudyViews,
  getStudyViewById,
  parseStudyViewHash,
  renderStudyShell,
} from "./studies/studyShell.js";

const studySelect = document.querySelector("#study-select");
const studyMeta = document.querySelector("#study-meta");
const studyRoot = document.querySelector("#study-root");
const runHistoryRoot = document.querySelector("#run-history");
const activeSubjectForm = document.querySelector("#active-subject-form");
const activeSubjectInput = document.querySelector("#active-subject-input");

let unmountCurrentStudy = null;

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (match) => HTML_ESCAPE_MAP[match]);
}

function buildCapabilityPills(study) {
  const studyViews = getStudyViews(study);
  const pills = [];
  const readyViews = studyViews.filter((view) => view.status === "ready");
  const plannedViews = studyViews.filter((view) => view.status !== "ready");

  if (readyViews.length) {
    pills.push(
      ...readyViews.map((view) => ({
        label: view.label,
        tone: "ready",
      })),
    );
  }

  if (plannedViews.length) {
    pills.push(
      ...plannedViews.map((view) => ({
        label: `${view.label} ${view.status}`,
        tone: "planned",
      })),
    );
  }

  if (study.capabilities?.exports?.length) {
    pills.push({
      label: `Exports ${study.capabilities.exports
        .map((format) => format.toUpperCase())
        .join(" / ")}`,
      tone: "default",
    });
  }

  return pills;
}

function renderStudyMeta(study, activeView) {
  const capabilityPills = buildCapabilityPills(study);

  studyMeta.innerHTML = `
    <div class="meta-row">
      <p class="meta-label">Summary</p>
      <p>${study.description}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Inputs</p>
      <p>${study.inputSummary}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Current View</p>
      <p>${activeView.summary || activeView.description || activeView.label}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Supports</p>
      <div class="meta-pill-row">
        ${capabilityPills
          .map(
            (pill) => `
              <span class="meta-pill ${pill.tone}">${pill.label}</span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderActiveSubjectControl() {
  activeSubjectInput.value = getActiveSubjectQuery();
}

function applyActiveSubjectFromSidebar() {
  const nextSubject = activeSubjectInput.value.trim();
  if (!nextSubject) {
    activeSubjectInput.value = getActiveSubjectQuery();
    return;
  }

  setActiveSubjectQuery(nextSubject);

  const route = parseRouteHash();
  const study = getStudyById(route.studyId) || studyRegistry[0] || null;
  if (!study) {
    return;
  }

  const activeView = getStudyViewById(
    study,
    route.viewId || getDefaultStudyViewId(study),
  );
  const nextParams = new URLSearchParams(route.params);
  nextParams.set("subject", nextSubject);
  const targetHash = buildStudyViewHash(study.id, activeView.id, nextParams);

  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountStudyRoute();
}

function parseRouteHash() {
  return parseStudyViewHash();
}

function formatHistoryTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderRunHistory() {
  const runs = getRecentRuns();
  if (!runs.length) {
    runHistoryRoot.innerHTML = `
      <p class="summary-meta">Completed studies will appear here.</p>
    `;
    return;
  }

  runHistoryRoot.innerHTML = `
    <div class="run-history-list">
      ${runs
        .map(
          (run) => `
            <button class="run-history-item" type="button" data-run-id="${escapeHtml(run.id)}">
              <span class="run-history-main">${escapeHtml(run.selectionLabel)}</span>
              <span class="run-history-meta">${escapeHtml(run.studyTitle)} · ${escapeHtml(formatHistoryTimestamp(run.completedAt))}</span>
              ${
                run.requestedStartDate && run.requestedEndDate
                  ? `<span class="run-history-meta">${escapeHtml(run.requestedStartDate)} to ${escapeHtml(run.requestedEndDate)}</span>`
                  : ""
              }
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function handleRunHistoryClick(event) {
  const trigger = event.target.closest("[data-run-id]");
  if (!trigger) {
    return;
  }

  const run = getRecentRuns().find((entry) => entry.id === trigger.dataset.runId);
  if (!run) {
    return;
  }

  setActiveSubjectQuery(run.subjectQuery);
  const targetHash = buildStudyViewHash(run.studyId, "overview", {
    subject: run.subjectQuery,
    start: run.requestedStartDate,
    end: run.requestedEndDate,
  });
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountStudyRoute();
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyCurrentStudyLink(trigger) {
  const originalText = trigger.textContent.trim() || "Copy Link";
  try {
    await writeClipboardText(window.location.href);
    trigger.textContent = "Copied";
    trigger.classList.add("is-copied");
  } catch (error) {
    trigger.textContent = "Copy failed";
  } finally {
    window.setTimeout(() => {
      trigger.textContent = originalText;
      trigger.classList.remove("is-copied");
    }, 1400);
  }
}

function handleStudyRootClick(event) {
  const copyLinkTrigger = event.target.closest("#copy-study-link");
  if (!copyLinkTrigger) {
    return;
  }

  copyCurrentStudyLink(copyLinkTrigger);
}

function mountStudyRoute() {
  const route = parseRouteHash();
  const study = getStudyById(route.studyId) || studyRegistry[0] || null;

  if (!study) {
    studyRoot.innerHTML = `<div class="empty-state">Study not found.</div>`;
    return;
  }

  const activeView = getStudyViewById(
    study,
    route.viewId || getDefaultStudyViewId(study),
  );
  const targetHash = buildStudyViewHash(study.id, activeView.id, route.params);

  if (route.studyId !== study.id || route.viewId !== activeView.id) {
    window.history.replaceState(null, "", targetHash);
  }

  if (typeof unmountCurrentStudy === "function") {
    unmountCurrentStudy();
  }

  studySelect.value = study.id;
  renderStudyMeta(study, activeView);
  studyRoot.innerHTML = renderStudyShell(study, activeView.id, route.params);

  const viewRoot = studyRoot.querySelector("#study-view-root");
  unmountCurrentStudy = activeView.mount(viewRoot);
}

function populateStudySelect() {
  studySelect.innerHTML = studyRegistry
    .map(
      (study) =>
        `<option value="${study.id}">${study.title}</option>`,
    )
    .join("");
}

studySelect.addEventListener("change", (event) => {
  const study = getStudyById(event.target.value);
  if (!study) {
    return;
  }

  const targetHash = buildStudyViewHash(study.id, getDefaultStudyViewId(study), {
    subject: getActiveSubjectQuery(),
  });
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountStudyRoute();
});
runHistoryRoot.addEventListener("click", handleRunHistoryClick);
studyRoot.addEventListener("click", handleStudyRootClick);
activeSubjectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applyActiveSubjectFromSidebar();
});
activeSubjectInput.addEventListener("change", () => {
  applyActiveSubjectFromSidebar();
});

window.addEventListener("hashchange", mountStudyRoute);
subscribeActiveSubject(() => {
  renderActiveSubjectControl();
  const route = parseRouteHash();
  const study = getStudyById(route.studyId) || studyRegistry[0] || null;
  if (!study) {
    return;
  }

  const activeView = getStudyViewById(
    study,
    route.viewId || getDefaultStudyViewId(study),
  );
  renderStudyMeta(study, activeView);
});
subscribeRunHistory(renderRunHistory);

populateStudySelect();
renderActiveSubjectControl();
renderRunHistory();
mountStudyRoute();
