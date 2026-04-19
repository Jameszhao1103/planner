function resolveBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export const BROWSER_TIME_ZONE = resolveBrowserTimeZone();

const TIME_ZONE_PARTS_FORMATTER_CACHE = new Map();

export function eventClass(item) {
  if (item.kind === "meal") return "meal-block";
  if (item.kind === "check_in" || item.kind === "check_out" || item.kind === "lodging") return "stay-block";
  if (item.kind === "buffer" || item.kind === "free_time") return "buffer-block";
  if (item.kind === "transit" || item.kind === "flight") return "travel-block";
  return "activity-block";
}

function formatIsoTimeInZone(iso, timeZone) {
  return getTimeZoneDateTimeParts(iso, timeZone).time;
}

export function localTime(iso, timeZone = BROWSER_TIME_ZONE) {
  return formatIsoTimeInZone(iso, timeZone);
}

export function minutesRelativeToDay(iso, dayDate, timeZone = BROWSER_TIME_ZONE) {
  const parts = getTimeZoneDateTimeParts(iso, timeZone);
  const dayOffset = daysBetweenDateStrings(dayDate, parts.date);
  return dayOffset * 24 * 60 + parts.hour * 60 + parts.minute;
}

export function durationMinutes(startAt, endAt) {
  return Math.max(30, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
}

export function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

export function normalizeText(value) {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function itemTypeLabel(item) {
  if (item.kind === "meal") {
    return capitalize(item.category ?? "meal");
  }
  if (item.kind === "check_in") return "Hotel check-in";
  if (item.kind === "check_out") return "Hotel check-out";
  if (item.kind === "buffer") return "Buffer";
  if (item.kind === "flight") return "Flight";
  if (item.kind === "transit") return "Transit";
  if (item.kind === "activity") return capitalize(item.category ?? "activity");
  return capitalize(item.kind.replace(/_/g, " "));
}

export function replaceIsoTime(iso, time) {
  const [hours, minutes] = time.split(":").map((value) => Number.parseInt(value, 10));
  const offsetMinutes = parseOffsetMinutes(iso);
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  shifted.setUTCHours(hours, minutes, 0, 0);
  return formatIsoWithOffset(new Date(shifted.getTime() - offsetMinutes * 60000), offsetMinutes);
}

export function shiftIsoByMinutes(iso, deltaMinutes) {
  const offsetMinutes = parseOffsetMinutes(iso);
  const nextDate = new Date(new Date(iso).getTime() + deltaMinutes * 60000);
  return formatIsoWithOffset(nextDate, offsetMinutes);
}

export function snapMinutes(value, step) {
  return Math.round(value / step) * step;
}

export function routeTouchesSelected(route, selectedItemId) {
  return Boolean(selectedItemId && (route.from_item_id === selectedItemId || route.to_item_id === selectedItemId));
}

export function shortLabel(value) {
  return value.length > 18 ? `${value.slice(0, 16)}…` : value;
}

export function resolveTripTimeZone(trip) {
  return trip?.timezone || BROWSER_TIME_ZONE;
}

export function defaultStartTimeForInsertSession(session) {
  if (session.kind === "meal") {
    if (session.mealType === "breakfast") return "09:00";
    if (session.mealType === "dinner") return "18:30";
    return "12:00";
  }

  return "10:00";
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTimeZoneDateTimeParts(iso, timeZone = BROWSER_TIME_ZONE) {
  const formatter = getTimeZoneFormatter(timeZone);
  const parts = formatter.formatToParts(new Date(iso));
  const partValue = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  const year = partValue("year");
  const month = partValue("month");
  const day = partValue("day");
  const hour = partValue("hour");
  const minute = partValue("minute");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    hour: Number.parseInt(hour, 10),
    minute: Number.parseInt(minute, 10),
  };
}

function getTimeZoneFormatter(timeZone) {
  if (!TIME_ZONE_PARTS_FORMATTER_CACHE.has(timeZone)) {
    TIME_ZONE_PARTS_FORMATTER_CACHE.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    );
  }

  return TIME_ZONE_PARTS_FORMATTER_CACHE.get(timeZone);
}

function daysBetweenDateStrings(baseDate, nextDate) {
  const base = new Date(`${baseDate}T12:00:00Z`);
  const next = new Date(`${nextDate}T12:00:00Z`);
  if (Number.isNaN(base.getTime()) || Number.isNaN(next.getTime())) {
    return 0;
  }

  return Math.round((next.getTime() - base.getTime()) / 86400000);
}

function parseOffsetMinutes(iso) {
  if (iso.endsWith("Z")) {
    return 0;
  }

  const match = iso.match(/([+-])(\d{2}):(\d{2})$/u);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number.parseInt(match[2], 10) * 60 + Number.parseInt(match[3], 10));
}

function formatIsoWithOffset(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const second = String(shifted.getUTCSeconds()).padStart(2, "0");

  if (offsetMinutes === 0) {
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetMinute = String(absolute % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetHour}:${offsetMinute}`;
}
