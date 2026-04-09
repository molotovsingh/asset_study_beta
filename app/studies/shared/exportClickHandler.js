function createExportClickHandler({
  triggerSelector,
  datasetKey,
  getPayload,
  exporters,
  setStatus,
  missingPayloadMessage = null,
}) {
  return function handleExportClick(event) {
    const trigger = event.target.closest(triggerSelector);
    if (!trigger) {
      return false;
    }

    const payload = getPayload();
    if (!payload) {
      if (missingPayloadMessage) {
        setStatus(missingPayloadMessage, "info");
      }
      return true;
    }

    const exportFormat = trigger.dataset[datasetKey];
    const exportAction = exporters[exportFormat];
    if (!exportAction) {
      return true;
    }

    try {
      exportAction(payload);
      setStatus(`Downloaded the ${exportFormat.toUpperCase()} export.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    }

    return true;
  };
}

export { createExportClickHandler };
