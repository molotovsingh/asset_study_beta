import {
  buildLocalApiUnavailableMessage,
  fetchInstrumentProfile,
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
  selectionSignatureKey = "lastLoadedSelectionSignature",
  snapshotKey = "lastLoadedSnapshot",
  reuseManifestIfLoaded = false,
}) {
  session.instrumentProfiles ||= {};

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

  function getProfileKey(selection) {
    const symbol = String(selection?.symbol || "").trim().toUpperCase();
    return symbol || null;
  }

  function getRuntimeSnapshot(selection) {
    const selectionSignature = buildSelectionSignature(selection);
    return selectionSignature === session[selectionSignatureKey]
      ? session[snapshotKey]
      : null;
  }

  function getBundledDatasetForSelection(selection) {
    if (!selection?.sync || !session.bundledManifest) {
      return null;
    }

    return getManifestDataset(session.bundledManifest, selection.sync);
  }

  function getInstrumentProfileState(selection) {
    const profileKey = getProfileKey(selection);
    return profileKey ? session.instrumentProfiles[profileKey] || null : null;
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
      getInstrumentProfileState(selection),
    );
    maybeLoadInstrumentProfile(selection);
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
    session[selectionSignatureKey] = buildSelectionSignature(selection);
    session[snapshotKey] = snapshot;

    if (rememberedEntry) {
      rememberCatalogEntry(rememberedEntry);
      return;
    }

    updateIndexSummary();
  }

  async function loadSelectionData(selection) {
    if ((selection.kind === "builtin" || selection.kind === "bundled") && selection.sync) {
      const manifestDataset =
        session.bundledManifest && selection.sync
          ? getManifestDataset(session.bundledManifest, selection.sync)
          : null;

      return loadSyncedSeries(selection.sync, manifestDataset);
    }

    return fetchIndexSeries(buildSeriesRequest(selection));
  }

  async function loadBundledManifest() {
    if (reuseManifestIfLoaded && session.bundledManifest) {
      refreshSelectionUi();
      return;
    }

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

  function setInstrumentProfileState(profileKey, state) {
    session.instrumentProfiles[profileKey] = state;
  }

  function maybeLoadInstrumentProfile(selection) {
    const profileKey = getProfileKey(selection);
    if (!profileKey || session.backendState !== "ready") {
      return;
    }

    // Ad hoc symbols stay unresolved until the first history load succeeds.
    if (selection?.kind === "adhoc" && !getRuntimeSnapshot(selection)) {
      return;
    }

    const currentState = session.instrumentProfiles[profileKey];
    if (
      currentState?.status === "ready" ||
      currentState?.status === "loading" ||
      currentState?.status === "unavailable"
    ) {
      return;
    }

    setInstrumentProfileState(profileKey, { status: "loading" });
    summaryEl.innerHTML = renderSelectionDetails(
      selection,
      getRuntimeSnapshot(selection),
      getSummaryContext().useDemoData || false,
      session.backendState,
      getInstrumentProfileState(selection),
    );

    fetchInstrumentProfile(selection.symbol)
      .then(({ profile, cache }) => {
        setInstrumentProfileState(profileKey, {
          status: "ready",
          profile,
          cache,
        });
      })
      .catch((error) => {
        setInstrumentProfileState(profileKey, {
          status: "unavailable",
          error: error.message,
        });
      })
      .finally(() => {
        const currentSelection = getCurrentSelection();
        if (getProfileKey(currentSelection) === profileKey) {
          updateIndexSummary();
        }
      });
  }

  return {
    session,
    setStatus,
    getSuggestions,
    getCurrentSelection,
    getRuntimeSnapshot,
    getBundledDatasetForSelection,
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
