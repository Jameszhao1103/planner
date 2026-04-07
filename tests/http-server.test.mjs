import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../server/app/create-server.mjs";
import { createRuntime } from "../server/app/create-runtime.mjs";
import { handleAppRequest, toErrorResponse } from "../server/app/app-router.mjs";

async function withEnv(overrides, run) {
  const previousValues = {
    PLANNER_PROVIDER: process.env.PLANNER_PROVIDER,
    PLANNER_STORAGE_MODE: process.env.PLANNER_STORAGE_MODE,
    PLANNER_ENABLE_DEBUG_ROUTES: process.env.PLANNER_ENABLE_DEBUG_ROUTES,
  };

  applyEnvValue("PLANNER_PROVIDER", overrides.PLANNER_PROVIDER ?? "mock");
  applyEnvValue("PLANNER_STORAGE_MODE", overrides.PLANNER_STORAGE_MODE ?? "memory");
  applyEnvValue("PLANNER_ENABLE_DEBUG_ROUTES", overrides.PLANNER_ENABLE_DEBUG_ROUTES);

  try {
    await run();
  } finally {
    applyEnvValue("PLANNER_PROVIDER", previousValues.PLANNER_PROVIDER);
    applyEnvValue("PLANNER_STORAGE_MODE", previousValues.PLANNER_STORAGE_MODE);
    applyEnvValue("PLANNER_ENABLE_DEBUG_ROUTES", previousValues.PLANNER_ENABLE_DEBUG_ROUTES);
  }
}

function applyEnvValue(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function withMockRuntime(run, overrides = {}) {
  await withEnv(overrides, async () => {
    const runtime = await createRuntime();
    await run(runtime);
  });
}

test("debug routes are disabled by default", async () => {
  await withMockRuntime(async (runtime) => {
    const tripId = runtime.sampleTripId;
    const tripResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: `/api/trips/${tripId}`,
    });

    assert.equal(tripResponse.status, 200);
    assert.equal(tripResponse.payload.data.workspace.debug.enabled, false);

    const runtimeResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: "/api/debug/runtime",
    });

    assert.equal(runtimeResponse.status, 404);
    assert.equal(runtimeResponse.payload.ok, false);
  });
});

test("debug routes can be enabled explicitly", async () => {
  await withMockRuntime(async (runtime) => {
    const tripId = runtime.sampleTripId;
    const tripResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: `/api/trips/${tripId}`,
    });

    assert.equal(tripResponse.status, 200);
    assert.equal(tripResponse.payload.data.workspace.debug.enabled, true);

    const metricsResponse = await handleAppRequest(runtime, {
      method: "GET",
      url: "/api/debug/metrics",
    });

    assert.equal(metricsResponse.status, 200);
    assert.equal(metricsResponse.payload.ok, true);
  }, { PLANNER_ENABLE_DEBUG_ROUTES: "1" });
});

test("server returns 400 for invalid JSON bodies", async () => {
  await assert.rejects(
    readJsonBody(fakeRequestFromChunks([Buffer.from("{invalid")])),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid_request" &&
      /valid json/i.test(error.message)
  );
});

test("server returns 413 for oversized JSON bodies", async () => {
  await assert.rejects(
    readJsonBody(
      fakeRequestFromChunks([
        Buffer.from(
          JSON.stringify({
            title: "Oversized request",
            start_date: "2026-05-01",
            end_date: "2026-05-03",
            timezone: "America/New_York",
            traveler_count: 2,
            notes: "x".repeat(1_100_000),
          })
        ),
      ])
    ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "request_too_large" &&
      /exceeds/i.test(error.message)
  );
});

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
  }, { PLANNER_ENABLE_DEBUG_ROUTES: "1" });
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

test("trip creation rejects invalid timezones", async () => {
  await withMockRuntime(async (runtime) => {
    try {
      await handleAppRequest(runtime, {
        method: "POST",
        url: "/api/trips",
        body: {
          title: "Broken timezone trip",
          start_date: "2026-05-01",
          end_date: "2026-05-03",
          timezone: "Mars/OlympusMons",
          traveler_count: 2,
        },
      });
      assert.fail("Expected invalid timezone to be rejected.");
    } catch (error) {
      const response = toErrorResponse(error);
      assert.equal(response.status, 400);
      assert.equal(response.payload.ok, false);
      assert.match(response.payload.error.message, /invalid iana timezone/i);
    }
  });
});

function fakeRequestFromChunks(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}
