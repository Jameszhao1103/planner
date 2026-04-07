import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../server/app/create-runtime.mjs";
import { handleAppRequest, toErrorResponse } from "../server/app/app-router.mjs";

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

test("metrics endpoint exposes request counters", async () => {
  await withMockRuntime(async (runtime) => {
    const tripId = runtime.sampleTripId;

    await handleAppRequest(runtime, {
      method: "GET",
      url: `/api/trips/${tripId}`,
    });

    const metricsResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: "/api/debug/metrics",
    });

    assert.equal(metricsResponse.status, 200);
    assert.equal(metricsResponse.payload.ok, true);
    assert.equal(typeof metricsResponse.payload.data.requests?.total, "number");
  });
});

test("rename endpoint updates the trip title", async () => {
  await withMockRuntime(async (runtime) => {
    const tripId = runtime.sampleTripId;

    const renameResponse = await handleAppRequest(runtime, {
      method: "POST",
      url: `/api/trips/${tripId}/rename`,
      body: {
        base_version: 1,
        title: "Blue Ridge Escape",
      },
    });

    assert.equal(renameResponse.status, 200);
    assert.equal(renameResponse.payload.ok, true);
    assert.equal(renameResponse.payload.data.trip.title, "Blue Ridge Escape");
    assert.equal(renameResponse.payload.data.trip.version, 2);
  });
});

test("trip endpoints expose saved trip summaries and create a new trip", async () => {
  await withMockRuntime(async (runtime) => {
    const listResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: "/api/trips",
    });

    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.payload.ok, true);
    assert.equal(listResponse.payload.data.trips.length, 1);

    const createResponse = await handleAppRequest(runtime, {
      method: "POST",
      url: "/api/trips",
      body: {
        title: "Kyoto Food Weekend",
        start_date: "2026-05-01",
        end_date: "2026-05-03",
        timezone: "Asia/Tokyo",
        traveler_count: 2,
      },
    });

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.payload.ok, true);
    assert.equal(createResponse.payload.data.trip.title, "Kyoto Food Weekend");
    assert.equal(createResponse.payload.data.trip.days.length, 3);

    const updatedList = await handleAppRequest(runtime, {
      method: "GET",
      url: "/api/trips",
    });

    assert.equal(updatedList.payload.data.trips.length, 2);
    assert.ok(updatedList.payload.data.trips.some((trip) => trip.title === "Kyoto Food Weekend"));
  });
});
