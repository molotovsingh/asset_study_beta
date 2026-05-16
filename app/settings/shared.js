import { buildSettingsRouteHash } from "../appRoute.js";

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (match) => HTML_ESCAPE_MAP[match]);
}

function formatSettingsTimestamp(value) {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderSettingsSectionNav(activeSection) {
  return `
    <nav class="study-view-nav settings-view-nav" aria-label="Settings sections">
      <a class="study-view-link${activeSection === "automations" ? " is-active" : ""}" href="${buildSettingsRouteHash("automations")}">Automations</a>
      <a class="study-view-link${activeSection === "history" ? " is-active" : ""}" href="${buildSettingsRouteHash("history")}">Run History</a>
      <a class="study-view-link${activeSection === "study-builder" ? " is-active" : ""}" href="${buildSettingsRouteHash("study-builder")}">Study Builder</a>
    </nav>
  `;
}

export { escapeHtml, formatSettingsTimestamp, renderSettingsSectionNav };
