function parseCsvLine(line) {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function normalizeHeader(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[%().]/g, "")
    .replace(/\s+/g, " ");
}

function parseDateValue(raw) {
  const value = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(value)) {
    const [day, month, year] = value.split(/[/-]/);
    return new Date(`${year}-${month}-${day}T00:00:00`);
  }

  if (/^\d{2}-[a-z]{3}-\d{4}$/i.test(value)) {
    return new Date(`${value}T00:00:00`);
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return null;
}

function parseNumericValue(raw) {
  const value = raw.replace(/,/g, "").replace(/%/g, "").trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickDateColumn(headers) {
  return headers.findIndex((header) => header.includes("date"));
}

function pickValueColumn(headers, candidates) {
  for (const candidate of candidates) {
    const exactMatch = headers.findIndex((header) => header === candidate);
    if (exactMatch >= 0) {
      return exactMatch;
    }
  }

  for (const candidate of candidates) {
    const partialMatch = headers.findIndex((header) => header.includes(candidate));
    if (partialMatch >= 0) {
      return partialMatch;
    }
  }

  return -1;
}

function dedupeAndSortSeries(points, allowZero = false) {
  const deduped = new Map();

  for (const point of points) {
    const key = point.date.toISOString().slice(0, 10);
    deduped.set(key, point);
  }

  return [...deduped.values()]
    .filter((point) => Number.isFinite(point.value))
    .filter((point) => (allowZero ? point.value >= 0 : point.value > 0))
    .sort((left, right) => left.date - right.date);
}

function parseSeriesCsv(text, valueCandidates, options = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }

  const headers = rows[0].map(normalizeHeader);
  const dateColumn = pickDateColumn(headers);
  const valueColumn = pickValueColumn(headers, valueCandidates);

  if (dateColumn < 0) {
    throw new Error("Could not find a date column in the CSV.");
  }

  if (valueColumn < 0) {
    throw new Error("Could not find a usable value column in the CSV.");
  }

  const points = rows
    .slice(1)
    .map((row) => {
      const date = parseDateValue(row[dateColumn] || "");
      const value = parseNumericValue(row[valueColumn] || "");
      return { date, value };
    })
    .filter((point) => point.date && Number.isFinite(point.value));

  const series = dedupeAndSortSeries(points, options.allowZero);
  if (series.length < 2) {
    throw new Error("The CSV did not produce enough valid observations.");
  }

  return {
    series,
    detectedColumns: {
      date: rows[0][dateColumn],
      value: rows[0][valueColumn],
    },
  };
}

function parseIndexSeriesCsv(text) {
  return parseSeriesCsv(text, [
    "total returns index",
    "net total return index",
    "tri",
    "close",
    "index value",
    "value",
    "price",
  ]);
}

function parseRiskFreeCsv(text) {
  return parseSeriesCsv(
    text,
    [
      "91-day treasury bill primary yield",
      "yield",
      "rate",
      "value",
      "close",
    ],
    { allowZero: true },
  );
}

export { parseIndexSeriesCsv, parseRiskFreeCsv };
