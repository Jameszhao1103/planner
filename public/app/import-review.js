import { escapeHtml, normalizeText } from "./shared.js";

export function renderTripImportReviewChecklist(context) {
  const review = buildTripImportReviewModel(context);
  const statusClass = context.resolution.importReviewConfirmed ? "confirmed" : "pending";
  const statusText = context.resolution.importReviewConfirmed ? "Confirmed" : "Needs review";
  const actionDisabled = !review.canConfirm || context.pending ? " disabled" : "";
  const action = context.resolution.importReviewConfirmed
    ? '<div class="trip-import-review-confirmed">Review confirmed</div>'
    : `<button type="button" class="button button-primary button-small" data-trip-review-action="confirm"${actionDisabled}>Confirm review</button>`;
  const issueList = review.issues.length
    ? `<ul class="trip-import-review-issues">${review.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`
    : '<div class="trip-import-review-empty">No review blockers found.</div>';
  const placeRows = review.placeReviewItems.length
    ? review.placeReviewItems
        .slice(0, 6)
        .map((item) => `
          <li>
            <span>${escapeHtml(item.title)}</span>
            <small>${escapeHtml(item.reason)}</small>
          </li>
        `)
        .join("")
    : '<li><span>All imported place titles look specific enough for lookup.</span></li>';
  const overflow = review.placeReviewItems.length > 6
    ? `<li><span>${escapeHtml(formatCountLabel(review.placeReviewItems.length - 6, "more item"))}</span></li>`
    : "";

  return `
    <section class="trip-import-review">
      <div class="trip-import-review-header">
        <div>
          <strong>Import review checklist</strong>
          <div class="trip-import-review-meta">${escapeHtml(review.summary)}</div>
        </div>
        <span class="trip-import-review-status ${statusClass}">${statusText}</span>
      </div>
      <div class="trip-import-review-stats">
        ${renderTripImportReviewStat("Days", review.dayCount)}
        ${renderTripImportReviewStat("Items", review.itemCount)}
        ${renderTripImportReviewStat("Timed", review.scheduledItemCount)}
        ${renderTripImportReviewStat("Needs place review", review.placeReviewItems.length)}
      </div>
      <div class="trip-import-review-grid">
        <div>
          <div class="trip-import-review-title">Trip details</div>
          <ul class="trip-import-review-list">
            ${review.fields.map(renderTripImportReviewField).join("")}
          </ul>
        </div>
        <div>
          <div class="trip-import-review-title">Itinerary days</div>
          <ul class="trip-import-review-list">
            ${review.days.map(renderTripImportReviewDay).join("")}
          </ul>
        </div>
      </div>
      <div>
        <div class="trip-import-review-title">Place review</div>
        <ul class="trip-import-review-list place-review">
          ${placeRows}
          ${overflow}
        </ul>
      </div>
      ${issueList}
      <div class="trip-import-review-actions">${action}</div>
    </section>
  `;
}

export function buildPostImportReviewMessage(trip, importDraft) {
  if (!trip || !importDraft) {
    return null;
  }

  const importedItems = trip.days
    .flatMap((day) => day.items)
    .filter((item) => item.source === "imported");
  const unresolvedPlaceCount = importedItems
    .filter((item) => shouldReportUnresolvedImportedPlace(item))
    .length;

  if (unresolvedPlaceCount === 0) {
    return `Created ${trip.title} from the reviewed itinerary.`;
  }

  return `Created ${trip.title} from the reviewed itinerary. ${formatCountLabel(unresolvedPlaceCount, "imported stop")} still needs place review.`;
}

function renderTripImportReviewStat(label, value) {
  return `
    <div class="trip-import-review-stat">
      <strong>${escapeHtml(String(value))}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function renderTripImportReviewField(field) {
  return `
    <li class="${field.status}">
      <span>${escapeHtml(field.label)}</span>
      <small>${escapeHtml(field.value || field.message)}</small>
    </li>
  `;
}

function renderTripImportReviewDay(day) {
  const details = [
    formatCountLabel(day.itemCount, "item"),
    day.missingTimeCount ? formatCountLabel(day.missingTimeCount, "missing time") : "",
    day.placeReviewCount ? formatCountLabel(day.placeReviewCount, "place to review") : "",
  ].filter(Boolean).join(" · ");

  return `
    <li>
      <span>${escapeHtml(day.label)}</span>
      <small>${escapeHtml([day.date, details].filter(Boolean).join(" · "))}</small>
    </li>
  `;
}

function buildTripImportReviewModel(context) {
  const itinerary = context.tripIntake.itinerary;
  const days = itinerary?.days ?? [];
  const dayModels = days.map((day, dayIndex) => {
    const items = Array.isArray(day.items) ? day.items : [];
    const placeReviewItems = collectTripImportPlaceReviewItems([{ ...day, items }], dayIndex);
    return {
      label: day.label || `Day ${dayIndex + 1}`,
      date: day.date || "Date aligns from trip start",
      itemCount: items.length,
      missingTimeCount: items.filter(needsTripImportTimeReview).length,
      placeReviewCount: placeReviewItems.length,
    };
  });
  const allItems = days.flatMap((day) => Array.isArray(day.items) ? day.items : []);
  const placeReviewItems = collectTripImportPlaceReviewItems(days);
  const missingTimeCount = allItems.filter(needsTripImportTimeReview).length;
  const fields = buildTripImportReviewFields(context);
  const fieldBlockers = fields.filter((field) => field.status === "missing");
  const issues = [];

  if (fieldBlockers.length) {
    issues.push(`Missing required trip details: ${fieldBlockers.map((field) => field.label).join(", ")}.`);
  }

  if (context.tripIntake.sourceDirty) {
    issues.push("The pasted plan changed after extraction.");
  }

  if (placeReviewItems.length) {
    issues.push(`${formatCountLabel(placeReviewItems.length, "place")} should be reviewed before import.`);
  }

  if (missingTimeCount) {
    issues.push(`${formatCountLabel(missingTimeCount, "item")} will use default timing because a start or end time is missing.`);
  }

  if (context.tripIntake.warnings.length) {
    issues.push(...context.tripIntake.warnings);
  }

  return {
    summary: `Review ${formatCountLabel(days.length, "day")} and ${formatCountLabel(allItems.length, "item")} before creating the trip.`,
    dayCount: days.length,
    itemCount: allItems.length,
    scheduledItemCount: allItems.filter((item) => item.start_time && item.end_time).length,
    placeReviewItems,
    fields,
    days: dayModels,
    issues,
    canConfirm:
      context.resolution.blockingMissingFields.length === 0 &&
      !context.tripIntake.sourceDirty &&
      days.length > 0,
  };
}

function buildTripImportReviewFields(context) {
  const travelerCount = Number.parseInt(context.form.travelers, 10);
  const rows = [
    {
      field: "title",
      label: "Trip title",
      value: context.form.title,
      message: "Missing title",
    },
    {
      field: "start_date",
      label: "Start date",
      value: context.form.startDate,
      message: "Missing start date",
    },
    {
      field: "end_date",
      label: "End date",
      value: context.form.endDate,
      message: "Missing end date",
    },
    {
      field: "timezone",
      label: "Timezone",
      value: context.form.timezone,
      message: "Missing timezone",
    },
  ];

  const fields = rows.map((row) => ({
    ...row,
    status: context.resolution.blockingMissingFields.includes(row.field) ? "missing" : "ready",
  }));
  fields.push({
    field: "traveler_count",
    label: "Travelers",
    value: Number.isFinite(travelerCount) && travelerCount > 0 ? context.form.travelers : "",
    message: "Using default traveler count",
    status: Number.isFinite(travelerCount) && travelerCount > 0
      ? (context.tripIntake.draft?.traveler_count ? "ready" : "defaulted")
      : "missing",
  });

  return fields;
}

function collectTripImportPlaceReviewItems(days, dayOffset = 0) {
  return days.flatMap((day, index) => {
    const dayIndex = dayOffset + index;
    const items = Array.isArray(day.items) ? day.items : [];
    return items
      .map((item) => {
        const reason = tripImportPlaceReviewReason(item);
        return reason
          ? {
              dayIndex,
              title: item.title || `Day ${dayIndex + 1} stop`,
              reason,
            }
          : null;
      })
      .filter(Boolean);
  });
}

function tripImportPlaceReviewReason(item) {
  const title = normalizeText(item.title ?? "");
  if (!title) {
    return "Missing stop title";
  }

  if (item.kind === "buffer" || item.kind === "free_time") {
    return null;
  }

  if (
    title.startsWith("optional ") ||
    /\bor\b/u.test(title) ||
    /\bif (?:time|energy|needed|possible|weather|flight)\b/u.test(title)
  ) {
    return "Optional or conditional stop";
  }

  if (item.kind === "meal" && /^(breakfast|brunch|lunch|dinner|meal)$/u.test(title)) {
    return "Generic meal without venue";
  }

  if (isGenericTripImportTransit(item, title)) {
    return "Transit destination is not specific";
  }

  if (isGenericTripImportLodging(item, title)) {
    return "Lodging name is not specific";
  }

  if (isGenericTripImportAirport(item, title)) {
    return "Airport name is not specific";
  }

  return null;
}

function needsTripImportTimeReview(item) {
  if (item.kind === "buffer" || item.kind === "free_time") {
    return false;
  }

  return !item.start_time || !item.end_time;
}

function isGenericTripImportTransit(item, title) {
  return item.kind === "transit" && !/(?:→|->|\bto\b|\bfrom\b)/u.test(title);
}

function isGenericTripImportLodging(item, title) {
  const category = normalizeText(item.category ?? "");
  if (!["check_in", "check_out", "lodging"].includes(item.kind) && !["hotel", "lodging", "accommodation"].includes(category)) {
    return false;
  }

  return /^(?:check in|check out|hotel|lodging|accommodation|stay)$/u.test(title)
    || /\b(?:hotel|lodging|accommodation)\b$/u.test(title);
}

function isGenericTripImportAirport(item, title) {
  const category = normalizeText(item.category ?? "");
  if (item.kind !== "flight" && category !== "airport") {
    return false;
  }

  return /^(?:flight|airport|arrive|depart|return rental car and check in for flight)$/u.test(title);
}

function shouldReportUnresolvedImportedPlace(item) {
  if (item.place_id || item.kind === "buffer" || item.kind === "free_time") {
    return false;
  }

  return ["flight", "transit", "check_in", "check_out", "lodging", "activity", "meal"].includes(item.kind);
}

function formatCountLabel(value, singular, plural = `${singular}s`) {
  const count = Number.isFinite(value) ? value : 0;
  return `${count} ${count === 1 ? singular : plural}`;
}
