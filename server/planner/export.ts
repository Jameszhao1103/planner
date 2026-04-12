import type { Itinerary, ItineraryDay, ItineraryItem } from "./types.ts";

export function buildCalendarExport(
  itinerary: Itinerary,
  options: {
    dayDate?: string | null;
  } = {}
): { fileName: string; content: string } {
  const days = filterDays(itinerary, options.dayDate);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Itinerary Workspace//Itinerary Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...days.flatMap((day) => buildCalendarEvents(itinerary, day)),
    "END:VCALENDAR",
    "",
  ];

  return {
    fileName: buildExportFileName(itinerary, "ics", options.dayDate),
    content: lines.join("\r\n"),
  };
}

export function buildPrintableDocument(
  itinerary: Itinerary,
  options: {
    dayDate?: string | null;
  } = {}
): { title: string; fileName: string; content: string } {
  const days = filterDays(itinerary, options.dayDate);
  const title = options.dayDate
    ? `${itinerary.title} · ${days[0]?.label ?? options.dayDate}`
    : itinerary.title;

  const body = days
    .map((day) => {
      const items = day.items
        .slice()
        .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
        .map((item) => renderPrintableItem(itinerary, item))
        .join("");
      const conflicts = itinerary.conflicts
        .filter((conflict) =>
          conflict.item_ids.length === 0
            ? conflict.id.includes(day.date)
            : conflict.item_ids.some((itemId) => day.items.some((item) => item.id === itemId))
        )
        .map((conflict) => `<li>${escapeHtml(conflict.message)}</li>`)
        .join("");

      return `
        <section class="day">
          <header class="day-header">
            <h2>${escapeHtml(day.label)}</h2>
            <div class="day-date">${escapeHtml(day.date)}</div>
          </header>
          <div class="items">${items}</div>
          ${conflicts ? `<section class="conflicts"><h3>Conflicts</h3><ul>${conflicts}</ul></section>` : ""}
        </section>
      `;
    })
    .join("");

  return {
    title,
    fileName: buildExportFileName(itinerary, "html", options.dayDate),
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --ink: #1f2d2a;
        --muted: #687974;
        --line: #d8cfbf;
        --bg: #fbf8f2;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background: var(--bg);
      }
      .shell {
        max-width: 940px;
        margin: 0 auto;
        padding: 32px 24px 80px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        margin-bottom: 28px;
      }
      .topbar h1 {
        margin: 0;
        font-size: 32px;
      }
      .topbar p {
        margin: 6px 0 0;
        color: var(--muted);
      }
      .print-button {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: white;
        color: var(--ink);
        padding: 10px 18px;
        font: inherit;
        cursor: pointer;
      }
      .day {
        border-top: 1px solid var(--line);
        padding-top: 20px;
        margin-top: 24px;
      }
      .day-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: baseline;
      }
      .day-header h2 {
        margin: 0;
        font-size: 24px;
      }
      .day-date {
        color: var(--muted);
      }
      .items {
        margin-top: 16px;
        display: grid;
        gap: 10px;
      }
      .item {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: white;
        padding: 14px 16px;
      }
      .item-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: baseline;
      }
      .item-title {
        font-size: 18px;
        font-weight: 700;
      }
      .item-time {
        color: var(--muted);
        white-space: nowrap;
      }
      .item-meta,
      .item-location {
        margin-top: 6px;
        color: var(--muted);
        font-size: 14px;
      }
      .conflicts {
        margin-top: 18px;
      }
      .conflicts h3 {
        margin: 0 0 8px;
        font-size: 15px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      @media print {
        body { background: white; }
        .print-button { display: none; }
        .shell { padding: 20px 0 40px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>Use your browser or system print dialog to save this page as PDF.</p>
        </div>
        <button class="print-button" onclick="window.print()">Print / Save PDF</button>
      </header>
      ${body}
    </main>
  </body>
</html>`,
  };
}

function buildCalendarEvents(itinerary: Itinerary, day: ItineraryDay): string[] {
  return day.items
    .filter((item) => shouldExportCalendarItem(item))
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
    .flatMap((item) => {
      const place = item.place_id ? itinerary.places.find((candidate) => candidate.place_id === item.place_id) : null;
      const description = [
        item.kind === "meal" && item.category ? `Meal: ${item.category}` : "",
        place?.address ?? "",
        item.notes ?? "",
      ]
        .filter(Boolean)
        .join("\\n");

      return [
        "BEGIN:VEVENT",
        `UID:${escapeIcsText(`${itinerary.trip_id}-${item.id}@itinerary-workspace`)}`,
        `DTSTAMP:${formatUtcStamp(new Date())}`,
        `DTSTART:${formatUtcStamp(new Date(item.start_at))}`,
        `DTEND:${formatUtcStamp(new Date(item.end_at))}`,
        `SUMMARY:${escapeIcsText(item.title)}`,
        place?.name ? `LOCATION:${escapeIcsText(place.address ? `${place.name}, ${place.address}` : place.name)}` : "",
        description ? `DESCRIPTION:${escapeIcsText(description)}` : "",
        "END:VEVENT",
      ].filter(Boolean);
    });
}

function shouldExportCalendarItem(item: ItineraryItem): boolean {
  return item.kind !== "buffer" && item.kind !== "free_time" && item.kind !== "transit";
}

function renderPrintableItem(itinerary: Itinerary, item: ItineraryItem): string {
  const place = item.place_id ? itinerary.places.find((candidate) => candidate.place_id === item.place_id) : null;
  const route = item.route_id ? itinerary.routes.find((candidate) => candidate.route_id === item.route_id) : null;
  const meta = [describeItemKind(item), route ? `Travel: ${route.mode} ${route.duration_minutes} min` : ""]
    .filter(Boolean)
    .join(" · ");

  return `
    <article class="item">
      <div class="item-row">
        <div class="item-title">${escapeHtml(item.title)}</div>
        <div class="item-time">${escapeHtml(localTimeRange(item.start_at, item.end_at))}</div>
      </div>
      ${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ""}
      ${place ? `<div class="item-location">${escapeHtml(place.address ? `${place.name} · ${place.address}` : place.name)}</div>` : ""}
    </article>
  `;
}

function filterDays(itinerary: Itinerary, dayDate?: string | null): ItineraryDay[] {
  if (!dayDate) {
    return itinerary.days;
  }

  return itinerary.days.filter((day) => day.date === dayDate);
}

function buildExportFileName(itinerary: Itinerary, extension: string, dayDate?: string | null): string {
  const slug = itinerary.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}${dayDate ? `-${dayDate}` : ""}.${extension}`;
}

function localTimeRange(startAt: string, endAt: string): string {
  return `${startAt.slice(11, 16)}-${endAt.slice(11, 16)}`;
}

function describeItemKind(item: ItineraryItem): string {
  if (item.kind === "meal") {
    return item.category ? `Meal · ${capitalize(item.category)}` : "Meal";
  }
  if (item.kind === "activity") {
    return item.category ? capitalize(item.category) : "Activity";
  }
  return capitalize(item.kind.replace(/_/g, " "));
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

function formatUtcStamp(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
