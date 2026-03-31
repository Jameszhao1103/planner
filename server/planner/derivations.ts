import { createId } from "./ids.ts";
import {
  compareIso,
  compareLocalTime,
  extractLocalTime,
  formatLocalTimeRange,
  minutesBetween,
  timeFallsWithinWindow,
  weekdayFromDate,
} from "./time.ts";
import type {
  CommandExecutionContext,
  Itinerary,
  ItineraryConflict,
  ItineraryDay,
  ItineraryItem,
  ItineraryPlace,
  ItineraryRoute,
  MarkdownSection,
  TimeWindow,
  TravelMode,
} from "./types.ts";

export async function recomputeDerivedState(
  itinerary: Itinerary,
  context: CommandExecutionContext
): Promise<void> {
  const previousRoutesByPair = new Map(
    itinerary.routes.map((route) => [routeKey(route.from_item_id, route.to_item_id), route])
  );

  itinerary.routes = [];

  for (const day of itinerary.days) {
    sortDayItems(day);
    resetDayDerivedFields(day);
    const dayRoutes = await recomputeRoutesForDay(itinerary, day, previousRoutesByPair, context);
    itinerary.routes.push(...dayRoutes);
  }

  itinerary.conflicts = buildConflicts(itinerary);
  attachConflictIdsToItems(itinerary);
  itinerary.markdown_sections = buildMarkdownSections(itinerary, context.now);
}

async function recomputeRoutesForDay(
  itinerary: Itinerary,
  day: ItineraryDay,
  previousRoutesByPair: Map<string, ItineraryRoute>,
  context: CommandExecutionContext
): Promise<ItineraryRoute[]> {
  const routes: ItineraryRoute[] = [];

  for (let index = 1; index < day.items.length; index += 1) {
    const previous = day.items[index - 1];
    const current = day.items[index];
    const gapMinutes = Math.max(0, minutesBetween(previous.end_at, current.start_at));
    current.slack_minutes_before = gapMinutes;
    previous.slack_minutes_after = gapMinutes;

    if (!previous.place_id || !current.place_id) {
      current.route_id = undefined;
      continue;
    }

    const fromPlace = findPlace(itinerary, previous.place_id);
    const toPlace = findPlace(itinerary, current.place_id);
    if (!fromPlace || !toPlace) {
      current.route_id = undefined;
      continue;
    }

    const previousRoute = previousRoutesByPair.get(routeKey(previous.id, current.id));
    const mode = resolveTravelMode(previousRoute?.mode, itinerary.preferences.preferred_transport_modes);

    const snapshot = await context.routesAdapter.computeLeg({
      origin: toRouteWaypoint(fromPlace),
      destination: toRouteWaypoint(toPlace),
      travelMode: mode === "flight" ? "drive" : mode,
      includeSteps: true,
    });

    const route: ItineraryRoute = {
      route_id: previousRoute?.route_id ?? createId("route"),
      mode,
      from_item_id: previous.id,
      to_item_id: current.id,
      duration_minutes: snapshot.durationMinutes,
      distance_meters: snapshot.distanceMeters,
      polyline: snapshot.polyline,
      provider: "google_routes",
      steps: (snapshot.steps ?? [])
        .filter((step) => step.distanceMeters !== undefined && step.durationMinutes !== undefined)
        .map((step) => ({
          instruction: step.instruction ?? "Continue",
          duration_minutes: step.durationMinutes ?? 0,
          distance_meters: step.distanceMeters ?? 0,
          polyline: step.polyline,
        })),
    };

    current.route_id = route.route_id;
    current.slack_minutes_before = Math.max(0, gapMinutes - route.duration_minutes);
    previous.slack_minutes_after = current.slack_minutes_before;
    routes.push(route);
  }

  return routes;
}

export function buildConflicts(itinerary: Itinerary): ItineraryConflict[] {
  const conflicts: ItineraryConflict[] = [];

  for (const day of itinerary.days) {
    const dayItems = [...day.items].sort((left, right) => compareIso(left.start_at, right.start_at));

    for (let index = 0; index < dayItems.length; index += 1) {
      const item = dayItems[index];
      const previous = index > 0 ? dayItems[index - 1] : undefined;

      if (previous && compareIso(item.start_at, previous.end_at) < 0) {
        conflicts.push({
          id: `overlap_${previous.id}_${item.id}`,
          type: "overlap_conflict",
          severity: "error",
          message: `${previous.title} overlaps with ${item.title}.`,
          item_ids: [previous.id, item.id],
          resolution_hint: "Move one of the items or reduce its duration.",
        });
      }

      if (previous && item.route_id) {
        const route = itinerary.routes.find((candidate) => candidate.route_id === item.route_id);
        if (route) {
          const gapMinutes = Math.max(0, minutesBetween(previous.end_at, item.start_at));
          if (gapMinutes < route.duration_minutes) {
            conflicts.push({
              id: `travel_${route.route_id}`,
              type: "travel_time_underestimated",
              severity: "warning",
              message: `Travel from ${previous.title} to ${item.title} needs ${route.duration_minutes} minutes, but only ${gapMinutes} minutes are scheduled.`,
              item_ids: [previous.id, item.id],
              resolution_hint: "Move the next item later or choose a faster transport mode.",
            });
          }

          if (route.mode === "walk" && route.duration_minutes > itinerary.preferences.max_walk_minutes) {
            conflicts.push({
              id: `pace_walk_${route.route_id}`,
              type: "pace_limit_exceeded",
              severity: "warning",
              message: `Walking segment to ${item.title} is ${route.duration_minutes} minutes, above the preferred ${itinerary.preferences.max_walk_minutes} minute limit.`,
              item_ids: [previous.id, item.id],
              resolution_hint: "Switch the segment to taxi, transit, or drive.",
            });
          }
        }
      }

      const place = item.place_id ? findPlace(itinerary, item.place_id) : undefined;
      if (place?.opening_hours?.length) {
        const openingConflict = maybeCreateOpeningHoursConflict(day.date, item, place);
        if (openingConflict) {
          conflicts.push(openingConflict);
        }
      }
    }

    conflicts.push(...buildMealCoverageConflicts(itinerary, day));
    const paceConflict = maybeCreatePaceConflict(day);
    if (paceConflict) {
      conflicts.push(paceConflict);
    }
  }

  return conflicts;
}

export function buildMarkdownSections(itinerary: Itinerary, now: Date): MarkdownSection[] {
  return itinerary.days.map((day) => {
    const lines = day.items
      .slice()
      .sort((left, right) => compareIso(left.start_at, right.start_at))
      .map((item) => {
        const timeRange = formatLocalTimeRange(item.start_at, item.end_at);
        const route = item.route_id
          ? itinerary.routes.find((candidate) => candidate.route_id === item.route_id)
          : undefined;
        const routeLine =
          route && route.duration_minutes > 0
            ? ` Travel: ${route.mode}, ${route.duration_minutes} min.`
            : "";
        const warningCount = item.validation_conflict_ids?.length ?? 0;
        const warningLine = warningCount > 0 ? ` Warning: ${warningCount} conflict(s).` : "";
        return `- ${timeRange} ${item.title}.${routeLine}${warningLine}`;
      });

    return {
      day_date: day.date,
      generated_at: now.toISOString(),
      content: [`## ${day.label}`, "", ...lines].join("\n"),
    };
  });
}

export function upsertPlace(itinerary: Itinerary, place: ItineraryPlace): void {
  const index = itinerary.places.findIndex((candidate) => candidate.place_id === place.place_id);
  if (index === -1) {
    itinerary.places.push(place);
    return;
  }

  itinerary.places[index] = place;
}

export function placeFromSnapshot(snapshot: {
  placeId: string;
  provider: "google_places";
  name: string;
  category: string;
  location: { lat: number; lng: number };
  formattedAddress?: string;
  rating?: number;
  priceLevel?: number;
  regularOpeningHours?: { weekday: string; open: string; close: string }[];
  googleMapsUri?: string;
}): ItineraryPlace {
  return {
    place_id: snapshot.placeId,
    provider: snapshot.provider,
    name: snapshot.name,
    category: isPlaceCategory(snapshot.category) ? snapshot.category : "other",
    lat: snapshot.location.lat,
    lng: snapshot.location.lng,
    address: snapshot.formattedAddress,
    rating: snapshot.rating,
    price_level: snapshot.priceLevel,
    opening_hours: snapshot.regularOpeningHours?.filter(isOpeningHoursWindow),
    maps_uri: snapshot.googleMapsUri,
  };
}

function sortDayItems(day: ItineraryDay): void {
  day.items.sort((left, right) => compareIso(left.start_at, right.start_at));
}

function resetDayDerivedFields(day: ItineraryDay): void {
  for (const item of day.items) {
    item.duration_minutes = Math.max(0, minutesBetween(item.start_at, item.end_at));
    item.slack_minutes_before = 0;
    item.slack_minutes_after = 0;
    item.validation_conflict_ids = [];
  }
}

function maybeCreateOpeningHoursConflict(
  dayDate: string,
  item: ItineraryItem,
  place: ItineraryPlace
): ItineraryConflict | null {
  const weekday = weekdayFromDate(dayDate);
  const hours = place.opening_hours?.find((window) => window.weekday === weekday);
  if (!hours) {
    return {
      id: `hours_${item.id}`,
      type: "opening_hours_conflict",
      severity: "warning",
      message: `${item.title} is scheduled on a day without published opening hours.`,
      item_ids: [item.id],
      resolution_hint: "Verify venue hours or replace the stop.",
    };
  }

  const start = extractLocalTime(item.start_at);
  const end = extractLocalTime(item.end_at);
  if (compareLocalTime(start, hours.open) < 0 || compareLocalTime(end, hours.close) > 0) {
    return {
      id: `hours_${item.id}`,
      type: "opening_hours_conflict",
      severity: "warning",
      message: `${item.title} is scheduled outside ${hours.open}-${hours.close}.`,
      item_ids: [item.id],
      resolution_hint: "Move the visit or pick a venue with compatible hours.",
    };
  }

  return null;
}

function buildMealCoverageConflicts(itinerary: Itinerary, day: ItineraryDay): ItineraryConflict[] {
  const conflicts: ItineraryConflict[] = [];

  const lunchItems = day.items.filter(
    (item) =>
      item.kind === "meal" &&
      (item.category === "lunch" ||
        timeFallsWithinWindow(extractLocalTime(item.start_at), itinerary.preferences.meal_windows.lunch))
  );
  if (lunchItems.length === 0) {
    conflicts.push(createMealConflict(day.date, "lunch", itinerary.preferences.meal_windows.lunch));
  }

  const dinnerItems = day.items.filter(
    (item) =>
      item.kind === "meal" &&
      (item.category === "dinner" ||
        timeFallsWithinWindow(extractLocalTime(item.start_at), itinerary.preferences.meal_windows.dinner))
  );
  if (dinnerItems.length === 0) {
    conflicts.push(createMealConflict(day.date, "dinner", itinerary.preferences.meal_windows.dinner));
  }

  return conflicts;
}

function createMealConflict(dayDate: string, mealType: string, window: TimeWindow): ItineraryConflict {
  return {
    id: `meal_${mealType}_${dayDate}`,
    type: "meal_window_missing",
    severity: "info",
    message: `No ${mealType} is scheduled between ${window.start} and ${window.end}.`,
    item_ids: [],
    resolution_hint: `Use fill_meal to add a ${mealType} near the current route.`,
  };
}

function maybeCreatePaceConflict(day: ItineraryDay): ItineraryConflict | null {
  if (day.items.length < 2) {
    return null;
  }

  const scheduledMinutes = day.items.reduce((total, item) => total + (item.duration_minutes ?? 0), 0);
  const daySpan = Math.max(1, minutesBetween(day.items[0].start_at, day.items[day.items.length - 1].end_at));
  const packedness = scheduledMinutes / daySpan;
  if (packedness <= 0.9) {
    return null;
  }

  return {
    id: `pace_${day.date}`,
    type: "pace_limit_exceeded",
    severity: "warning",
    message: `${day.label} is highly packed with ${Math.round(packedness * 100)}% of the day scheduled.`,
    item_ids: day.items.map((item) => item.id),
    resolution_hint: "Relax the day, shorten a stop, or add more buffer time.",
  };
}

function attachConflictIdsToItems(itinerary: Itinerary): void {
  const byItem = new Map<string, string[]>();
  itinerary.conflicts.forEach((conflict) => {
    conflict.item_ids.forEach((itemId) => {
      const list = byItem.get(itemId) ?? [];
      list.push(conflict.id);
      byItem.set(itemId, list);
    });
  });

  itinerary.days.forEach((day) => {
    day.items.forEach((item) => {
      item.validation_conflict_ids = byItem.get(item.id) ?? [];
    });
  });
}

function findPlace(itinerary: Itinerary, placeId: string): ItineraryPlace | undefined {
  return itinerary.places.find((candidate) => candidate.place_id === placeId);
}

function resolveTravelMode(
  currentMode: TravelMode | undefined,
  preferredModes: TravelMode[]
): TravelMode {
  if (currentMode && currentMode !== "flight") {
    return currentMode;
  }

  const preferred = preferredModes.find((mode) => mode !== "flight");
  return preferred ?? "drive";
}

function routeKey(fromItemId: string, toItemId: string): string {
  return `${fromItemId}__${toItemId}`;
}

function toRouteWaypoint(place: ItineraryPlace) {
  return place.provider === "google_places"
    ? {
        placeId: place.place_id,
        location: { lat: place.lat, lng: place.lng },
      }
    : {
        location: { lat: place.lat, lng: place.lng },
      };
}

function isPlaceCategory(value: string): value is ItineraryPlace["category"] {
  return [
    "airport",
    "hotel",
    "restaurant",
    "museum",
    "park",
    "shopping",
    "landmark",
    "station",
    "other",
  ].includes(value);
}

function isOpeningHoursWindow(value: {
  weekday: string;
  open: string;
  close: string;
}): value is NonNullable<ItineraryPlace["opening_hours"]>[number] {
  return Boolean(value.weekday && value.open && value.close);
}
