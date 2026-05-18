import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createAppServer } from "../../server/app/create-server.mjs";

const HOST = "127.0.0.1";
const E2E_TIMEOUT_MS = 45_000;

test("browser smoke covers load, quality drill-down, and review history", { timeout: E2E_TIMEOUT_MS }, async () => {
  const restoreEnv = applyTemporaryEnv({
    PLANNER_PROVIDER: "mock",
    PLANNER_STORAGE_MODE: "memory",
    PLANNER_LOG_REQUESTS: "0",
    PLANNER_ENABLE_DEBUG_ROUTES: "0",
    GOOGLE_MAPS_API_KEY: "",
    GOOGLE_MAPS_BROWSER_API_KEY: "",
    OPENAI_API_KEY: "",
  });
  let server = null;
  let browser = null;

  try {
    ({ server } = await createAppServer());
    await listenOnRandomPort(server);
    const baseUrl = `http://${HOST}:${server.address().port}`;
    const tripId = await seedConflictTrip(baseUrl);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto(`${baseUrl}/?trip=${encodeURIComponent(tripId)}`, {
      waitUntil: "networkidle",
    });

    assert.equal(await page.title(), "Itinerary Workspace");
    await page.locator("#tripTitle").waitFor({ state: "visible" });
    assert.match(await page.locator("#tripQuality").innerText(), /trip quality/iu);
    assert.equal(await page.locator(".timeline-block, .event-pill").count() > 0, true);

    const mustFixButton = page.locator('[data-trip-quality-target="must-fix"]');
    await mustFixButton.waitFor({ state: "visible" });
    assert.equal(await mustFixButton.isEnabled(), true);
    await mustFixButton.click();

    await page.locator('#workspaceTabAssistant[aria-selected="true"]').waitFor();
    await page.locator(".conflict-entry.active").waitFor({ state: "visible" });
    assert.match(await page.locator("#assistantDiff").innerText(), /current conflicts/iu);

    const reviewButtons = page.locator('[data-conflict-action="review"]');
    assert.equal(await reviewButtons.count() > 0, true);
    await reviewButtons.first().click();

    await page.locator(".review-history").waitFor({ state: "visible" });
    const assistantDiff = await page.locator("#assistantDiff").innerText();
    assert.match(assistantDiff, /review history/iu);
    assert.match(assistantDiff, /Kept/u);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser?.close();
    await closeServer(server);
    restoreEnv();
  }
});

async function seedConflictTrip(baseUrl) {
  const tripsPayload = await requestJson(baseUrl, "/api/trips");
  const tripId = tripsPayload.trips?.[0]?.trip_id;
  assert.ok(tripId, "Expected the mock runtime to expose a sample trip.");

  const tripPayload = await requestJson(baseUrl, `/api/trips/${tripId}`);
  const trip = tripPayload.trip;
  assert.ok(trip, "Expected the sample trip to load before seeding browser state.");

  await requestJson(baseUrl, `/api/trips/${tripId}/commands/execute`, {
    method: "POST",
    body: {
      base_version: trip.version,
      input: {
        commands: [
          {
            command_id: "cmd_e2e_seed_overlap",
            action: "move_item",
            item_id: "item_walk_river_arts",
            day_date: "2026-04-12",
            reason: "Seed a visible conflict for the browser smoke test.",
            new_start_at: "2026-04-12T13:00:00-04:00",
            new_end_at: "2026-04-12T15:00:00-04:00",
          },
        ],
      },
    },
  });

  return tripId;
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload?.error?.message ?? `Request failed: ${response.status}`);
  assert.equal(payload.ok, true, payload?.error?.message ?? "API returned an error payload.");
  return payload.data;
}

async function listenOnRandomPort(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, HOST);
  });
}

async function closeServer(server) {
  if (!server?.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function applyTemporaryEnv(overrides) {
  const previousValues = new Map(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  );

  Object.entries(overrides).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  return () => {
    previousValues.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  };
}
