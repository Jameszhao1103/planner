import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTimelineLayout,
  buildTimelineModel,
  computeTimelineWindow,
} from "../public/app/timeline.js";

test("timeline layout keeps overlapping events visible on separate rows", () => {
  const dayDate = "2026-06-17";
  const timeZone = "America/Denver";
  const events = [
    {
      id: "flow_item_old",
      itemId: "item_old",
      kind: "activity",
      title: "Old Faithful",
      timelineTitle: "Old",
      start_at: "2026-06-17T09:00:00-06:00",
      end_at: "2026-06-17T11:00:00-06:00",
      warningCount: 0,
      locked: false,
      meta: "Activity",
      className: "activity",
    },
    {
      id: "flow_item_upper",
      itemId: "item_upper",
      kind: "activity",
      title: "Upper Geyser Basin",
      timelineTitle: "Upper",
      start_at: "2026-06-17T10:00:00-06:00",
      end_at: "2026-06-17T12:00:00-06:00",
      warningCount: 1,
      locked: false,
      meta: "Activity",
      className: "activity",
    },
  ];

  const window = computeTimelineWindow(events, dayDate, timeZone);
  const layout = buildTimelineLayout(events, window, dayDate, timeZone);

  assert.equal(layout.events.length, 2);
  assert.equal(layout.rows, 2);
  assert.notEqual(layout.events[0].top, layout.events[1].top);
});

test("timeline route strips use route origin across unplaced intermediate items", () => {
  const day = {
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
  };
  const trip = {
    places: [
      {
        place_id: "place_upper",
        name: "Upper Geyser Basin",
        category: "landmark",
        lat: 44.4605,
        lng: -110.8281,
      },
      {
        place_id: "place_grand",
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
        duration_minutes: 17,
        distance_meters: 12000,
      },
    ],
    conflicts: [],
  };

  const model = buildTimelineModel(trip, day);

  assert.equal(model.transports.length, 1);
  assert.equal(model.transports[0].fromItemId, "item_upper");
  assert.equal(model.transports[0].toItemId, "item_grand");
  assert.equal(model.transports[0].start_at, "2026-06-17T13:00:00-06:00");
  assert.match(model.transports[0].meta, /scheduled window 75 min/);
});
