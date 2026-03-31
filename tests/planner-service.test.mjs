import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../server/app/create-runtime.mjs";

test("planner service can preview and apply a dinner replacement", async () => {
  const previousProvider = process.env.PLANNER_PROVIDER;
  process.env.PLANNER_PROVIDER = "mock";
  const runtime = await createRuntime();
  try {
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
  } finally {
    if (previousProvider === undefined) {
      delete process.env.PLANNER_PROVIDER;
    } else {
      process.env.PLANNER_PROVIDER = previousProvider;
    }
  }
});
