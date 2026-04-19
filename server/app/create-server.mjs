import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCalendarExport, buildPrintableDocument } from "../planner/index.ts";
import { PlannerError } from "../planner/errors.ts";
import { createRuntime } from "./create-runtime.mjs";
import { handleAppRequest, toErrorResponse } from "./app-router.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "../../public");
const JSON_BODY_LIMIT_BYTES = 1_000_000;

export async function createAppServer() {
  let runtime = await createRuntime();

  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    try {
      if (method === "GET" && await tryServeStatic(response, pathname)) {
        recordRuntimeRequest(runtime, method, pathname, 200, startedAt);
        return;
      }

      if (method === "GET" && pathname.match(/^\/api\/trips\/[^/]+\/export\/ics$/)) {
        const tripId = pathname.split("/")[3];
        const trip = await runtime.tripRepository.getTripById(tripId);
        if (!trip) {
          throw new PlannerError("trip_not_found", `Trip not found: ${tripId}`);
        }
        const dayDate = url.searchParams.get("day");
        const exportPayload = buildCalendarExport(trip, { dayDate });
        writeText(response, 200, exportPayload.content, "text/calendar; charset=utf-8", {
          "Content-Disposition": `attachment; filename="${exportPayload.fileName}"`,
          "Cache-Control": "no-store",
        });
        recordRuntimeRequest(runtime, method, "/api/trips/:tripId/export/ics", 200, startedAt);
        return;
      }

      if (method === "GET" && pathname.match(/^\/trips\/[^/]+\/print$/)) {
        const tripId = pathname.split("/")[2];
        const trip = await runtime.tripRepository.getTripById(tripId);
        if (!trip) {
          throw new PlannerError("trip_not_found", `Trip not found: ${tripId}`);
        }
        const dayDate = url.searchParams.get("day");
        const documentPayload = buildPrintableDocument(trip, { dayDate });
        writeText(response, 200, documentPayload.content, "text/html; charset=utf-8", {
          "Cache-Control": "no-store",
        });
        recordRuntimeRequest(runtime, method, "/trips/:tripId/print", 200, startedAt);
        return;
      }

      if (pathname.startsWith("/api/")) {
        const routeResponse = await handleAppRequest(runtime, {
          method,
          url: request.url ?? pathname,
          body: method === "POST" ? await readJsonBody(request) : undefined,
        });
        if (pathname === "/api/debug/reset" && routeResponse.payload.ok) {
          runtime = await createRuntime();
        }
        writeJson(response, routeResponse.status, routeResponse.payload);
        recordRuntimeRequest(runtime, method, pathname, routeResponse.status, startedAt);
        return;
      }

      writeJson(response, 404, {
        ok: false,
        error: {
          code: "not_found",
          message: `No route for ${method} ${pathname}`,
        },
      });
      recordRuntimeRequest(runtime, method, pathname, 404, startedAt);
      return;
    } catch (error) {
      const routeResponse = toErrorResponse(error);
      writeJson(response, routeResponse.status, routeResponse.payload);
      runtime.logger?.error("request.error", {
        method,
        route: normalizeMetricsRoute(pathname),
        status: routeResponse.status,
        duration_ms: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Unknown server error.",
      });
      runtime.metrics?.recordRequest({
        method,
        route: normalizeMetricsRoute(pathname),
        status: routeResponse.status,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
  });

  return {
    server,
    getSampleTripId() {
      return runtime.sampleTripId;
    },
  };
}

async function serveStatic(response, fileName) {
  const filePath = resolvePublicAssetPath(fileName);
  if (!filePath) {
    const error = new Error(`Static asset not found: ${fileName}`);
    error.code = "not_found";
    throw error;
  }

  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-store",
  });
  response.end(content);
}

async function tryServeStatic(response, pathname) {
  const filePath = resolvePublicAssetPath(pathname);
  if (!filePath) {
    return false;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store",
    });
    response.end(content);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      return false;
    }
    throw error;
  }
}

export function resolvePublicAssetPath(pathname) {
  if (!pathname) {
    return null;
  }

  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(normalizedPath);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  if (!relativePath) {
    return null;
  }

  const candidatePath = resolve(PUBLIC_DIR, relativePath);
  if (candidatePath !== PUBLIC_DIR && !candidatePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    return null;
  }

  return candidatePath;
}

export async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > JSON_BODY_LIMIT_BYTES) {
      throw new PlannerError(
        "request_too_large",
        `JSON request body exceeds ${Math.round(JSON_BODY_LIMIT_BYTES / 1000)} KB.`
      );
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PlannerError("invalid_request", "Request body must be valid JSON.");
  }
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function writeText(response, status, payload, contentType, headers = {}) {
  response.writeHead(status, {
    "Content-Type": contentType,
    ...headers,
  });
  response.end(payload);
}

function contentTypeFor(filePath) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    default:
      return "text/html; charset=utf-8";
  }
}

function normalizeMetricsRoute(pathname) {
  return pathname
    .replace(/^\/api\/trips\/[^/]+/u, "/api/trips/:tripId")
    .replace(/^\/trips\/[^/]+/u, "/trips/:tripId");
}

function recordRuntimeRequest(runtime, method, pathname, status, startedAt) {
  const route = normalizeMetricsRoute(pathname);
  const durationMs = Date.now() - startedAt;
  runtime.metrics?.recordRequest({
    method,
    route,
    status,
    durationMs,
  });
  runtime.logger?.info("request.complete", {
    method,
    route,
    status,
    duration_ms: durationMs,
  });
}
