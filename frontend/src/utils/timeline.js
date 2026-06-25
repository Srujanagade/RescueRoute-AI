const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_TOLERANCE_MS = 60 * 1000;

export const DEFAULT_TIMELINE_PRESET = "24h";
export const CUSTOM_TIMELINE_PRESET = "custom";

export const TIMELINE_PRESET_OPTIONS = [
  { value: "24h", shortLabel: "24h", label: "Last 24 Hours", days: 1 },
  { value: "7d", shortLabel: "7d", label: "Last 7 Days", days: 7 },
  { value: "30d", shortLabel: "30d", label: "Last 30 Days", days: 30 },
  { value: "6m", shortLabel: "6m", label: "Last 6 Months", days: 180 },
  { value: "1y", shortLabel: "1y", label: "Last 1 Year", days: 365 },
  { value: "5y", shortLabel: "5y", label: "Last 5 Years", days: 1825 },
];

const TIMELINE_PRESET_LOOKUP = Object.fromEntries(
  TIMELINE_PRESET_OPTIONS.map((option) => [option.value, option]),
);

const toClampedDate = (value, maxDate = new Date()) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getTime() > maxDate.getTime() ? new Date(maxDate) : parsed;
};

const inferTimelinePreset = (fromDate, toDate) => {
  const durationMs = toDate.getTime() - fromDate.getTime();

  for (const option of TIMELINE_PRESET_OPTIONS) {
    if (Math.abs(durationMs - option.days * DAY_MS) <= PRESET_TOLERANCE_MS) {
      return option.value;
    }
  }

  return CUSTOM_TIMELINE_PRESET;
};

export const buildTimelineFromPreset = (
  preset = DEFAULT_TIMELINE_PRESET,
  nowValue = new Date(),
) => {
  const now = toClampedDate(nowValue) ?? new Date();
  const option =
    TIMELINE_PRESET_LOOKUP[preset] ??
    TIMELINE_PRESET_LOOKUP[DEFAULT_TIMELINE_PRESET];
  const from = new Date(now.getTime() - option.days * DAY_MS);

  return {
    from: from.toISOString(),
    to: now.toISOString(),
    preset: option.value,
  };
};

export const normalizeTimeline = (timeline, fallbackTimeline) => {
  const fallback =
    fallbackTimeline ?? buildTimelineFromPreset(DEFAULT_TIMELINE_PRESET);
  const now = new Date();
  const fromDate = toClampedDate(timeline?.from, now);
  const toDate = toClampedDate(timeline?.to, now);

  if (!fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
    return fallback;
  }

  const preset = TIMELINE_PRESET_LOOKUP[timeline?.preset]
    ? timeline.preset
    : inferTimelinePreset(fromDate, toDate);

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    preset,
  };
};

export const parseTimelineFromSearch = (search) => {
  const params = new URLSearchParams(search);
  const from = params.get("from");
  const to = params.get("to");

  if (!from || !to) {
    return null;
  }

  const now = new Date();
  const fromDate = toClampedDate(from, now);
  const toDate = toClampedDate(to, now);

  if (!fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
    return null;
  }

  return normalizeTimeline({
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  });
};

export const buildTimelineSearch = (timeline) => {
  const params = new URLSearchParams();
  params.set("from", timeline.from);
  params.set("to", timeline.to);
  return params.toString();
};

export const getTimelineSliderIndex = (timeline) => {
  const presetIndex = TIMELINE_PRESET_OPTIONS.findIndex(
    (option) => option.value === timeline?.preset,
  );
  if (presetIndex >= 0) {
    return presetIndex;
  }

  const fromDate = toClampedDate(timeline?.from);
  const toDate = toClampedDate(timeline?.to);
  if (!fromDate || !toDate) {
    return 0;
  }

  const durationMs = toDate.getTime() - fromDate.getTime();
  let closestIndex = 0;
  let smallestDiff = Number.POSITIVE_INFINITY;

  TIMELINE_PRESET_OPTIONS.forEach((option, index) => {
    const diff = Math.abs(durationMs - option.days * DAY_MS);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestIndex = index;
    }
  });

  return closestIndex;
};

export const formatTimelineLabel = (timeline) => {
  const option = TIMELINE_PRESET_LOOKUP[timeline?.preset];
  if (option) {
    return option.label;
  }

  return "Custom Range";
};

export const formatTimelineWindow = (timeline) => {
  const fromDate = toClampedDate(timeline?.from);
  const toDate = toClampedDate(timeline?.to);
  if (!fromDate || !toDate) {
    return "Invalid time range";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return `${formatter.format(fromDate)} - ${formatter.format(toDate)}`;
};
