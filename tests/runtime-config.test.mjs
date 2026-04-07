import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDebugRoutesEnabled,
  resolveMapsBrowserApiKey,
  resolveRuntimeMode,
  resolveCommandPlannerMode,
} from "../server/app/runtime-config.mjs";

test("browser map key does not fall back to the server google key", () => {
  assert.equal(
    resolveMapsBrowserApiKey({
      GOOGLE_MAPS_API_KEY: "server-only-key",
    }),
    null
  );

  assert.equal(
    resolveMapsBrowserApiKey({
      GOOGLE_MAPS_BROWSER_API_KEY: "browser-key",
      GOOGLE_MAPS_API_KEY: "server-only-key",
    }),
    "browser-key"
  );
});

test("runtime mode and command planner mode still infer from server env", () => {
  assert.equal(
    resolveRuntimeMode({
      GOOGLE_MAPS_API_KEY: "server-only-key",
    }),
    "google"
  );

  assert.equal(
    resolveCommandPlannerMode({
      OPENAI_API_KEY: "openai-key",
    }),
    "openai"
  );
});

test("debug routes are disabled by default and can be enabled explicitly", () => {
  assert.equal(resolveDebugRoutesEnabled({}), false);
  assert.equal(resolveDebugRoutesEnabled({ PLANNER_ENABLE_DEBUG_ROUTES: "1" }), true);
  assert.equal(resolveDebugRoutesEnabled({ PLANNER_ENABLE_DEBUG_ROUTES: "true" }), true);
});
