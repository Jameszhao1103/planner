import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../server/app/create-runtime.mjs";
import { handleAppRequest } from "../server/app/app-router.mjs";

test("app router exposes trip load and preview endpoints", async () => {
  const runtime = await createRuntime();
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
});
