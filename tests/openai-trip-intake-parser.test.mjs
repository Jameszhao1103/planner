import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiTripIntakeParser } from "../server/planner/openai-trip-intake-parser.ts";

test("openai trip intake parser normalizes structured extraction output", async () => {
  const parser = new OpenAiTripIntakeParser({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            draft: {
              title: "Grand Teton & Yellowstone",
              start_date: null,
              end_date: null,
              timezone: "America/Denver",
              traveler_count: null,
            },
            derived: {
              duration_days: 5,
            },
            itinerary: {
              pace: "balanced",
              days: [
                {
                  day_index: 1,
                  date: null,
                  label: "Day 1",
                  summary: "Arrive in Jackson and ease into Grand Teton.",
                  items: [
                    {
                      title: "Arrive in Jackson",
                      kind: "flight",
                      category: "flight",
                      start_time: "10:00",
                      end_time: "12:00",
                      duration_minutes: 120,
                      status: "confirmed",
                      locked: true,
                      subtitle: null,
                      notes: null,
                      tags: [],
                    },
                  ],
                },
              ],
            },
            summary: "Parsed a 5-day Jackson / Grand Teton / Yellowstone trip.",
            warnings: ["Exact travel dates were not specified."],
          }),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      ),
  });

  const result = await parser.parse({
    sourceText: "6月、5天、Jackson 进出",
    now: new Date("2026-04-19T09:00:00Z"),
  });

  assert.equal(result.draft.title, "Grand Teton & Yellowstone");
  assert.equal(result.draft.start_date, null);
  assert.equal(result.draft.end_date, null);
  assert.equal(result.draft.timezone, "America/Denver");
  assert.equal(result.derived.duration_days, 5);
  assert.equal(result.itinerary?.pace, "balanced");
  assert.equal(result.itinerary?.days?.length, 1);
  assert.equal(result.itinerary?.days?.[0]?.items?.[0]?.title, "Arrive in Jackson");
  assert.equal(result.summary, "Parsed a 5-day Jackson / Grand Teton / Yellowstone trip.");
  assert.deepEqual(result.warnings, ["Exact travel dates were not specified."]);
});
