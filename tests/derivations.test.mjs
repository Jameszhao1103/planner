import test from "node:test";
import assert from "node:assert/strict";
import { buildConflicts } from "../server/planner/index.ts";

test("travel conflicts use the route origin instead of an unplaced intermediate item", () => {
  const itinerary = {
    trip_id: "trip_test",
    version: 1,
    title: "Route Origin Test",
    timezone: "America/Denver",
    start_date: "2026-06-17",
    end_date: "2026-06-17",
    preferences: {
      pace: "balanced",
      max_walk_minutes: 30,
      preferred_transport_modes: ["drive"],
      meal_windows: {
        lunch: { start: "12:00", end: "14:00" },
        dinner: { start: "18:00", end: "20:00" },
      },
    },
    days: [
      {
        date: "2026-06-17",
        label: "Day 4",
        items: [
          {
            id: "item_upper",
            kind: "activity",
            title: "Upper Geyser Basin",
            start_at: "2026-06-17T11:00:00-06:00",
            end_at: "2026-06-17T13:00:00-06:00",
            status: "suggested",
            locked: false,
            source: "ai",
            place_id: "place_upper",
          },
          {
            id: "item_lunch",
            kind: "meal",
            title: "Lunch near Old Faithful",
            start_at: "2026-06-17T13:00:00-06:00",
            end_at: "2026-06-17T14:15:00-06:00",
            status: "suggested",
            locked: false,
            source: "ai",
            category: "lunch",
          },
          {
            id: "item_grand",
            kind: "activity",
            title: "Grand Prismatic Spring",
            start_at: "2026-06-17T14:15:00-06:00",
            end_at: "2026-06-17T16:00:00-06:00",
            status: "suggested",
            locked: false,
            source: "ai",
            place_id: "place_grand",
            route_id: "route_upper_grand",
          },
        ],
      },
    ],
    places: [
      {
        place_id: "place_upper",
        provider: "manual",
        name: "Upper Geyser Basin",
        category: "landmark",
        lat: 44.4605,
        lng: -110.8281,
      },
      {
        place_id: "place_grand",
        provider: "manual",
        name: "Grand Prismatic Spring",
        category: "landmark",
        lat: 44.5251,
        lng: -110.8382,
      },
    ],
    routes: [
      {
        route_id: "route_upper_grand",
        mode: "drive",
        from_item_id: "item_upper",
        to_item_id: "item_grand",
        duration_minutes: 90,
        distance_meters: 18000,
      },
    ],
    conflicts: [],
    change_log: [],
  };

  const travelConflict = buildConflicts(itinerary).find(
    (conflict) => conflict.id === "travel_route_upper_grand"
  );

  assert.ok(travelConflict);
  assert.deepEqual(travelConflict.item_ids, ["item_upper", "item_grand"]);
  assert.match(travelConflict.message, /Travel from Upper Geyser Basin to Grand Prismatic Spring/);
  assert.doesNotMatch(travelConflict.message, /Lunch near Old Faithful/);
});
