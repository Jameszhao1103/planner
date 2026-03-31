import { randomUUID } from "node:crypto";
import { PlannerError } from "../planner/errors.ts";

export async function handleAppRequest(runtime, request) {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname;

  if (request.method === "GET" && pathname.startsWith("/api/trips/")) {
    const tripId = pathname.split("/")[3];
    const trip = await runtime.tripRepository.getTripById(tripId);
    if (!trip) {
      throw new PlannerError("trip_not_found", `Trip not found: ${tripId}`);
    }

    return json(200, {
      ok: true,
      data: {
        trip,
        workspace: {
          selected_day: trip.days[0]?.date ?? null,
          summary_counts: summarizeTrip(trip),
          provider: runtime.provider,
          maps: {
            browser_api_key: runtime.mapsBrowserApiKey ?? null,
            browser_api_key_present: Boolean(runtime.mapsBrowserApiKey),
          },
        },
      },
      meta: {
        request_id: randomUUID(),
        trip_id: trip.trip_id,
        version: trip.version,
      },
    });
  }

  if (request.method === "GET" && pathname === "/api/places/search") {
    const query = url.searchParams.get("q") ?? "";
    const candidates = await runtime.placesAdapter.searchByText({
      query,
      includedType: url.searchParams.get("type") ?? undefined,
      pageSize: Number.parseInt(url.searchParams.get("page_size") ?? "5", 10),
    });

    return json(200, {
      ok: true,
      data: { candidates },
      meta: {
        request_id: randomUUID(),
      },
    });
  }

  if (request.method === "POST" && pathname.match(/^\/api\/trips\/[^/]+\/commands\/preview$/)) {
    const tripId = pathname.split("/")[3];
    const preview = await runtime.plannerService.previewCommand({
      tripId,
      baseVersion: request.body.base_version,
      input: request.body.input,
    });

    return json(200, {
      ok: true,
      data: preview,
      meta: {
        request_id: randomUUID(),
        trip_id: tripId,
        version: preview.result_version,
      },
    });
  }

  if (request.method === "POST" && pathname.match(/^\/api\/trips\/[^/]+\/commands\/apply$/)) {
    const tripId = pathname.split("/")[3];
    const result = await runtime.plannerService.applyPreview({
      tripId,
      baseVersion: request.body.base_version,
      previewId: request.body.preview_id,
    });

    return json(200, {
      ok: true,
      data: result,
      meta: {
        request_id: randomUUID(),
        trip_id: tripId,
        version: result.trip.version,
      },
    });
  }

  if (request.method === "POST" && pathname.match(/^\/api\/trips\/[^/]+\/commands\/reject$/)) {
    const tripId = pathname.split("/")[3];
    await runtime.plannerService.rejectPreview({
      tripId,
      previewId: request.body.preview_id,
    });

    return json(200, {
      ok: true,
      data: { rejected: true },
      meta: {
        request_id: randomUUID(),
        trip_id: tripId,
      },
    });
  }

  if (request.method === "POST" && pathname === "/api/debug/reset") {
    const nextRuntime = await runtime.reset();
    const trip = await nextRuntime.tripRepository.getTripById(nextRuntime.sampleTripId);
    return json(200, {
      ok: true,
      data: { trip },
      meta: {
        request_id: randomUUID(),
        trip_id: nextRuntime.sampleTripId,
        version: trip?.version,
      },
    });
  }

  if (request.method === "GET" && pathname === "/api/debug/runtime") {
    return json(200, {
      ok: true,
      data: {
        provider: runtime.provider,
        sample_trip_id: runtime.sampleTripId,
        maps_browser_key_present: Boolean(runtime.mapsBrowserApiKey),
      },
      meta: {
        request_id: randomUUID(),
      },
    });
  }

  return json(404, {
    ok: false,
    error: {
      code: "not_found",
      message: `No route for ${request.method} ${pathname}`,
    },
  });
}

export function toErrorResponse(error) {
  if (error instanceof PlannerError) {
    return json(error.code === "trip_not_found" ? 404 : 400, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  return json(500, {
    ok: false,
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Unknown server error.",
    },
  });
}

function summarizeTrip(trip) {
  const items = trip.days.flatMap((day) => day.items);
  return {
    days: trip.days.length,
    conflicts: trip.conflicts.length,
    locked_items: items.filter((item) => item.locked).length,
  };
}

function json(status, payload) {
  return { status, payload };
}
