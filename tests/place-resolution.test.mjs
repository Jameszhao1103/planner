import test from "node:test";
import assert from "node:assert/strict";
import { collectUnresolvedPlaceItems, needsPlaceResolution, renderPlaceResolutionQueue } from "../public/app/place-resolution.js";

test("place resolution queue collects map-relevant stops without place ids", () => {
  const trip = {
    days: [
      {
        date: "2026-06-16",
        label: "Day 1",
        items: [
          item({ id: "item_arrival", kind: "flight", title: "Arrive at airport" }),
          item({ id: "item_buffer", kind: "buffer", title: "Transfer buffer" }),
          item({ id: "item_lunch", kind: "meal", title: "Lunch", place_id: "place_lunch" }),
        ],
      },
      {
        date: "2026-06-17",
        label: "Day 2",
        items: [
          item({ id: "item_hike", kind: "activity", title: "Morning hike" }),
          item({ id: "item_free", kind: "free_time", title: "Free time" }),
        ],
      },
    ],
  };

  assert.equal(needsPlaceResolution(trip.days[0].items[0]), true);
  assert.equal(needsPlaceResolution(trip.days[0].items[1]), false);
  assert.equal(needsPlaceResolution(trip.days[0].items[2]), false);

  const unresolved = collectUnresolvedPlaceItems(trip);
  assert.deepEqual(
    unresolved.map(({ dayDate, item }) => [dayDate, item.id]),
    [
      ["2026-06-16", "item_arrival"],
      ["2026-06-17", "item_hike"],
    ]
  );
});

test("place resolution queue renders searchable unresolved stops", () => {
  const html = renderPlaceResolutionQueue({
    days: [
      {
        date: "2026-06-16",
        label: "Day 1",
        items: [
          item({ id: "item_arrival", kind: "flight", title: "Arrive at airport" }),
        ],
      },
    ],
  }, "item_arrival");

  assert.match(html, /Place review/);
  assert.match(html, /1 stop needs map matches/);
  assert.match(html, /data-editor-action="resolve-place"/);
  assert.match(html, /data-item-id="item_arrival"/);
  assert.match(html, /class="place-resolution-item selected"/);
});

function item(overrides) {
  return {
    id: "item",
    kind: "activity",
    title: "Stop",
    start_at: "2026-06-16T09:00:00-06:00",
    end_at: "2026-06-16T10:00:00-06:00",
    status: "suggested",
    locked: false,
    source: "imported",
    ...overrides,
  };
}
