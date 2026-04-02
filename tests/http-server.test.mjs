import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../server/app/create-runtime.mjs";
import { handleAppRequest, toErrorResponse } from "../server/app/app-router.mjs";

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

test("app router exposes trip load, preview, and execute endpoints", async () => {
  await withMockRuntime(async (runtime) => {
    const tripId = runtime.sampleTripId;

    const tripResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: `/api/trips/${tripId}`,
    });
    assert.equal(tripResponse.status, 200);
    assert.equal(tripResponse.payload.ok, true);
    assert.equal(tripResponse.payload.data.trip.trip_id, tripId);
    assert.equal(tripResponse.payload.data.workspace.provider, "mock");

    const previewResponse = await handleAppRequest(runtime, {
      method: "POST",
      url: `/api/trips/${tripId}/commands/preview`,
      body: {
        base_version: 1,
        input: {
          commands: [
            {
              command_id: "cmd_test_relax",
              action: "relax_day",
              day_date: "2026-04-12",
              reason: "test relax day",
            },
          ],
        },
      },
    });

    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.payload.ok, true);
    assert.equal(previewResponse.payload.data.base_version, 1);
    assert.ok(previewResponse.payload.data.preview_id);
    assert.ok(previewResponse.payload.data.trip_preview.days[0].items.length > 0);

    const executeResponse = await handleAppRequest(runtime, {
      method: "POST",
      url: `/api/trips/${tripId}/commands/execute`,
      body: {
        base_version: 1,
        input: {
          commands: [
            {
              command_id: "cmd_test_lock",
              action: "lock_item",
              item_id: "item_lunch",
              day_date: "2026-04-12",
              reason: "test direct lock",
            },
          ],
        },
      },
    });

    assert.equal(executeResponse.status, 200);
    assert.equal(executeResponse.payload.ok, true);
    assert.equal(executeResponse.payload.data.trip.version, 2);
    assert.equal(executeResponse.payload.data.undo_commands.length, 1);
    const lunch = executeResponse.payload.data.trip.days[0].items.find((item) => item.id === "item_lunch");
    assert.equal(lunch?.locked, true);
  });
});

test("execute endpoint rejects utterance input", async () => {
  await withMockRuntime(async (runtime) => {
    const tripId = runtime.sampleTripId;
    try {
      await handleAppRequest(runtime, {
        method: "POST",
        url: `/api/trips/${tripId}/commands/execute`,
        body: {
          base_version: 1,
          input: {
            utterance: "lock lunch",
          },
        },
      });
      assert.fail("Expected execute endpoint to reject utterance input.");
    } catch (error) {
      const response = toErrorResponse(error);
      assert.equal(response.status, 400);
      assert.equal(response.payload.ok, false);
      assert.match(response.payload.error.message, /structured commands/i);
    }
  });
});
