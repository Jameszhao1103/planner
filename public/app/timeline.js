import {
  capitalize,
  durationMinutes,
  eventClass,
  itemTypeLabel,
  minutesRelativeToDay,
  normalizeText,
  shiftIsoByMinutes,
  snapMinutes,
} from "./shared.js";

const TIMELINE_MIN_SPAN_HOURS = 8;
const TIMELINE_WINDOW_PADDING_MINUTES = 45;
const TIMELINE_CARD_HEIGHT = 68;
const TIMELINE_ROW_HEIGHT = 78;
const TIMELINE_ROW_GAP = 10;
const TIMELINE_TOP_PADDING = 10;
const TIMELINE_ROW_COLLISION_GAP = 0.75;
const TIMELINE_TRANSPORT_GAP = 14;
const TIMELINE_TRANSPORT_HEIGHT = 18;
const TIMELINE_BOTTOM_PADDING = 10;

const timelineDrag = {
  active: null,
};

export function attachTimelineInteractions({
  timelinePanel,
  day,
  window,
  getActiveTrip,
  getSelectedItem,
  selectItem,
  executeImmediately,
}) {
  const laneGrid = timelinePanel.querySelector(".lane-grid");
  if (!laneGrid || !day) {
    return;
  }

  timelinePanel.querySelectorAll(".event-pill[data-item-id]").forEach((pill) => {
    pill.addEventListener("click", () => {
      selectItem(pill.dataset.itemId ?? null);
    });

    pill.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || pill.classList.contains("locked")) {
        return;
      }

      const activeTrip = getActiveTrip();
      const item = getSelectedItem(activeTrip, day.date, pill.dataset.itemId ?? null);
      if (!item || item.locked) {
        return;
      }

      event.preventDefault();
      timelineDrag.active = {
        itemId: item.id,
        dayDate: day.date,
        startX: event.clientX,
        laneWidth: laneGrid.getBoundingClientRect().width,
        totalMinutes: window.totalMinutes,
        originalStartAt: item.start_at,
        originalEndAt: item.end_at,
        pill,
        dragging: false,
      };

      document.addEventListener("pointermove", handleTimelinePointerMove);
      document.addEventListener(
        "pointerup",
        (pointerUpEvent) => handleTimelinePointerUp(pointerUpEvent, executeImmediately),
        { once: true }
      );
    });
  });
}

function handleTimelinePointerMove(event) {
  const drag = timelineDrag.active;
  if (!drag) {
    return;
  }

  const deltaX = event.clientX - drag.startX;
  if (!drag.dragging && Math.abs(deltaX) >= 6) {
    drag.dragging = true;
    drag.pill.classList.add("dragging");
  }

  if (!drag.dragging) {
    return;
  }

  drag.pill.style.transform = `translateX(${deltaX}px)`;
}

async function handleTimelinePointerUp(event, executeImmediately) {
  const drag = timelineDrag.active;
  timelineDrag.active = null;
  document.removeEventListener("pointermove", handleTimelinePointerMove);

  if (!drag) {
    return;
  }

  drag.pill.classList.remove("dragging");
  drag.pill.style.transform = "";

  const deltaX = event.clientX - drag.startX;
  if (Math.abs(deltaX) < 6) {
    return;
  }

  const rawMinutes = (deltaX / Math.max(1, drag.laneWidth)) * drag.totalMinutes;
  const deltaMinutes = snapMinutes(rawMinutes, 15);
  if (!deltaMinutes) {
    return;
  }

  await executeImmediately(
    {
      commands: [
        {
          command_id: `cmd_drag_${Date.now()}`,
          action: "move_item",
          item_id: drag.itemId,
          day_date: drag.dayDate,
          reason: "Adjust item time from timeline drag",
          new_start_at: shiftIsoByMinutes(drag.originalStartAt, deltaMinutes),
          new_end_at: shiftIsoByMinutes(drag.originalEndAt, deltaMinutes),
        },
      ],
    },
    {
      pendingMessage: "Adjusting item time…",
      successMessage: "Timeline edit applied.",
      workspaceTab: "selection",
    }
  );
}

export function buildTimelineLayout(items, window, dayDate, timeZone) {
  const rowEnds = [];
  const events = items
    .slice()
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
    .map((block) => {
      const density = timelineDensity(block, window.totalMinutes);
      const displayTitle = timelineBlockTitle(block, density);
      const startPercent = clampPercent(percentFromTimelineMinute(minutesRelativeToDay(block.start_at, dayDate, timeZone), window));
      const actualWidth = Math.max(4, (durationMinutes(block.start_at, block.end_at) / window.totalMinutes) * 100);
      const minimumWidth = timelineMinimumWidth(displayTitle, density);
      const width = Math.max(actualWidth, minimumWidth);
      const left = Math.max(0, Math.min(100 - width, startPercent));

      let rowIndex = rowEnds.findIndex((occupiedUntil) => left >= occupiedUntil);
      if (rowIndex === -1) {
        rowIndex = rowEnds.length;
        rowEnds.push(0);
      }

      rowEnds[rowIndex] = left + width + TIMELINE_ROW_COLLISION_GAP;

      return {
        block,
        left,
        width,
        density,
        top: TIMELINE_TOP_PADDING + rowIndex * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP),
      };
    });

  const rows = Math.max(1, rowEnds.length);
  const eventAreaHeight =
    TIMELINE_TOP_PADDING +
    rows * TIMELINE_CARD_HEIGHT +
    Math.max(0, rows - 1) * TIMELINE_ROW_GAP;
  const transportTop = eventAreaHeight + TIMELINE_TRANSPORT_GAP;

  return {
    events,
    rows,
    transportTop,
    totalHeight: transportTop + TIMELINE_TRANSPORT_HEIGHT + TIMELINE_BOTTOM_PADDING,
  };
}

export function computeTimelineWindow(flow, dayDate, timeZone) {
  if (!flow.length) {
    return {
      startMinute: 8 * 60,
      endMinute: 16 * 60,
      totalMinutes: 8 * 60,
      hours: Array.from({ length: 9 }, (_, index) => 8 + index),
      columnCount: 9,
    };
  }

  const startMinutes = flow.map((block) => minutesRelativeToDay(block.start_at, dayDate, timeZone));
  const endMinutes = flow.map((block) => minutesRelativeToDay(block.end_at, dayDate, timeZone));
  const minimum = Math.min(...startMinutes);
  const maximum = Math.max(...endMinutes);
  let startMinute = Math.max(0, Math.floor((minimum - TIMELINE_WINDOW_PADDING_MINUTES) / 60) * 60);
  let endMinute = Math.min(24 * 60, Math.ceil((maximum + TIMELINE_WINDOW_PADDING_MINUTES) / 60) * 60);
  const minimumSpanMinutes = TIMELINE_MIN_SPAN_HOURS * 60;

  if (endMinute - startMinute < minimumSpanMinutes) {
    const missing = minimumSpanMinutes - (endMinute - startMinute);
    startMinute = Math.max(0, startMinute - Math.ceil(missing / 2));
    endMinute = Math.min(24 * 60, endMinute + Math.floor(missing / 2));
    startMinute = Math.floor(startMinute / 60) * 60;
    endMinute = Math.ceil(endMinute / 60) * 60;
  }

  if (endMinute - startMinute < minimumSpanMinutes) {
    if (startMinute === 0) {
      endMinute = Math.min(24 * 60, startMinute + minimumSpanMinutes);
    } else {
      startMinute = Math.max(0, endMinute - minimumSpanMinutes);
    }
  }

  if (endMinute <= startMinute) {
    endMinute = Math.min(24 * 60, startMinute + minimumSpanMinutes);
  }

  const startHour = Math.floor(startMinute / 60);
  const endHour = Math.ceil(endMinute / 60);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  return {
    startMinute,
    endMinute,
    totalMinutes: Math.max(60, endMinute - startMinute),
    hours,
    columnCount: Math.max(2, hours.length),
  };
}

export function buildTimelineHourMarks(window) {
  return window.hours.map((hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("");
}

export function percentFromTimelineMinute(minute, window) {
  return ((minute - window.startMinute) / Math.max(1, window.totalMinutes)) * 100;
}

export function buildPlanFlow(trip, day) {
  return buildDayFlow(trip, day).filter((block) => block.kind !== "synthetic_transit");
}

export function buildTimelineModel(trip, day) {
  const flow = buildDayFlow(trip, day);
  return {
    events: flow.filter((block) => block.kind !== "synthetic_transit"),
    transports: flow.filter((block) => block.kind === "synthetic_transit"),
  };
}

export function makeItemFlowBlock(item, placesById) {
  const place = item.place_id ? placesById.get(item.place_id) : undefined;
  return {
    id: `flow_item_${item.id}`,
    itemId: item.id,
    kind: item.kind,
    title: item.title,
    timelineTitle: buildTimelineItemTitle(item, place),
    start_at: item.start_at,
    end_at: item.end_at,
    warningCount: item.validation_conflict_ids?.length ?? 0,
    locked: item.locked,
    meta: buildItemMeta(item, place),
    className: eventClass(item),
  };
}

export function flowBlockClass(block) {
  return block.className;
}

export function timelineBlockTitle(block, density = "spacious") {
  const baseTitle = block.timelineTitle || block.title;
  return adaptTimelineTitle(baseTitle, density);
}

export function exactDurationMinutes(startAt, endAt) {
  return Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000));
}

function clampPercent(value) {
  return Math.max(0, Math.min(96, value));
}

function buildDayFlow(trip, day) {
  if (!day) {
    return [];
  }

  const routesById = new Map(trip.routes.map((route) => [route.route_id, route]));
  const placesById = new Map(trip.places.map((place) => [place.place_id, place]));
  const items = day.items
    .slice()
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const flow = [];

  items.forEach((item, index) => {
    const previous = index > 0 ? items[index - 1] : null;
    const route = item.route_id ? routesById.get(item.route_id) : undefined;
    const gapMinutes = previous ? exactDurationMinutes(previous.end_at, item.start_at) : 0;

    if (shouldInsertSyntheticTransit(previous, item, route, gapMinutes)) {
      flow.push(makeTransitFlowBlock(trip, previous, item, route, placesById, gapMinutes));
    }

    flow.push(makeItemFlowBlock(item, placesById));
  });

  return flow;
}

function shouldInsertSyntheticTransit(previous, current, route, gapMinutes) {
  return Boolean(
    previous &&
      route &&
      gapMinutes > 0 &&
      route.from_item_id === previous.id &&
      route.to_item_id === current.id &&
      current.kind !== "transit" &&
      current.kind !== "flight"
  );
}

function makeTransitFlowBlock(trip, previous, current, route, placesById, gapMinutes) {
  const destination = current.place_id ? placesById.get(current.place_id) : undefined;
  return {
    id: `flow_route_${route.route_id}`,
    kind: "synthetic_transit",
    title: `${transportLabel(route.mode)} to ${destination?.name ?? current.title}`,
    timelineTitle: route.mode.toLowerCase(),
    start_at: previous.end_at,
    end_at: current.start_at,
    warningCount: countRouteWarnings(trip, previous.id, current.id),
    meta: buildTransitMeta(route, gapMinutes),
    className: "travel-block",
    transportClassName: route.mode,
  };
}

function buildItemMeta(item, place) {
  const details = [];
  const typeLabel = itemTypeLabel(item);
  if (typeLabel) {
    details.push(typeLabel);
  }

  if (place?.name && !normalizeText(item.title).includes(normalizeText(place.name))) {
    details.push(place.name);
  }

  return details.join(" · ");
}

function buildTransitMeta(route, gapMinutes) {
  const parts = [`${transportLabel(route.mode)} · route ${route.duration_minutes} min`];
  if (gapMinutes > route.duration_minutes) {
    parts.push(`scheduled window ${gapMinutes} min`);
  }
  return parts.join(" · ");
}

function transportLabel(mode) {
  if (mode === "walk") return "Walk";
  if (mode === "transit") return "Transit";
  if (mode === "taxi") return "Taxi";
  return "Drive";
}

function buildTimelineItemTitle(item, place) {
  if (item.kind === "meal") {
    return standardMealTimelineLabel(item.category);
  }

  if (item.kind === "check_in") {
    return "Hotel";
  }

  if (item.kind === "check_out") {
    return "Checkout";
  }

  if (item.kind === "buffer") {
    return normalizeText(item.title).includes("hotel") ? "Reset" : "Buffer";
  }

  if (item.kind === "flight") {
    const airportCode = extractAirportCode(item.title) ?? extractAirportCode(place?.name);
    return airportCode ?? "Flight";
  }

  if (item.kind === "transit") {
    return transportLabel(item.category === "drive" ? "drive" : "transit");
  }

  if (item.kind === "activity") {
    return standardActivityTimelineLabel(item, place);
  }

  return standardFallbackTimelineLabel(item, place);
}

function countRouteWarnings(trip, fromItemId, toItemId) {
  return trip.conflicts.filter((conflict) => {
    if (conflict.severity !== "warning") {
      return false;
    }

    return conflict.item_ids.includes(fromItemId) && conflict.item_ids.includes(toItemId);
  }).length;
}

function shortenTimelineLabel(value) {
  const cleaned = String(value)
    .replace(/^the\s+/iu, "")
    .replace(/\b(hotel asheville|hotel|district|estate|restaurant|cafe|shop|exchange|museum|park)\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  return words.length <= 2 ? cleaned || value : words.slice(0, 2).join(" ");
}

function standardMealTimelineLabel(category) {
  if (category === "breakfast") return "Breakfast";
  if (category === "brunch") return "Brunch";
  if (category === "dinner") return "Dine";
  return "Lunch";
}

function standardActivityTimelineLabel(item, place) {
  const normalized = normalizeText(place?.name ?? item.title);
  if (normalized.includes("river arts")) return "Arts";
  if (normalized.includes("battery park") || normalized.includes("book exchange") || normalized.includes("bookshop")) {
    return "Books";
  }
  if (normalized.includes("biltmore")) return "Bilt";
  if (normalized.includes("carrier park") || normalized.includes("park walk")) return "Park";
  if (normalized.includes("museum")) return "Muse";
  if (item.category === "shopping") return "Shop";
  if (item.category === "park") return "Park";
  if (item.category === "landmark") return "Stop";
  if (item.category === "sightseeing") return "Walk";
  return "Stop";
}

function standardFallbackTimelineLabel(item, place) {
  const normalized = normalizeText(place?.name ?? item.title);
  if (normalized.includes("foundry")) return "Hotel";
  if (normalized.includes("airport") || normalized.includes("avl")) return "AVL";
  if (normalized.includes("stable cafe")) return "Lunch";
  if (normalized.includes("white duck")) return "Lunch";
  if (normalized.includes("buffer")) return "Gap";
  return capitalize(item.kind.replace(/_/g, " "));
}

function adaptTimelineTitle(title, density) {
  if (density === "micro") {
    return microTimelineLabel(title);
  }

  if (density === "tight") {
    return compactTimelineLabel(title, 1);
  }

  if (density === "compact") {
    return compactTimelineLabel(title, 2);
  }

  return title;
}

function compactTimelineLabel(title, wordLimit) {
  const words = String(title).split(/\s+/u).filter(Boolean);
  if (words.length <= wordLimit) {
    return title;
  }

  return words.slice(0, wordLimit).join(" ");
}

function microTimelineLabel(title) {
  const normalized = normalizeText(title);
  if (normalized.includes("avl")) return "AVL";
  if (normalized.includes("hotel")) return "Hotel";
  if (normalized.includes("check")) return "Check";
  if (normalized.includes("dine") || normalized.includes("dinner")) return "Dine";
  if (normalized.includes("lunch")) return "Lunch";
  if (normalized.includes("brunch")) return "Brunch";
  if (normalized.includes("breakfast")) return "Breakfast";
  if (normalized.includes("biltmore")) return "Bilt";
  if (normalized.includes("reset")) return "Reset";
  if (normalized.includes("books")) return "Books";
  if (normalized.includes("arts")) return "Arts";
  if (normalized.includes("park")) return "Park";
  if (normalized.includes("buffer")) return "Buffer";
  if (normalized.includes("drive")) return "Drive";
  if (normalized.includes("transit")) return "Transit";

  return compactTimelineLabel(title, 1);
}

function timelineDensity(block, totalMinutes) {
  const actualWidth = Math.max(4, (durationMinutes(block.start_at, block.end_at) / Math.max(1, totalMinutes)) * 100);
  if (actualWidth < 5.6) return "micro";
  if (actualWidth < 8.4) return "tight";
  if (actualWidth < 11.4) return "compact";
  return "spacious";
}

function timelineMinimumWidth(displayTitle, density) {
  if (density === "micro") {
    return Math.max(6.8, 4.8 + displayTitle.length * 0.42);
  }

  if (density === "tight") {
    return Math.min(9.8, Math.max(7.8, 4.9 + displayTitle.length * 0.55));
  }

  if (density === "compact") {
    return Math.min(11.4, Math.max(8.6, 5.4 + displayTitle.length * 0.48));
  }

  return Math.min(14.8, Math.max(9.2, 5.8 + displayTitle.length * 0.38));
}

function extractAirportCode(value) {
  const match = String(value ?? "").match(/\b([A-Z]{3})\b/u);
  return match ? match[1] : null;
}
