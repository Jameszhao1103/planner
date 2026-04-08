import { PlannerError } from "./errors.ts";
import { createId } from "./ids.ts";
import { recomputeDerivedState, placeFromSnapshot, upsertPlace } from "./derivations.ts";
import {
  addMinutesToIso,
  combineLocalDateTime,
  compareIso,
  compareLocalTime,
  extractLocalDate,
  extractLocalTime,
  minutesBetween,
  offsetForTimeZoneOnDate,
  weekdayFromDate,
} from "./time.ts";
import type {
  CommandExecutionContext,
  Itinerary,
  ItineraryDay,
  ItineraryItem,
  ItineraryRoute,
  PlaceSnapshot,
  PlannerCommand,
  PlaceResolution,
  TimeWindow,
} from "./types.ts";

export async function executeCommands(
  itinerary: Itinerary,
  commands: PlannerCommand[],
  context: CommandExecutionContext
): Promise<void> {
  for (const command of commands) {
    await executeCommand(itinerary, command, context);
  }

  await recomputeDerivedState(itinerary, context);
}

async function executeCommand(
  itinerary: Itinerary,
  command: PlannerCommand,
  context: CommandExecutionContext
): Promise<void> {
  switch (command.action) {
    case "lock_item":
      mutateItem(itinerary, command, (item) => {
        item.locked = true;
      }, { respectLocks: false });
      return;
    case "unlock_item":
      mutateItem(itinerary, command, (item) => {
        item.locked = false;
      }, { respectLocks: false });
      return;
    case "move_item":
      mutateItem(itinerary, command, (item) => {
        const originalDuration = item.duration_minutes ?? Math.max(0, minutesBetween(item.start_at, item.end_at));
        if (command.new_start_at) {
          item.start_at = command.new_start_at;
          item.end_at = command.new_end_at ?? addMinutesToIso(command.new_start_at, originalDuration);
          return;
        }

        if (command.new_end_at) {
          item.end_at = command.new_end_at;
        }
      });
      return;
    case "reorder_item":
      reorderItem(itinerary, command);
      return;
    case "add_day":
      addDay(itinerary, command);
      return;
    case "delete_day":
      deleteDay(itinerary, command);
      return;
    case "delete_item":
      deleteItem(itinerary, command);
      return;
    case "restore_item":
      restoreItem(itinerary, command);
      return;
    case "replace_place":
      await replacePlace(itinerary, command, context);
      return;
    case "insert_item":
      await insertItem(itinerary, command, context);
      return;
    case "fill_meal":
      await fillMeal(itinerary, command, context);
      return;
    case "set_transport_mode":
      setTransportMode(itinerary, command);
      return;
    case "compress_day":
      compressDay(itinerary, command);
      return;
    case "relax_day":
      relaxDay(itinerary, command);
      return;
    case "optimize_day":
      compressDay(itinerary, command);
      return;
    case "resolve_conflict":
      await resolveConflict(itinerary, command, context);
      return;
    case "regenerate_markdown":
      return;
    default:
      throw new PlannerError("command_not_supported", `Unsupported planner command: ${command.action}`);
  }
}

function mutateItem(
  itinerary: Itinerary,
  command: PlannerCommand,
  callback: (item: ItineraryItem) => void,
  options: { respectLocks?: boolean } = {}
): void {
  const item = findItem(itinerary, command.item_id);
  if (options.respectLocks !== false) {
    assertItemEditable(item, command);
  }
  callback(item);
}

function deleteItem(itinerary: Itinerary, command: PlannerCommand): void {
  const location = findItemLocation(itinerary, command.item_id);
  if (!location) {
    throw new PlannerError("invalid_command", `Item not found: ${command.item_id}`);
  }

  assertItemEditable(location.item, command);
  location.day.items.splice(location.index, 1);
  itinerary.routes = itinerary.routes.filter(
    (route) => route.from_item_id !== location.item.id && route.to_item_id !== location.item.id
  );
}

function restoreItem(itinerary: Itinerary, command: PlannerCommand): void {
  const day = findDay(itinerary, command.day_date);
  if (!day) {
    throw new PlannerError("invalid_command", "restore_item requires day_date.");
  }

  const payloadItem = command.payload?.item;
  if (!payloadItem || typeof payloadItem !== "object") {
    throw new PlannerError("invalid_command", "restore_item requires payload.item.");
  }

  const item = structuredClone(payloadItem) as ItineraryItem;
  if (day.items.some((candidate) => candidate.id === item.id)) {
    return;
  }

  day.items.push(item);
  day.items.sort((left, right) => compareIso(left.start_at, right.start_at));
}

function addDay(itinerary: Itinerary, command: PlannerCommand): void {
  const date = typeof command.payload?.date === "string"
    ? command.payload.date
    : addDaysToDate(itinerary.end_date, 1);

  if (itinerary.days.some((day) => day.date === date)) {
    throw new PlannerError("invalid_command", `Day already exists: ${date}`);
  }

  itinerary.days.push({
    date,
    label: typeof command.payload?.label === "string" ? command.payload.label : "",
    summary: "",
    items: [],
  });
  sortAndRelabelDays(itinerary);
}

function deleteDay(itinerary: Itinerary, command: PlannerCommand): void {
  const day = findDay(itinerary, command.day_date);
  if (!day) {
    throw new PlannerError("invalid_command", "delete_day requires day_date.");
  }

  if (itinerary.days.length <= 1) {
    throw new PlannerError("invalid_command", "Trip must keep at least one day.");
  }

  if (day.items.length > 0) {
    throw new PlannerError("invalid_command", "Only empty days can be deleted.");
  }

  itinerary.days = itinerary.days.filter((candidate) => candidate.date !== day.date);
  sortAndRelabelDays(itinerary);
}

function reorderItem(itinerary: Itinerary, command: PlannerCommand): void {
  const location = findItemLocation(itinerary, command.item_id);
  const targetLocation = findItemLocation(itinerary, command.target_item_id);
  const position = typeof command.payload?.position === "string" ? command.payload.position : null;

  if (!location || !targetLocation || !position || !["before", "after"].includes(position)) {
    throw new PlannerError(
      "invalid_command",
      "reorder_item requires item_id, target_item_id, and payload.position of before or after."
    );
  }

  if (location.day.date !== targetLocation.day.date) {
    throw new PlannerError("invalid_command", "reorder_item currently supports reordering within the same day only.");
  }

  if (location.item.id === targetLocation.item.id) {
    return;
  }

  assertItemEditable(location.item, command);

  const ordered = location.day.items
    .slice()
    .sort((left, right) => compareIso(left.start_at, right.start_at))
    .filter((item) => item.id !== location.item.id);
  const targetIndex = ordered.findIndex((item) => item.id === targetLocation.item.id);
  if (targetIndex === -1) {
    throw new PlannerError("invalid_command", `Target item not found in day: ${targetLocation.item.id}`);
  }

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  ordered.splice(insertIndex, 0, location.item);
  const movedIndex = ordered.findIndex((item) => item.id === location.item.id);
  const movedDuration =
    location.item.duration_minutes ?? Math.max(0, minutesBetween(location.item.start_at, location.item.end_at));
  const previous = movedIndex > 0 ? ordered[movedIndex - 1] : null;
  const next = movedIndex < ordered.length - 1 ? ordered[movedIndex + 1] : null;
  const desiredStart =
    previous?.end_at ??
    (position === "before" && next ? next.start_at : location.item.start_at);

  location.item.start_at = desiredStart;
  location.item.end_at = addMinutesToIso(desiredStart, movedDuration);

  let cursor = location.item.end_at;
  for (let index = movedIndex + 1; index < ordered.length; index += 1) {
    const item = ordered[index];
    if (item.locked) {
      if (compareIso(item.start_at, cursor) < 0) {
        throw new PlannerError(
          "locked_item_violation",
          `${item.title} is locked, so the requested reorder would force it to move.`
        );
      }
      cursor = item.end_at;
      continue;
    }

    if (compareIso(item.start_at, cursor) < 0) {
      const duration = item.duration_minutes ?? Math.max(0, minutesBetween(item.start_at, item.end_at));
      item.start_at = cursor;
      item.end_at = addMinutesToIso(cursor, duration);
    }

    cursor = item.end_at;
  }
}

async function replacePlace(
  itinerary: Itinerary,
  command: PlannerCommand,
  context: CommandExecutionContext
): Promise<void> {
  const item = findItem(itinerary, command.item_id);
  assertItemEditable(item, command);

  const resolution = await resolvePlace(command, item, itinerary, context);
  const nextPlace = placeFromSnapshot(resolution.snapshot);
  upsertPlace(itinerary, nextPlace);

  item.place_id = nextPlace.place_id;
  item.title = resolution.title;
  item.category = inferItemCategory(item, command);
}

async function insertItem(
  itinerary: Itinerary,
  command: PlannerCommand,
  context: CommandExecutionContext
): Promise<void> {
  const day = findDay(itinerary, command.day_date);
  if (!day) {
    throw new PlannerError("invalid_command", "insert_item requires day_date.");
  }

  const payload = command.payload ?? {};
  const templateOffset = inferDayOffset(day, itinerary.timezone);
  const durationMinutes = coerceNumber(payload.duration_minutes) ?? defaultInsertDurationMinutes(command.kind);
  const position = payload.position === "before" || payload.position === "after" ? payload.position : null;
  const targetLocation = position ? findItemLocation(itinerary, command.target_item_id) : null;
  const explicitStartAt = typeof payload.start_at === "string" ? payload.start_at : null;

  if (command.kind === "meal" && !coerceMealType(payload.meal_type)) {
    throw new PlannerError("invalid_command", "insert_item of kind meal requires payload.meal_type.");
  }

  if ((position && !command.target_item_id) || (command.target_item_id && !position)) {
    throw new PlannerError(
      "invalid_command",
      "insert_item relative placement requires both target_item_id and payload.position."
    );
  }

  if (position && !targetLocation) {
    throw new PlannerError("invalid_command", `Target item not found: ${command.target_item_id}`);
  }

  const startAt = explicitStartAt
    ?? (position && targetLocation
      ? computeRelativeInsertStartAt(day, targetLocation, position, durationMinutes)
      : combineLocalDateTime(day.date, coerceTime(payload.start_time) ?? "15:00", templateOffset));
  const endAt =
    typeof payload.end_at === "string"
      ? payload.end_at
      : addMinutesToIso(startAt, durationMinutes);

  const title = typeof payload.title === "string" ? payload.title : defaultInsertedTitle(command.kind);
  const item: ItineraryItem = {
    id: createId("item"),
    kind: command.kind ?? "activity",
    title,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: Math.max(0, minutesBetween(startAt, endAt)),
    status: "draft",
    locked: false,
    source: "user",
    category: inferInsertedCategory(command),
    tags: [],
    validation_conflict_ids: [],
  };

  if (command.place_id || command.place_query) {
    const resolution = await resolvePlace(command, item, itinerary, context);
    const place = placeFromSnapshot(resolution.snapshot);
    upsertPlace(itinerary, place);
    item.place_id = place.place_id;
    item.title = typeof payload.title === "string" ? payload.title : resolution.title;
  }

  if (position && targetLocation) {
    insertRelativeToTarget(day, item, targetLocation, position);
    return;
  }

  day.items.push(item);
  day.items.sort((left, right) => compareIso(left.start_at, right.start_at));
}

async function fillMeal(
  itinerary: Itinerary,
  command: PlannerCommand,
  context: CommandExecutionContext
): Promise<void> {
  const day = resolveCommandDay(itinerary, command);
  const mealType = coerceMealType(command.payload?.meal_type) ?? "lunch";
  const window = itinerary.preferences.meal_windows[mealType];
  if (!window) {
    throw new PlannerError("invalid_command", `No ${mealType} meal window configured.`);
  }

  const anchorItem =
    (command.item_id ? findItem(itinerary, command.item_id) : undefined) ??
    day.items.find((item) => item.place_id && item.kind !== "meal");
  const anchorPlaceId = command.constraints?.near_place_id ?? anchorItem?.place_id;
  const nearPlace = anchorPlaceId ? itinerary.places.find((place) => place.place_id === anchorPlaceId) : undefined;

  let candidates = await searchCandidatesWithFallback(context, {
    query: command.place_query ?? `${mealType} near ${nearPlace?.name ?? itinerary.title}`,
    includedType: "restaurant",
    minRating: command.constraints?.min_rating,
    maxPriceLevel: command.constraints?.max_price_level,
    locationBias: nearPlace
      ? {
          center: { lat: nearPlace.lat, lng: nearPlace.lng },
          radiusMeters: 2500,
        }
      : undefined,
    pageSize: 5,
  });

  if (candidates.length === 0) {
    candidates = await context.placesAdapter.searchByText({
      query: nearPlace?.name ?? itinerary.title,
      includedType: "restaurant",
      locationBias: nearPlace
        ? {
            center: { lat: nearPlace.lat, lng: nearPlace.lng },
            radiusMeters: 4000,
          }
        : undefined,
      pageSize: 5,
    });
  }

  if (candidates.length === 0) {
    candidates = await context.placesAdapter.searchByText({
      query: "",
      includedType: "restaurant",
      pageSize: 5,
    });
  }

  const offset = inferDayOffset(day, itinerary.timezone);
  const startAt = combineLocalDateTime(day.date, pickMealStart(window, day), offset);
  const endAt = addMinutesToIso(startAt, 60);
  const mealItem: ItineraryItem = {
    id: createId("item"),
    kind: "meal",
    title: `${capitalize(mealType)} stop`,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: 60,
    status: "suggested",
    locked: false,
    source: "ai",
    category: mealType,
    tags: ["auto_fill"],
    validation_conflict_ids: [],
  };

  const snapshot = await pickBestPlaceSnapshot(candidates, mealItem, context);
  if (!snapshot) {
    throw new PlannerError("invalid_command", `No meal candidate found for ${mealType}.`);
  }
  const place = placeFromSnapshot(snapshot);
  upsertPlace(itinerary, place);

  day.items.push({
    ...mealItem,
    title: `${capitalize(mealType)} at ${place.name}`,
    place_id: place.place_id,
  });

  day.items.sort((left, right) => compareIso(left.start_at, right.start_at));
}

function setTransportMode(itinerary: Itinerary, command: PlannerCommand): void {
  if (!command.mode) {
    throw new PlannerError("invalid_command", "set_transport_mode requires mode.");
  }

  const routes = itinerary.routes.filter((route) => matchesRoute(route, command));
  if (routes.length === 0) {
    throw new PlannerError("invalid_command", "No matching route found for set_transport_mode.");
  }

  routes.forEach((route) => {
    route.mode = command.mode!;
  });
}

function compressDay(itinerary: Itinerary, command: PlannerCommand): void {
  const day = findDay(itinerary, command.day_date);
  if (!day) {
    throw new PlannerError("invalid_command", "compress_day requires day_date.");
  }

  day.items.sort((left, right) => compareIso(left.start_at, right.start_at));
  for (let index = 1; index < day.items.length; index += 1) {
    const previous = day.items[index - 1];
    const current = day.items[index];
    if (current.locked) {
      continue;
    }

    const route = itinerary.routes.find(
      (candidate) => candidate.from_item_id === previous.id && candidate.to_item_id === current.id
    );
    const minimumGap = route?.duration_minutes ?? 0;
    const desiredStart = addMinutesToIso(previous.end_at, minimumGap);
    if (compareIso(desiredStart, current.start_at) < 0) {
      const duration = current.duration_minutes ?? Math.max(0, minutesBetween(current.start_at, current.end_at));
      current.start_at = desiredStart;
      current.end_at = addMinutesToIso(desiredStart, duration);
    }
  }
}

function relaxDay(itinerary: Itinerary, command: PlannerCommand): void {
  const day = findDay(itinerary, command.day_date);
  if (!day) {
    throw new PlannerError("invalid_command", "relax_day requires day_date.");
  }

  const candidate = day.items.find((item) => !item.locked && item.kind === "activity");
  if (!candidate) {
    return;
  }

  const insertAfter = day.items.indexOf(candidate);
  const bufferStart = candidate.end_at;
  const bufferEnd = addMinutesToIso(bufferStart, 30);
  const bufferItem: ItineraryItem = {
    id: createId("item"),
    kind: "buffer",
    title: "Breathing room",
    start_at: bufferStart,
    end_at: bufferEnd,
    duration_minutes: 30,
    status: "suggested",
    locked: false,
    source: "ai",
    category: "buffer",
    tags: ["relax_day"],
    validation_conflict_ids: [],
  };

  day.items.splice(insertAfter + 1, 0, bufferItem);

  for (let index = insertAfter + 2; index < day.items.length; index += 1) {
    if (day.items[index].locked) {
      continue;
    }

    day.items[index].start_at = addMinutesToIso(day.items[index].start_at, 30);
    day.items[index].end_at = addMinutesToIso(day.items[index].end_at, 30);
  }
}

async function resolveConflict(
  itinerary: Itinerary,
  command: PlannerCommand,
  context: CommandExecutionContext
): Promise<void> {
  const conflictId =
    typeof command.payload?.conflict_id === "string"
      ? command.payload.conflict_id
      : findItem(itinerary, command.item_id).validation_conflict_ids?.[0];
  const conflict = itinerary.conflicts.find((candidate) => candidate.id === conflictId);
  if (!conflict) {
    throw new PlannerError("invalid_command", "resolve_conflict requires an existing conflict.");
  }

  if (conflict.type === "opening_hours_conflict") {
    const item = findItem(itinerary, conflict.item_ids[0]);
    const place = item.place_id ? itinerary.places.find((candidate) => candidate.place_id === item.place_id) : undefined;
    const hours = place?.opening_hours?.find(
      (window) => window.weekday === weekdayForItem(item, itinerary)
    );

    if (hours) {
      const duration = item.duration_minutes ?? Math.max(0, minutesBetween(item.start_at, item.end_at));
      const endAt = `${extractLocalDate(item.start_at)}T${hours.close}:00${item.end_at.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "Z"}`;
      item.end_at = endAt;
      item.start_at = addMinutesToIso(endAt, -duration);
    }
    return;
  }

  if (conflict.type === "travel_time_underestimated" && conflict.item_ids.length >= 2) {
    const previous = findItem(itinerary, conflict.item_ids[0]);
    const current = findItem(itinerary, conflict.item_ids[1]);
    const route = itinerary.routes.find(
      (candidate) => candidate.from_item_id === previous.id && candidate.to_item_id === current.id
    );
    if (route && !current.locked) {
      const duration = current.duration_minutes ?? Math.max(0, minutesBetween(current.start_at, current.end_at));
      current.start_at = addMinutesToIso(previous.end_at, route.duration_minutes);
      current.end_at = addMinutesToIso(current.start_at, duration);
    }
    return;
  }

  if (conflict.type === "overlap_conflict" && conflict.item_ids.length >= 2) {
    const previous = findItem(itinerary, conflict.item_ids[0]);
    const current = findItem(itinerary, conflict.item_ids[1]);

    if (!current.locked) {
      const duration = current.duration_minutes ?? Math.max(0, minutesBetween(current.start_at, current.end_at));
      current.start_at = previous.end_at;
      current.end_at = addMinutesToIso(current.start_at, duration);
      return;
    }

    if (!previous.locked) {
      const duration = previous.duration_minutes ?? Math.max(0, minutesBetween(previous.start_at, previous.end_at));
      previous.end_at = current.start_at;
      previous.start_at = addMinutesToIso(previous.end_at, -duration);
      return;
    }

    throw new PlannerError(
      "locked_item_violation",
      "Both overlapping items are locked, so the conflict cannot be repaired automatically."
    );
  }

  if (conflict.type === "meal_window_missing") {
    const dayDate = command.day_date ?? extractDayDateFromConflict(conflict.id);
    const mealType = extractMealTypeFromConflict(conflict.id);
    if (!dayDate || !mealType) {
      throw new PlannerError("invalid_command", "meal_window_missing repair requires a day and meal type.");
    }

    await fillMeal(itinerary, {
      command_id: command.command_id,
      action: "fill_meal",
      day_date: dayDate,
      item_id: command.item_id,
      reason: command.reason || `Resolve missing ${mealType}`,
      payload: {
        meal_type: mealType,
      },
    }, context);
    return;
  }

  if (conflict.type === "pace_limit_exceeded") {
    if (conflict.item_ids.length >= 2) {
      setTransportMode(itinerary, {
        ...command,
        action: "set_transport_mode",
        item_id: conflict.item_ids[0],
        target_item_id: conflict.item_ids[1],
        mode: "taxi",
        reason: command.reason || "Resolve walking pace conflict",
      });
      return;
    }

    const dayDate = command.day_date ?? extractDayDateFromConflict(conflict.id);
    if (!dayDate) {
      throw new PlannerError("invalid_command", "pace_limit_exceeded repair requires a day.");
    }

    relaxDay(itinerary, {
      ...command,
      action: "relax_day",
      day_date: dayDate,
      reason: command.reason || "Resolve packed-day conflict",
    });
    return;
  }
}

function extractMealTypeFromConflict(conflictId: string): "breakfast" | "lunch" | "dinner" | null {
  const match = conflictId.match(/^meal_(breakfast|lunch|dinner)_/u);
  return match?.[1] as "breakfast" | "lunch" | "dinner" | null;
}

function extractDayDateFromConflict(conflictId: string): string | null {
  const match = conflictId.match(/(\d{4}-\d{2}-\d{2})$/u);
  return match?.[1] ?? null;
}

async function resolvePlace(
  command: PlannerCommand,
  item: ItineraryItem,
  itinerary: Itinerary,
  context: CommandExecutionContext
): Promise<PlaceResolution> {
  const snapshot = command.place_id
    ? await context.placesAdapter.getPlaceDetails({ placeId: command.place_id })
    : await searchPlace(command, item, itinerary, context);

  return {
    snapshot,
    title: buildItemTitle(item, snapshot.name),
  };
}

async function searchPlace(
  command: PlannerCommand,
  item: ItineraryItem,
  itinerary: Itinerary,
  context: CommandExecutionContext
) {
  const nearPlaceId = command.constraints?.near_place_id ?? item.place_id;
  const nearPlace = nearPlaceId
    ? itinerary.places.find((candidate) => candidate.place_id === nearPlaceId)
    : undefined;

  const candidates = await searchCandidatesWithFallback(context, {
    query: command.place_query ?? item.title,
    includedType: inferSearchType(item, command),
    minRating: command.constraints?.min_rating,
    maxPriceLevel: command.constraints?.max_price_level,
    locationBias: nearPlace
      ? {
          center: { lat: nearPlace.lat, lng: nearPlace.lng },
          radiusMeters: 3000,
        }
      : undefined,
    pageSize: 5,
  });

  const snapshot = await pickBestPlaceSnapshot(candidates, item, context);
  if (!snapshot) {
    throw new PlannerError("invalid_command", `No place candidate found for query: ${command.place_query ?? item.title}`);
  }

  return snapshot;
}

function matchesRoute(route: ItineraryRoute, command: PlannerCommand): boolean {
  if (command.item_id && command.target_item_id) {
    return route.from_item_id === command.item_id && route.to_item_id === command.target_item_id;
  }

  if (command.item_id) {
    return route.to_item_id === command.item_id || route.from_item_id === command.item_id;
  }

  return false;
}

function assertItemEditable(item: ItineraryItem, command: PlannerCommand): void {
  const respectLocks = command.constraints?.respect_locks ?? true;
  if (item.locked && respectLocks) {
    throw new PlannerError(
      "locked_item_violation",
      `Item ${item.id} is locked and cannot be changed without overriding respect_locks.`
    );
  }
}

function findItem(itinerary: Itinerary, itemId?: string): ItineraryItem {
  if (!itemId) {
    throw new PlannerError("invalid_command", "item_id is required.");
  }

  const item = itinerary.days.flatMap((day) => day.items).find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new PlannerError("invalid_command", `Item not found: ${itemId}`);
  }

  return item;
}

function findItemLocation(
  itinerary: Itinerary,
  itemId?: string
): { day: ItineraryDay; item: ItineraryItem; index: number } | null {
  if (!itemId) {
    return null;
  }

  for (const day of itinerary.days) {
    const index = day.items.findIndex((candidate) => candidate.id === itemId);
    if (index !== -1) {
      return { day, item: day.items[index], index };
    }
  }

  return null;
}

function findDay(itinerary: Itinerary, dayDate?: string): ItineraryDay | undefined {
  return dayDate ? itinerary.days.find((candidate) => candidate.date === dayDate) : undefined;
}

function resolveCommandDay(itinerary: Itinerary, command: PlannerCommand): ItineraryDay {
  if (command.day_date) {
    const day = findDay(itinerary, command.day_date);
    if (!day) {
      throw new PlannerError("invalid_command", `Day not found: ${command.day_date}`);
    }
    return day;
  }

  if (command.item_id) {
    const location = findItemLocation(itinerary, command.item_id);
    if (location) {
      return location.day;
    }
  }

  throw new PlannerError("invalid_command", "Command requires day_date or item_id to infer the day.");
}

function inferInsertedCategory(command: PlannerCommand): string {
  if (command.kind === "meal") {
    return coerceMealType(command.payload?.meal_type) ?? "meal";
  }

  return command.kind ?? "activity";
}

function defaultInsertDurationMinutes(kind: PlannerCommand["kind"] | undefined): number {
  return kind === "meal" ? 60 : 90;
}

function defaultInsertedTitle(kind: PlannerCommand["kind"] | undefined): string {
  return kind === "meal" ? "Meal stop" : "New stop";
}

function computeRelativeInsertStartAt(
  day: ItineraryDay,
  targetLocation: { day: ItineraryDay; item: ItineraryItem; index: number },
  position: "before" | "after",
  durationMinutes: number
): string {
  if (day.date !== targetLocation.day.date) {
    throw new PlannerError("invalid_command", "insert_item target must be on the same day.");
  }

  if (position === "before") {
    const ordered = sortDayItems(day.items);
    const targetIndex = ordered.findIndex((candidate) => candidate.id === targetLocation.item.id);
    const previous = targetIndex > 0 ? ordered[targetIndex - 1] : null;
    const desiredStart = addMinutesToIso(targetLocation.item.start_at, -durationMinutes);
    return previous ? maxIso(previous.end_at, desiredStart) : desiredStart;
  }

  return targetLocation.item.end_at;
}

function insertRelativeToTarget(
  day: ItineraryDay,
  item: ItineraryItem,
  targetLocation: { day: ItineraryDay; item: ItineraryItem; index: number },
  position: "before" | "after"
): void {
  if (day.date !== targetLocation.day.date) {
    throw new PlannerError("invalid_command", "insert_item target must be on the same day.");
  }

  const ordered = sortDayItems(day.items);
  const targetIndex = ordered.findIndex((candidate) => candidate.id === targetLocation.item.id);
  if (targetIndex === -1) {
    throw new PlannerError("invalid_command", `Target item not found in day: ${targetLocation.item.id}`);
  }

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  ordered.splice(insertIndex, 0, item);

  const cursorStart = position === "before" ? item.end_at : item.end_at;
  const shiftStartIndex = position === "before" ? insertIndex + 1 : insertIndex + 1;
  pushOverlappingItemsForward(ordered, shiftStartIndex, cursorStart);
  day.items = ordered;
}

function pushOverlappingItemsForward(items: ItineraryItem[], startIndex: number, cursorStart: string): void {
  let cursor = cursorStart;
  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index];
    if (item.locked) {
      if (compareIso(item.start_at, cursor) < 0) {
        throw new PlannerError(
          "locked_item_violation",
          `${item.title} is locked, so the requested insertion would force it to move.`
        );
      }
      cursor = item.end_at;
      continue;
    }

    if (compareIso(item.start_at, cursor) < 0) {
      const duration = item.duration_minutes ?? Math.max(0, minutesBetween(item.start_at, item.end_at));
      item.start_at = cursor;
      item.end_at = addMinutesToIso(cursor, duration);
    }

    cursor = item.end_at;
  }
}

function sortDayItems(items: ItineraryItem[]): ItineraryItem[] {
  return items.slice().sort((left, right) => compareIso(left.start_at, right.start_at));
}

function sortAndRelabelDays(itinerary: Itinerary): void {
  itinerary.days.sort((left, right) => left.date.localeCompare(right.date));
  itinerary.days.forEach((day, index) => {
    day.label = `Day ${index + 1}`;
  });
  itinerary.start_date = itinerary.days[0]?.date ?? itinerary.start_date;
  itinerary.end_date = itinerary.days[itinerary.days.length - 1]?.date ?? itinerary.end_date;
}

function addDaysToDate(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

function maxIso(left: string, right: string): string {
  return compareIso(left, right) >= 0 ? left : right;
}

function inferItemCategory(item: ItineraryItem, command: PlannerCommand): string {
  if (item.kind === "meal") {
    return coerceMealType(command.payload?.meal_type) ?? item.category ?? "meal";
  }

  return item.category ?? command.kind ?? "activity";
}

function inferSearchType(item: ItineraryItem, command: PlannerCommand): string | undefined {
  if (command.kind === "meal" || item.kind === "meal") {
    return "restaurant";
  }

  return undefined;
}

async function pickBestPlaceSnapshot(
  candidates: Array<{ placeId: string }>,
  item: ItineraryItem,
  context: CommandExecutionContext
): Promise<PlaceSnapshot | null> {
  if (!candidates.length) {
    return null;
  }

  const snapshots = await Promise.all(
    candidates.slice(0, 5).map((candidate) => context.placesAdapter.getPlaceDetails({ placeId: candidate.placeId }))
  );

  return snapshots.find((snapshot) => snapshotMatchesItemWindow(snapshot, item)) ?? snapshots[0] ?? null;
}

async function searchCandidatesWithFallback(
  context: CommandExecutionContext,
  request: {
    query: string;
    includedType?: string;
    minRating?: number;
    maxPriceLevel?: number;
    locationBias?: {
      center: { lat: number; lng: number };
      radiusMeters: number;
    };
    pageSize?: number;
  }
) {
  const candidates = await context.placesAdapter.searchByText(request);
  if (candidates.length > 0) {
    return candidates;
  }

  if (request.minRating !== undefined) {
    const relaxed = await context.placesAdapter.searchByText({
      ...request,
      minRating: undefined,
    });
    if (relaxed.length > 0) {
      return relaxed;
    }
  }

  return candidates;
}

function snapshotMatchesItemWindow(snapshot: PlaceSnapshot, item: ItineraryItem): boolean {
  const hours = snapshot.regularOpeningHours;
  if (!hours?.length) {
    return true;
  }

  const weekday = weekdayFromDate(extractLocalDate(item.start_at));
  const window = hours.find((candidate) => candidate.weekday === weekday);
  if (!window) {
    return false;
  }

  const startTime = extractLocalTime(item.start_at);
  const endTime = extractLocalTime(item.end_at);
  return compareLocalTime(startTime, window.open) >= 0 && compareLocalTime(endTime, window.close) <= 0;
}

function buildItemTitle(item: ItineraryItem, placeName: string): string {
  if (item.kind === "meal") {
    const prefix = item.category ? capitalize(item.category) : "Meal";
    return `${prefix} at ${placeName}`;
  }

  if (item.kind === "check_in") {
    return `Check in at ${placeName}`;
  }

  if (item.kind === "check_out") {
    return `Check out of ${placeName}`;
  }

  return placeName;
}

function pickMealStart(window: TimeWindow, day: ItineraryDay): string {
  const firstAfterWindow = day.items.find(
    (item) => compareIso(item.start_at, `${day.date}T${window.start}:00${item.start_at.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "Z"}`) >= 0
  );
  if (!firstAfterWindow) {
    return window.start;
  }

  const candidate = extractLocalTime(firstAfterWindow.start_at);
  return compareIso(
    `${day.date}T${candidate}:00${firstAfterWindow.start_at.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "Z"}`,
    `${day.date}T${window.end}:00${firstAfterWindow.start_at.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "Z"}`
  ) <= 0
    ? candidate
    : window.start;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function inferDayOffset(day: ItineraryDay, timeZone: string): string {
  return day.items[0]?.start_at.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? offsetForTimeZoneOnDate(day.date, timeZone);
}

function coerceMealType(value: unknown): "breakfast" | "lunch" | "dinner" | null {
  return value === "breakfast" || value === "lunch" || value === "dinner" ? value : null;
}

function coerceTime(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
}

function coerceNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function weekdayForItem(item: ItineraryItem, itinerary: Itinerary): string {
  const day = itinerary.days.find((candidate) => candidate.items.some((candidateItem) => candidateItem.id === item.id));
  return day?.date ? new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase() : "";
}
