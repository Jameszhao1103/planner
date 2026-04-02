import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../server/app/create-runtime.mjs";

async function withMockRuntime(run) {
  const previousProvider = process.env.PLANNER_PROVIDER;
  process.env.PLANNER_PROVIDER = "mock";
  const runtime = await createRuntime();
  try {
    await run(runtime);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.PLANNER_PROVIDER;
    } else {
      process.env.PLANNER_PROVIDER = previousProvider;
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
