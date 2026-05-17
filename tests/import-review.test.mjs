import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPostImportReviewMessage,
  renderTripImportReviewChecklist,
} from "../public/app/import-review.js";

test("import review checklist highlights place review items and gates confirmation", () => {
  const html = renderTripImportReviewChecklist({
    pending: false,
    form: {
      title: "Yellowstone family trip",
      startDate: "2026-06-16",
      endDate: "2026-06-18",
      timezone: "America/Denver",
      travelers: "2",
    },
    resolution: {
      blockingMissingFields: [],
      importReviewConfirmed: false,
    },
    tripIntake: {
      sourceDirty: false,
      warnings: [],
      draft: {
        traveler_count: null,
      },
      itinerary: {
        days: [
          {
            label: "Day 1",
            items: [
              {
                title: "Visit Old Faithful Geyser",
                kind: "activity",
                start_time: "09:00",
                end_time: "10:30",
              },
              {
                title: "Lunch",
                kind: "meal",
                start_time: "12:00",
                end_time: "13:00",
              },
            ],
          },
        ],
      },
    },
  });

  assert.match(html, /Import review checklist/u);
  assert.match(html, /Needs place review/u);
  assert.match(html, /Generic meal without venue/u);
  assert.match(html, /data-trip-review-action="confirm"/u);
  assert.doesNotMatch(html, /data-trip-review-action="confirm" disabled/u);
});

test("import review checklist disables confirmation when required trip fields are missing", () => {
  const html = renderTripImportReviewChecklist({
    pending: false,
    form: {
      title: "Yellowstone family trip",
      startDate: "",
      endDate: "2026-06-18",
      timezone: "America/Denver",
      travelers: "2",
    },
    resolution: {
      blockingMissingFields: ["start_date"],
      importReviewConfirmed: false,
    },
    tripIntake: {
      sourceDirty: false,
      warnings: [],
      draft: {
        traveler_count: 2,
      },
      itinerary: {
        days: [
          {
            label: "Day 1",
            items: [
              {
                title: "Visit Old Faithful Geyser",
                kind: "activity",
                start_time: "09:00",
                end_time: "10:30",
              },
            ],
          },
        ],
      },
    },
  });

  assert.match(html, /Missing required trip details: Start date/u);
  assert.match(html, /data-trip-review-action="confirm" disabled/u);
});

test("post-import review message reports imported stops without resolved places", () => {
  const message = buildPostImportReviewMessage(
    {
      title: "Yellowstone family trip",
      days: [
        {
          items: [
            {
              source: "imported",
              kind: "activity",
              title: "Visit Old Faithful Geyser",
              place_id: "place_old_faithful",
            },
            {
              source: "imported",
              kind: "meal",
              title: "Lunch",
            },
            {
              source: "imported",
              kind: "free_time",
              title: "Rest",
            },
          ],
        },
      ],
    },
    { days: [{ items: [] }] }
  );

  assert.equal(
    message,
    "Created Yellowstone family trip from the reviewed itinerary. 1 imported stop still needs place review."
  );
});
