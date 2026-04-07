const state = {
  tripId: null,
  tripList: [],
  trip: null,
  preview: null,
  previewMeta: null,
  selectedDay: null,
  selectedItemId: null,
  scheduleTab: "timeline",
  workspaceTab: "selection",
  pending: false,
  statusMessage: "Loading trip…",
  statusTone: "neutral",
  provider: "mock",
  assistantProvider: "rules",
  storageMode: "memory",
  mapsBrowserApiKey: null,
  debugEnabled: false,
  placeSearchSession: null,
  undoStack: [],
  redoStack: [],
  titleEditing: false,
  tripBrowserOpen: false,
  tripBrowserMode: "browse",
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

const initialRouteState = readUrlState();
const UI_LOCALE = globalThis.navigator?.language || "en-US";
const BROWSER_TIME_ZONE = resolveBrowserTimeZone();
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(UI_LOCALE, {
  month: "short",
  day: "numeric",
});
const SHORT_DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat(UI_LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const NUMBER_FORMATTER = new Intl.NumberFormat(UI_LOCALE);

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
  tripTitleKicker: document.querySelector("#tripTitleKicker"),
  tripSubtitle: document.querySelector("#tripSubtitle"),
  tripTitleForm: document.querySelector("#tripTitleForm"),
  tripTitleInput: document.querySelector("#tripTitleInput"),
  editTripTitleButton: document.querySelector("#editTripTitleButton"),
  cancelTripTitleButton: document.querySelector("#cancelTripTitleButton"),
  metaPills: document.querySelector("#metaPills"),
  grid: document.querySelector(".grid"),
  globalDaySwitcher: document.querySelector(".global-day-switcher"),
  tripBrowser: document.querySelector("#tripBrowser"),
  tripBrowserToggleButton: document.querySelector("#tripBrowserToggleButton"),
  newTripToggleButton: document.querySelector("#newTripToggleButton"),
  tripBrowserCloseButton: document.querySelector("#tripBrowserCloseButton"),
  tripList: document.querySelector("#tripList"),
  tripCreateForm: document.querySelector("#tripCreateForm"),
  tripCreateTitle: document.querySelector("#tripCreateTitle"),
  tripCreateStartDate: document.querySelector("#tripCreateStartDate"),
  tripCreateEndDate: document.querySelector("#tripCreateEndDate"),
  tripCreateTimezone: document.querySelector("#tripCreateTimezone"),
  tripCreateTravelers: document.querySelector("#tripCreateTravelers"),
  dayTabs: document.querySelector("#dayTabs"),
  addDayButton: document.querySelector("#addDayButton"),
  removeDayButton: document.querySelector("#removeDayButton"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapStatus: document.querySelector("#mapStatus"),
  planPanel: document.querySelector("#planPanel"),
  timelinePanel: document.querySelector("#timelinePanel"),
  scheduleTabs: document.querySelectorAll("[data-schedule-tab]"),
  scheduleViews: document.querySelectorAll("[data-schedule-view]"),
  exportCalendarButton: document.querySelector("#exportCalendarButton"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
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

state.tripId = initialRouteState.tripId;
state.selectedDay = initialRouteState.selectedDay;
state.selectedItemId = initialRouteState.selectedItemId;
state.scheduleTab = initialRouteState.scheduleTab;
state.workspaceTab = initialRouteState.workspaceTab;

bootstrap().catch((error) => {
  console.error(error);
  setPending(false, error.message, "error");
});

elements.editTripTitleButton.addEventListener("click", () => {
  if (!state.trip) {
    return;
  }

  state.titleEditing = true;
  renderTitleEditor();
  elements.tripTitleInput.focus();
  elements.tripTitleInput.select();
});

elements.tripBrowserToggleButton.addEventListener("click", () => {
  state.tripBrowserMode = "browse";
  state.tripBrowserOpen = !state.tripBrowserOpen;
  render();
});

elements.newTripToggleButton.addEventListener("click", () => {
  state.tripBrowserMode = "create";
  state.tripBrowserOpen = true;
  render();
  elements.tripCreateTitle.focus();
});

elements.tripBrowserCloseButton.addEventListener("click", () => {
  state.tripBrowserOpen = false;
  state.tripBrowserMode = "browse";
  render();
});

elements.cancelTripTitleButton.addEventListener("click", () => {
  state.titleEditing = false;
  renderTitleEditor();
});

elements.tripTitleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.trip) {
    return;
  }

  const nextTitle = elements.tripTitleInput.value.trim();
  if (!nextTitle) {
    return;
  }

  setPending(true, "Renaming trip…");
  try {
    const payload = await requestJson(`/api/trips/${requireTripId()}/rename`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        title: nextTitle,
      },
    });

    state.trip = payload.trip;
    syncTripListEntry(payload.trip);
    state.preview = null;
    state.previewMeta = null;
    state.titleEditing = false;
    render();
    setPending(false, payload.summary ?? "Trip renamed.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
});

elements.tripCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.tripCreateForm);
  const title = String(formData.get("title") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "").trim();
  const endDate = String(formData.get("end_date") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const travelerCount = Number.parseInt(String(formData.get("traveler_count") ?? "2"), 10);

  if (!title || !startDate || !endDate || !timezone) {
    return;
  }

  setPending(true, "Creating trip…");
  try {
    const payload = await requestJson("/api/trips", {
      method: "POST",
      body: {
        title,
        start_date: startDate,
        end_date: endDate,
        timezone,
        traveler_count: travelerCount,
      },
    });

    state.tripId = payload.trip.trip_id;
    state.tripBrowserOpen = false;
    state.tripBrowserMode = "browse";
    elements.tripCreateForm.reset();
    seedTripCreateForm();
    elements.tripCreateTimezone.value = timezone;
    elements.tripCreateTravelers.value = String(travelerCount);
    await loadTrips();
    await loadTrip(state.tripId);
    setPending(false, payload.summary ?? "Trip created.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
});

elements.tripList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-trip-id]");
  if (!button) {
    return;
  }

  const nextTripId = button.dataset.tripId;
  if (!nextTripId || nextTripId === state.tripId) {
    return;
  }

  state.tripBrowserOpen = false;
  state.tripBrowserMode = "browse";
  await loadTrip(nextTripId);
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
    const payload = await requestJson(`/api/trips/${requireTripId()}/commands/apply`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        preview_id: state.previewMeta.preview_id,
      },
    });

    state.trip = payload.trip;
    syncTripListEntry(payload.trip);
    state.preview = null;
    state.previewMeta = null;
    state.selectedDay = state.selectedDay ?? state.trip.days[0]?.date ?? null;
    clearPlaceSearchSession();
    clearHistory();
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
    await requestJson(`/api/trips/${requireTripId()}/commands/reject`, {
      method: "POST",
      body: {
        preview_id: state.previewMeta.preview_id,
      },
    });

    state.preview = null;
    state.previewMeta = null;
    clearPlaceSearchSession();
    clearHistory();
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
    await loadTrips();
    await loadTrip(state.tripId);
    elements.assistantInput.value = "";
    setPending(false, "Sample trip reset.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
});

elements.addDayButton.addEventListener("click", async () => {
  if (!state.trip) {
    return;
  }

  const nextDayDate = addDaysToDate(state.trip.end_date, 1);
  await executeImmediately({
    commands: [
      {
        command_id: `cmd_add_day_${Date.now()}`,
        action: "add_day",
        day_date: nextDayDate,
        reason: "Append a new trip day",
        payload: {
          date: nextDayDate,
        },
      },
    ],
  }, {
    pendingMessage: "Adding day…",
    successMessage: "Day added.",
    workspaceTab: "selection",
    selectDay: nextDayDate,
  });
});

elements.removeDayButton.addEventListener("click", async () => {
  if (!state.trip || !state.selectedDay) {
    return;
  }

  await executeImmediately({
    commands: [
      {
        command_id: `cmd_remove_day_${Date.now()}`,
        action: "delete_day",
        day_date: state.selectedDay,
        reason: "Remove current day",
      },
    ],
  }, {
    pendingMessage: "Removing day…",
    successMessage: "Day removed.",
    workspaceTab: "selection",
  });
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
    syncUrlState();
  });

  button.addEventListener("keydown", (event) => {
    handleTabKeydown(elements.workspaceTabs, button, event);
  });
});

elements.scheduleTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.scheduleTab;
    if (!tab) {
      return;
    }

    state.scheduleTab = tab;
    renderScheduleShell();
    syncUrlState();
  });

  button.addEventListener("keydown", (event) => {
    handleTabKeydown(elements.scheduleTabs, button, event);
  });
});

elements.exportCalendarButton.addEventListener("click", () => {
  if (!state.selectedDay) {
    return;
  }

  triggerDownload(`/api/trips/${requireTripId()}/export/ics?day=${encodeURIComponent(state.selectedDay)}`);
});

elements.exportPdfButton.addEventListener("click", () => {
  if (!state.selectedDay) {
    return;
  }

  window.open(`/trips/${requireTripId()}/print?day=${encodeURIComponent(state.selectedDay)}`, "_blank", "noopener");
});

elements.workspaceNotice.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-workspace-action]");
  if (!actionTarget) {
    return;
  }

  if (actionTarget.dataset.workspaceAction === "undo") {
    await replayHistory("undo");
    return;
  }

  if (actionTarget.dataset.workspaceAction === "redo") {
    await replayHistory("redo");
  }
});

elements.assistantDiff.addEventListener("click", async (event) => {
  const repairTarget = event.target.closest("[data-conflict-action='repair']");
  if (!repairTarget) {
    return;
  }

  const conflictId = repairTarget.dataset.conflictId;
  if (!conflictId) {
    return;
  }

  await previewWithInput({
    commands: [
      {
        command_id: `cmd_repair_${Date.now()}`,
        action: "resolve_conflict",
        item_id: repairTarget.dataset.itemId || undefined,
        day_date: repairTarget.dataset.dayDate || state.selectedDay || undefined,
        reason: "Repair current conflict",
        payload: {
          conflict_id: conflictId,
        },
      },
    ],
  });
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

  if (action === "delete-item") {
    await executeImmediately({
      commands: [
        {
          command_id: `cmd_delete_${Date.now()}`,
          action: "delete_item",
          item_id: selectedItem.id,
          day_date: state.selectedDay,
          reason: `Delete ${selectedItem.title}`,
        },
      ],
    }, {
      pendingMessage: "Deleting stop…",
      successMessage: "Stop deleted.",
      workspaceTab: "selection",
      keepSelection: false,
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
  seedTripCreateForm();
  await loadTrips();
  if (state.tripId) {
    await loadTrip(state.tripId);
    return;
  }

  if (state.tripList[0]?.trip_id) {
    await loadTrip(state.tripList[0].trip_id);
    return;
  }

  state.tripBrowserOpen = true;
  renderTripBrowser();
  setPending(false, "Create your first trip to get started.");
}

async function loadTrips() {
  const payload = await requestJson("/api/trips");
  state.tripList = payload.trips ?? [];
  if (!state.tripId || !state.tripList.some((trip) => trip.trip_id === state.tripId)) {
    state.tripId = state.tripList[0]?.trip_id ?? null;
  }
  renderTripBrowser();
}

async function loadTrip(nextTripId = state.tripId) {
  if (!nextTripId) {
    state.trip = null;
    state.preview = null;
    state.previewMeta = null;
    state.debugEnabled = false;
    render();
    return;
  }

  setPending(true, "Loading trip…");
  const payload = await requestJson(`/api/trips/${nextTripId}`);
  const isSameTrip = state.tripId === nextTripId;
  state.tripId = nextTripId;
  state.trip = payload.trip;
  syncTripListEntry(payload.trip);
  state.preview = null;
  state.previewMeta = null;
  clearHistory();
  state.provider = payload.workspace.provider ?? "mock";
  state.assistantProvider = payload.workspace.assistant?.provider ?? "rules";
  state.storageMode = payload.workspace.storage?.mode ?? "memory";
  state.mapsBrowserApiKey = payload.workspace.maps?.browser_api_key ?? null;
  state.debugEnabled = payload.workspace.debug?.enabled ?? false;
  state.selectedDay = isSameTrip
    ? (state.selectedDay ?? payload.workspace.selected_day ?? payload.trip.days[0]?.date ?? null)
    : (payload.workspace.selected_day ?? payload.trip.days[0]?.date ?? null);
  state.selectedItemId = inferDefaultSelectedItemId(payload.trip, state.selectedDay, null);
  state.workspaceTab = "selection";
  state.scheduleTab = state.scheduleTab || "timeline";
  state.tripBrowserOpen = false;
  state.tripBrowserMode = "browse";
  state.titleEditing = false;
  clearPlaceSearchSession();
  render();
  setPending(false, "Trip loaded.");
}

async function previewWithInput(input) {
  setPending(true, "Previewing change…");
  try {
    clearHistory();
    const context = {
      selected_day: input.context?.selected_day ?? state.selectedDay ?? undefined,
      selected_item_id: input.context?.selected_item_id ?? state.selectedItemId ?? undefined,
    };
    const payload = await requestJson(`/api/trips/${requireTripId()}/commands/preview`, {
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
    setPending(false, normalizeAssistantError(error), "error");
  }
}

async function executeImmediately(input, options = {}) {
  setPending(true, options.pendingMessage ?? "Saving change…");
  try {
    const payload = await requestJson(`/api/trips/${requireTripId()}/commands/execute`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        input: {
          commands: input.commands ?? [],
        },
      },
    });

    state.trip = payload.trip;
    syncTripListEntry(payload.trip);
    state.preview = null;
    state.previewMeta = null;
    if (options.clearSearch !== false) {
      clearPlaceSearchSession();
    }
    if (options.keepSelection === false) {
      state.selectedItemId = null;
    }
    if (options.selectDay) {
      state.selectedDay = options.selectDay;
    }
    if (payload.undo_commands?.length) {
      state.undoStack.push({
        commands: payload.undo_commands,
        summary: options.undoSummary ?? payload.summary ?? "Undo last edit",
      });
      if (state.undoStack.length > 20) {
        state.undoStack.shift();
      }
      state.redoStack = [];
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
  const creating = state.tripBrowserOpen && state.tripBrowserMode === "create";
  if (!activeTrip) {
    renderHeader(null, creating);
    renderMeta(null, creating);
    renderTitleEditor();
    renderTripBrowser();
    return;
  }

  const selectedDay = activeTrip.days.find((day) => day.date === state.selectedDay) ?? activeTrip.days[0];
  state.selectedDay = selectedDay?.date ?? null;
  state.selectedItemId = inferDefaultSelectedItemId(activeTrip, state.selectedDay, state.selectedItemId);
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);

  renderHeader(activeTrip, creating);
  renderMeta(activeTrip, creating);
  renderTitleEditor();
  renderTripBrowser();
  renderDayTabs(activeTrip);
  renderScheduleShell();
  renderWorkspaceShell();
  renderWorkspaceNotice();
  renderMap(activeTrip, selectedDay, selectedItem);
  renderPlan(activeTrip, selectedDay, selectedItem);
  renderTimeline(activeTrip, selectedDay, selectedItem);
  renderAssistant(activeTrip, selectedDay, selectedItem);
  syncUrlState();
}

function renderHeader(trip, creating) {
  if (creating) {
    state.titleEditing = false;
    elements.tripTitleKicker.textContent = "Planning setup";
    elements.tripTitle.textContent = "Create a New Trip";
    elements.tripSubtitle.textContent = "Set dates, timezone, and travelers before opening a new workspace.";
    document.title = "Create a New Trip";
    return;
  }

  if (!trip) {
    elements.tripTitleKicker.textContent = "AI-assisted itinerary editor";
    elements.tripTitle.textContent = "Trip Workspace";
    elements.tripSubtitle.textContent = "Open a saved itinerary or start a new draft.";
    document.title = "Trip Workspace";
    return;
  }

  elements.tripTitleKicker.textContent = "AI-assisted itinerary editor";
  elements.tripTitle.textContent = trip.title;
  elements.tripSubtitle.textContent = state.preview ? "Preview mode" : "";
  document.title = trip.title;
}

function renderTitleEditor() {
  const activeTrip = getActiveTrip();
  const creating = state.tripBrowserOpen && state.tripBrowserMode === "create";
  const isEditing = !creating && state.titleEditing && Boolean(activeTrip);
  elements.tripTitle.classList.toggle("hidden", isEditing);
  elements.editTripTitleButton.classList.toggle("hidden", isEditing || creating || !activeTrip);
  elements.tripTitleForm.classList.toggle("hidden", !isEditing);
  if (isEditing && activeTrip) {
    elements.tripTitleInput.value = activeTrip.title;
  }
}

function renderMeta(trip, creating = false) {
  if (!trip || creating) {
    elements.metaPills.innerHTML = "";
    return;
  }

  const items = trip.days.flatMap((day) => day.items);
  elements.metaPills.innerHTML = [
    pill(formatDateRange(trip.start_date, trip.end_date)),
    pill(formatCountLabel(trip.travelers?.length ?? 0, "traveler")),
    pill(formatCountLabel(items.filter((item) => item.locked).length, "locked stop", "locked stops")),
    pill(formatCountLabel(trip.conflicts.length, "conflict")),
    state.preview ? pill("Preview active") : "",
  ].join("");
}

function renderTripBrowser() {
  const creating = state.tripBrowserOpen && state.tripBrowserMode === "create";
  elements.tripBrowser.classList.toggle("hidden", !state.tripBrowserOpen);
  elements.tripBrowser.classList.toggle("creating", creating);
  elements.grid.classList.toggle("hidden", creating);
  elements.globalDaySwitcher.classList.toggle("hidden", creating);
  elements.metaPills.classList.toggle("hidden", creating);
  elements.tripBrowserToggleButton.classList.toggle("button-primary", state.tripBrowserOpen && state.tripBrowserMode === "browse");
  elements.newTripToggleButton.classList.toggle("button-primary", creating);
  elements.tripBrowserCloseButton.textContent = creating ? "Back to trips" : "Close";
  elements.tripList.innerHTML = state.tripList.length
    ? state.tripList
      .map((trip) => `
        <button type="button" class="trip-list-item${trip.trip_id === state.tripId ? " active" : ""}" data-trip-id="${escapeHtml(trip.trip_id)}">
          <strong>${escapeHtml(trip.title)}</strong>
          <small>${escapeHtml(formatDateRange(trip.start_date, trip.end_date))} · ${escapeHtml(formatCountLabel(trip.day_count, "day"))}</small>
        </button>
      `)
      .join("")
    : '<div class="trip-list-empty">No trips yet. Create one to get started.</div>';
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

  updateDayActionState(trip);
}

function updateDayActionState(trip = getActiveTrip()) {
  if (!trip) {
    elements.addDayButton.disabled = true;
    elements.removeDayButton.disabled = true;
    return;
  }

  const selectedDay = trip.days.find((day) => day.date === state.selectedDay);
  const canRemoveDay = Boolean(selectedDay) && trip.days.length > 1 && (selectedDay?.items?.length ?? 0) === 0;
  elements.removeDayButton.disabled = !canRemoveDay || state.pending;
  elements.addDayButton.disabled = state.pending;
}

function renderWorkspaceShell() {
  elements.workspaceTabs.forEach((button) => {
    const isActive = button.dataset.workspaceTab === state.workspaceTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  elements.workspaceViews.forEach((view) => {
    const isActive = view.dataset.workspaceView === state.workspaceTab;
    view.classList.toggle("hidden", !isActive);
    view.setAttribute("aria-hidden", String(!isActive));
  });
}

function renderScheduleShell() {
  elements.scheduleTabs.forEach((button) => {
    const isActive = button.dataset.scheduleTab === state.scheduleTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  elements.scheduleViews.forEach((view) => {
    const isActive = view.dataset.scheduleView === state.scheduleTab;
    view.classList.toggle("hidden", !isActive);
    view.setAttribute("aria-hidden", String(!isActive));
  });
}

function renderWorkspaceNotice() {
  const undoEntry = state.undoStack[state.undoStack.length - 1] ?? null;
  const canRedo = state.redoStack.length > 0;
  const hasNotice = Boolean(state.statusMessage || undoEntry || canRedo);
  elements.workspaceNotice.classList.toggle("hidden", !hasNotice);
  elements.workspaceNotice.classList.toggle("error", state.statusTone === "error");
  if (!hasNotice) {
    elements.workspaceNotice.removeAttribute("role");
    elements.workspaceNotice.innerHTML = "";
    return;
  }

  elements.workspaceNotice.setAttribute("role", state.statusTone === "error" ? "alert" : "status");

  const summaryText = undoEntry?.summary ?? state.redoStack[state.redoStack.length - 1]?.summary ?? "";
  const summary = summaryText ? `<strong>${escapeHtml(summaryText)}</strong>` : "";
  const detail =
    state.statusMessage && state.statusMessage !== summaryText
      ? escapeHtml(state.statusMessage)
      : "";
  const copy = [summary, detail].filter(Boolean).join(" · ");
  const undoButton = undoEntry
    ? `<button type="button" class="button" data-workspace-action="undo"${state.pending ? " disabled" : ""}>Undo</button>`
    : "";
  const redoButton = canRedo
    ? `<button type="button" class="button" data-workspace-action="redo"${state.pending ? " disabled" : ""}>Redo</button>`
    : "";

  elements.workspaceNotice.innerHTML = `
    <div class="workspace-notice-copy">${copy}</div>
    ${(undoButton || redoButton) ? `<div class="workspace-notice-actions">${undoButton}${redoButton}</div>` : ""}
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
  elements.resetButton.classList.toggle("hidden", !state.debugEnabled);
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
        <div class="focus-header-actions">
          <button type="button" class="button ${selectedItem.locked ? "" : "button-primary"}" data-editor-action="toggle-lock">
            ${selectedItem.locked ? "Unlock item" : "Lock item"}
          </button>
          <button type="button" class="button" data-editor-action="delete-item" ${disabledAttr}>Delete stop</button>
        </div>
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
            placeholder="Search a replacement venue…"
            autocomplete="off"
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
          <input type="search" name="place_query" value="${escapeHtml(session.query ?? "")}" placeholder="Search nearby places…" autocomplete="off">
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

function clearHistory() {
  state.undoStack = [];
  state.redoStack = [];
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

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const scheduleTab = params.get("schedule") === "plan" ? "plan" : "timeline";
  const workspaceTab = params.get("workspace") === "assistant" ? "assistant" : "selection";

  return {
    tripId: params.get("trip") || null,
    selectedDay: params.get("day") || null,
    selectedItemId: params.get("item") || null,
    scheduleTab,
    workspaceTab,
  };
}

function syncUrlState() {
  const params = new URLSearchParams(window.location.search);
  writeUrlParam(params, "trip", state.tripId);
  writeUrlParam(params, "day", state.selectedDay);
  writeUrlParam(params, "item", state.selectedItemId);
  writeUrlParam(params, "schedule", state.scheduleTab !== "timeline" ? state.scheduleTab : null);
  writeUrlParam(params, "workspace", state.workspaceTab !== "selection" ? state.workspaceTab : null);
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function writeUrlParam(params, key, value) {
  if (value) {
    params.set(key, value);
    return;
  }

  params.delete(key);
}

function handleTabKeydown(buttons, currentButton, event) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
    return;
  }

  const orderedButtons = Array.from(buttons);
  const currentIndex = orderedButtons.indexOf(currentButton);
  if (currentIndex === -1) {
    return;
  }

  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = (currentIndex + direction + orderedButtons.length) % orderedButtons.length;
  orderedButtons[nextIndex]?.click();
  orderedButtons[nextIndex]?.focus();
}

async function replayHistory(mode) {
  const stack = mode === "undo" ? state.undoStack : state.redoStack;
  const entry = stack[stack.length - 1];
  if (!entry?.commands?.length || !state.trip) {
    return;
  }

  setPending(true, mode === "undo" ? "Undoing last edit…" : "Reapplying last edit…");
  try {
    const payload = await requestJson(`/api/trips/${requireTripId()}/commands/execute`, {
      method: "POST",
      body: {
        base_version: state.trip.version,
        input: {
          commands: entry.commands,
        },
      },
    });

    stack.pop();
    state.trip = payload.trip;
    state.preview = null;
    state.previewMeta = null;
    clearPlaceSearchSession();

    const inverseEntry = payload.undo_commands?.length
      ? {
          commands: payload.undo_commands,
          summary: payload.summary ?? (mode === "undo" ? "Redo last edit" : "Undo last redo"),
        }
      : null;

    if (mode === "undo" && inverseEntry) {
      state.redoStack.push(inverseEntry);
      if (state.redoStack.length > 20) {
        state.redoStack.shift();
      }
    }

    if (mode === "redo" && inverseEntry) {
      state.undoStack.push(inverseEntry);
      if (state.undoStack.length > 20) {
        state.undoStack.shift();
      }
    }

    render();
    setPending(false, mode === "undo" ? "Undo applied." : "Redo applied.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
}

function requireTripId() {
  if (!state.tripId) {
    throw new Error("No trip selected.");
  }

  return state.tripId;
}

function normalizeAssistantError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/could not map|preview requires either commands or utterance|direct execute/i.test(message)) {
    return "I couldn’t map that request cleanly. Try naming the day or selecting the stop first.";
  }

  return message;
}

function seedTripCreateForm() {
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = addDaysToDate(startDate, 2);
  elements.tripCreateTitle.value = "";
  elements.tripCreateStartDate.value = startDate;
  elements.tripCreateEndDate.value = endDate;
  ensureTimeZoneOption(BROWSER_TIME_ZONE);
  elements.tripCreateTimezone.value = BROWSER_TIME_ZONE;
  elements.tripCreateTravelers.value = "2";
}

function addDaysToDate(date, days) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

function syncTripListEntry(trip) {
  const nextSummary = summarizeTripForList(trip);
  const index = state.tripList.findIndex((candidate) => candidate.trip_id === trip.trip_id);
  if (index === -1) {
    state.tripList.unshift(nextSummary);
    return;
  }

  state.tripList.splice(index, 1, nextSummary);
}

function summarizeTripForList(trip) {
  const items = trip.days.flatMap((day) => day.items);
  return {
    trip_id: trip.trip_id,
    title: trip.title,
    timezone: trip.timezone,
    start_date: trip.start_date,
    end_date: trip.end_date,
    traveler_count: trip.travelers?.length ?? 0,
    day_count: trip.days.length,
    conflict_count: trip.conflicts.length,
    locked_item_count: items.filter((item) => item.locked).length,
    last_updated_at: trip.change_log?.at(-1)?.timestamp ?? null,
  };
}

function resolveBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function ensureTimeZoneOption(timezone) {
  if (!timezone || !elements.tripCreateTimezone) {
    return;
  }

  if ([...elements.tripCreateTimezone.options].some((option) => option.value === timezone)) {
    return;
  }

  const option = document.createElement("option");
  option.value = timezone;
  option.textContent = timezone;
  elements.tripCreateTimezone.append(option);
}

function formatDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return [startDate, endDate].filter(Boolean).join(" – ");
  }

  const start = toDateValue(startDate);
  const end = toDateValue(endDate);
  if (!start || !end) {
    return `${startDate} – ${endDate}`;
  }

  const includeYear = start.getUTCFullYear() !== end.getUTCFullYear();
  const formatter = includeYear ? SHORT_DATE_WITH_YEAR_FORMATTER : SHORT_DATE_FORMATTER;
  if (typeof formatter.formatRange === "function") {
    return formatter.formatRange(start, end);
  }

  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatCountLabel(value, singular, plural = `${singular}s`) {
  const count = Number.isFinite(value) ? value : 0;
  const label = count === 1 ? singular : plural;
  return `${NUMBER_FORMATTER.format(count)} ${label}`;
}

function toDateValue(date) {
  if (!date) {
    return null;
  }

  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  const conflicts = trip.conflicts.filter((conflict) => {
    if (conflict.item_ids.length === 0) {
      return Boolean(day?.date && conflict.id.includes(day.date));
    }
    return conflict.item_ids.some((itemId) => itemIds.has(itemId));
  });
  if (conflicts.length === 0) {
    return "<div class=\"diff-meta\">No current conflicts on this day.</div>";
  }

  return `
    <ul class="diff-list">
      ${conflicts
        .map((conflict) => {
          const repairButton = isRepairableConflict(conflict)
            ? `<button type="button" class="button button-small" data-conflict-action="repair" data-conflict-id="${escapeHtml(conflict.id)}" data-item-id="${escapeHtml(conflict.item_ids[0] ?? "")}" data-day-date="${escapeHtml(day?.date ?? "")}">Repair</button>`
            : "";
          const hint = conflict.resolution_hint ? `<div class="diff-meta">${escapeHtml(conflict.resolution_hint)}</div>` : "";
          return `
            <li class="${conflict.severity === "error" ? "conflict-error" : ""}">
              <div class="conflict-row">
                <span>${escapeHtml(conflict.message)}</span>
                ${repairButton}
              </div>
              ${hint}
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function isRepairableConflict(conflict) {
  return [
    "opening_hours_conflict",
    "travel_time_underestimated",
    "overlap_conflict",
    "meal_window_missing",
    "pace_limit_exceeded",
  ].includes(conflict.type);
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

function triggerDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function setPending(value, message, tone = "neutral") {
  state.pending = value;
  state.statusMessage = message;
  state.statusTone = tone;
  elements.assistantStatus.textContent = message;
  updateDayActionState();
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
