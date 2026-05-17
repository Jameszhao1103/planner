import test from "node:test";
import assert from "node:assert/strict";
import { buildTripQualitySummary, isConflictAccepted, renderTripQualitySummary } from "../public/app/trip-quality.js";

test("trip quality score penalizes open conflicts and unresolved places", () => {
  const trip = tripFixture({
    conflicts: [
      conflict({ id: "overlap_1", type: "overlap_conflict", severity: "error" }),
      conflict({ id: "hours_1", type: "opening_hours_conflict", severity: "warning" }),
    ],
  });

  const quality = buildTripQualitySummary(trip);
  assert.equal(quality.unresolvedPlaceCount, 1);
  assert.equal(quality.mustFixCount, 1);
  assert.equal(quality.reviewCount, 1);
  assert.equal(quality.tone, "needs-work");
  assert.equal(quality.score, 53);
});

test("trip quality score treats accepted conflicts as reviewed history", () => {
  const trip = tripFixture({
    conflicts: [
      conflict({ id: "overlap_1", type: "overlap_conflict", severity: "error" }),
    ],
    review_decisions: [
      {
        id: "review_1",
        conflict_id: "overlap_1",
        decision: "accepted",
        decided_at: "2026-05-17T12:00:00Z",
        decided_by: "user",
      },
    ],
  });

  const quality = buildTripQualitySummary(trip);
  assert.equal(isConflictAccepted(trip, "overlap_1"), true);
  assert.equal(quality.mustFixCount, 0);
  assert.equal(quality.acceptedConflictCount, 1);
  assert.match(renderTripQualitySummary(trip), /1 kept conflict/);
});

function tripFixture(overrides = {}) {
  return {
    days: [
      {
        date: "2026-06-16",
        label: "Day 1",
        items: [
          {
            id: "item_unresolved",
            kind: "activity",
            title: "Unmapped stop",
            start_at: "2026-06-16T09:00:00-06:00",
            end_at: "2026-06-16T10:00:00-06:00",
            status: "suggested",
            locked: false,
            source: "imported",
          },
        ],
      },
    ],
    conflicts: [],
    review_decisions: [],
    ...overrides,
  };
}

function conflict(overrides) {
  return {
    id: "conflict",
    type: "opening_hours_conflict",
    severity: "warning",
    message: "Needs review.",
    item_ids: ["item_unresolved"],
    ...overrides,
  };
}
