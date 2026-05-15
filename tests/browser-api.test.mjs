import assert from "node:assert/strict";
import { test } from "node:test";
import { requestJson } from "../public/app/api.js";

test("requestJson reports non-JSON error responses without masking status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<!doctype html><h1>Bad Gateway</h1>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: {
        "Content-Type": "text/html",
      },
    });

  try {
    await assert.rejects(
      () => requestJson("/api/trips"),
      /Request failed: 502 Bad Gateway/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
