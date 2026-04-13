function validateIndexDateRange(selection, startValue, endValue) {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);

  if (!selection) {
    throw new Error("Set an active asset in the sidebar before running the study.");
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Pick a valid start date and end date.");
  }

  if (start >= end) {
    throw new Error("Start date must be earlier than end date.");
  }

  return { start, end };
}

export { validateIndexDateRange };
