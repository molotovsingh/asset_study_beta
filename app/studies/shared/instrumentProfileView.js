import {
  formatDateTime,
  formatNumber,
  formatPercent,
} from "../../lib/format.js";

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

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function isNonZeroNumber(value) {
  return isFiniteNumber(value) && Number(value) !== 0;
}

function compactNumber(value) {
  if (!isFiniteNumber(value)) {
    return "n/a";
  }

  const numericValue = Number(value);
  const absoluteValue = Math.abs(numericValue);
  const units = [
    { divisor: 1_000_000_000_000, suffix: "T" },
    { divisor: 1_000_000_000, suffix: "B" },
    { divisor: 1_000_000, suffix: "M" },
    { divisor: 1_000, suffix: "K" },
  ];
  const unit = units.find((candidate) => absoluteValue >= candidate.divisor);
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit ? 1 : 0,
  });

  if (!unit) {
    return formatter.format(numericValue);
  }

  return `${formatter.format(numericValue / unit.divisor)}${unit.suffix}`;
}

function formatMarketCap(value, currency) {
  if (!isFiniteNumber(value) || Number(value) <= 0) {
    return "n/a";
  }

  return [currency, compactNumber(value)].filter(Boolean).join(" ");
}

function formatProfileRatio(value, { allowNegative = false } = {}) {
  if (!isNonZeroNumber(value)) {
    return "n/a";
  }

  const numericValue = Number(value);
  if (!allowNegative && numericValue < 0) {
    return "n/a";
  }

  return formatNumber(numericValue, 2);
}

function formatDateTimeIfValid(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatDateTime(date);
}

function safeExternalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch (error) {
    return null;
  }
}

function renderProfileMetric(label, value) {
  if (!value || value === "n/a") {
    return "";
  }

  return `
    <div class="profile-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderInstrumentProfile(instrumentProfileState) {
  if (!instrumentProfileState) {
    return "";
  }

  if (instrumentProfileState.status === "loading") {
    return `
      <div class="profile-enrichment is-loading">
        <p class="summary-meta">Loading symbol profile from the local market-data cache...</p>
      </div>
    `;
  }

  if (instrumentProfileState.status !== "ready" || !instrumentProfileState.profile) {
    return "";
  }

  const { profile, cache } = instrumentProfileState;
  const displayName = profile.longName || profile.shortName || profile.symbol;
  const classification = [
    profile.quoteType,
    profile.sector,
    profile.industry,
    profile.country,
    profile.exchangeName || profile.exchange,
  ].filter(Boolean);
  const websiteUrl = safeExternalUrl(profile.website);
  const sourceUrl = safeExternalUrl(profile.sourceUrl);
  const cacheLabel =
    cache?.status === "hit"
      ? "Cached"
      : cache?.status === "refreshed"
        ? "Updated"
        : "Profile";
  const fetchedAt = formatDateTimeIfValid(profile.fetchedAt);
  const metrics = [
    renderProfileMetric(
      "Market cap",
      formatMarketCap(profile.marketCap, profile.currency),
    ),
    renderProfileMetric(
      "Beta",
      formatProfileRatio(profile.beta, { allowNegative: true }),
    ),
    renderProfileMetric("P/E", formatProfileRatio(profile.trailingPE)),
    renderProfileMetric("P/B", formatProfileRatio(profile.priceToBook)),
    renderProfileMetric(
      "Yield",
      isFiniteNumber(profile.dividendYield) && Number(profile.dividendYield) > 0
        ? formatPercent(Number(profile.dividendYield))
        : "n/a",
    ),
  ].join("");
  const sourceMeta = [
    fetchedAt ? `Profile fetched: ${escapeHtml(fetchedAt)}.` : "",
    websiteUrl
      ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noreferrer">Website</a>`
      : "",
    sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source</a>`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="profile-enrichment">
      <div class="profile-head">
        <div>
          <p class="section-label">Instrument Profile</p>
          <p class="profile-name">${escapeHtml(displayName)}</p>
        </div>
        <span class="summary-pill fresh">${escapeHtml(cacheLabel)}</span>
      </div>
      ${
        classification.length
          ? `<div class="profile-classification">${classification
              .map((item) => `<span>${escapeHtml(item)}</span>`)
              .join("")}</div>`
          : `<p class="summary-meta">The current data provider returned limited classification metadata for this symbol.</p>`
      }
      ${metrics ? `<div class="profile-metric-row">${metrics}</div>` : ""}
      ${sourceMeta ? `<p class="summary-meta">${sourceMeta}</p>` : ""}
    </div>
  `;
}

export { renderInstrumentProfile };
