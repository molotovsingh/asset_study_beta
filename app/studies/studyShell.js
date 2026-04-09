function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getStudyViews(study) {
  if (study?.views?.length) {
    return study.views;
  }

  if (typeof study?.mount === "function") {
    return [
      {
        id: "overview",
        label: "Overview",
        summary: study.description || study.title || "Study overview.",
        description: study.description || study.title || "Study overview.",
        status: "ready",
        default: true,
        mount: study.mount,
      },
    ];
  }

  return [];
}

function getDefaultStudyViewId(study) {
  const views = getStudyViews(study);
  if (!views.length) {
    return "";
  }

  return views.find((view) => view.default)?.id || views[0].id;
}

function getStudyViewById(study, viewId) {
  const views = getStudyViews(study);
  if (!views.length) {
    return null;
  }

  return (
    views.find((view) => view.id === viewId) ||
    views.find((view) => view.default) ||
    views[0]
  );
}

function buildStudyViewHash(studyId, viewId) {
  return `#${studyId}/${viewId}`;
}

function renderStudyShell(study, activeViewId) {
  const views = getStudyViews(study);

  return `
    <div class="study-view-shell">
      <nav class="study-view-nav" aria-label="Study views">
        ${views
          .map((view) => {
            const isActive = view.id === activeViewId;
            const statusLabel =
              view.status && view.status !== "ready"
                ? `<span class="study-view-state">${capitalize(view.status)}</span>`
                : "";

            return `
              <a
                class="study-view-link${isActive ? " is-active" : ""}"
                href="${buildStudyViewHash(study.id, view.id)}"
                ${isActive ? 'aria-current="page"' : ""}
              >
                <span>${view.label}</span>
                ${statusLabel}
              </a>
            `;
          })
          .join("")}
      </nav>
      <div id="study-view-root" class="study-view-root"></div>
    </div>
  `;
}

function createPlaceholderView({
  id,
  label,
  description,
  summary,
  bullets = [],
  status = "planned",
}) {
  return {
    id,
    label,
    summary,
    description,
    status,
    mount(root) {
      root.innerHTML = `
        <section class="card study-placeholder">
          <p class="study-kicker">Planned View</p>
          <h2>${label}</h2>
          <p class="summary-meta">${description}</p>
          ${
            bullets.length
              ? `
                <div class="study-placeholder-grid">
                  ${bullets
                    .map(
                      (bullet) => `
                        <div class="study-placeholder-card">
                          <p class="meta-label">${bullet.label}</p>
                          <p>${bullet.copy}</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </section>
      `;

      return () => {};
    },
  };
}

export {
  buildStudyViewHash,
  createPlaceholderView,
  getDefaultStudyViewId,
  getStudyViews,
  getStudyViewById,
  renderStudyShell,
};
