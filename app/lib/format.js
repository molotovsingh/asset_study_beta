function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateRange(startDate, endDate) {
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export { formatPercent, formatNumber, formatDate, formatDateRange, formatDateTime };
