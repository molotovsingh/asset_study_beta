import {
  buildLocalApiUnavailableMessage,
  fetchIndexSeries,
  getManifestDataset,
  loadRememberedIndexCatalog,
  loadSyncManifest,
  loadSyncedSeries,
} from "../../lib/syncedData.js";
import {
  buildSelectionSignature,
  buildSeriesRequest,
  findSelectionByQuery,
  mergeSelectionSuggestions,
  upsertRememberedCatalogEntry,
} from "./indexSelection.js";
import { BUNDLED_INDEX_MANIFEST_SYNC_CONFIG } from "./overviewUtils.js";
import { renderSelectionDetails } from "./selectionSummaryView.js";

function createIndexStudyOverviewRuntime({
  session,
  queryInput,
  suggestionsEl,
  summaryEl,
  statusEl,
  getSummaryContext = () => ({ useDemoData: false }),
}) {
  function setStatus(message, statusState = "info") {
    statusEl.className = `status ${statusState}`;
    statusEl.textContent = message;
  }

  function getSuggestions() {
    return mergeSelectionSuggestions(
      session.bundledManifest,
      session.rememberedCatalog,
    );
  }

  function getCurrentSelection() {
    return findSelectionByQuery(queryInput.value, getSuggestions());
  }

  function getRuntimeSnapshot(selection) {
    const selectionSignature = buildSelectionSignature(selection);
    return selectionSignature === session.lastLoadedSelectionSignature
      ? session.lastLoadedSnapshot
      : null;
  }

  function populateSuggestionList() {
    suggestionsEl.innerHTML = getSuggestions()
      .map(
        (entry) =>
          `<option value="${entry.label}" label="${entry.symbol} · ${entry.family}"></option>`,
      )
      .join("");
  }

  function updateIndexSummary() {
    const selection = getCurrentSelection();
    const { useDemoData = false } = getSummaryContext();
    summaryEl.innerHTML = renderSelectionDetails(
      selection,
      getRuntimeSnapshot(selection),
      useDemoData,
      session.backendState,
    );
  }

  function refreshSelectionUi() {
    populateSuggestionList();
    updateIndexSummary();
  }

  function rememberCatalogEntry(entry) {
    session.rememberedCatalog = upsertRememberedCatalogEntry(
      session.rememberedCatalog,
      entry,
    );
    refreshSelectionUi();
  }

  function applyLoadedSnapshot(selection, snapshot, rememberedEntry) {
    session.lastLoadedSelectionSignature = buildSelectionSignature(selection);
    session.lastLoadedSnapshot = snapshot;

    if (rememberedEntry) {
      rememberCatalogEntry(rememberedEntry);
      return;
    }

    updateIndexSummary();
  }

  async function loadSelectionData(selection) {
    if (selection.kind === "builtin" || selection.kind === "bundled") {
      const manifestDataset =
        session.bundledManifest && selection.sync
          ? getManifestDataset(session.bundledManifest, selection.sync)
          : null;

      return loadSyncedSeries(selection.sync, manifestDataset);
    }

    return fetchIndexSeries(buildSeriesRequest(selection));
  }

  async function loadBundledManifest() {
    try {
      session.bundledManifest = await loadSyncManifest(
        BUNDLED_INDEX_MANIFEST_SYNC_CONFIG,
      );
      refreshSelectionUi();
    } catch (error) {
      session.bundledManifest = null;
      refreshSelectionUi();
      setStatus(
        `${error.message} Built-in datasets can still load directly if their snapshot files exist.`,
        "info",
      );
    }
  }

  async function loadRememberedSymbols() {
    try {
      session.rememberedCatalog = await loadRememberedIndexCatalog();
      session.backendState = "ready";
      refreshSelectionUi();
    } catch (error) {
      session.rememberedCatalog = [];
      session.backendState = "unavailable";
      refreshSelectionUi();
      if (!statusEl.textContent) {
        setStatus(buildLocalApiUnavailableMessage(), "info");
      }
    }
  }

  return {
    session,
    setStatus,
    getSuggestions,
    getCurrentSelection,
    getRuntimeSnapshot,
    updateIndexSummary,
    refreshSelectionUi,
    rememberCatalogEntry,
    applyLoadedSnapshot,
    loadSelectionData,
    loadBundledManifest,
    loadRememberedSymbols,
  };
}

export { createIndexStudyOverviewRuntime };
