const tripId = "trip_asheville_001";

const state = {
  trip: null,
  preview: null,
  previewMeta: null,
  selectedDay: null,
  pending: false,
  provider: "mock",
  mapsBrowserApiKey: null,
};

const mapRuntime = {
  promise: null,
  map: null,
  infoWindow: null,
  markers: [],
  polylines: [],
  renderToken: 0,
};

const TIMELINE_START_HOUR = 8;
const TIMELINE_TOTAL_MINUTES = 14 * 60;
const TIMELINE_MIN_WIDTH_PERCENT = 8.5;
const TIMELINE_ROW_HEIGHT = 116;
const TIMELINE_ROW_GAP = 12;
const TIMELINE_TOP_PADDING = 12;
const TIMELINE_ROW_COLLISION_GAP = 0.75;

const elements = {
  tripTitle: document.querySelector("#tripTitle"),
  tripSubtitle: document.querySelector("#tripSubtitle"),
  metaPills: document.querySelector("#metaPills"),
  dayTabs: document.querySelector("#dayTabs"),
  mapDayLabel: document.querySelector("#mapDayLabel"),
  markdownDayLabel: document.querySelector("#markdownDayLabel"),
  timelineDayLabel: document.querySelector("#timelineDayLabel"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapStatus: document.querySelector("#mapStatus"),
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
  state.mapsBrowserApiKey = payload.workspace.maps?.browser_api_key ?? null;
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
    pill(state.mapsBrowserApiKey ? "map key detected" : "map key missing"),
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
    destroyGoogleMap();
    elements.mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
    clearMapStatus();
    return;
  }

  if (state.provider !== "google") {
    renderFallbackMap(trip, items, places, "Provider is mock. Restart the server in Google mode to render the live map.");
    return;
  }

  if (!state.mapsBrowserApiKey) {
    renderFallbackMap(
      trip,
      items,
      places,
      "Missing browser map key. Set GOOGLE_MAPS_BROWSER_API_KEY or GOOGLE_MAPS_API_KEY and restart the server.",
      true
    );
    return;
  }

  void renderGoogleMap(trip, items, places);
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
  const layout = buildTimelineLayout(day.items);
  const pills = layout.events
    .map(({ item, left, width, top, compact }) => {
      const warning = item.validation_conflict_ids?.length
        ? `<span class="warning">${item.validation_conflict_ids.length} conflict(s)</span>`
        : "";
      return `
        <div class="event-pill ${eventClass(item)}${compact ? " compact" : ""}" style="left:${left}%;width:${width}%;top:${top}px;">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${localTime(item.start_at)}-${localTime(item.end_at)}</small>
          ${warning}
        </div>
      `;
    })
    .join("");

  elements.timelinePanel.innerHTML = `
    <div class="timeline-board" style="--timeline-rows:${layout.rows};">
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

function renderFallbackMap(trip, items, places, message = "", isError = false) {
  destroyGoogleMap();
  if (places.length === 0) {
    elements.mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
    setMapStatus(message, isError);
    return;
  }

  const positions = computeMapPositions(places);
  const itemIds = new Set(items.map((item) => item.id));
  const routes = trip.routes.filter(
    (route) => itemIds.has(route.from_item_id) && itemIds.has(route.to_item_id)
  );
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
  setMapStatus(message, isError);
}

async function renderGoogleMap(trip, items, places) {
  const renderToken = ++mapRuntime.renderToken;
  setMapStatus("Loading Google Map…");

  try {
    const maps = await loadGoogleMapsApi(state.mapsBrowserApiKey);
    if (renderToken !== mapRuntime.renderToken) {
      return;
    }

    ensureGoogleMap(maps);
    drawGoogleMap(trip, items, places, maps);
    clearMapStatus();
  } catch (error) {
    if (renderToken !== mapRuntime.renderToken) {
      return;
    }

    renderFallbackMap(
      trip,
      items,
      places,
      error instanceof Error
        ? error.message
        : "Failed to load Google Maps JavaScript API.",
      true
    );
  }
}

function ensureGoogleMap(maps) {
  if (mapRuntime.map) {
    return;
  }

  elements.mapCanvas.innerHTML = "";
  mapRuntime.map = new maps.Map(elements.mapCanvas, {
    center: { lat: 35.5951, lng: -82.5515 },
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: "cooperative",
  });
  mapRuntime.infoWindow = new maps.InfoWindow();
}

function drawGoogleMap(trip, items, places, maps) {
  clearGoogleMapOverlays();

  const itemIds = new Set(items.map((item) => item.id));
  const routes = trip.routes.filter(
    (route) => itemIds.has(route.from_item_id) && itemIds.has(route.to_item_id)
  );
  const placeById = new Map(trip.places.map((place) => [place.place_id, place]));
  const bounds = new maps.LatLngBounds();

  places.forEach((place, index) => {
    bounds.extend({ lat: place.lat, lng: place.lng });
    const marker = new maps.Marker({
      map: mapRuntime.map,
      position: { lat: place.lat, lng: place.lng },
      title: place.name,
      label: {
        text: String(index + 1),
        color: "#ffffff",
        fontWeight: "700",
      },
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: markerColor(place.category),
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
    });

    marker.addListener("click", () => {
      mapRuntime.infoWindow?.setContent(`
        <div style="font-family:Georgia, serif; min-width:180px;">
          <strong>${escapeHtml(place.name)}</strong><br>
          <span>${escapeHtml(place.formatted_address ?? place.address ?? "")}</span>
        </div>
      `);
      mapRuntime.infoWindow?.open({
        anchor: marker,
        map: mapRuntime.map,
      });
    });

    mapRuntime.markers.push(marker);
  });

  routes.forEach((route) => {
    const fromItem = items.find((item) => item.id === route.from_item_id);
    const toItem = items.find((item) => item.id === route.to_item_id);
    const fromPlace = fromItem?.place_id ? placeById.get(fromItem.place_id) : null;
    const toPlace = toItem?.place_id ? placeById.get(toItem.place_id) : null;
    if (!fromPlace || !toPlace) {
      return;
    }

    const style = routeStyle(route.mode);
    const path = buildRoutePath(maps, route, fromPlace, toPlace);
    path.forEach((point) => {
      bounds.extend(point);
    });

    const polyline = new maps.Polyline({
      map: mapRuntime.map,
      path,
      geodesic: false,
      strokeColor: style.strokeColor,
      strokeOpacity: style.strokeOpacity,
      strokeWeight: style.strokeWeight,
      icons: style.icons,
      zIndex: 1,
    });

    mapRuntime.polylines.push(polyline);
  });

  if (places.length === 1) {
    mapRuntime.map?.setCenter({ lat: places[0].lat, lng: places[0].lng });
    mapRuntime.map?.setZoom(13);
    return;
  }

  if (!bounds.isEmpty()) {
    mapRuntime.map?.fitBounds(bounds, 56);
  }
}

function buildRoutePath(maps, route, fromPlace, toPlace) {
  const stepPath = decodeRouteStepPath(maps, route.steps);
  if (stepPath.length >= 2) {
    return stepPath;
  }

  if (route.polyline && maps.geometry?.encoding?.decodePath) {
    try {
      return normalizeDecodedPath(maps.geometry.encoding.decodePath(route.polyline));
    } catch (_error) {
      // Fall back to a straight line if the polyline payload is not encoded.
    }
  }

  return [
    { lat: fromPlace.lat, lng: fromPlace.lng },
    { lat: toPlace.lat, lng: toPlace.lng },
  ];
}

function decodeRouteStepPath(maps, steps = []) {
  if (!maps.geometry?.encoding?.decodePath || !Array.isArray(steps) || steps.length === 0) {
    return [];
  }

  const points = [];
  steps.forEach((step) => {
    if (!step?.polyline) {
      return;
    }

    try {
      const decoded = normalizeDecodedPath(maps.geometry.encoding.decodePath(step.polyline));
      decoded.forEach((point, index) => {
        const previous = points[points.length - 1];
        if (
          index > 0 &&
          previous &&
          previous.lat === point.lat &&
          previous.lng === point.lng
        ) {
          return;
        }
        points.push(point);
      });
    } catch (_error) {
      // Ignore broken step polylines and let the overview polyline handle the route.
    }
  });

  return points;
}

function normalizeDecodedPath(path) {
  return Array.from(path ?? []).map((point) => ({
    lat: typeof point.lat === "function" ? point.lat() : point.lat,
    lng: typeof point.lng === "function" ? point.lng() : point.lng,
  }));
}

function routeStyle(mode) {
  if (mode === "walk") {
    return {
      strokeColor: "#2d6cdf",
      strokeOpacity: 0,
      strokeWeight: 3,
      icons: [
        {
          icon: {
            path: "M 0,-1 0,1",
            strokeOpacity: 1,
            strokeWeight: 2.4,
            scale: 4,
          },
          offset: "0",
          repeat: "14px",
        },
      ],
    };
  }

  if (mode === "transit") {
    return {
      strokeColor: "#1b5cc8",
      strokeOpacity: 0.9,
      strokeWeight: 4,
      icons: [
        {
          icon: {
            path: "M 0,-1 0,1",
            strokeOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
            scale: 4,
          },
          offset: "0",
          repeat: "18px",
        },
      ],
    };
  }

  if (mode === "taxi") {
    return {
      strokeColor: "#4474c4",
      strokeOpacity: 0.92,
      strokeWeight: 5,
    };
  }

  return {
    strokeColor: "#2d6cdf",
    strokeOpacity: 0.94,
    strokeWeight: 5,
  };
}

function markerColor(category) {
  if (category === "airport") return "#245fce";
  if (category === "hotel") return "#8b4db3";
  if (category === "restaurant") return "#d28325";
  return "#2d8c54";
}

function clearGoogleMapOverlays() {
  mapRuntime.markers.forEach((marker) => marker.setMap(null));
  mapRuntime.polylines.forEach((polyline) => polyline.setMap(null));
  mapRuntime.markers = [];
  mapRuntime.polylines = [];
}

function destroyGoogleMap() {
  clearGoogleMapOverlays();
  mapRuntime.infoWindow?.close();
  mapRuntime.infoWindow = null;
  mapRuntime.map = null;
}

function setMapStatus(message, isError = false) {
  if (!message) {
    clearMapStatus();
    return;
  }

  elements.mapStatus.textContent = message;
  elements.mapStatus.classList.remove("hidden");
  elements.mapStatus.classList.toggle("error", isError);
}

function clearMapStatus() {
  elements.mapStatus.textContent = "";
  elements.mapStatus.classList.add("hidden");
  elements.mapStatus.classList.remove("error");
}

function loadGoogleMapsApi(apiKey) {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (mapRuntime.promise) {
    return mapRuntime.promise;
  }

  mapRuntime.promise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    window.gm_authFailure = () => {
      mapRuntime.promise = null;
      finish(
        reject,
        new Error(
          "Google Maps browser key was rejected. Check Maps JavaScript API access and localhost referrer restrictions."
        )
      );
    };

    const existing = document.querySelector('script[data-google-maps-loader="true"]');
    if (existing) {
      existing.addEventListener("load", () => finish(resolve, window.google.maps), { once: true });
      existing.addEventListener(
        "error",
        () => {
          mapRuntime.promise = null;
          finish(reject, new Error("Failed to load Google Maps JavaScript API."));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=geometry`;
    script.addEventListener(
      "load",
      () => {
        if (!window.google?.maps) {
          mapRuntime.promise = null;
          finish(reject, new Error("Google Maps loaded without window.google.maps."));
          return;
        }

        finish(resolve, window.google.maps);
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => {
        mapRuntime.promise = null;
        finish(
          reject,
          new Error("Failed to load Google Maps JavaScript API. Check the browser key and network access.")
        );
      },
      { once: true }
    );
    document.head.appendChild(script);
  });

  return mapRuntime.promise;
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
  return Math.max(0, (hour - TIMELINE_START_HOUR) * 60 + minute);
}

function durationMinutes(startAt, endAt) {
  return Math.max(30, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
}

function clampPercent(value) {
  return Math.max(0, Math.min(96, value));
}

function buildTimelineLayout(items) {
  const rowEnds = [];
  const events = items
    .slice()
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
    .map((item) => {
      const startPercent = clampPercent((minutesFromDayStart(item.start_at) / TIMELINE_TOTAL_MINUTES) * 100);
      const actualWidth = Math.max(4, (durationMinutes(item.start_at, item.end_at) / TIMELINE_TOTAL_MINUTES) * 100);
      const minimumWidth = Math.min(
        16,
        Math.max(TIMELINE_MIN_WIDTH_PERCENT, 5.6 + item.title.length * 0.12)
      );
      const width = Math.max(actualWidth, minimumWidth);
      const left = Math.max(0, Math.min(100 - width, startPercent));

      let rowIndex = rowEnds.findIndex((occupiedUntil) => left >= occupiedUntil);
      if (rowIndex === -1) {
        rowIndex = rowEnds.length;
        rowEnds.push(0);
      }

      rowEnds[rowIndex] = left + width + TIMELINE_ROW_COLLISION_GAP;

      return {
        item,
        left,
        width,
        compact: actualWidth < TIMELINE_MIN_WIDTH_PERCENT,
        top: TIMELINE_TOP_PADDING + rowIndex * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP),
      };
    });

  return {
    events,
    rows: Math.max(1, rowEnds.length),
  };
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
