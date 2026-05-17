import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../server/app/create-runtime.mjs";
import {
  InMemoryPreviewRepository,
  InMemoryTripRepository,
  PlannerService,
  recomputeDerivedState,
} from "../server/planner/index.ts";
import { MockPlacesAdapter, MockRoutesAdapter } from "../server/integrations/mock/index.ts";

async function withMockRuntime(run) {
  const previousProvider = process.env.PLANNER_PROVIDER;
  const previousStorageMode = process.env.PLANNER_STORAGE_MODE;
  process.env.PLANNER_PROVIDER = "mock";
  process.env.PLANNER_STORAGE_MODE = "memory";
  const runtime = await createRuntime();
  try {
    await run(runtime);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.PLANNER_PROVIDER;
    } else {
      process.env.PLANNER_PROVIDER = previousProvider;
    }

    if (previousStorageMode === undefined) {
      delete process.env.PLANNER_STORAGE_MODE;
    } else {
      process.env.PLANNER_STORAGE_MODE = previousStorageMode;
    }
  }
}

test("planner service can preview and apply a dinner replacement", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        utterance: "把周六晚餐换成评分高一点的美式餐厅",
      },
    });

    const dinner = preview.trip_preview.days[0].items.find((item) => item.id === "item_dinner");
    assert.ok(dinner);
    assert.notEqual(dinner.place_id, "place_curate");
    assert.equal(preview.base_version, 1);
    assert.equal(preview.result_version, 2);

    const applied = await runtime.plannerService.applyPreview({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      previewId: preview.preview_id,
    });

    const appliedDinner = applied.trip.days[0].items.find((item) => item.id === "item_dinner");
    assert.ok(appliedDinner);
    assert.equal(applied.trip.version, 2);
    assert.notEqual(appliedDinner.place_id, "place_curate");
  });
});

test("planner service can reorder an item within the day", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_reorder_test",
            action: "reorder_item",
            day_date: "2026-04-12",
            item_id: "item_lunch",
            target_item_id: "item_walk_river_arts",
            reason: "Move lunch later in the afternoon",
            payload: {
              position: "after",
            },
          },
        ],
      },
    });

    const day = preview.trip_preview.days.find((item) => item.date === "2026-04-12");
    assert.ok(day);
    const walkIndex = day.items.findIndex((item) => item.id === "item_walk_river_arts");
    const lunch = day.items.find((item) => item.id === "item_lunch");
    const lunchIndex = day.items.findIndex((item) => item.id === "item_lunch");

    assert.ok(lunch);
    assert.ok(walkIndex !== -1);
    assert.ok(lunchIndex > walkIndex);
    assert.equal(lunch.start_at, "2026-04-12T16:00:00-04:00");
  });
});

test("planner service uses selected day context for current-day dinner replacement", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        utterance: "把当前这天的晚餐换成评分高一点的美式餐厅",
        context: {
          selected_day: "2026-04-13",
        },
      },
    });

    const day1Dinner = preview.trip_preview.days[0].items.find((item) => item.id === "item_dinner");
    const day2Dinner = preview.trip_preview.days[1].items.find((item) => item.id === "item_day2_dinner");

    assert.ok(day1Dinner);
    assert.ok(day2Dinner);
    assert.equal(day1Dinner.place_id, "place_curate");
    assert.notEqual(day2Dinner.place_id, "place_admiral");
  });
});

test("sample trip starts without warning conflicts", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const warnings = trip.conflicts.filter((conflict) => conflict.severity !== "info");
    assert.deepEqual(warnings, []);
  });
});

test("direct execute can lock an item and provide undo", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const executed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_lock_direct",
            action: "lock_item",
            item_id: "item_lunch",
            day_date: "2026-04-12",
            reason: "Lock lunch directly",
          },
        ],
      },
    });

    const lunch = executed.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.ok(lunch?.locked);
    assert.equal(executed.trip.version, 2);
    assert.equal(executed.applied_command_ids[0], "cmd_lock_direct");
    assert.equal(executed.undo_commands.length, 1);
    assert.equal(executed.undo_commands[0].action, "unlock_item");

    const undone = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: executed.trip.version,
      input: {
        commands: executed.undo_commands,
      },
    });

    const restoredLunch = undone.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.equal(restoredLunch?.locked, false);
  });
});

test("direct execute can move an item and provide undo", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const executed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_move_direct",
            action: "move_item",
            item_id: "item_lunch",
            day_date: "2026-04-12",
            reason: "Move lunch later",
            new_start_at: "2026-04-12T13:00:00-04:00",
            new_end_at: "2026-04-12T14:00:00-04:00",
          },
        ],
      },
    });

    const lunch = executed.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.equal(lunch?.start_at, "2026-04-12T13:00:00-04:00");
    assert.equal(lunch?.end_at, "2026-04-12T14:00:00-04:00");
    assert.equal(executed.undo_commands.length, 1);
    assert.equal(executed.undo_commands[0].action, "move_item");
    assert.equal(executed.undo_commands[0].new_start_at, "2026-04-12T12:30:00-04:00");
  });
});

test("direct execute can update item details and provide undo", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);
    const originalLunch = trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.ok(originalLunch);

    const executed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_update_direct",
            action: "update_item",
            item_id: "item_lunch",
            day_date: "2026-04-12",
            reason: "Update lunch details",
            payload: {
              title: "Picnic at the market",
              kind: "activity",
              category: "market",
              notes: "Keep this flexible if the morning runs long.",
              status: "draft",
            },
          },
        ],
      },
    });

    const lunch = executed.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.equal(lunch?.title, "Picnic at the market");
    assert.equal(lunch?.kind, "activity");
    assert.equal(lunch?.category, "market");
    assert.equal(lunch?.notes, "Keep this flexible if the morning runs long.");
    assert.equal(lunch?.status, "draft");
    assert.equal(executed.undo_commands.length, 1);
    assert.equal(executed.undo_commands[0].action, "update_item");

    const undone = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: executed.trip.version,
      input: {
        commands: executed.undo_commands,
      },
    });

    const restoredLunch = undone.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.equal(restoredLunch?.title, originalLunch.title);
    assert.equal(restoredLunch?.kind, originalLunch.kind);
    assert.equal(restoredLunch?.category, originalLunch.category);
    assert.equal(restoredLunch?.notes, originalLunch.notes);
    assert.equal(restoredLunch?.status, originalLunch.status);
  });
});

test("direct execute rejects update_item on locked stops", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const locked = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_lock_before_update",
            action: "lock_item",
            item_id: "item_lunch",
            day_date: "2026-04-12",
            reason: "Lock lunch",
          },
        ],
      },
    });

    await assert.rejects(
      () =>
        runtime.plannerService.executeCommandsDirect({
          tripId: runtime.sampleTripId,
          baseVersion: locked.trip.version,
          input: {
            commands: [
              {
                command_id: "cmd_update_locked",
                action: "update_item",
                item_id: "item_lunch",
                day_date: "2026-04-12",
                reason: "Update locked lunch",
                payload: {
                  title: "Locked lunch edit",
                },
              },
            ],
          },
        }),
      /locked and cannot be changed/
    );
  });
});

test("direct execute can reorder an item and undo by restoring moved times", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const executed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_reorder_direct",
            action: "reorder_item",
            day_date: "2026-04-12",
            item_id: "item_lunch",
            target_item_id: "item_walk_river_arts",
            reason: "Move lunch after the arts walk",
            payload: {
              position: "after",
            },
          },
        ],
      },
    });

    const changedIds = new Set(executed.changed_item_ids);
    assert.ok(changedIds.has("item_lunch"));
    assert.ok(executed.undo_commands.length >= 1);
    assert.ok(executed.undo_commands.every((command) => command.action === "move_item"));

    const reorderedLunch = executed.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.equal(reorderedLunch?.start_at, "2026-04-12T16:00:00-04:00");

    const undone = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: executed.trip.version,
      input: {
        commands: executed.undo_commands,
      },
    });

    const restoredDay = undone.trip.days.find((day) => day.date === "2026-04-12");
    const restoredLunch = restoredDay?.items.find((item) => item.id === "item_lunch");
    const restoredWalk = restoredDay?.items.find((item) => item.id === "item_walk_river_arts");
    assert.equal(restoredLunch?.start_at, "2026-04-12T12:30:00-04:00");
    assert.equal(restoredWalk?.start_at, "2026-04-12T14:00:00-04:00");
  });
});

test("direct execute rejects utterance input", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    await assert.rejects(
      () =>
        runtime.plannerService.executeCommandsDirect({
          tripId: runtime.sampleTripId,
          baseVersion: trip.version,
          input: {
            utterance: "lock lunch",
          },
        }),
      /Direct execute only accepts structured commands/
    );
  });
});

test("imported itinerary place hydration skips ambiguous matches and reuses airport and lodging anchors", async () => {
  const catalog = [
    manualPlace({
      place_id: "place_jac",
      name: "Jackson Hole Airport",
      category: "airport",
      lat: 43.6073,
      lng: -110.7377,
      address: "1250 E Airport Rd, Jackson, WY 83001",
    }),
    manualPlace({
      place_id: "place_moran_lodge",
      name: "Moran Lodge",
      category: "hotel",
      lat: 44.743,
      lng: -110.487,
      address: "Yellowstone National Park, WY 82190",
    }),
    manualPlace({
      place_id: "place_old_faithful",
      name: "Old Faithful - Observation Deck",
      category: "landmark",
      lat: 44.4595,
      lng: -110.8281,
      address: "Yellowstone National Park, WY 82190",
    }),
    manualPlace({
      place_id: "place_upper_geyser",
      name: "Upper Geyser Basin",
      category: "landmark",
      lat: 44.46,
      lng: -110.8292,
      address: "Yellowstone National Park, WY 82190",
    }),
    manualPlace({
      place_id: "place_grand_prismatic",
      name: "Grand Prismatic Spring",
      category: "landmark",
      lat: 44.5251,
      lng: -110.8382,
      address: "Yellowstone National Park, WY 82190",
    }),
    manualPlace({
      place_id: "place_canyon",
      name: "Canyon Visitor Education Center",
      category: "landmark",
      lat: 44.7281,
      lng: -110.4972,
      address: "Yellowstone National Park, WY 82190",
    }),
    manualPlace({
      place_id: "place_hanks",
      name: "Hanks Chop Shop",
      category: "restaurant",
      lat: 44.6632,
      lng: -111.0994,
      address: "221 N Canyon St, West Yellowstone, MT 59758",
      rating: 4.6,
    }),
    manualPlace({
      place_id: "place_yellowstone_centroid",
      name: "Yellowstone National Park",
      category: "park",
      lat: 44.5979,
      lng: -110.5612,
      address: "United States",
      rating: 4.8,
    }),
    manualPlace({
      place_id: "place_norris",
      name: "Norris Geyser Basin Trailhead",
      category: "landmark",
      lat: 44.7374,
      lng: -110.6983,
      address: "Yellowstone National Park, WY 82190",
      rating: 4.7,
    }),
  ];

  const plannerService = new PlannerService(
    new InMemoryTripRepository(),
    new InMemoryPreviewRepository(),
    {
      placesAdapter: new MockPlacesAdapter(catalog),
      routesAdapter: new MockRoutesAdapter(catalog),
      clock: () => new Date("2026-03-30T21:00:00-04:00"),
    }
  );

  const created = await plannerService.createTrip({
    title: "Yellowstone Imported",
    startDate: "2026-06-16",
    endDate: "2026-06-18",
    timezone: "America/Denver",
    travelerCount: 2,
    importDraft: {
      pace: "balanced",
      days: [
        {
          day_index: 1,
          items: [
            {
              title: "Arrive at Jackson Hole Airport (JAC)",
              kind: "flight",
            },
            {
              title: "Check in at Moran Lodge",
              kind: "check_in",
            },
          ],
        },
        {
          day_index: 2,
          items: [
            {
              title: "Early entry to Yellowstone park",
              kind: "activity",
            },
            {
              title: "Visit Old Faithful Geyser",
              kind: "activity",
            },
            {
              title: "Explore Upper Geyser Basin",
              kind: "activity",
            },
            {
              title: "Lunch",
              kind: "meal",
              category: "lunch",
            },
            {
              title: "Visit Midway Geyser Basin (Grand Prismatic Spring)",
              kind: "activity",
            },
            {
              title: "Optional visit Norris Geyser Basin based on energy",
              kind: "activity",
            },
          ],
        },
        {
          day_index: 3,
          items: [
            {
              title: "Check out from Yellowstone lodging",
              kind: "check_out",
              category: "lodging",
            },
            {
              title: "Return rental car and check in for flight",
              kind: "check_out",
              category: "airport",
            },
          ],
        },
      ],
    },
  });

  const trip = created.trip;
  const day2 = trip.days.find((day) => day.date === "2026-06-17");
  const day3 = trip.days.find((day) => day.date === "2026-06-18");
  assert.ok(day2);
  assert.ok(day3);

  const earlyEntry = day2.items.find((item) => item.title === "Early entry to Yellowstone park");
  const oldFaithful = day2.items.find((item) => item.title === "Visit Old Faithful Geyser");
  const lunch = day2.items.find((item) => item.title === "Lunch");
  const grandPrismatic = day2.items.find((item) => item.title === "Visit Midway Geyser Basin (Grand Prismatic Spring)");
  const optionalNorris = day2.items.find((item) => item.title === "Optional visit Norris Geyser Basin based on energy");
  const checkOut = day3.items.find((item) => item.title === "Check out from Yellowstone lodging");
  const flightReturn = day3.items.find((item) => item.title === "Return rental car and check in for flight");

  assert.equal(earlyEntry?.place_id, undefined);
  assert.equal(oldFaithful?.place_id, "place_old_faithful");
  assert.equal(lunch?.place_id, undefined);
  assert.equal(grandPrismatic?.place_id, "place_grand_prismatic");
  assert.equal(optionalNorris?.place_id, undefined);
  assert.equal(checkOut?.place_id, "place_moran_lodge");
  assert.equal(flightReturn?.place_id, "place_jac");
  assert.ok(!trip.places.some((place) => place.place_id === "place_hanks"));
});

function manualPlace(overrides) {
  return {
    provider: "manual",
    rating: undefined,
    price_level: undefined,
    opening_hours: undefined,
    maps_uri: undefined,
    ...overrides,
  };
}

test("direct execute can delete an item and undo by restoring it", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const executed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_delete_direct",
            action: "delete_item",
            item_id: "item_lunch",
            day_date: "2026-04-12",
            reason: "Delete lunch",
          },
        ],
      },
    });

    assert.equal(executed.trip.days[0].items.some((item) => item.id === "item_lunch"), false);
    assert.equal(executed.undo_commands.length, 1);
    assert.equal(executed.undo_commands[0].action, "restore_item");

    const undone = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: executed.trip.version,
      input: {
        commands: executed.undo_commands,
      },
    });

    assert.equal(undone.trip.days[0].items.some((item) => item.id === "item_lunch"), true);
  });
});

test("direct execute can add an empty day and remove it again", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const executed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_add_day_direct",
            action: "add_day",
            day_date: "2026-04-15",
            reason: "Add a day",
            payload: {
              date: "2026-04-15",
            },
          },
        ],
      },
    });

    assert.equal(executed.trip.days.length, 4);
    assert.equal(executed.trip.end_date, "2026-04-15");
    assert.equal(executed.undo_commands[0].action, "delete_day");

    const removed = await runtime.plannerService.executeCommandsDirect({
      tripId: runtime.sampleTripId,
      baseVersion: executed.trip.version,
      input: {
        commands: executed.undo_commands,
      },
    });

    assert.equal(removed.trip.days.length, 3);
    assert.equal(removed.trip.end_date, "2026-04-14");
  });
});

test("rule fallback can map delete this stop when a stop is selected", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        utterance: "delete this stop",
        context: {
          selected_day: "2026-04-12",
          selected_item_id: "item_lunch",
        },
      },
    });

    assert.equal(preview.commands.length, 1);
    assert.equal(preview.commands[0].action, "delete_item");
    assert.equal(preview.trip_preview.days[0].items.some((item) => item.id === "item_lunch"), false);
  });
});

test("direct execute rejects unsupported actions", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    await assert.rejects(
      () =>
        runtime.plannerService.executeCommandsDirect({
          tripId: runtime.sampleTripId,
          baseVersion: trip.version,
          input: {
            commands: [
              {
                command_id: "cmd_replace_direct",
                action: "replace_place",
                item_id: "item_dinner",
                day_date: "2026-04-12",
                reason: "Should fail in direct execute",
                place_id: "place_white_duck",
              },
            ],
          },
        }),
      /Direct execute only supports/
    );
  });
});

test("insert_item before uses an existing gap without moving the target", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_insert_before_gap",
            action: "insert_item",
            day_date: "2026-04-12",
            target_item_id: "item_walk_river_arts",
            reason: "Insert a short stop before River Arts",
            kind: "activity",
            place_id: "place_battery_bookshop",
            payload: {
              position: "before",
              duration_minutes: 20,
            },
          },
        ],
      },
    });

    const day = preview.trip_preview.days.find((candidate) => candidate.date === "2026-04-12");
    assert.ok(day);
    const inserted = day.items.find((item) => item.place_id === "place_battery_bookshop" && item.id !== "item_bookshop");
    const walk = day.items.find((item) => item.id === "item_walk_river_arts");
    assert.ok(inserted);
    assert.equal(inserted.start_at, "2026-04-12T13:40:00-04:00");
    assert.equal(inserted.end_at, "2026-04-12T14:00:00-04:00");
    assert.equal(walk?.start_at, "2026-04-12T14:00:00-04:00");
  });
});

test("insert_item after pushes later unlocked items when there is no gap", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_insert_after_push",
            action: "insert_item",
            day_date: "2026-04-12",
            target_item_id: "item_hotel_checkin",
            reason: "Add lunch after check-in",
            kind: "meal",
            place_id: "place_stable_cafe",
            payload: {
              position: "after",
              meal_type: "lunch",
            },
          },
        ],
      },
    });

    const day = preview.trip_preview.days.find((candidate) => candidate.date === "2026-04-12");
    assert.ok(day);
    const inserted = day.items.find(
      (item) =>
        item.place_id === "place_stable_cafe" &&
        item.id !== "item_day2_lunch"
    );
    const lunch = day.items.find((item) => item.id === "item_lunch");
    const walk = day.items.find((item) => item.id === "item_walk_river_arts");
    assert.ok(inserted);
    assert.equal(inserted.start_at, "2026-04-12T12:15:00-04:00");
    assert.equal(inserted.end_at, "2026-04-12T13:15:00-04:00");
    assert.equal(lunch?.start_at, "2026-04-12T13:15:00-04:00");
    assert.equal(walk?.start_at, "2026-04-12T14:15:00-04:00");
  });
});

test("insert_item can seed the first stop on an empty day without a target item", async () => {
  await withMockRuntime(async (runtime) => {
    const created = await runtime.plannerService.createTrip({
      title: "Empty test trip",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      timezone: "America/New_York",
      travelerCount: 2,
    });

    const preview = await runtime.plannerService.previewCommand({
      tripId: created.trip.trip_id,
      baseVersion: created.trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_insert_first_stop",
            action: "insert_item",
            day_date: "2026-06-01",
            reason: "Seed the first stop on an empty day",
            kind: "meal",
            place_id: "place_white_duck",
            payload: {
              meal_type: "lunch",
              start_time: "12:00",
            },
          },
        ],
      },
    });

    const day = preview.trip_preview.days.find((candidate) => candidate.date === "2026-06-01");
    assert.ok(day);
    assert.equal(day.items.length, 1);
    assert.equal(day.items[0].place_id, "place_white_duck");
    assert.equal(day.items[0].start_at, "2026-06-01T12:00:00-04:00");
  });
});

test("insert_item throws when a locked item would need to move", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    await assert.rejects(
      () =>
        runtime.plannerService.previewCommand({
          tripId: runtime.sampleTripId,
          baseVersion: trip.version,
          input: {
            commands: [
              {
                command_id: "cmd_insert_locked_fail",
                action: "insert_item",
                day_date: "2026-04-14",
                target_item_id: "item_day3_checkout",
                reason: "Try to squeeze a stop before locked checkout",
                kind: "activity",
                place_id: "place_battery_bookshop",
                payload: {
                  position: "before",
                },
              },
            ],
          },
        }),
      /locked/i
    );
  });
});

test("resolve_conflict can repair an overlap conflict", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const day = trip.days.find((candidate) => candidate.date === "2026-04-12");
    const lunch = day?.items.find((item) => item.id === "item_lunch");
    const walk = day?.items.find((item) => item.id === "item_walk_river_arts");
    assert.ok(lunch);
    assert.ok(walk);

    walk.start_at = "2026-04-12T13:00:00-04:00";
    walk.end_at = "2026-04-12T15:00:00-04:00";
    await recomputeDerivedState(trip, {
      placesAdapter: runtime.placesAdapter,
      routesAdapter: runtime.routesAdapter,
      now: new Date("2026-03-30T21:00:00-04:00"),
    });
    await runtime.tripRepository.saveTrip(trip);

    const conflict = trip.conflicts.find((candidate) => candidate.type === "overlap_conflict");
    assert.ok(conflict);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_resolve_overlap",
            action: "resolve_conflict",
            day_date: "2026-04-12",
            item_id: walk.id,
            reason: "Repair overlap",
            payload: {
              conflict_id: conflict.id,
            },
          },
        ],
      },
    });

    const repairedWalk = preview.trip_preview.days[0].items.find((item) => item.id === walk.id);
    assert.equal(repairedWalk?.start_at, "2026-04-12T13:30:00-04:00");
  });
});

test("resolve_conflict can fill a missing meal window", async () => {
  await withMockRuntime(async (runtime) => {
    const trip = await runtime.tripRepository.getTripById(runtime.sampleTripId);
    assert.ok(trip);

    const day = trip.days.find((candidate) => candidate.date === "2026-04-13");
    assert.ok(day);
    day.items = day.items.filter((item) => item.id !== "item_day2_lunch");
    await recomputeDerivedState(trip, {
      placesAdapter: runtime.placesAdapter,
      routesAdapter: runtime.routesAdapter,
      now: new Date("2026-03-30T21:00:00-04:00"),
    });
    await runtime.tripRepository.saveTrip(trip);

    const conflict = trip.conflicts.find((candidate) => candidate.id === "meal_lunch_2026-04-13");
    assert.ok(conflict);

    const preview = await runtime.plannerService.previewCommand({
      tripId: runtime.sampleTripId,
      baseVersion: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_resolve_meal",
            action: "resolve_conflict",
            day_date: "2026-04-13",
            reason: "Repair missing lunch",
            payload: {
              conflict_id: conflict.id,
            },
          },
        ],
      },
    });

    const lunchItems = preview.trip_preview.days[1].items.filter(
      (item) => item.kind === "meal" && item.category === "lunch"
    );
    assert.equal(lunchItems.length >= 1, true);
  });
});
