import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody, resolvePublicAssetPath } from "../server/app/create-server.mjs";
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

test("static asset resolver allows nested public modules", () => {
  const resolved = resolvePublicAssetPath("/app/main.js");
  assert.ok(resolved?.endsWith("/public/app/main.js"));
});

test("static asset resolver rejects path traversal", () => {
  assert.equal(resolvePublicAssetPath("/../package.json"), null);
  assert.equal(resolvePublicAssetPath("/..%2Fpackage.json"), null);
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

test("trip intake parser extracts create-trip fields from a pasted brief", async () => {
  await withMockRuntime(async (runtime) => {
    const response = await handleAppRequest(runtime, {
      method: "POST",
      url: "/api/trips/intake/parse",
      body: {
        source_text: "Kyoto Food Weekend from 2026-05-01 to 2026-05-03 in Asia/Tokyo for 2 travelers",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.draft.title, "Kyoto Food Weekend");
    assert.equal(response.payload.data.draft.start_date, "2026-05-01");
    assert.equal(response.payload.data.draft.end_date, "2026-05-03");
    assert.equal(response.payload.data.draft.timezone, "Asia/Tokyo");
    assert.equal(response.payload.data.draft.traveler_count, 2);
    assert.equal(response.payload.data.can_create, true);
  });
});

test("trip intake parser keeps duration while asking for exact missing dates", async () => {
  await withMockRuntime(async (runtime) => {
    const response = await handleAppRequest(runtime, {
      method: "POST",
      url: "/api/trips/intake/parse",
      body: {
        source_text: "6月、5天、Jackson 进出、第一次去也比较稳",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.draft.start_date, null);
    assert.equal(response.payload.data.draft.end_date, null);
    assert.equal(response.payload.data.draft.timezone, "America/Denver");
    assert.equal(response.payload.data.derived.duration_days, 5);
    assert.equal(response.payload.data.itinerary.day_count, 5);
    assert.equal(response.payload.data.can_create, false);
    assert.deepEqual(response.payload.data.blocking_missing_fields, ["start_date", "end_date"]);
  });
});

test("trip intake parser can apply a follow-up answer to fill missing dates", async () => {
  await withMockRuntime(async (runtime) => {
    const response = await handleAppRequest(runtime, {
      method: "POST",
      url: "/api/trips/intake/parse",
      body: {
        source_text: "6月、5天、Jackson 进出、第一次去也比较稳",
        clarification_text: "Start date: 2026-06-10",
        known_draft: {
          title: "Jackson and Yellowstone",
          start_date: null,
          end_date: null,
          timezone: "America/Denver",
          traveler_count: null,
        },
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.draft.start_date, "2026-06-10");
    assert.equal(response.payload.data.draft.end_date, "2026-06-14");
    assert.equal(response.payload.data.can_create, true);
  });
});

test("trip creation can persist an imported itinerary draft directly into days and items", async () => {
  await withMockRuntime(async (runtime) => {
    const createResponse = await handleAppRequest(runtime, {
      method: "POST",
      url: "/api/trips",
      body: {
        title: "Yellowstone Loop",
        start_date: "2026-06-10",
        end_date: "2026-06-14",
        timezone: "America/Denver",
        traveler_count: 2,
        import_draft: {
          pace: "balanced",
          days: [
            {
              day_index: 1,
              summary: "Arrive in Jackson and settle in.",
              items: [
                {
                  title: "Arrive in Jackson",
                  kind: "flight",
                  start_time: "10:00",
                  end_time: "12:00",
                  status: "confirmed",
                  locked: true,
                },
                {
                  title: "South Teton scenic stops",
                  kind: "activity",
                  start_time: "14:00",
                  end_time: "17:00",
                },
              ],
            },
            {
              day_index: 2,
              summary: "Jenny Lake core day.",
              items: [
                {
                  title: "Jenny Lake",
                  kind: "activity",
                  start_time: "08:30",
                  end_time: "12:30",
                },
                {
                  title: "Dinner in Jackson",
                  kind: "meal",
                  category: "dinner",
                  start_time: "18:30",
                  end_time: "20:00",
                },
              ],
            },
          ],
        },
      },
    });

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.payload.ok, true);
    assert.equal(createResponse.payload.data.trip.days.length, 5);
    assert.equal(createResponse.payload.data.trip.days[0].items.length, 2);
    assert.equal(createResponse.payload.data.trip.days[1].items.length, 2);
    assert.equal(createResponse.payload.data.trip.days[2].items.length, 0);
    assert.equal(createResponse.payload.data.trip.days[0].items[0].source, "imported");
    assert.equal(createResponse.payload.data.trip.days[0].items[0].locked, true);
    assert.equal(createResponse.payload.data.trip.days[0].items[1].title, "South Teton scenic stops");
  });
});

test("imported itinerary auto-resolves matching places and computes routes", async () => {
  await withMockRuntime(async (runtime) => {
    const createResponse = await handleAppRequest(runtime, {
      method: "POST",
      url: "/api/trips",
      body: {
        title: "Asheville Imported",
        start_date: "2026-04-12",
        end_date: "2026-04-12",
        timezone: "America/New_York",
        traveler_count: 2,
        import_draft: {
          pace: "balanced",
          days: [
            {
              day_index: 1,
              summary: "Arrival and downtown evening.",
              items: [
                {
                  title: "Arrive at AVL",
                  kind: "flight",
                  start_time: "09:10",
                  end_time: "10:45",
                  status: "confirmed",
                  locked: true,
                },
                {
                  title: "Check in at The Foundry Hotel Asheville",
                  kind: "check_in",
                  start_time: "11:45",
                  end_time: "12:15",
                },
                {
                  title: "Lunch at White Duck Taco Shop",
                  kind: "meal",
                  category: "lunch",
                  start_time: "12:30",
                  end_time: "13:30",
                },
              ],
            },
          ],
        },
      },
    });

    assert.equal(createResponse.status, 201);
    const trip = createResponse.payload.data.trip;
    assert.equal(trip.days[0].items[0].place_id, "place_avl");
    assert.equal(trip.days[0].items[1].place_id, "place_foundry");
    assert.equal(trip.days[0].items[2].place_id, "place_white_duck");
    assert.ok(trip.routes.length >= 2);
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
