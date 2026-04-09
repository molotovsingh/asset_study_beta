import { studyRegistry, getStudyById } from "./studies/registry.js";

const studySelect = document.querySelector("#study-select");
const studyMeta = document.querySelector("#study-meta");
const studyRoot = document.querySelector("#study-root");

let unmountCurrentStudy = null;

function renderStudyMeta(study) {
  studyMeta.innerHTML = `
    <div class="meta-row">
      <p class="meta-label">Summary</p>
      <p>${study.description}</p>
    </div>
    <div class="meta-row">
      <p class="meta-label">Inputs</p>
      <p>${study.inputSummary}</p>
    </div>
  `;
}

function mountStudy(studyId) {
  const study = getStudyById(studyId);
  if (!study) {
    studyRoot.innerHTML = `<div class="empty-state">Study not found.</div>`;
    return;
  }

  if (typeof unmountCurrentStudy === "function") {
    unmountCurrentStudy();
  }

  renderStudyMeta(study);
  unmountCurrentStudy = study.mount(studyRoot);
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
  mountStudy(event.target.value);
});

populateStudySelect();
mountStudy(studyRegistry[0]?.id);
