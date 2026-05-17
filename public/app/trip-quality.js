import { collectUnresolvedPlaceItems } from "./place-resolution.js";
import { escapeHtml } from "./shared.js";

export function buildTripQualitySummary(trip) {
  const unresolvedPlaces = collectUnresolvedPlaceItems(trip);
  const acceptedConflictIds = new Set(
    (trip?.review_decisions ?? [])
      .filter((decision) => decision.decision === "accepted")
      .map((decision) => decision.conflict_id)
  );
  const openConflicts = (trip?.conflicts ?? []).filter((conflict) => !acceptedConflictIds.has(conflict.id));
  const mustFixConflicts = openConflicts.filter(isMustFixConflict);
  const reviewConflicts = openConflicts.filter((conflict) => !isMustFixConflict(conflict) && isReviewConflict(conflict));
  const missingMealConflicts = openConflicts.filter((conflict) => conflict.type === "meal_window_missing");
  const acceptedConflicts = (trip?.conflicts ?? []).filter((conflict) => acceptedConflictIds.has(conflict.id));
  const score = clampScore(
    100
      - unresolvedPlaces.length * 12
      - mustFixConflicts.length * 25
      - reviewConflicts.length * 10
      - missingMealConflicts.length * 6
  );
  const tone = score >= 90 && openConflicts.length === 0 && unresolvedPlaces.length === 0
    ? "ready"
    : score >= 70
      ? "review"
      : "needs-work";

  return {
    score,
    tone,
    label: qualityLabel(tone),
    openConflictCount: openConflicts.length,
    mustFixCount: mustFixConflicts.length,
    reviewCount: reviewConflicts.length,
    missingMealCount: missingMealConflicts.length,
    unresolvedPlaceCount: unresolvedPlaces.length,
    acceptedConflictCount: acceptedConflicts.length,
    primaryIssue: primaryIssue({
      unresolvedPlaceCount: unresolvedPlaces.length,
      mustFixCount: mustFixConflicts.length,
      reviewCount: reviewConflicts.length,
      missingMealCount: missingMealConflicts.length,
      acceptedConflictCount: acceptedConflicts.length,
    }),
  };
}

export function renderTripQualitySummary(trip) {
  if (!trip) {
    return "";
  }

  const quality = buildTripQualitySummary(trip);
  return `
    <section class="trip-quality-card ${escapeHtml(quality.tone)}" aria-label="Trip quality score">
      <div class="trip-quality-score">
        <span>Trip quality</span>
        <strong>${quality.score}</strong>
        <em>${escapeHtml(quality.label)}</em>
      </div>
      <div class="trip-quality-copy">
        <strong>${escapeHtml(quality.primaryIssue)}</strong>
        <div class="trip-quality-metrics">
          <span>${escapeHtml(formatCount(quality.unresolvedPlaceCount, "unresolved place"))}</span>
          <span>${escapeHtml(formatCount(quality.mustFixCount, "must-fix issue"))}</span>
          <span>${escapeHtml(formatCount(quality.reviewCount, "review item"))}</span>
          <span>${escapeHtml(formatCount(quality.acceptedConflictCount, "kept conflict"))}</span>
        </div>
      </div>
    </section>
  `;
}

export function isConflictAccepted(trip, conflictId) {
  return Boolean(
    conflictId &&
      (trip?.review_decisions ?? []).some(
        (decision) => decision.conflict_id === conflictId && decision.decision === "accepted"
      )
  );
}

function isMustFixConflict(conflict) {
  return (
    conflict.severity === "error" ||
    conflict.type === "locked_item_violation" ||
    conflict.type === "overlap_conflict" ||
    conflict.type === "travel_time_underestimated"
  );
}

function isReviewConflict(conflict) {
  return (
    conflict.severity === "warning" ||
    conflict.type === "opening_hours_conflict" ||
    conflict.type === "meal_window_missing" ||
    conflict.type === "pace_limit_exceeded" ||
    conflict.type === "reservation_time_mismatch"
  );
}

function qualityLabel(tone) {
  if (tone === "ready") return "Ready";
  if (tone === "review") return "Review";
  return "Needs work";
}

function primaryIssue(metrics) {
  if (metrics.mustFixCount > 0) {
    return `${formatCount(metrics.mustFixCount, "must-fix issue")} should be handled first.`;
  }

  if (metrics.unresolvedPlaceCount > 0) {
    return `${formatCount(metrics.unresolvedPlaceCount, "stop")} still needs a map match.`;
  }

  if (metrics.reviewCount > 0) {
    return `${formatCount(metrics.reviewCount, "item")} should be reviewed before sharing.`;
  }

  if (metrics.acceptedConflictCount > 0) {
    return `${formatCount(metrics.acceptedConflictCount, "conflict")} kept as-is with review history.`;
  }

  return "No open quality issues detected.";
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
