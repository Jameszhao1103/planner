import { escapeHtml, itemTypeLabel } from "./shared.js";

const PLACE_RESOLUTION_KINDS = new Set([
  "activity",
  "meal",
  "flight",
  "check_in",
  "check_out",
  "lodging",
]);

export function collectUnresolvedPlaceItems(trip) {
  if (!trip?.days?.length) {
    return [];
  }

  return trip.days
    .flatMap((day) =>
      (day.items ?? []).map((item) => ({
        dayDate: day.date,
        dayLabel: day.label,
        item,
      }))
    )
    .filter(({ item }) => needsPlaceResolution(item));
}

export function needsPlaceResolution(item) {
  return Boolean(item && PLACE_RESOLUTION_KINDS.has(item.kind) && !item.place_id);
}

export function renderPlaceResolutionQueue(trip, selectedItemId = null) {
  const unresolved = collectUnresolvedPlaceItems(trip);
  if (unresolved.length === 0) {
    return "";
  }

  const countLabel = unresolved.length === 1 ? "1 stop" : `${unresolved.length} stops`;
  const verb = unresolved.length === 1 ? "needs" : "need";
  const visibleItems = unresolved.slice(0, 6);
  const overflowCount = unresolved.length - visibleItems.length;

  return `
    <section class="place-resolution-queue" aria-label="Unresolved places">
      <div class="place-resolution-header">
        <div>
          <div class="focus-kicker">Place review</div>
          <h3>${escapeHtml(`${countLabel} ${verb} map matches`)}</h3>
        </div>
        ${overflowCount > 0 ? `<span>${escapeHtml(`+${overflowCount} more`)}</span>` : ""}
      </div>
      <div class="place-resolution-list">
        ${visibleItems.map(({ dayDate, dayLabel, item }) => `
          <button
            type="button"
            class="place-resolution-item${item.id === selectedItemId ? " selected" : ""}"
            data-editor-action="resolve-place"
            data-item-id="${escapeHtml(item.id)}"
            data-day-date="${escapeHtml(dayDate)}">
            <span>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(`${dayLabel} · ${itemTypeLabel(item)}`)}</small>
            </span>
            <em>Search</em>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}
