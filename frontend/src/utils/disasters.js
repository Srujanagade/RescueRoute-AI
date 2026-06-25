export const DISASTER_COLORS = {
  flood: "#3b82f6",
  earthquake: "#ef4444",
  fire: "#f97316",
  weather: "#facc15",
  other: "#9ca3af",
  default: "#9ca3af",
};

export const DISASTER_TYPE_OPTIONS = [
  { value: "flood", label: "Flood" },
  { value: "earthquake", label: "Earthquake" },
  { value: "fire", label: "Fire" },
  { value: "weather", label: "Weather" },
  { value: "other", label: "Other" },
];

export const DISASTER_CONFIDENCE_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const DEFAULT_DISASTER_FILTERS = {
  types: DISASTER_TYPE_OPTIONS.map((option) => option.value),
};

export const DEFAULT_CONFIDENCE_FILTERS = DISASTER_CONFIDENCE_OPTIONS.map(
  (option) => option.value,
);

const DISASTER_CONFIDENCE_STYLES = {
  high: {
    opacity: 1,
    border: "2px solid #22c55e",
    strokeColor: "#22c55e",
    strokeWidth: 2.5,
  },
  medium: {
    opacity: 0.75,
    border: "2px solid #f59e0b",
    strokeColor: "#f59e0b",
    strokeWidth: 2,
  },
  low: {
    opacity: 0.45,
    border: "2px solid #ef4444",
    strokeColor: "#ef4444",
    strokeWidth: 1.5,
  },
};

export const DISASTER_COLOR_EXPRESSION = [
  "match",
  ["get", "type"],
  "flood",
  DISASTER_COLORS.flood,
  "earthquake",
  DISASTER_COLORS.earthquake,
  "fire",
  DISASTER_COLORS.fire,
  "weather",
  DISASTER_COLORS.weather,
  "other",
  DISASTER_COLORS.other,
  DISASTER_COLORS.default,
];

export const DISASTER_RADIUS_EXPRESSION = [
  "step",
  ["coalesce", ["to-number", ["get", "severity"]], 0],
  6,
  40,
  8,
  70,
  10,
  90,
  12,
];

export const DISASTER_CONFIDENCE_OPACITY_EXPRESSION = [
  "match",
  ["coalesce", ["get", "confidence"], "low"],
  "high",
  DISASTER_CONFIDENCE_STYLES.high.opacity,
  "medium",
  DISASTER_CONFIDENCE_STYLES.medium.opacity,
  "low",
  DISASTER_CONFIDENCE_STYLES.low.opacity,
  DISASTER_CONFIDENCE_STYLES.low.opacity,
];

export const DISASTER_CONFIDENCE_STROKE_COLOR_EXPRESSION = [
  "match",
  ["coalesce", ["get", "confidence"], "low"],
  "high",
  DISASTER_CONFIDENCE_STYLES.high.strokeColor,
  "medium",
  DISASTER_CONFIDENCE_STYLES.medium.strokeColor,
  "low",
  DISASTER_CONFIDENCE_STYLES.low.strokeColor,
  DISASTER_CONFIDENCE_STYLES.low.strokeColor,
];

export const DISASTER_CONFIDENCE_STROKE_WIDTH_EXPRESSION = [
  "match",
  ["coalesce", ["get", "confidence"], "low"],
  "high",
  DISASTER_CONFIDENCE_STYLES.high.strokeWidth,
  "medium",
  DISASTER_CONFIDENCE_STYLES.medium.strokeWidth,
  "low",
  DISASTER_CONFIDENCE_STYLES.low.strokeWidth,
  DISASTER_CONFIDENCE_STYLES.low.strokeWidth,
];

const EMPTY_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [],
};

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const toValidCoordinate = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

export const normalizeDisasterType = (value) => {
  const normalizedValue = String(value ?? "")
    .trim()
    .toLowerCase();

  return DISASTER_TYPE_OPTIONS.some((option) => option.value === normalizedValue)
    ? normalizedValue
    : "other";
};

export const normalizeConfidence = (value) => {
  const normalizedValue = String(value ?? "")
    .trim()
    .toLowerCase();

  return DISASTER_CONFIDENCE_OPTIONS.some((option) => option.value === normalizedValue)
    ? normalizedValue
    : "low";
};

export const formatDisasterType = (value) => {
  if (!value) return "Other";

  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const formatConfidenceLabel = (value) =>
  normalizeConfidence(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const getConfidenceStyle = (confidence) =>
  DISASTER_CONFIDENCE_STYLES[normalizeConfidence(confidence)] ??
  DISASTER_CONFIDENCE_STYLES.low;

export const getSeverityLabel = (severity) => {
  const normalizedSeverity = Number(severity);

  if (!Number.isFinite(normalizedSeverity) || normalizedSeverity <= 0) {
    return "Unknown";
  }

  if (normalizedSeverity >= 80) {
    return "High";
  }

  if (normalizedSeverity >= 50) {
    return "Medium";
  }

  return "Low";
};

export const formatDisasterTimestamp = (timestamp) => {
  if (!timestamp) {
    return "Unknown";
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const getDisasterInsightCacheKey = (disaster) => {
  if (!disaster) {
    return "";
  }

  return [
    disaster.id || "unknown",
    disaster.timestamp || "",
    disaster.severity ?? "",
    normalizeConfidence(disaster.confidence),
    disaster.title || "",
  ].join(":");
};

const getTravelImpactText = (type) => {
  switch (normalizeDisasterType(type)) {
    case "flood":
      return "Low-lying roads may be blocked and detours are likely.";
    case "fire":
      return "Smoke or emergency closures may slow nearby traffic.";
    case "earthquake":
      return "Road checks or debris may delay travel in this area.";
    case "weather":
      return "Rain, wind, or poor visibility may make roads slower or unsafe.";
    default:
      return "Travel nearby may be disrupted, so expect delays.";
  }
};

export const buildLocalDisasterInsight = (disaster) => {
  const title = disaster?.title || formatDisasterType(disaster?.type);
  const location = disaster?.location || "this area";
  const severity = getSeverityLabel(disaster?.severity).toLowerCase();
  const confidence = formatConfidenceLabel(disaster?.confidence).toLowerCase();
  const impact = getTravelImpactText(disaster?.type);

  return `${title} was reported near ${location}. Severity appears ${severity} and data confidence is ${confidence}. ${impact}`;
};

export const filterDisasters = (
  disasters,
  filters,
  confidenceFilter = DEFAULT_CONFIDENCE_FILTERS,
) => {
  const activeTypes =
    Array.isArray(filters?.types)
      ? new Set(filters.types.map((type) => normalizeDisasterType(type)))
      : new Set(DEFAULT_DISASTER_FILTERS.types);
  const activeConfidence = Array.isArray(confidenceFilter)
    ? new Set(confidenceFilter.map((level) => normalizeConfidence(level)))
    : new Set(DEFAULT_CONFIDENCE_FILTERS);

  return (disasters ?? []).filter(
    (disaster) =>
      activeTypes.has(normalizeDisasterType(disaster?.type)) &&
      activeConfidence.has(normalizeConfidence(disaster?.confidence)),
  );
};

export const toGeoJSON = (disasters) => {
  const features = (disasters ?? [])
    .map((disaster) => {
      const latitude = toValidCoordinate(disaster?.latitude);
      const longitude = toValidCoordinate(disaster?.longitude);

      if (latitude === null || longitude === null) {
        return null;
      }

      const type = normalizeDisasterType(disaster?.type);
      const severity = Number(disaster?.severity);
      const confidence = normalizeConfidence(disaster?.confidence);

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        properties: {
          id: disaster?.id,
          type,
          severity: Number.isFinite(severity) ? severity : 0,
          severityLabel: getSeverityLabel(severity),
          confidence,
          confidenceLabel: formatConfidenceLabel(confidence),
          timestamp: disaster?.timestamp ?? "",
          source: disaster?.source ?? "Unknown",
          title: disaster?.title ?? "",
          location: disaster?.location ?? "",
          description: disaster?.description ?? "",
        },
      };
    })
    .filter(Boolean);

  return {
    ...EMPTY_FEATURE_COLLECTION,
    features,
  };
};

export const buildDisasterPopupHtml = (properties = {}) => {
  const title = properties.title || formatDisasterType(properties.type);
  const severityValue = Number(properties.severity);
  const severityText = Number.isFinite(severityValue) && severityValue > 0
    ? `${properties.severityLabel} (${severityValue.toFixed(1)})`
    : properties.severityLabel || "Unknown";
  const confidenceText = `${formatConfidenceLabel(properties.confidence)} Confidence`;
  const timestamp = properties.timestamp ? new Date(properties.timestamp) : null;
  const formattedTimestamp =
    timestamp && !Number.isNaN(timestamp.getTime())
      ? timestamp.toLocaleString()
      : "Unknown";

  return `
    <div class="space-y-1">
      <div class="text-sm font-semibold text-white">${escapeHtml(title)}</div>
      <div class="text-xs text-slate-300">${escapeHtml(
        formatDisasterType(properties.type),
      )}</div>
      <div class="text-xs text-slate-400">Severity: ${escapeHtml(severityText)}</div>
      <div class="text-xs text-slate-400">Confidence: ${escapeHtml(confidenceText)}</div>
      <div class="text-xs text-slate-400">Time: ${escapeHtml(formattedTimestamp)}</div>
      <div class="text-xs text-slate-400">Source: ${escapeHtml(
        properties.source || "Unknown",
      )}</div>
      ${
        properties.location
          ? `<div class="text-xs text-slate-400">Location: ${escapeHtml(
              properties.location,
            )}</div>`
          : ""
      }
    </div>
  `;
};
