import { studyRegistry, getStudyById } from "./studies/registry.js";
import {
  getActiveSubjectQuery,
  subscribeActiveSubject,
} from "./studies/shared/activeSubject.js";
import {
  buildStudyViewHash,
  getDefaultStudyViewId,
  getStudyViews,
  getStudyViewById,
  renderStudyShell,
} from "./studies/studyShell.js";

const studySelect = document.querySelector("#study-select");
const studyMeta = document.querySelector("#study-meta");
const studyRoot = document.querySelector("#study-root");

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
  const activeSubjectQuery = getActiveSubjectQuery();

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
      <p class="meta-label">Active Subject</p>
      <p><span class="mono">${escapeHtml(activeSubjectQuery)}</span></p>
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

function parseRouteHash() {
  const [studyId = "", viewId = ""] = window.location.hash
    .replace(/^#/, "")
    .split("/");
  return { studyId, viewId };
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
  const targetHash = buildStudyViewHash(study.id, activeView.id);

  if (window.location.hash !== targetHash) {
    window.history.replaceState(null, "", targetHash);
  }

  if (typeof unmountCurrentStudy === "function") {
    unmountCurrentStudy();
  }

  studySelect.value = study.id;
  renderStudyMeta(study, activeView);
  studyRoot.innerHTML = renderStudyShell(study, activeView.id);

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

  const targetHash = buildStudyViewHash(study.id, getDefaultStudyViewId(study));
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    return;
  }

  mountStudyRoute();
});

window.addEventListener("hashchange", mountStudyRoute);
subscribeActiveSubject(() => {
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

populateStudySelect();
mountStudyRoute();
