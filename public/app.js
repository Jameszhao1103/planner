const tripId = "trip_asheville_001";

const state = {
  trip: null,
  preview: null,
  previewMeta: null,
  selectedDay: null,
  pending: false,
  provider: "mock",
};

const elements = {
  tripTitle: document.querySelector("#tripTitle"),
  tripSubtitle: document.querySelector("#tripSubtitle"),
  metaPills: document.querySelector("#metaPills"),
  dayTabs: document.querySelector("#dayTabs"),
  mapDayLabel: document.querySelector("#mapDayLabel"),
  markdownDayLabel: document.querySelector("#markdownDayLabel"),
  timelineDayLabel: document.querySelector("#timelineDayLabel"),
  mapCanvas: document.querySelector("#mapCanvas"),
  markdownPanel: document.querySelector("#markdownPanel"),
  timelinePanel: document.querySelector("#timelinePanel"),
  assistantInput: document.querySelector("#assistantInput"),
  assistantStatus: document.querySelector("#assistantStatus"),
  assistantDiff: document.querySelector("#assistantDiff"),
  assistantForm: document.querySelector("#assistantForm"),
  applyButton: document.querySelector("#applyButton"),
  rejectButton: document.querySelector("#rejectButton"),
  resetButton: document.querySelector("#resetButton"),
  quickActions: document.querySelectorAll("[data-quick-action]"),
};

bootstrap().catch((error) => {
  console.error(error);
  elements.assistantStatus.textContent = error.message;
});

elements.assistantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const utterance = elements.assistantInput.value.trim();
  if (!utterance) {
    return;
  }

  await previewWithInput({
    utterance,
  });
});

elements.applyButton.addEventListener("click", async () => {
  if (!state.previewMeta) {
    return;
  }

  setPending(true, "Applying preview…");
  try {
    const payload = await requestJson(`/api/trips/${tripId}/commands/apply`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        preview_id: state.previewMeta.preview_id,
      },
    });

    state.trip = payload.trip;
    state.preview = null;
    state.previewMeta = null;
    state.selectedDay = state.selectedDay ?? state.trip.days[0]?.date ?? null;
    elements.assistantInput.value = "";
    render();
    setPending(false, "Preview applied.");
  } catch (error) {
    setPending(false, error.message);
  }
});

elements.rejectButton.addEventListener("click", async () => {
  if (!state.previewMeta) {
    return;
  }

  setPending(true, "Rejecting preview…");
  try {
    await requestJson(`/api/trips/${tripId}/commands/reject`, {
      method: "POST",
      body: {
        preview_id: state.previewMeta.preview_id,
      },
    });

    state.preview = null;
    state.previewMeta = null;
    render();
    setPending(false, "Preview discarded.");
  } catch (error) {
    setPending(false, error.message);
  }
});

elements.resetButton.addEventListener("click", async () => {
  setPending(true, "Resetting sample trip…");
  try {
    await requestJson("/api/debug/reset", {
      method: "POST",
      body: {},
    });
    await loadTrip();
    elements.assistantInput.value = "";
    setPending(false, "Sample trip reset.");
  } catch (error) {
    setPending(false, error.message);
  }
});

elements.quickActions.forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.quickAction;
    if (!action || !state.selectedDay) {
      return;
    }

    const input = buildQuickActionInput(action, state.selectedDay);
    if (!input) {
      return;
    }

    await previewWithInput(input);
  });
});

async function bootstrap() {
  await loadTrip();
}

async function loadTrip() {
  setPending(true, "Loading trip…");
  const payload = await requestJson(`/api/trips/${tripId}`);
  state.trip = payload.trip;
  state.preview = null;
  state.previewMeta = null;
  state.provider = payload.workspace.provider ?? "mock";
  state.selectedDay = state.selectedDay ?? payload.workspace.selected_day ?? payload.trip.days[0]?.date ?? null;
  render();
  setPending(false, "Trip loaded.");
}

async function previewWithInput(input) {
  setPending(true, "Previewing change…");
  try {
    const payload = await requestJson(`/api/trips/${tripId}/commands/preview`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        input,
      },
    });

    state.preview = payload.trip_preview;
    state.previewMeta = payload;
    render();
    setPending(false, "Preview ready.");
  } catch (error) {
    setPending(false, error.message);
  }
}

function render() {
  const activeTrip = getActiveTrip();
  if (!activeTrip) {
    return;
  }

  const selectedDay = activeTrip.days.find((day) => day.date === state.selectedDay) ?? activeTrip.days[0];
  state.selectedDay = selectedDay?.date ?? null;
  const selectedLabel = selectedDay?.label ?? "Day";

  elements.tripTitle.textContent = activeTrip.title;
  elements.tripSubtitle.textContent = state.preview
    ? "Preview mode: all panels are rendering from the draft itinerary."
    : "Shared state across map, timeline, markdown, and assistant.";
  elements.mapDayLabel.textContent = selectedLabel;
  elements.markdownDayLabel.textContent = selectedLabel;
  elements.timelineDayLabel.textContent = selectedLabel;

  renderMeta(activeTrip);
  renderDayTabs(activeTrip);
  renderMap(activeTrip, selectedDay);
  renderMarkdown(activeTrip, selectedDay);
  renderTimeline(activeTrip, selectedDay);
  renderAssistant(activeTrip, selectedDay);
}

function renderMeta(trip) {
  const items = trip.days.flatMap((day) => day.items);
  elements.metaPills.innerHTML = [
    pill(`${trip.start_date} to ${trip.end_date}`),
    pill(`${trip.travelers?.length ?? 0} travelers`),
    pill(`${items.filter((item) => item.locked).length} locked items`),
    pill(`${trip.conflicts.length} conflict${trip.conflicts.length === 1 ? "" : "s"}`),
    pill(`provider: ${state.provider ?? "mock"}`),
    state.preview ? pill("Preview active") : "",
  ].join("");
}

function renderDayTabs(trip) {
  elements.dayTabs.innerHTML = "";
  trip.days.forEach((day, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day-tab${day.date === state.selectedDay ? " active" : ""}`;
    button.textContent = day.label || `Day ${index + 1}`;
    button.addEventListener("click", () => {
      state.selectedDay = day.date;
      render();
    });
    elements.dayTabs.appendChild(button);
  });
}

function renderMap(trip, day) {
  const items = day?.items ?? [];
  const places = uniquePlacesForDay(trip, items);
  if (!day || places.length === 0) {
    elements.mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
    return;
  }

  const positions = computeMapPositions(places);
  const routes = trip.routes.filter((route) => items.some((item) => item.id === route.to_item_id));
  const routeHtml = routes
    .map((route) => {
      const fromItem = items.find((item) => item.id === route.from_item_id);
      const toItem = items.find((item) => item.id === route.to_item_id);
      const fromPlace = fromItem?.place_id ? positions.get(fromItem.place_id) : null;
      const toPlace = toItem?.place_id ? positions.get(toItem.place_id) : null;
      if (!fromPlace || !toPlace) {
        return "";
      }

      const deltaX = toPlace.x - fromPlace.x;
      const deltaY = toPlace.y - fromPlace.y;
      const width = Math.sqrt(deltaX ** 2 + deltaY ** 2);
      const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
      return `<div class="route ${route.mode}" style="left:${fromPlace.x}%;top:${fromPlace.y}%;width:${width}%;transform:rotate(${angle}deg);"></div>`;
    })
    .join("");

  const markerHtml = items
    .filter((item) => item.place_id)
    .map((item) => {
      const position = positions.get(item.place_id);
      const place = trip.places.find((candidate) => candidate.place_id === item.place_id);
      if (!position || !place) {
        return "";
      }

      return `
        <div class="marker ${markerClass(place.category)}" style="left:${position.x}%;top:${position.y}%;"></div>
        <div class="marker-label" style="left:${position.x}%;top:${position.y}%;">${escapeHtml(shortLabel(item.title))}</div>
      `;
    })
    .join("");

  elements.mapCanvas.innerHTML = `${routeHtml}${markerHtml}`;
}

function renderMarkdown(trip, day) {
  const section = trip.markdown_sections?.find((candidate) => candidate.day_date === day?.date);
  if (!section) {
    elements.markdownPanel.textContent = "No markdown generated.";
    return;
  }

  elements.markdownPanel.textContent = section.content;
}

function renderTimeline(trip, day) {
  if (!day) {
    elements.timelinePanel.innerHTML = '<div class="timeline-empty">No timeline for this day.</div>';
    return;
  }

  const hourMarks = Array.from({ length: 15 }, (_, index) => `<span>${String(index + 8).padStart(2, "0")}</span>`).join("");
  const pills = day.items
    .map((item) => {
      const left = clampPercent((minutesFromDayStart(item.start_at) / (14 * 60)) * 100);
      const width = Math.max(4, (durationMinutes(item.start_at, item.end_at) / (14 * 60)) * 100);
      const warning = item.validation_conflict_ids?.length
        ? `<span class="warning">${item.validation_conflict_ids.length} conflict(s)</span>`
        : "";
      return `
        <div class="event-pill ${eventClass(item)}" style="left:${left}%;width:${width}%;">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${localTime(item.start_at)}-${localTime(item.end_at)}</small>
          ${warning}
        </div>
      `;
    })
    .join("");

  elements.timelinePanel.innerHTML = `
    <div class="timeline-board">
      <div class="timeline-spacer"></div>
      <div class="hour-ruler">${hourMarks}</div>
      <div class="lane-label">Day Flow</div>
      <div class="lane-grid">${pills}</div>
    </div>
  `;
}

function renderAssistant(trip, day) {
  if (!state.previewMeta) {
    elements.assistantDiff.innerHTML = `
      <div class="diff-summary">No preview yet.</div>
      <div class="diff-meta">Try the assistant box or use a quick action for ${escapeHtml(day.label)}.</div>
      ${renderConflicts(trip, day)}
    `;
    elements.applyButton.classList.add("hidden");
    elements.rejectButton.classList.add("hidden");
    return;
  }

  const commands = state.previewMeta.commands
    .map((command) => `<li><code>${escapeHtml(command.action)}</code> — ${escapeHtml(command.reason)}</li>`)
    .join("");
  const warnings = state.previewMeta.warnings
    .map((warning) => `<li class="conflict-error">${escapeHtml(warning)}</li>`)
    .join("");

  elements.assistantDiff.innerHTML = `
    <div class="diff-summary">${escapeHtml(state.previewMeta.diff.summary)}</div>
    <div class="diff-meta">
      Changed items: ${state.previewMeta.changed_item_ids.length} ·
      Resolved conflicts: ${state.previewMeta.resolved_conflicts.length} ·
      Introduced conflicts: ${state.previewMeta.introduced_conflicts.length}
    </div>
    <ul class="diff-list">${commands}</ul>
    ${warnings ? `<ul class="diff-list">${warnings}</ul>` : ""}
  `;

  elements.applyButton.classList.remove("hidden");
  elements.rejectButton.classList.remove("hidden");
}

function renderConflicts(trip, day) {
  const itemIds = new Set((day?.items ?? []).map((item) => item.id));
  const conflicts = trip.conflicts.filter((conflict) => conflict.item_ids.some((itemId) => itemIds.has(itemId)));
  if (conflicts.length === 0) {
    return "<div class=\"diff-meta\">No current conflicts on this day.</div>";
  }

  return `
    <ul class="diff-list">
      ${conflicts
        .map((conflict) => `<li class="${conflict.severity === "error" ? "conflict-error" : ""}">${escapeHtml(conflict.message)}</li>`)
        .join("")}
    </ul>
  `;
}

function buildQuickActionInput(action, dayDate) {
  switch (action) {
    case "replace-dinner":
      return {
        utterance: "把周六晚餐换成评分高一点的美式餐厅",
      };
    case "reoptimize-day":
      return {
        commands: [
          {
            command_id: `cmd_optimize_${Date.now()}`,
            action: "optimize_day",
            day_date: dayDate,
            reason: "Quick action: reoptimize current day",
          },
        ],
      };
    case "add-lunch":
      return {
        commands: [
          {
            command_id: `cmd_fill_${Date.now()}`,
            action: "fill_meal",
            day_date: dayDate,
            reason: "Quick action: add lunch near current route",
            payload: {
              meal_type: "lunch",
            },
          },
        ],
      };
    case "relax-day":
      return {
        commands: [
          {
            command_id: `cmd_relax_${Date.now()}`,
            action: "relax_day",
            day_date: dayDate,
            reason: "Quick action: relax current day",
          },
        ],
      };
    default:
      return null;
  }
}

function getActiveTrip() {
  return state.preview ?? state.trip;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `Request failed: ${response.status}`);
  }

  return payload.data;
}

function setPending(value, message) {
  state.pending = value;
  elements.assistantStatus.textContent = message;
}

function pill(text) {
  return `<span class="pill">${escapeHtml(text)}</span>`;
}

function uniquePlacesForDay(trip, items) {
  const seen = new Set();
  return items
    .filter((item) => item.place_id && !seen.has(item.place_id) && seen.add(item.place_id))
    .map((item) => trip.places.find((place) => place.place_id === item.place_id))
    .filter(Boolean);
}

function computeMapPositions(places) {
  const lats = places.map((place) => place.lat);
  const lngs = places.map((place) => place.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPadding = Math.max(0.01, (maxLat - minLat) * 0.25);
  const lngPadding = Math.max(0.01, (maxLng - minLng) * 0.25);
  const positions = new Map();

  places.forEach((place) => {
    const x = 12 + (((place.lng - (minLng - lngPadding)) / (maxLng - minLng + lngPadding * 2)) * 76);
    const y = 14 + (((maxLat + latPadding - place.lat) / (maxLat - minLat + latPadding * 2)) * 72);
    positions.set(place.place_id, { x, y });
  });

  return positions;
}

function markerClass(category) {
  if (category === "airport") return "airport";
  if (category === "hotel") return "hotel";
  if (category === "restaurant") return "restaurant";
  return "sight";
}

function eventClass(item) {
  if (item.kind === "meal") return "meal-block";
  if (item.kind === "check_in" || item.kind === "check_out" || item.kind === "lodging") return "stay-block";
  if (item.kind === "buffer" || item.kind === "free_time") return "buffer-block";
  if (item.kind === "transit" || item.kind === "flight") return "travel-block";
  return "activity-block";
}

function localTime(iso) {
  return iso.slice(11, 16);
}

function minutesFromDayStart(iso) {
  const [hour, minute] = iso.slice(11, 16).split(":").map((part) => Number.parseInt(part, 10));
  return Math.max(0, (hour - 8) * 60 + minute);
}

function durationMinutes(startAt, endAt) {
  return Math.max(30, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
}

function clampPercent(value) {
  return Math.max(0, Math.min(96, value));
}

function shortLabel(value) {
  return value.length > 18 ? `${value.slice(0, 16)}…` : value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
