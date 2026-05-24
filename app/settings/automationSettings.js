import { escapeHtml, formatSettingsTimestamp, renderSettingsSectionNav } from "./shared.js";

function normalizeAutomationCsvList(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseOptionalIntegerValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumberValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function describeAutomationStatus(automation) {
  const lastStatus = automation?.isRunning
    ? "running"
    : automation?.lastRunStatus
      ? String(automation.lastRunStatus).trim().toLowerCase()
      : automation?.isActive
        ? "scheduled"
        : "paused";
  const tone =
    lastStatus === "ok"
      ? "ok"
      : lastStatus === "running"
        ? "running"
        : lastStatus === "attention"
          ? "attention"
          : lastStatus === "scheduled"
            ? "ok"
            : "inactive";
  return {
    lastStatus,
    tone,
  };
}

function buildAutomationCatalogCopy(automationState) {
  const marketUniverses = automationState?.catalogs?.marketUniverses || [];
  const optionsUniverses = automationState?.catalogs?.optionsUniverses || [];
  const fundamentalUniverses = automationState?.catalogs?.fundamentalUniverses || [];
  return [
    marketUniverses.length
      ? `Market: ${marketUniverses
          .map((entry) => `${entry.universeId} (${entry.activeMembers ?? 0})`)
          .join(", ")}`
      : "Market: no local universes stored yet.",
    optionsUniverses.length
      ? `Options: ${optionsUniverses.map((entry) => entry.universeId).join(", ")}`
      : "Options: no configured collector universes.",
    fundamentalUniverses.length
      ? `Fundamentals: ${fundamentalUniverses
          .map((entry) => `${entry.universeId} (${entry.activeMembers ?? entry.memberCount ?? "unseeded"})`)
          .join(", ")}`
      : "Fundamentals: no configured universes.",
  ].join("\n");
}

function resolveFormTemplate(automationState, selectedAutomationId) {
  const automations = automationState?.automations || [];
  if (selectedAutomationId) {
    const current = automations.find(
      (entry) => entry.automationId === String(selectedAutomationId).trim(),
    );
    if (current) {
      return current;
    }
  }
  return automationState?.defaults || {};
}

function renderRuntimeHealthSummary(automationRuntimeHealth, { compact = false } = {}) {
  if (!automationRuntimeHealth?.summary) {
    return `
      <p class="summary-meta">Runtime health will appear here once the local API responds.</p>
    `;
  }

  const summary = automationRuntimeHealth.summary;
  const registrySummary = automationRuntimeHealth.instrumentRegistry?.summary || {};
  const topIssues = automationRuntimeHealth.attentionSymbols?.length
    ? automationRuntimeHealth.attentionSymbols
        .slice(0, compact ? 2 : 5)
        .map((entry) => `${entry.symbol} (${entry.issue})`)
        .join(", ")
    : "";

  return `
    <div class="automation-runtime-health-card${compact ? " is-compact" : ""}">
      <div class="automation-panel-head">
        <p class="meta-label">Runtime Health</p>
        <div class="automation-pill-row">
          <span class="automation-pill ${summary.attentionSymbolCount ? "attention" : "ok"}">
            ${summary.attentionSymbolCount ? "Attention" : "Healthy"}
          </span>
        </div>
      </div>
      <div class="automation-runtime-health-grid">
        <div class="automation-health-metric">
          <span class="automation-health-value">${escapeHtml(summary.totalSymbols || 0)}</span>
          <span class="summary-meta">Symbols tracked</span>
        </div>
        <div class="automation-health-metric">
          <span class="automation-health-value">${escapeHtml(summary.attentionSymbolCount || 0)}</span>
          <span class="summary-meta">Need attention</span>
        </div>
        <div class="automation-health-metric">
          <span class="automation-health-value">${escapeHtml(summary.syncErrorCount || 0)}</span>
          <span class="summary-meta">Sync errors</span>
        </div>
        <div class="automation-health-metric">
          <span class="automation-health-value">${escapeHtml(summary.totalCollectionRuns || 0)}</span>
          <span class="summary-meta">Market runs</span>
        </div>
        <div class="automation-health-metric">
          <span class="automation-health-value">${escapeHtml(summary.totalFundamentalSnapshots || 0)}</span>
          <span class="summary-meta">Fundamental snapshots</span>
        </div>
        <div class="automation-health-metric">
          <span class="automation-health-value">${escapeHtml(registrySummary.totalInstruments || 0)}</span>
          <span class="summary-meta">Registry instruments</span>
        </div>
      </div>
      ${
        topIssues
          ? `<p class="summary-meta">Top issues: ${escapeHtml(topIssues)}</p>`
          : `<p class="summary-meta">No attention symbols in the current health snapshot.</p>`
      }
    </div>
  `;
}

function renderRuntimeHealthDetail(automationRuntimeHealth) {
  const universeHealth = automationRuntimeHealth?.universeHealth || [];
  const attentionSymbols = automationRuntimeHealth?.attentionSymbols || [];
  const recentFundamentalRuns = automationRuntimeHealth?.recentFundamentalCollectionRuns || [];
  const instrumentRegistry = automationRuntimeHealth?.instrumentRegistry || null;

  return `
    <section class="card settings-card">
      <div class="settings-card-head">
        <div>
          <p class="meta-label">Runtime Health</p>
          <h3 class="settings-card-title">System visibility</h3>
        </div>
      </div>
      ${renderRuntimeHealthSummary(automationRuntimeHealth)}
      <div class="settings-detail-grid">
        <div class="settings-detail-column">
          <p class="meta-label">Attention Symbols</p>
          ${
            attentionSymbols.length
              ? `
                <div class="settings-detail-list">
                  ${attentionSymbols
                    .slice(0, 8)
                    .map(
                      (entry) => `
                        <div class="settings-detail-item">
                          <p class="settings-detail-title">${escapeHtml(entry.symbol)}</p>
                          <p class="automation-item-meta">${escapeHtml(entry.issue)} · ${escapeHtml(entry.historyEndDate || "unknown end date")}</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<p class="summary-meta">No attention symbols in the current snapshot.</p>`
          }
        </div>
        <div class="settings-detail-column">
          <p class="meta-label">Universe Health</p>
          ${
            universeHealth.length
              ? `
                <div class="settings-detail-list">
                  ${universeHealth
                    .slice(0, 6)
                    .map(
                      (entry) => `
                        <div class="settings-detail-item">
                          <p class="settings-detail-title">${escapeHtml(entry.label || entry.universeId)}</p>
                          <p class="automation-item-meta">${escapeHtml(entry.universeId)} · ${escapeHtml(entry.selectionKind || "manual")}</p>
                          <p class="automation-item-meta">${
                            entry.latestRun
                              ? `Last run ${escapeHtml(formatSettingsTimestamp(entry.latestRun.completedAt))} · ${escapeHtml(entry.latestRun.successCount || 0)} ok / ${escapeHtml(entry.latestRun.failureCount || 0)} failed`
                              : "No collection run recorded yet."
                          }</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<p class="summary-meta">No stored universe health yet.</p>`
          }
        </div>
        <div class="settings-detail-column">
          <p class="meta-label">Instrument Registry</p>
          ${
            instrumentRegistry?.summary
              ? `
                <div class="settings-detail-list">
                  <div class="settings-detail-item">
                    <p class="settings-detail-title">${escapeHtml(instrumentRegistry.summary.totalInstruments || 0)} instruments</p>
                    <p class="automation-item-meta">${escapeHtml(instrumentRegistry.summary.verifiedMappings || 0)} verified mappings · ${escapeHtml(instrumentRegistry.summary.unverifiedInstruments || 0)} unverified or legacy</p>
                    <p class="automation-item-meta">Providers: ${escapeHtml(Object.keys(instrumentRegistry.byProvider || {}).join(", ") || "none")}</p>
                  </div>
                </div>
              `
              : `<p class="summary-meta">No registry health snapshot yet.</p>`
          }
        </div>
        <div class="settings-detail-column">
          <p class="meta-label">Fundamental Runs</p>
          ${
            recentFundamentalRuns.length
              ? `
                <div class="settings-detail-list">
                  ${recentFundamentalRuns
                    .slice(0, 6)
                    .map(
                      (entry) => `
                        <div class="settings-detail-item">
                          <p class="settings-detail-title">${escapeHtml(entry.universeLabel || entry.universeId)}</p>
                          <p class="automation-item-meta">${escapeHtml(entry.provider || "provider")} · ${escapeHtml(entry.successCount || 0)} ok / ${escapeHtml(entry.failureCount || 0)} failed</p>
                          <p class="automation-item-meta">${escapeHtml(formatSettingsTimestamp(entry.completedAt))}</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<p class="summary-meta">No fundamental collection run recorded yet.</p>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderAutomationList(automationState) {
  const automations = automationState?.automations || [];
  if (!automations.length) {
    return `<p class="summary-meta">No saved automations yet. Save one from the form above.</p>`;
  }

  return automations
    .map((automation) => {
      const { lastStatus, tone } = describeAutomationStatus(automation);
      const summary = [
        `Interval ${automation.intervalMinutes}m`,
        automation.runMarketCollection
          ? `Market ${automation.marketUniverseIds?.join(", ") || "all local universes"}`
          : null,
        automation.runOptionsCollection
          ? `Options ${automation.optionsUniverseIds?.join(", ") || "all configured universes"}`
          : null,
        automation.runFundamentalCollection
          ? `Fundamentals ${automation.fundamentalUniverseIds?.join(", ") || "built-in universes"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <div class="automation-item">
          <div class="automation-item-head">
            <div>
              <p class="automation-item-title">${escapeHtml(automation.label || automation.automationId)}</p>
              <p class="automation-item-meta">${escapeHtml(automation.automationId)}</p>
            </div>
            <div class="automation-pill-row">
              <span class="automation-pill ${tone}">${escapeHtml(lastStatus)}</span>
              ${
                automation.isActive || lastStatus === "paused"
                  ? ""
                  : `<span class="automation-pill inactive">paused</span>`
              }
            </div>
          </div>
          <p class="automation-item-copy">${escapeHtml(summary)}</p>
          <p class="automation-item-meta">${
            automation.lastRunCompletedAt
              ? `Last run ${escapeHtml(formatSettingsTimestamp(automation.lastRunCompletedAt))}`
              : "Never run yet."
          }</p>
          ${
            automation.lastRunError
              ? `<p class="automation-item-meta">Last error: ${escapeHtml(automation.lastRunError)}</p>`
              : ""
          }
          <div class="automation-item-actions">
            <button class="button ghost" type="button" data-automation-edit="${escapeHtml(automation.automationId)}">Edit</button>
            <button class="button ghost" type="button" data-automation-run="${escapeHtml(automation.automationId)}">Run Now</button>
            <button class="button ghost" type="button" data-automation-delete="${escapeHtml(automation.automationId)}">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAutomationSettingsPage({
  automationState,
  automationRuntimeHealth,
  statusMessage = "",
  selectedAutomationId = "",
}) {
  const template = resolveFormTemplate(automationState, selectedAutomationId);
  const catalogCopy = buildAutomationCatalogCopy(automationState);
  const maxAttentionValue =
    template.maxAttentionSymbols !== undefined &&
    template.maxAttentionSymbols !== null &&
    template.maxAttentionSymbols !== ""
      ? String(template.maxAttentionSymbols)
      : "";
  const maxSyncErrorsValue =
    template.maxSyncErrors !== undefined &&
    template.maxSyncErrors !== null &&
    template.maxSyncErrors !== ""
      ? String(template.maxSyncErrors)
      : "";
  const isActiveChecked = Boolean(template.isActive ?? true);
  const runMarketChecked = Boolean(template.runMarketCollection ?? true);
  const runOptionsChecked = Boolean(template.runOptionsCollection ?? true);
  const runFundamentalsChecked = Boolean(template.runFundamentalCollection ?? false);
  const seedFundamentalsChecked = Boolean(template.seedFundamentalUniverses ?? true);
  const refreshMastersChecked = Boolean(template.refreshExchangeSymbolMasters ?? false);
  const fundamentalPeriodValue =
    template.fundamentalPeriodDays !== undefined &&
    template.fundamentalPeriodDays !== null &&
    template.fundamentalPeriodDays !== ""
      ? String(template.fundamentalPeriodDays)
      : "366";
  const fundamentalLimitValue =
    template.fundamentalLimit !== undefined &&
    template.fundamentalLimit !== null &&
    template.fundamentalLimit !== ""
      ? String(template.fundamentalLimit)
      : "";
  const fundamentalDelayValue =
    template.fundamentalDelaySeconds !== undefined &&
    template.fundamentalDelaySeconds !== null &&
    template.fundamentalDelaySeconds !== ""
      ? String(template.fundamentalDelaySeconds)
      : "0";

  return `
    <section class="settings-shell">
      <div class="study-view-toolbar settings-toolbar">
        <div>
          <p class="eyebrow">App Settings</p>
          <h2 class="settings-title">Automations</h2>
          <p class="summary-meta settings-copy">Manage local maintenance runs and inspect runtime health without leaving the app.</p>
        </div>
      </div>

      ${renderSettingsSectionNav("automations")}

      <p class="summary-meta settings-status" aria-live="polite">${escapeHtml(statusMessage)}</p>

      <div class="settings-grid">
        ${renderRuntimeHealthDetail(automationRuntimeHealth)}
        <section class="card settings-card">
          <div class="settings-card-head">
            <div>
              <p class="meta-label">Automation Editor</p>
              <h3 class="settings-card-title">Data maintenance</h3>
            </div>
            <button id="settings-automation-refresh" class="button ghost automation-refresh-button" type="button">Refresh</button>
          </div>
          <form id="settings-automation-form" class="automation-form">
            <input id="settings-automation-id-input" type="hidden" value="${escapeHtml(template.automationId || template.id || "")}">
            <label class="field-label" for="settings-automation-label-input">Label</label>
            <input id="settings-automation-label-input" class="input" type="text" placeholder="Daily Maintenance" value="${escapeHtml(template.label || "")}">

            <label class="field-label" for="settings-automation-interval-input">Every (minutes)</label>
            <input id="settings-automation-interval-input" class="input" type="number" min="1" step="1" value="${escapeHtml(template.intervalMinutes || 1440)}">

            <div class="toggle-row">
              <input id="settings-automation-active-input" type="checkbox" ${isActiveChecked ? "checked" : ""}>
              <label for="settings-automation-active-input">Automation is active</label>
            </div>
            <div class="toggle-row">
              <input id="settings-automation-run-market-input" type="checkbox" ${runMarketChecked ? "checked" : ""}>
              <label for="settings-automation-run-market-input">Run market collection</label>
            </div>
            <div class="toggle-row">
              <input id="settings-automation-run-options-input" type="checkbox" ${runOptionsChecked ? "checked" : ""}>
              <label for="settings-automation-run-options-input">Run options evidence</label>
            </div>
            <div class="toggle-row">
              <input id="settings-automation-run-fundamentals-input" type="checkbox" ${runFundamentalsChecked ? "checked" : ""}>
              <label for="settings-automation-run-fundamentals-input">Run fundamentals snapshots</label>
            </div>
            <div class="toggle-row">
              <input id="settings-automation-seed-fundamentals-input" type="checkbox" ${seedFundamentalsChecked ? "checked" : ""}>
              <label for="settings-automation-seed-fundamentals-input">Refresh built-in fundamental memberships</label>
            </div>
            <div class="toggle-row">
              <input id="settings-automation-refresh-masters-input" type="checkbox" ${refreshMastersChecked ? "checked" : ""}>
              <label for="settings-automation-refresh-masters-input">Refresh exchange symbol masters</label>
            </div>

            <label class="field-label" for="settings-automation-market-universes-input">Market Universe Ids</label>
            <input id="settings-automation-market-universes-input" class="input" type="text" placeholder="smoke-aapl, smoke-msft" value="${escapeHtml(Array.isArray(template.marketUniverseIds) ? template.marketUniverseIds.join(", ") : "")}">
            <p class="field-help">Leave blank to run every active local market universe.</p>

            <label class="field-label" for="settings-automation-options-universes-input">Options Universe Ids</label>
            <input id="settings-automation-options-universes-input" class="input" type="text" placeholder="us-liquid-10" value="${escapeHtml(Array.isArray(template.optionsUniverseIds) ? template.optionsUniverseIds.join(", ") : "")}">
            <p class="field-help">Leave blank to run every configured options evidence universe.</p>

            <label class="field-label" for="settings-automation-fundamental-universes-input">Fundamental Universe Ids</label>
            <input id="settings-automation-fundamental-universes-input" class="input" type="text" placeholder="sp500-current, nifty-500-current" value="${escapeHtml(Array.isArray(template.fundamentalUniverseIds) ? template.fundamentalUniverseIds.join(", ") : "")}">
            <p class="field-help">Leave blank to use the built-in fundamental universes.</p>

            <label class="field-label" for="settings-automation-fundamental-period-input">Fundamental Period Days</label>
            <input id="settings-automation-fundamental-period-input" class="input" type="number" min="1" step="1" value="${escapeHtml(fundamentalPeriodValue)}">

            <label class="field-label" for="settings-automation-fundamental-limit-input">Fundamental Run Limit</label>
            <input id="settings-automation-fundamental-limit-input" class="input" type="number" min="1" step="1" placeholder="Blank for full universe" value="${escapeHtml(fundamentalLimitValue)}">

            <label class="field-label" for="settings-automation-fundamental-delay-input">Fundamental Delay Seconds</label>
            <input id="settings-automation-fundamental-delay-input" class="input" type="number" min="0" step="0.1" value="${escapeHtml(fundamentalDelayValue)}">

            <label class="field-label" for="settings-automation-max-attention-input">Max Attention Symbols</label>
            <input id="settings-automation-max-attention-input" class="input" type="number" min="0" step="1" placeholder="Leave blank to tolerate" value="${escapeHtml(maxAttentionValue)}">

            <label class="field-label" for="settings-automation-max-sync-errors-input">Max Sync Errors</label>
            <input id="settings-automation-max-sync-errors-input" class="input" type="number" min="0" step="1" placeholder="Leave blank to tolerate" value="${escapeHtml(maxSyncErrorsValue)}">

            <div class="automation-actions">
              <button class="button" type="submit">Save</button>
              <button id="settings-automation-reset" class="button ghost" type="button">Reset</button>
            </div>
          </form>
          <div class="automation-catalog-copy summary-meta">${escapeHtml(catalogCopy)}</div>
        </section>
      </div>

      <section class="card settings-card">
        <div class="settings-card-head">
          <div>
            <p class="meta-label">Saved Automations</p>
            <h3 class="settings-card-title">Configured jobs</h3>
          </div>
        </div>
        <div class="automation-list">
          ${renderAutomationList(automationState)}
        </div>
      </section>
    </section>
  `;
}

function renderAutomationSidebarSummary(automationState, automationRuntimeHealth) {
  const automations = automationState?.automations || [];
  const summary = automationRuntimeHealth?.summary;
  if (!summary) {
    return `
      <p class="summary-meta">Runtime health will appear here once the local API responds.</p>
    `;
  }

  const activeCount = automations.filter((entry) => entry.isActive).length;
  return `
    ${renderRuntimeHealthSummary(automationRuntimeHealth, { compact: true })}
    <p class="summary-meta">Saved automations: ${escapeHtml(automations.length)} total · ${escapeHtml(activeCount)} active</p>
  `;
}

function buildAutomationFormPayload(root) {
  return {
    automationId: String(root.querySelector("#settings-automation-id-input")?.value || "").trim().toLowerCase(),
    label: String(root.querySelector("#settings-automation-label-input")?.value || "").trim(),
    intervalMinutes: parseOptionalIntegerValue(root.querySelector("#settings-automation-interval-input")?.value),
    isActive: Boolean(root.querySelector("#settings-automation-active-input")?.checked),
    runMarketCollection: Boolean(root.querySelector("#settings-automation-run-market-input")?.checked),
    runOptionsCollection: Boolean(root.querySelector("#settings-automation-run-options-input")?.checked),
    runFundamentalCollection: Boolean(root.querySelector("#settings-automation-run-fundamentals-input")?.checked),
    seedFundamentalUniverses: Boolean(root.querySelector("#settings-automation-seed-fundamentals-input")?.checked),
    refreshExchangeSymbolMasters: Boolean(root.querySelector("#settings-automation-refresh-masters-input")?.checked),
    marketUniverseIds: normalizeAutomationCsvList(
      root.querySelector("#settings-automation-market-universes-input")?.value,
    ).map((value) => value.toLowerCase()),
    optionsUniverseIds: normalizeAutomationCsvList(
      root.querySelector("#settings-automation-options-universes-input")?.value,
    ),
    fundamentalUniverseIds: normalizeAutomationCsvList(
      root.querySelector("#settings-automation-fundamental-universes-input")?.value,
    ).map((value) => value.toLowerCase()),
    fundamentalPeriodDays: parseOptionalIntegerValue(
      root.querySelector("#settings-automation-fundamental-period-input")?.value,
    ),
    fundamentalLimit: parseOptionalIntegerValue(
      root.querySelector("#settings-automation-fundamental-limit-input")?.value,
    ),
    fundamentalDelaySeconds: parseOptionalNumberValue(
      root.querySelector("#settings-automation-fundamental-delay-input")?.value,
    ),
    maxAttentionSymbols: parseOptionalIntegerValue(
      root.querySelector("#settings-automation-max-attention-input")?.value,
    ),
    maxSyncErrors: parseOptionalIntegerValue(
      root.querySelector("#settings-automation-max-sync-errors-input")?.value,
    ),
  };
}

function mountAutomationSettingsPage(root, controller) {
  let selectedAutomationId = "";

  function render() {
    root.innerHTML = renderAutomationSettingsPage({
      automationState: controller.getAutomationState(),
      automationRuntimeHealth: controller.getRuntimeHealth(),
      statusMessage: controller.getStatusMessage(),
      selectedAutomationId,
    });
  }

  const unsubscribe = controller.subscribe(() => {
    render();
  });

  async function handleSubmit(event) {
    const form = event.target.closest("#settings-automation-form");
    if (!form) {
      return;
    }
    event.preventDefault();
    const payload = buildAutomationFormPayload(root);
    if (!payload.automationId || !payload.label) {
      controller.setStatusMessage("Automation id and label are required.");
      render();
      return;
    }

    controller.setStatusMessage("Saving automation...");
    render();
    try {
      const response = await controller.saveAutomation(payload);
      selectedAutomationId = response?.automation?.automationId || payload.automationId;
      controller.setStatusMessage("Automation saved.");
    } catch (error) {
      controller.setStatusMessage(error?.message || "Could not save automation.");
    }
    render();
  }

  async function handleClick(event) {
    const resetTrigger = event.target.closest("#settings-automation-reset");
    if (resetTrigger) {
      selectedAutomationId = "";
      controller.setStatusMessage("");
      render();
      return;
    }

    const refreshTrigger = event.target.closest("#settings-automation-refresh");
    if (refreshTrigger) {
      try {
        await controller.refreshAutomationData("Refreshing automation state...");
        controller.setStatusMessage("");
      } catch (error) {
        controller.setStatusMessage(error?.message || "Could not load automation state.");
      }
      render();
      return;
    }

    const editId = event.target.closest("[data-automation-edit]")?.dataset.automationEdit;
    if (editId) {
      selectedAutomationId = editId;
      const automation = controller
        .getAutomationState()
        ?.automations?.find((entry) => entry.automationId === editId);
      controller.setStatusMessage(automation ? `Loaded ${automation.label}.` : "");
      render();
      return;
    }

    const runId = event.target.closest("[data-automation-run]")?.dataset.automationRun;
    if (runId) {
      controller.setStatusMessage("Running automation...");
      render();
      try {
        const response = await controller.runAutomation(runId);
        selectedAutomationId = runId;
        controller.setStatusMessage(
          response?.result?.status === "ok"
            ? "Automation completed."
            : `Automation completed with attention: ${(response?.result?.failureReasons || []).join(", ") || "see health"}`,
        );
      } catch (error) {
        controller.setStatusMessage(error?.message || "Could not run automation.");
      }
      render();
      return;
    }

    const deleteId = event.target.closest("[data-automation-delete]")?.dataset.automationDelete;
    if (deleteId) {
      controller.setStatusMessage("Deleting automation...");
      render();
      try {
        await controller.deleteAutomation(deleteId);
        if (selectedAutomationId === deleteId) {
          selectedAutomationId = "";
        }
        controller.setStatusMessage("Automation deleted.");
      } catch (error) {
        controller.setStatusMessage(error?.message || "Could not delete automation.");
      }
      render();
    }
  }

  root.addEventListener("submit", handleSubmit);
  root.addEventListener("click", handleClick);
  render();

  return () => {
    unsubscribe();
    root.removeEventListener("submit", handleSubmit);
    root.removeEventListener("click", handleClick);
  };
}

export {
  mountAutomationSettingsPage,
  renderAutomationSettingsPage,
  renderAutomationSidebarSummary,
};
