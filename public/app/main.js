import { requestJson, triggerDownload } from "./api.js";
import { createMapController } from "./map.js";
import { defaultStartTimeForInsertSession, escapeHtml, eventClass, itemTypeLabel, localTime, minutesRelativeToDay, replaceIsoTime, resolveTripTimeZone, shiftIsoByMinutes } from "./shared.js";
import { attachTimelineInteractions, buildPlanFlow, buildTimelineHourMarks, buildTimelineLayout, buildTimelineModel, computeTimelineWindow, exactDurationMinutes, flowBlockClass, percentFromTimelineMinute, timelineBlockTitle } from "./timeline.js";

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
const TIME_ZONE_PARTS_FORMATTER_CACHE = new Map();
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

const mapController = createMapController({
  mapCanvas: elements.mapCanvas,
  mapStatus: elements.mapStatus,
  selectItem: (itemId) => selectItem(itemId),
});

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
  const selectedDay = activeTrip?.days.find((candidate) => candidate.date === state.selectedDay) ?? null;
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);
  const action = actionTarget.dataset.editorAction;

  if (!selectedItem) {
    if (!selectedDay) {
      return;
    }

    if (action === "add-first-activity" || action === "add-first-meal") {
      const kind = action === "add-first-meal" ? "meal" : "activity";
      const current = getPlaceSearchSessionForDay(selectedDay.date);
      if (current?.mode === "insert" && current.kind === kind) {
        clearPlaceSearchSession();
      } else {
        state.placeSearchSession = {
          mode: "insert",
          itemId: null,
          dayDate: selectedDay.date,
          position: null,
          kind,
          mealType: "lunch",
          query: "",
          results: [],
        };
      }
      render();
      return;
    }

    if (action === "draft-day") {
      await previewWithInput({
        utterance: "Draft a balanced starter itinerary for the selected day.",
        context: {
          selected_day: selectedDay.date,
        },
      });
      return;
    }

    if (action === "insert-place") {
      const placeId = actionTarget.dataset.placeId;
      const placeName = actionTarget.dataset.placeName ?? "selected place";
      const session = getPlaceSearchSessionForDay(selectedDay.date);
      if (!placeId || !session || session.mode !== "insert") {
        return;
      }

      await previewWithInput({
        commands: [
          {
            command_id: `cmd_insert_${Date.now()}`,
            action: "insert_item",
            day_date: selectedDay.date,
            reason: `Add ${placeName} to ${selectedDay.label ?? "this day"}`,
            kind: session.kind,
            place_id: placeId,
            payload: {
              meal_type: session.kind === "meal" ? session.mealType : undefined,
              start_time: defaultStartTimeForInsertSession(session),
            },
          },
        ],
      });
      return;
    }

    return;
  }

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
    const current = getPlaceSearchSessionForItem(selectedItem.id, state.selectedDay);
    if (current?.mode === "insert" && current.position === position) {
      clearPlaceSearchSession();
    } else {
      state.placeSearchSession = {
        mode: "insert",
        itemId: selectedItem.id,
        dayDate: state.selectedDay,
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
    const session = getPlaceSearchSessionForItem(selectedItem.id, state.selectedDay);
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
  const selectedDay = activeTrip?.days.find((candidate) => candidate.date === state.selectedDay) ?? null;
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);
  const session = selectedItem
    ? getPlaceSearchSessionForItem(selectedItem.id, state.selectedDay)
    : getPlaceSearchSessionForDay(selectedDay?.date);
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
  const selectedDay = activeTrip?.days.find((candidate) => candidate.date === state.selectedDay) ?? null;
  const selectedItem = getSelectedItem(activeTrip, state.selectedDay, state.selectedItemId);
  const formMode = form.dataset.editorForm;
  if (formMode !== "insert-search" && !selectedItem) {
    return;
  }

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
      dayDate: state.selectedDay,
      query,
      kind: inferInsertKindFromItem(selectedItem),
      mealType: selectedItem.kind === "meal" ? normalizeMealType(selectedItem.category) : null,
    }, selectedItem, selectedDay);
    return;
  }

  if (formMode === "insert-search") {
    const session = selectedItem
      ? getPlaceSearchSessionForItem(selectedItem.id, state.selectedDay)
      : getPlaceSearchSessionForDay(selectedDay?.date);
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
    }, selectedItem, selectedDay);
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
  mapController.renderMap({
    provider: state.provider,
    mapsBrowserApiKey: state.mapsBrowserApiKey,
    trip,
    day,
    selectedItem,
  });
}

function renderPlan(trip, day, selectedItem) {
  const timeZone = resolveTripTimeZone(trip);
  const flow = buildPlanFlow(trip, day);
  if (flow.length === 0) {
    elements.planPanel.innerHTML = '<div class="plan-empty">No plan yet for this day. Add the first stop from Selection or ask Assistant to draft it.</div>';
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
              <div class="plan-time">${localTime(block.start_at, timeZone)}-${localTime(block.end_at, timeZone)}</div>
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

  const timeZone = resolveTripTimeZone(trip);
  const model = buildTimelineModel(trip, day);
  if (model.events.length === 0 && model.transports.length === 0) {
    elements.timelinePanel.innerHTML = '<div class="timeline-empty">No scheduled items yet. Add the first stop from Selection or ask Assistant to draft this day.</div>';
    return;
  }

  const window = computeTimelineWindow([...model.events, ...model.transports], day.date, timeZone);
  const hourMarks = buildTimelineHourMarks(window);
  const layout = buildTimelineLayout(model.events, window, day.date, timeZone);
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
      const left = clampPercent(percentFromTimelineMinute(minutesRelativeToDay(block.start_at, day.date, timeZone), window));
      const width = Math.max(1.8, (exactDurationMinutes(block.start_at, block.end_at) / window.totalMinutes) * 100);
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
    <div class="timeline-board" style="--timeline-rows:${layout.rows}; --timeline-height:${layout.totalHeight}px; --timeline-columns:${window.columnCount};">
      <div class="hour-ruler">${hourMarks}</div>
      <div class="lane-grid">
        ${eventPills}
        ${transportStrips}
      </div>
    </div>
  `;

  attachTimelineInteractions({
    timelinePanel: elements.timelinePanel,
    day,
    window,
    getActiveTrip,
    getSelectedItem,
    selectItem,
    executeImmediately,
  });
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
  const timeZone = resolveTripTimeZone(trip);
  if (!selectedItem && day?.items?.length === 0) {
    return renderEmptyDayEditor(day);
  }

  if (!selectedItem) {
    return '<div class="focus-empty">Select an item from the map, plan, or timeline to edit it.</div>';
  }

  const disabledAttr = selectedItem.locked ? "disabled" : "";
  const place = selectedItem.place_id
    ? trip.places.find((candidate) => candidate.place_id === selectedItem.place_id)
    : null;
  const previous = getAdjacentItem(trip, day?.date, selectedItem.id, -1);
  const next = getAdjacentItem(trip, day?.date, selectedItem.id, 1);
  const searchSession = getPlaceSearchSessionForItem(selectedItem.id, day?.date);
  const replaceSession = searchSession?.mode === "replace" ? searchSession : null;
  const insertSession = searchSession?.mode === "insert" ? searchSession : null;
  const replaceResults = replaceSession ? renderSearchResults(replaceSession.results, "replace-place") : "";

  return `
    <section class="focus-card ${eventClass(selectedItem)}">
      <div class="focus-header">
        <div>
          <div class="focus-kicker">Focused item</div>
          <h3>${escapeHtml(selectedItem.title)}</h3>
          <div class="focus-meta">${localTime(selectedItem.start_at, timeZone)}-${localTime(selectedItem.end_at, timeZone)} · ${escapeHtml(itemTypeLabel(selectedItem))}</div>
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
          <input type="time" name="start_time" value="${localTime(selectedItem.start_at, timeZone)}" ${disabledAttr}>
        </label>
        <label>
          <span>End</span>
          <input type="time" name="end_time" value="${localTime(selectedItem.end_at, timeZone)}" ${disabledAttr}>
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

function renderEmptyDayEditor(day) {
  const insertSession = getPlaceSearchSessionForDay(day.date);
  return `
    <section class="focus-empty focus-empty-day">
      <div class="focus-empty-copy">
        <div class="focus-kicker">First stop</div>
        <h3>${escapeHtml(day.label ?? "Empty day")}</h3>
        <p>This day is still empty. Add the first activity or meal, or ask Assistant to draft a starting plan.</p>
      </div>
      <div class="insert-actions">
        <button type="button" class="button ${insertSession?.kind === "activity" ? "button-primary" : ""}" data-editor-action="add-first-activity">Add first activity</button>
        <button type="button" class="button ${insertSession?.kind === "meal" ? "button-primary" : ""}" data-editor-action="add-first-meal">Add first meal</button>
        <button type="button" class="button" data-editor-action="draft-day">Ask Assistant</button>
      </div>
      ${insertSession ? renderInsertComposer(insertSession, { firstStop: true }) : ""}
    </section>
  `;
}

function renderInsertComposer(session, options = {}) {
  const kind = session.kind === "meal" ? "meal" : "activity";
  const mealType = session.mealType ?? "lunch";
  const copy = options.firstStop
    ? `Preview first. This will add the first ${kind} on this day.`
    : `Preview first. This will insert a new ${kind} ${session.position} the current item.`;
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
      <div class="insert-composer-meta">${copy}</div>
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

async function searchPlaces(session, selectedItem, day) {
  const subjectLabel = selectedItem?.title ?? day?.label ?? "this day";
  setPending(true, `Searching places for ${subjectLabel}…`);
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

  if (!item) {
    return "";
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

function getPlaceSearchSessionForItem(itemId, dayDate = state.selectedDay) {
  return state.placeSearchSession?.itemId === itemId && state.placeSearchSession?.dayDate === dayDate
    ? state.placeSearchSession
    : null;
}

function getPlaceSearchSessionForDay(dayDate = state.selectedDay) {
  return state.placeSearchSession?.itemId == null && state.placeSearchSession?.dayDate === dayDate
    ? state.placeSearchSession
    : null;
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

function getActiveTrip() {
  return state.preview ?? state.trip;
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

function clampPercent(value) {
  return Math.max(0, Math.min(96, value));
}
