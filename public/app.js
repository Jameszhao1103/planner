const tripId = "trip_asheville_001";

const state = {
  trip: null,
  preview: null,
  previewMeta: null,
  selectedDay: null,
  selectedItemId: null,
  workspaceTab: "selection",
  pending: false,
  statusMessage: "Loading trip…",
  statusTone: "neutral",
  provider: "mock",
  assistantProvider: "rules",
  mapsBrowserApiKey: null,
  placeSearchSession: null,
  undoAction: null,
};

const mapRuntime = {
  promise: null,
  map: null,
  infoWindow: null,
  markers: [],
  polylines: [],
  renderToken: 0,
};

const timelineDrag = {
  active: null,
};

const TIMELINE_START_HOUR = 8;
const TIMELINE_TOTAL_MINUTES = 14 * 60;
const TIMELINE_MIN_WIDTH_PERCENT = 5.4;
const TIMELINE_CARD_HEIGHT = 68;
const TIMELINE_ROW_HEIGHT = 78;
const TIMELINE_ROW_GAP = 10;
const TIMELINE_TOP_PADDING = 10;
const TIMELINE_ROW_COLLISION_GAP = 0.75;
const TIMELINE_TRANSPORT_GAP = 14;
const TIMELINE_TRANSPORT_HEIGHT = 18;
const TIMELINE_BOTTOM_PADDING = 10;

const elements = {
  tripTitle: document.querySelector("#tripTitle"),
  tripSubtitle: document.querySelector("#tripSubtitle"),
  metaPills: document.querySelector("#metaPills"),
  dayTabs: document.querySelector("#dayTabs"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapStatus: document.querySelector("#mapStatus"),
  planPanel: document.querySelector("#planPanel"),
  timelinePanel: document.querySelector("#timelinePanel"),
  workspaceTabs: document.querySelectorAll("[data-workspace-tab]"),
  workspaceViews: document.querySelectorAll("[data-workspace-view]"),
  workspaceNotice: document.querySelector("#workspaceNotice"),
  assistantInput: document.querySelector("#assistantInput"),
  focusEditor: document.querySelector("#focusEditor"),
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
  setPending(false, error.message, "error");
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
    clearPlaceSearchSession();
    clearUndoAction();
    elements.assistantInput.value = "";
    render();
    setPending(false, "Preview applied.");
  } catch (error) {
    setPending(false, error.message, "error");
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
    clearPlaceSearchSession();
    clearUndoAction();
    render();
    setPending(false, "Preview discarded.");
  } catch (error) {
    setPending(false, error.message, "error");
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
    setPending(false, error.message, "error");
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

elements.workspaceTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.workspaceTab;
    if (!tab) {
      return;
    }

    state.workspaceTab = tab;
    renderWorkspaceShell();
  });
});

elements.workspaceNotice.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-workspace-action]");
  if (!actionTarget) {
    return;
  }

  if (actionTarget.dataset.workspaceAction === "undo" && state.undoAction?.commands?.length) {
    await executeImmediately(
      {
        commands: state.undoAction.commands,
      },
      {
        pendingMessage: "Undoing last edit…",
        successMessage: "Undo applied.",
        clearSearch: false,
      }
    );
    state.undoAction = null;
    renderWorkspaceNotice();
  }
});

elements.focusEditor.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-editor-action]");
  if (!actionTarget) {
    return;
  }

  const activeTrip = getActiveTrip();
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);
  if (!selectedItem) {
    return;
  }

  const action = actionTarget.dataset.editorAction;
  if (action === "toggle-lock") {
    await executeImmediately({
      commands: [
        {
          command_id: `cmd_lock_${Date.now()}`,
          action: selectedItem.locked ? "unlock_item" : "lock_item",
          item_id: selectedItem.id,
          day_date: state.selectedDay,
          reason: selectedItem.locked ? "Unlock focused item" : "Lock focused item",
        },
      ],
    }, {
      pendingMessage: selectedItem.locked ? "Unlocking item…" : "Locking item…",
      successMessage: selectedItem.locked ? "Item unlocked." : "Item locked.",
      workspaceTab: "selection",
    });
    return;
  }

  if (action === "move-earlier" || action === "move-later") {
    const neighbor = getAdjacentItem(activeTrip, state.selectedDay, selectedItem.id, action === "move-earlier" ? -1 : 1);
    if (!neighbor) {
      return;
    }

    await executeImmediately({
      commands: [
        {
          command_id: `cmd_reorder_${Date.now()}`,
          action: "reorder_item",
          item_id: selectedItem.id,
          target_item_id: neighbor.id,
          day_date: state.selectedDay,
          reason: action === "move-earlier" ? "Move focused item earlier" : "Move focused item later",
          payload: {
            position: action === "move-earlier" ? "before" : "after",
          },
        },
      ],
    }, {
      pendingMessage: action === "move-earlier" ? "Moving item earlier…" : "Moving item later…",
      successMessage: action === "move-earlier" ? "Moved item earlier." : "Moved item later.",
      workspaceTab: "selection",
    });
    return;
  }

  if (action === "add-before" || action === "add-after") {
    const position = action === "add-before" ? "before" : "after";
    const current = getPlaceSearchSessionForItem(selectedItem.id);
    if (current?.mode === "insert" && current.position === position) {
      clearPlaceSearchSession();
    } else {
      state.placeSearchSession = {
        mode: "insert",
        itemId: selectedItem.id,
        position,
        kind: "activity",
        mealType: "lunch",
        query: "",
        results: [],
      };
    }
    render();
    return;
  }

  if (action === "replace-place") {
    const placeId = actionTarget.dataset.placeId;
    const placeName = actionTarget.dataset.placeName ?? "selected place";
    if (!placeId) {
      return;
    }

    await previewWithInput({
      commands: [
        {
          command_id: `cmd_replace_${Date.now()}`,
          action: "replace_place",
          item_id: selectedItem.id,
          day_date: state.selectedDay,
          reason: `Replace ${selectedItem.title} with ${placeName}`,
          place_id: placeId,
          constraints: {
            near_place_id: selectedItem.place_id,
          },
        },
      ],
    });
    return;
  }

  if (action === "insert-place") {
    const placeId = actionTarget.dataset.placeId;
    const placeName = actionTarget.dataset.placeName ?? "selected place";
    const session = getPlaceSearchSessionForItem(selectedItem.id);
    if (!placeId || !session || session.mode !== "insert") {
      return;
    }

    await previewWithInput({
      commands: [
        {
          command_id: `cmd_insert_${Date.now()}`,
          action: "insert_item",
          day_date: state.selectedDay,
          target_item_id: selectedItem.id,
          reason: `Insert ${placeName} ${session.position} ${selectedItem.title}`,
          kind: session.kind,
          place_id: placeId,
          constraints: {
            near_place_id: selectedItem.place_id,
          },
          payload: {
            position: session.position,
            meal_type: session.kind === "meal" ? session.mealType : undefined,
          },
        },
      ],
    });
  }
});

elements.focusEditor.addEventListener("change", (event) => {
  const field = event.target.closest("[data-place-session-field]");
  if (!field) {
    return;
  }

  const activeTrip = getActiveTrip();
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);
  if (!selectedItem) {
    return;
  }

  const session = getPlaceSearchSessionForItem(selectedItem.id);
  if (!session || session.mode !== "insert") {
    return;
  }

  if (field.dataset.placeSessionField === "kind") {
    session.kind = field.value === "meal" ? "meal" : "activity";
    if (session.kind !== "meal") {
      session.mealType = "lunch";
    }
    session.results = [];
    render();
    return;
  }

  if (field.dataset.placeSessionField === "meal-type") {
    session.mealType = field.value || "lunch";
    session.results = [];
    render();
  }
});

elements.focusEditor.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const activeTrip = getActiveTrip();
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);
  if (!selectedItem) {
    return;
  }

  const formMode = form.dataset.editorForm;
  if (formMode === "time") {
    const formData = new FormData(form);
    const startTime = String(formData.get("start_time") ?? "").trim();
    const endTime = String(formData.get("end_time") ?? "").trim();
    if (!startTime || !endTime) {
      return;
    }

    await executeImmediately({
      commands: [
        {
          command_id: `cmd_move_${Date.now()}`,
          action: "move_item",
          item_id: selectedItem.id,
          day_date: state.selectedDay,
          reason: `Adjust time for ${selectedItem.title}`,
          new_start_at: replaceIsoTime(selectedItem.start_at, startTime),
          new_end_at: replaceIsoTime(selectedItem.end_at, endTime),
        },
      ],
    }, {
      pendingMessage: `Updating ${selectedItem.title}…`,
      successMessage: `${selectedItem.title} updated.`,
      workspaceTab: "selection",
    });
    return;
  }

  if (formMode === "place-search") {
    const formData = new FormData(form);
    const query = String(formData.get("place_query") ?? "").trim();
    if (!query) {
      return;
    }

    await searchPlaces({
      mode: "replace",
      itemId: selectedItem.id,
      query,
      kind: inferInsertKindFromItem(selectedItem),
      mealType: selectedItem.kind === "meal" ? normalizeMealType(selectedItem.category) : null,
    }, selectedItem);
    return;
  }

  if (formMode === "insert-search") {
    const session = getPlaceSearchSessionForItem(selectedItem.id);
    if (!session || session.mode !== "insert") {
      return;
    }

    const formData = new FormData(form);
    const kind = String(formData.get("kind") ?? session.kind ?? "activity");
    const mealType = String(formData.get("meal_type") ?? session.mealType ?? "lunch");
    const query = String(formData.get("place_query") ?? "").trim();
    if (!query) {
      return;
    }

    await searchPlaces({
      ...session,
      kind: kind === "meal" ? "meal" : "activity",
      mealType,
      query,
    }, selectedItem);
  }
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
  state.undoAction = null;
  state.provider = payload.workspace.provider ?? "mock";
  state.assistantProvider = payload.workspace.assistant?.provider ?? "rules";
  state.mapsBrowserApiKey = payload.workspace.maps?.browser_api_key ?? null;
  state.selectedDay = state.selectedDay ?? payload.workspace.selected_day ?? payload.trip.days[0]?.date ?? null;
  state.selectedItemId = inferDefaultSelectedItemId(payload.trip, state.selectedDay, state.selectedItemId);
  clearPlaceSearchSession();
  render();
  setPending(false, "Trip loaded.");
}

async function previewWithInput(input) {
  setPending(true, "Previewing change…");
  try {
    clearUndoAction();
    const context = {
      selected_day: input.context?.selected_day ?? state.selectedDay ?? undefined,
      selected_item_id: input.context?.selected_item_id ?? state.selectedItemId ?? undefined,
    };
    const payload = await requestJson(`/api/trips/${tripId}/commands/preview`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        input: {
          ...input,
          context,
        },
      },
    });

    state.preview = payload.trip_preview;
    state.previewMeta = payload;
    state.workspaceTab = "assistant";
    clearPlaceSearchSession();
    render();
    setPending(false, "Preview ready.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
}

async function executeImmediately(input, options = {}) {
  setPending(true, options.pendingMessage ?? "Saving change…");
  try {
    clearUndoAction();
    const payload = await requestJson(`/api/trips/${tripId}/commands/execute`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        input: {
          commands: input.commands ?? [],
        },
      },
    });

    state.trip = payload.trip;
    state.preview = null;
    state.previewMeta = null;
    if (options.clearSearch !== false) {
      clearPlaceSearchSession();
    }
    if (payload.undo_commands?.length) {
      state.undoAction = {
        commands: payload.undo_commands,
        summary: options.undoSummary ?? payload.summary ?? "Undo last edit",
      };
    }
    state.workspaceTab = options.workspaceTab ?? state.workspaceTab;
    render();
    setPending(false, options.successMessage ?? payload.summary ?? "Change saved.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
}

function render() {
  const activeTrip = getActiveTrip();
  if (!activeTrip) {
    return;
  }

  const selectedDay = activeTrip.days.find((day) => day.date === state.selectedDay) ?? activeTrip.days[0];
  state.selectedDay = selectedDay?.date ?? null;
  state.selectedItemId = inferDefaultSelectedItemId(activeTrip, state.selectedDay, state.selectedItemId);
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);

  elements.tripTitle.textContent = activeTrip.title;
  elements.tripSubtitle.textContent = state.preview
    ? "Preview mode: all panels are rendering from the draft itinerary."
    : "Shared state across map, timeline, and the workspace.";

  renderMeta(activeTrip);
  renderDayTabs(activeTrip);
  renderWorkspaceShell();
  renderWorkspaceNotice();
  renderMap(activeTrip, selectedDay, selectedItem);
  renderPlan(activeTrip, selectedDay, selectedItem);
  renderTimeline(activeTrip, selectedDay, selectedItem);
  renderAssistant(activeTrip, selectedDay, selectedItem);
}

function renderMeta(trip) {
  const items = trip.days.flatMap((day) => day.items);
  elements.metaPills.innerHTML = [
    pill(`${trip.start_date} to ${trip.end_date}`),
    pill(`${trip.travelers?.length ?? 0} travelers`),
    pill(`${items.filter((item) => item.locked).length} locked items`),
    pill(`${trip.conflicts.length} conflict${trip.conflicts.length === 1 ? "" : "s"}`),
    pill(`provider: ${state.provider ?? "mock"}`),
    pill(`assistant: ${state.assistantProvider}`),
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
      state.selectedItemId = inferDefaultSelectedItemId(trip, day.date, null);
      state.workspaceTab = "selection";
      clearPlaceSearchSession();
      render();
    });
    elements.dayTabs.appendChild(button);
  });
}

function renderWorkspaceShell() {
  elements.workspaceTabs.forEach((button) => {
    const isActive = button.dataset.workspaceTab === state.workspaceTab;
    button.classList.toggle("active", isActive);
  });

  elements.workspaceViews.forEach((view) => {
    view.classList.toggle("hidden", view.dataset.workspaceView !== state.workspaceTab);
  });
}

function renderWorkspaceNotice() {
  const hasNotice = Boolean(state.statusMessage || state.undoAction);
  elements.workspaceNotice.classList.toggle("hidden", !hasNotice);
  elements.workspaceNotice.classList.toggle("error", state.statusTone === "error");
  if (!hasNotice) {
    elements.workspaceNotice.innerHTML = "";
    return;
  }

  const summaryText = state.undoAction?.summary ?? "";
  const summary = summaryText ? `<strong>${escapeHtml(summaryText)}</strong>` : "";
  const detail =
    state.statusMessage && state.statusMessage !== summaryText
      ? escapeHtml(state.statusMessage)
      : "";
  const copy = [summary, detail].filter(Boolean).join(" · ");
  const undoButton = state.undoAction
    ? `<button type="button" class="button" data-workspace-action="undo"${state.pending ? " disabled" : ""}>Undo</button>`
    : "";

  elements.workspaceNotice.innerHTML = `
    <div class="workspace-notice-copy">${copy}</div>
    ${undoButton ? `<div class="workspace-notice-actions">${undoButton}</div>` : ""}
  `;
}

function renderMap(trip, day, selectedItem) {
  const items = day?.items ?? [];
  const mapPoints = buildMapPoints(trip, items);
  if (!day || mapPoints.length === 0) {
    destroyGoogleMap();
    elements.mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
    clearMapStatus();
    return;
  }

  if (state.provider !== "google") {
    renderFallbackMap(
      trip,
      items,
      mapPoints,
      selectedItem,
      "Provider is mock. Restart the server in Google mode to render the live map."
    );
    return;
  }

  if (!state.mapsBrowserApiKey) {
    renderFallbackMap(
      trip,
      items,
      mapPoints,
      selectedItem,
      "Missing browser map key. Set GOOGLE_MAPS_BROWSER_API_KEY or GOOGLE_MAPS_API_KEY and restart the server.",
      true
    );
    return;
  }

  void renderGoogleMap(trip, items, mapPoints, selectedItem);
}

function renderPlan(trip, day, selectedItem) {
  const flow = buildPlanFlow(trip, day);
  if (flow.length === 0) {
    elements.planPanel.innerHTML = '<div class="plan-empty">No plan for this day.</div>';
    return;
  }

  elements.planPanel.innerHTML = `
    <div class="plan-list">
      ${flow
        .map((block) => {
          const warning = block.warningCount
            ? `<span class="warning">${block.warningCount} conflict(s)</span>`
            : "";
          const meta = block.meta ? `<div class="plan-meta">${escapeHtml(block.meta)}</div>` : "";
          const locked = block.locked ? '<span class="lock-badge">Locked</span>' : "";
          return `
            <article class="plan-row ${flowBlockClass(block)}${block.itemId === selectedItem?.id ? " selected" : ""}" data-item-id="${block.itemId}">
              <div class="plan-time">${localTime(block.start_at)}-${localTime(block.end_at)}</div>
              <div class="plan-copy">
                <strong>${escapeHtml(block.title)}</strong>
                ${meta}
                ${locked}
                ${warning}
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  elements.planPanel.querySelectorAll("[data-item-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectItem(row.dataset.itemId ?? null);
    });
  });
}

function renderTimeline(trip, day, selectedItem) {
  if (!day) {
    elements.timelinePanel.innerHTML = '<div class="timeline-empty">No timeline for this day.</div>';
    return;
  }

  const model = buildTimelineModel(trip, day);
  const hourMarks = Array.from({ length: 15 }, (_, index) => `<span>${String(index + 8).padStart(2, "0")}</span>`).join("");
  const layout = buildTimelineLayout(model.events);
  const eventPills = layout.events
    .map(({ block, left, width, top, density }) => {
      const warning = block.warningCount
        ? `<span class="event-alert" title="${block.warningCount} conflict(s)">${block.warningCount}</span>`
        : "";
      return `
        <div
          class="event-pill ${flowBlockClass(block)} density-${density}${block.itemId === selectedItem?.id ? " selected" : ""}${block.locked ? " locked" : ""}"
          data-item-id="${block.itemId}"
          style="left:${left}%;width:${width}%;top:${top}px;">
          ${warning}
          <strong>${escapeHtml(timelineBlockTitle(block, density))}</strong>
        </div>
      `;
    })
    .join("");
  const transportStrips = model.transports
    .map((block) => {
      const left = clampPercent((minutesFromDayStart(block.start_at) / TIMELINE_TOTAL_MINUTES) * 100);
      const width = Math.max(1.8, (exactDurationMinutes(block.start_at, block.end_at) / TIMELINE_TOTAL_MINUTES) * 100);
      const fittedLeft = Math.max(0, Math.min(100 - width, left));
      const warning = block.warningCount
        ? `<span class="transport-alert" title="${block.warningCount} warning(s)"></span>`
        : "";
      const label = width >= 5.4 ? `<span>${escapeHtml(timelineBlockTitle(block))}</span>` : "";
      return `
        <div class="transport-strip ${block.transportClassName ?? ""}" style="left:${fittedLeft}%;width:${width}%;top:${layout.transportTop}px;">
          ${label}
          ${warning}
        </div>
      `;
    })
    .join("");

  elements.timelinePanel.innerHTML = `
    <div class="timeline-board" style="--timeline-rows:${layout.rows}; --timeline-height:${layout.totalHeight}px;">
      <div class="hour-ruler">${hourMarks}</div>
      <div class="lane-grid">
        ${eventPills}
        ${transportStrips}
      </div>
    </div>
  `;

  attachTimelineInteractions(day);
}

function renderAssistant(trip, day, selectedItem) {
  elements.focusEditor.innerHTML = renderFocusedEditor(trip, day, selectedItem);
  if (!state.previewMeta) {
    elements.assistantDiff.innerHTML = `
      <div class="diff-summary">No preview yet.</div>
      <div class="diff-meta">Try the assistant box, drag a timeline card, or edit the focused item for ${escapeHtml(day.label)}.</div>
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

function renderFocusedEditor(trip, day, selectedItem) {
  if (!selectedItem) {
    return '<div class="focus-empty">Select an item from the map, plan, or timeline to edit it.</div>';
  }

  const disabledAttr = selectedItem.locked ? "disabled" : "";
  const place = selectedItem.place_id
    ? trip.places.find((candidate) => candidate.place_id === selectedItem.place_id)
    : null;
  const previous = getAdjacentItem(trip, day?.date, selectedItem.id, -1);
  const next = getAdjacentItem(trip, day?.date, selectedItem.id, 1);
  const searchSession = getPlaceSearchSessionForItem(selectedItem.id);
  const replaceSession = searchSession?.mode === "replace" ? searchSession : null;
  const insertSession = searchSession?.mode === "insert" ? searchSession : null;
  const replaceResults = replaceSession ? renderSearchResults(replaceSession.results, "replace-place") : "";

  return `
    <section class="focus-card ${eventClass(selectedItem)}">
      <div class="focus-header">
        <div>
          <div class="focus-kicker">Focused item</div>
          <h3>${escapeHtml(selectedItem.title)}</h3>
          <div class="focus-meta">${localTime(selectedItem.start_at)}-${localTime(selectedItem.end_at)} · ${escapeHtml(itemTypeLabel(selectedItem))}</div>
          ${place ? `<div class="focus-meta">${escapeHtml(place.name)}</div>` : ""}
        </div>
        <button type="button" class="button ${selectedItem.locked ? "" : "button-primary"}" data-editor-action="toggle-lock">
          ${selectedItem.locked ? "Unlock item" : "Lock item"}
        </button>
      </div>

      <div class="focus-actions">
        <button type="button" class="action" data-editor-action="move-earlier" ${previous && !selectedItem.locked ? "" : "disabled"}>Move earlier</button>
        <button type="button" class="action" data-editor-action="move-later" ${next && !selectedItem.locked ? "" : "disabled"}>Move later</button>
        <span class="focus-hint">Small edits apply immediately. Drag on the timeline to shift time.</span>
      </div>

      <form class="editor-form" data-editor-form="time">
        <label>
          <span>Start</span>
          <input type="time" name="start_time" value="${localTime(selectedItem.start_at)}" ${disabledAttr}>
        </label>
        <label>
          <span>End</span>
          <input type="time" name="end_time" value="${localTime(selectedItem.end_at)}" ${disabledAttr}>
        </label>
        <button type="submit" class="button button-primary" ${disabledAttr}>Save time</button>
      </form>

      <div class="focus-section">
        <h4>Insert Stop</h4>
        <div class="insert-actions">
          <button type="button" class="button ${insertSession?.position === "before" ? "button-primary" : ""}" data-editor-action="add-before">Add before</button>
          <button type="button" class="button ${insertSession?.position === "after" ? "button-primary" : ""}" data-editor-action="add-after">Add after</button>
        </div>
        ${insertSession ? renderInsertComposer(insertSession) : ""}
      </div>

      <div class="focus-section">
        <h4>Replace Place</h4>
      <form class="editor-form editor-form-search" data-editor-form="place-search">
        <label class="editor-search">
          <span>Replace place</span>
          <input
            type="search"
            name="place_query"
            value="${replaceSession ? escapeHtml(replaceSession.query ?? "") : ""}"
            placeholder="Search a replacement venue"
            ${disabledAttr}>
        </label>
        <button type="submit" class="button" ${disabledAttr}>Search</button>
      </form>

      ${replaceResults ? `<div class="search-results">${replaceResults}</div>` : ""}
      </div>
    </section>
  `;
}

function renderInsertComposer(session) {
  const kind = session.kind === "meal" ? "meal" : "activity";
  const mealType = session.mealType ?? "lunch";
  return `
    <div class="insert-composer">
      <div class="insert-composer-grid">
        <label>
          <span>Type</span>
          <select name="kind" data-place-session-field="kind">
            <option value="activity"${kind === "activity" ? " selected" : ""}>Activity</option>
            <option value="meal"${kind === "meal" ? " selected" : ""}>Meal</option>
          </select>
        </label>
        ${kind === "meal"
          ? `<label>
              <span>Meal type</span>
              <select name="meal_type" data-place-session-field="meal-type">
                <option value="breakfast"${mealType === "breakfast" ? " selected" : ""}>Breakfast</option>
                <option value="lunch"${mealType === "lunch" ? " selected" : ""}>Lunch</option>
                <option value="dinner"${mealType === "dinner" ? " selected" : ""}>Dinner</option>
              </select>
            </label>`
          : "<div></div>"}
      </div>
      <form class="insert-search-form" data-editor-form="insert-search">
        <label>
          <span>Search query</span>
          <input type="search" name="place_query" value="${escapeHtml(session.query ?? "")}" placeholder="Search nearby places">
        </label>
        <button type="submit" class="button">Search</button>
      </form>
      <div class="insert-composer-meta">Preview first. This will insert a new ${kind} ${session.position} the current item.</div>
      ${insertResultsContainer(session)}
    </div>
  `;
}

function insertResultsContainer(session) {
  const searchResults = renderSearchResults(session.results, "insert-place");
  return searchResults ? `<div class="search-results">${searchResults}</div>` : "";
}

function renderSearchResults(results, action) {
  return (results ?? [])
    .map((candidate) => {
      const meta = [
        candidate.primaryType,
        candidate.rating ? `★ ${candidate.rating.toFixed(1)}` : "",
        candidate.formattedAddress ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <button
          type="button"
          class="search-result"
          data-editor-action="${action}"
          data-place-id="${candidate.placeId}"
          data-place-name="${escapeHtml(candidate.name)}">
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${escapeHtml(meta)}</small>
        </button>
      `;
    })
    .join("");
}

async function searchPlaces(session, selectedItem) {
  setPending(true, `Searching places for ${selectedItem.title}…`);
  try {
    const nextSession = {
      ...session,
      results: [],
    };
    const payload = await requestJson(
      `/api/places/search?q=${encodeURIComponent(session.query)}&type=${encodeURIComponent(inferSearchTypeForSession(selectedItem, session) ?? "")}&page_size=5`
    );
    state.placeSearchSession = {
      ...nextSession,
      results: payload.candidates ?? [],
    };
    render();
    setPending(false, `Found ${(payload.candidates ?? []).length} place candidate(s).`);
  } catch (error) {
    setPending(false, error.message, "error");
  }
}

function inferSearchTypeForSession(item, session) {
  if (session.mode === "insert") {
    return session.kind === "meal" ? "restaurant" : "";
  }

  if (item.kind === "meal") {
    return "restaurant";
  }

  if (item.kind === "check_in" || item.kind === "check_out" || item.kind === "lodging") {
    return "hotel";
  }

  return "";
}

function inferInsertKindFromItem(item) {
  return item.kind === "meal" ? "meal" : "activity";
}

function normalizeMealType(value) {
  if (value === "breakfast" || value === "lunch" || value === "dinner") {
    return value;
  }

  return "lunch";
}

function getPlaceSearchSessionForItem(itemId) {
  return state.placeSearchSession?.itemId === itemId ? state.placeSearchSession : null;
}

function clearPlaceSearchSession() {
  state.placeSearchSession = null;
}

function clearUndoAction() {
  state.undoAction = null;
}

function inferDefaultSelectedItemId(trip, dayDate, preferredItemId) {
  const day = trip?.days?.find((candidate) => candidate.date === dayDate) ?? trip?.days?.[0];
  if (!day) {
    return null;
  }

  if (preferredItemId && day.items.some((item) => item.id === preferredItemId)) {
    return preferredItemId;
  }

  return day.items[0]?.id ?? null;
}

function getSelectedItem(trip, dayDate, itemId) {
  if (!trip || !dayDate || !itemId) {
    return null;
  }

  const day = trip.days.find((candidate) => candidate.date === dayDate);
  return day?.items.find((item) => item.id === itemId) ?? null;
}

function selectItem(itemId) {
  if (!itemId) {
    return;
  }

  if (state.selectedItemId !== itemId) {
    clearPlaceSearchSession();
  }

  state.selectedItemId = itemId;
  state.workspaceTab = "selection";
  render();
}

function getAdjacentItem(trip, dayDate, itemId, direction) {
  if (!trip || !dayDate || !itemId) {
    return null;
  }

  const day = trip.days.find((candidate) => candidate.date === dayDate);
  if (!day) {
    return null;
  }

  const items = day.items.slice().sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return null;
  }

  return items[index + direction] ?? null;
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
        utterance: "把当前这天的晚餐换成评分高一点的美式餐厅",
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

function attachTimelineInteractions(day) {
  const laneGrid = elements.timelinePanel.querySelector(".lane-grid");
  if (!laneGrid || !day) {
    return;
  }

  elements.timelinePanel.querySelectorAll(".event-pill[data-item-id]").forEach((pill) => {
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
        originalStartAt: item.start_at,
        originalEndAt: item.end_at,
        pill,
        dragging: false,
      };

      document.addEventListener("pointermove", handleTimelinePointerMove);
      document.addEventListener("pointerup", handleTimelinePointerUp, { once: true });
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

async function handleTimelinePointerUp(event) {
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

  const rawMinutes = (deltaX / Math.max(1, drag.laneWidth)) * TIMELINE_TOTAL_MINUTES;
  const deltaMinutes = snapMinutes(rawMinutes, 15);
  if (!deltaMinutes) {
    return;
  }

  await executeImmediately({
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
  }, {
    pendingMessage: "Adjusting item time…",
    successMessage: "Timeline edit applied.",
    workspaceTab: "selection",
  });
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

function setPending(value, message, tone = "neutral") {
  state.pending = value;
  state.statusMessage = message;
  state.statusTone = tone;
  elements.assistantStatus.textContent = message;
  renderWorkspaceNotice();
}

function pill(text) {
  return `<span class="pill">${escapeHtml(text)}</span>`;
}

function buildMapPoints(trip, items) {
  const placeById = new Map(trip.places.map((place) => [place.place_id, place]));
  const countsByPlace = new Map();

  return items
    .filter((item) => item.place_id)
    .map((item, index) => {
      const place = placeById.get(item.place_id);
      if (!place) {
        return null;
      }

      const occurrence = countsByPlace.get(place.place_id) ?? 0;
      countsByPlace.set(place.place_id, occurrence + 1);
      const location = jitterMapPoint(place, occurrence);

      return {
        item,
        place,
        label: String(index + 1),
        lat: location.lat,
        lng: location.lng,
      };
    })
    .filter(Boolean);
}

function jitterMapPoint(place, occurrence) {
  if (!occurrence) {
    return { lat: place.lat, lng: place.lng };
  }

  const angle = occurrence * 2.1;
  const radius = 0.0022 * Math.min(occurrence, 3);
  return {
    lat: place.lat + Math.sin(angle) * radius,
    lng: place.lng + Math.cos(angle) * radius,
  };
}

function computeMapPositions(mapPoints) {
  const lats = mapPoints.map((point) => point.lat);
  const lngs = mapPoints.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPadding = Math.max(0.01, (maxLat - minLat) * 0.25);
  const lngPadding = Math.max(0.01, (maxLng - minLng) * 0.25);
  const positions = new Map();

  mapPoints.forEach((point) => {
    const x = 12 + (((point.lng - (minLng - lngPadding)) / (maxLng - minLng + lngPadding * 2)) * 76);
    const y = 14 + (((maxLat + latPadding - point.lat) / (maxLat - minLat + latPadding * 2)) * 72);
    positions.set(point.item.id, { x, y });
  });

  return positions;
}

function renderFallbackMap(trip, items, mapPoints, selectedItem, message = "", isError = false) {
  destroyGoogleMap();
  if (mapPoints.length === 0) {
    elements.mapCanvas.innerHTML = '<div class="map-empty">No map data for this day.</div>';
    setMapStatus(message, isError);
    return;
  }

  const positions = computeMapPositions(mapPoints);
  const itemIds = new Set(items.map((item) => item.id));
  const routes = trip.routes.filter(
    (route) => itemIds.has(route.from_item_id) && itemIds.has(route.to_item_id)
  );
  const routeHtml = routes
    .map((route) => {
      const fromPosition = positions.get(route.from_item_id);
      const toPosition = positions.get(route.to_item_id);
      if (!fromPosition || !toPosition) {
        return "";
      }

      const deltaX = toPosition.x - fromPosition.x;
      const deltaY = toPosition.y - fromPosition.y;
      const width = Math.sqrt(deltaX ** 2 + deltaY ** 2);
      const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
      return `<div class="route ${route.mode}${routeTouchesSelected(route, selectedItem?.id) ? " selected" : ""}" style="left:${fromPosition.x}%;top:${fromPosition.y}%;width:${width}%;transform:rotate(${angle}deg);"></div>`;
    })
    .join("");

  const markerHtml = mapPoints
    .map((point) => {
      const position = positions.get(point.item.id);
      if (!position) {
        return "";
      }

      return `
        <button
          type="button"
          class="marker ${markerClass(point.place.category)}${point.item.id === selectedItem?.id ? " selected" : ""}"
          data-map-item-id="${point.item.id}"
          style="left:${position.x}%;top:${position.y}%;">
          <span>${escapeHtml(point.label)}</span>
        </button>
        <div class="marker-label${point.item.id === selectedItem?.id ? " selected" : ""}" style="left:${position.x}%;top:${position.y}%;">${escapeHtml(shortLabel(timelineBlockTitle(makeItemFlowBlock(point.item, new Map([[point.place.place_id, point.place]])))))}</div>
      `;
    })
    .join("");

  elements.mapCanvas.innerHTML = `${routeHtml}${markerHtml}`;
  elements.mapCanvas.querySelectorAll("[data-map-item-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectItem(button.dataset.mapItemId ?? null);
    });
  });
  setMapStatus(message, isError);
}

async function renderGoogleMap(trip, items, mapPoints, selectedItem) {
  const renderToken = ++mapRuntime.renderToken;
  setMapStatus("Loading Google Map…");

  try {
    const maps = await loadGoogleMapsApi(state.mapsBrowserApiKey);
    if (renderToken !== mapRuntime.renderToken) {
      return;
    }

    ensureGoogleMap(maps);
    drawGoogleMap(trip, items, mapPoints, selectedItem, maps);
    clearMapStatus();
  } catch (error) {
    if (renderToken !== mapRuntime.renderToken) {
      return;
    }

    renderFallbackMap(
      trip,
      items,
      mapPoints,
      selectedItem,
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

function drawGoogleMap(trip, items, mapPoints, selectedItem, maps) {
  clearGoogleMapOverlays();

  const itemIds = new Set(items.map((item) => item.id));
  const routes = trip.routes.filter(
    (route) => itemIds.has(route.from_item_id) && itemIds.has(route.to_item_id)
  );
  const pointByItemId = new Map(mapPoints.map((point) => [point.item.id, point]));
  const bounds = new maps.LatLngBounds();

  mapPoints.forEach((point) => {
    bounds.extend({ lat: point.lat, lng: point.lng });
    const marker = new maps.Marker({
      map: mapRuntime.map,
      position: { lat: point.lat, lng: point.lng },
      title: point.item.title,
      label: {
        text: point.label,
        color: point.item.id === selectedItem?.id ? "#145a4a" : "#ffffff",
        fontWeight: "700",
      },
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: point.item.id === selectedItem?.id ? 13 : 11,
        fillColor: markerColor(point.place.category),
        fillOpacity: 1,
        strokeColor: point.item.id === selectedItem?.id ? "#145a4a" : "#ffffff",
        strokeWeight: point.item.id === selectedItem?.id ? 3 : 2,
      },
      zIndex: point.item.id === selectedItem?.id ? 9 : 4,
    });

    marker.addListener("click", () => {
      selectItem(point.item.id);
    });

    mapRuntime.markers.push(marker);
  });

  routes.forEach((route) => {
    const fromPoint = pointByItemId.get(route.from_item_id);
    const toPoint = pointByItemId.get(route.to_item_id);
    if (!fromPoint || !toPoint) {
      return;
    }

    const style = routeStyle(route.mode);
    const isSelected = routeTouchesSelected(route, selectedItem?.id);
    const path = buildRoutePath(maps, route, fromPoint, toPoint);
    path.forEach((point) => {
      bounds.extend(point);
    });

    const polyline = new maps.Polyline({
      map: mapRuntime.map,
      path,
      geodesic: false,
      strokeColor: style.strokeColor,
      strokeOpacity: isSelected ? 1 : style.strokeOpacity,
      strokeWeight: isSelected ? style.strokeWeight + 2 : style.strokeWeight,
      icons: style.icons,
      zIndex: isSelected ? 3 : 1,
    });

    mapRuntime.polylines.push(polyline);
  });

  if (mapPoints.length === 1) {
    mapRuntime.map?.setCenter({ lat: mapPoints[0].lat, lng: mapPoints[0].lng });
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
    .map((block) => {
      const density = timelineDensity(block);
      const displayTitle = timelineBlockTitle(block, density);
      const startPercent = clampPercent((minutesFromDayStart(block.start_at) / TIMELINE_TOTAL_MINUTES) * 100);
      const actualWidth = Math.max(4, (durationMinutes(block.start_at, block.end_at) / TIMELINE_TOTAL_MINUTES) * 100);
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

function buildPlanFlow(trip, day) {
  return buildDayFlow(trip, day).filter((block) => block.kind !== "synthetic_transit");
}

function buildTimelineModel(trip, day) {
  const flow = buildDayFlow(trip, day);
  return {
    events: flow.filter((block) => block.kind !== "synthetic_transit"),
    transports: flow.filter((block) => block.kind === "synthetic_transit"),
  };
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

function makeItemFlowBlock(item, placesById) {
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

function flowBlockClass(block) {
  return block.className;
}

function timelineBlockTitle(block, density = "spacious") {
  const baseTitle = block.timelineTitle || block.title;
  return adaptTimelineTitle(baseTitle, density);
}

function transportLabel(mode) {
  if (mode === "walk") return "Walk";
  if (mode === "transit") return "Transit";
  if (mode === "taxi") return "Taxi";
  return "Drive";
}

function itemTypeLabel(item) {
  if (item.kind === "meal") {
    return capitalize(item.category ?? "meal");
  }
  if (item.kind === "check_in") return "Hotel check-in";
  if (item.kind === "check_out") return "Hotel check-out";
  if (item.kind === "buffer") return "Buffer";
  if (item.kind === "flight") return "Flight";
  if (item.kind === "transit") return "Transit";
  if (item.kind === "activity") return capitalize(item.category ?? "activity");
  return capitalize(item.kind.replace(/_/g, " "));
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

function shortLabel(value) {
  return value.length > 18 ? `${value.slice(0, 16)}…` : value;
}

function exactDurationMinutes(startAt, endAt) {
  return Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000));
}

function replaceIsoTime(iso, time) {
  const [hours, minutes] = time.split(":").map((value) => Number.parseInt(value, 10));
  const offsetMinutes = parseOffsetMinutes(iso);
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  shifted.setUTCHours(hours, minutes, 0, 0);
  return formatIsoWithOffset(new Date(shifted.getTime() - offsetMinutes * 60000), offsetMinutes);
}

function shiftIsoByMinutes(iso, deltaMinutes) {
  const offsetMinutes = parseOffsetMinutes(iso);
  const nextDate = new Date(new Date(iso).getTime() + deltaMinutes * 60000);
  return formatIsoWithOffset(nextDate, offsetMinutes);
}

function parseOffsetMinutes(iso) {
  if (iso.endsWith("Z")) {
    return 0;
  }

  const match = iso.match(/([+-])(\d{2}):(\d{2})$/u);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number.parseInt(match[2], 10) * 60 + Number.parseInt(match[3], 10));
}

function formatIsoWithOffset(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const second = String(shifted.getUTCSeconds()).padStart(2, "0");

  if (offsetMinutes === 0) {
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetMinute = String(absolute % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetHour}:${offsetMinute}`;
}

function snapMinutes(value, step) {
  return Math.round(value / step) * step;
}

function routeTouchesSelected(route, selectedItemId) {
  return Boolean(selectedItemId && (route.from_item_id === selectedItemId || route.to_item_id === selectedItemId));
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function normalizeText(value) {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
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

function canonicalTimelineLabel(value) {
  const normalized = normalizeText(value);
  if (normalized.includes("river arts")) return "River Arts";
  if (normalized.includes("battery park") || normalized.includes("book exchange") || normalized.includes("bookshop")) {
    return "Bookshop";
  }
  if (normalized.includes("biltmore")) return "Biltmore";
  if (normalized.includes("carrier park") || normalized.includes("park walk")) return "Park";
  if (normalized.includes("white duck")) return "White Duck";
  if (normalized.includes("stable cafe")) return "Stable Cafe";
  if (normalized.includes("foundry")) return "Foundry";
  return shortenTimelineLabel(value);
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

function timelineDensity(block) {
  const actualWidth = Math.max(4, (durationMinutes(block.start_at, block.end_at) / TIMELINE_TOTAL_MINUTES) * 100);
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
