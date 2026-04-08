import type { TimeWindow } from "./types.ts";

const MINUTE_MS = 60_000;

export function minutesBetween(startAt: string, endAt: string): number {
  return Math.round((toDate(endAt).getTime() - toDate(startAt).getTime()) / MINUTE_MS);
}

export function addMinutesToIso(iso: string, minutes: number): string {
  const offset = extractOffset(iso);
  const next = new Date(toDate(iso).getTime() + minutes * MINUTE_MS);
  return formatDateTimeWithOffset(next, offset);
}

export function extractLocalDate(iso: string): string {
  return iso.slice(0, 10);
}

export function extractLocalTime(iso: string): string {
  return iso.slice(11, 16);
}

export function compareIso(a: string, b: string): number {
  return toDate(a).getTime() - toDate(b).getTime();
}

export function compareLocalTime(a: string, b: string): number {
  return parseTimeToMinutes(a) - parseTimeToMinutes(b);
}

export function timeFallsWithinWindow(time: string, window: TimeWindow): boolean {
  return compareLocalTime(time, window.start) >= 0 && compareLocalTime(time, window.end) <= 0;
}

export function clampEndAtWindow(startAt: string, durationMinutes: number, windowEnd: string): string {
  const offset = extractOffset(startAt);
  const dayDate = extractLocalDate(startAt);
  const desiredEnd = `${dayDate}T${windowEnd}:00${offset}`;
  const adjustedStart = addMinutesToIso(desiredEnd, -durationMinutes);
  return compareIso(adjustedStart, startAt) >= 0 ? desiredEnd : desiredEnd;
}

export function combineLocalDateTime(dayDate: string, time: string, offset: string): string {
  return `${dayDate}T${time}:00${offset}`;
}

export function offsetForTimeZoneOnDate(dayDate: string, timeZone: string): string {
  try {
    const probe = new Date(`${dayDate}T12:00:00Z`);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      timeZoneName: "longOffset",
    });
    const value = formatter.formatToParts(probe).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    if (value === "GMT") {
      return "Z";
    }

    const match = value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u);
    if (!match) {
      return "Z";
    }

    const hour = String(Number.parseInt(match[2], 10)).padStart(2, "0");
    const minute = match[3] ?? "00";
    return `${match[1]}${hour}:${minute}`;
  } catch {
    return "Z";
  }
}

export function parseTimeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

export function formatLocalTimeRange(startAt: string, endAt: string): string {
  return `${extractLocalTime(startAt)}-${extractLocalTime(endAt)}`;
}

export function weekdayFromDate(dayDate: string): Weekday {
  const day = new Date(`${dayDate}T00:00:00Z`).getUTCDay();
  return WEEKDAY_BY_INDEX[day];
}

export type Weekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

const WEEKDAY_BY_INDEX: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function extractOffset(iso: string): string {
  const match = iso.match(/(Z|[+-]\d{2}:\d{2})$/);
  return match?.[1] ?? "Z";
}

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date-time: ${value}`);
  }

  return parsed;
}

function formatDateTimeWithOffset(date: Date, offset: string): string {
  if (offset === "Z") {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  const minutes = parseOffsetMinutes(offset);
  const shifted = new Date(date.getTime() + minutes * MINUTE_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const second = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

function parseOffsetMinutes(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [hour, minute] = offset.slice(1).split(":").map((part) => Number.parseInt(part, 10));
  return sign * (hour * 60 + minute);
}
