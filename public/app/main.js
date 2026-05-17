import { requestJson, triggerDownload } from "./api.js";
import { buildPostImportReviewMessage, renderTripImportReviewChecklist } from "./import-review.js";
import { createMapController } from "./map.js";
import { renderPlaceResolutionQueue } from "./place-resolution.js";
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
  highlightedConflictId: null,
  ignoredConflictIds: new Set(),
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
  tripIntake: createEmptyTripIntakeState(),
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
const EDITABLE_ITEM_KINDS = [
  ["activity", "Activity"],
  ["meal", "Meal"],
  ["flight", "Flight"],
  ["transit", "Transit"],
  ["check_in", "Check-in"],
  ["check_out", "Check-out"],
  ["lodging", "Lodging"],
  ["buffer", "Buffer"],
  ["free_time", "Free time"],
];
const EDITABLE_ITEM_STATUSES = [
  ["confirmed", "Confirmed"],
  ["suggested", "Suggested"],
  ["draft", "Draft"],
];
const EDITABLE_TRANSPORT_MODES = [
  ["walk", "Walk"],
  ["drive", "Drive"],
  ["taxi", "Taxi"],
  ["transit", "Transit"],
  ["flight", "Flight"],
];
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
  tripCreateSubmitButton: document.querySelector("#tripCreateSubmitButton"),
  tripImportInput: document.querySelector("#tripImportInput"),
  tripImportParseButton: document.querySelector("#tripImportParseButton"),
  tripImportStatus: document.querySelector("#tripImportStatus"),
  tripImportSummary: document.querySelector("#tripImportSummary"),
  tripImportFollowUp: document.querySelector("#tripImportFollowUp"),
  tripImportFollowUpPrompt: document.querySelector("#tripImportFollowUpPrompt"),
  tripImportFollowUpInput: document.querySelector("#tripImportFollowUpInput"),
  tripImportFollowUpButton: document.querySelector("#tripImportFollowUpButton"),
  tripImportFollowUpHistory: document.querySelector("#tripImportFollowUpHistory"),
  tripImportItinerary: document.querySelector("#tripImportItinerary"),
  tripCreateTitle: document.querySelector("#tripCreateTitle"),
  tripCreateStartDate: document.querySelector("#tripCreateStartDate"),
  tripCreateEndDate: document.querySelector("#tripCreateEndDate"),
  tripCreateTimezone: document.querySelector("#tripCreateTimezone"),
  tripCreateTravelers: document.querySelector("#tripCreateTravelers"),
  tripCreateFields: document.querySelectorAll("[data-trip-field]"),
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
  elements.tripImportInput.focus();
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
    reconcileIgnoredConflicts(payload.trip);
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
  const resolution = resolveTripCreateState();

  if (!title || !startDate || !endDate || !timezone) {
    return;
  }

  if (resolution.importReviewRequired && !resolution.importReviewConfirmed) {
    state.tripIntake = {
      ...state.tripIntake,
      statusMessage: "Review and confirm the imported itinerary before creating this trip.",
      statusTone: "error",
    };
    renderTripCreateAssist();
    return;
  }

  setPending(true, "Creating trip…");
  try {
    const importDraft =
      state.tripIntake.parsed &&
      !state.tripIntake.sourceDirty &&
      elements.tripImportInput.value.trim() &&
      (state.tripIntake.itinerary?.days?.length ?? 0) > 0
        ? state.tripIntake.itinerary
        : null;
    const payload = await requestJson("/api/trips", {
      method: "POST",
      body: {
        title,
        start_date: startDate,
        end_date: endDate,
        timezone,
        traveler_count: travelerCount,
        import_draft: importDraft,
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
    setPending(false, buildPostImportReviewMessage(state.trip, importDraft) ?? payload.summary ?? "Trip created.");
  } catch (error) {
    setPending(false, error.message, "error");
  }
});

elements.tripImportParseButton.addEventListener("click", async () => {
  await parseTripIntake();
});

elements.tripImportFollowUpButton?.addEventListener("click", async () => {
  await parseTripIntake({
    clarificationText: elements.tripImportFollowUpInput?.value ?? "",
  });
});

elements.tripCreateForm.addEventListener("input", (event) => {
  if (event.target === elements.tripImportInput) {
    markTripImportSourceDirty();
  }

  if (event.target === elements.tripCreateStartDate) {
    clearTripIntakeReviewConfirmation();
    clearTripIntakeStatusMessage();
    maybeAutoFillTripEndDate();
  }

  if (event.target === elements.tripCreateEndDate) {
    clearTripIntakeReviewConfirmation();
    clearTripIntakeStatusMessage();
    if (elements.tripCreateEndDate.value !== state.tripIntake.autoDerivedEndDate) {
      state.tripIntake.autoDerivedEndDate = null;
    }
  }

  if (
    event.target === elements.tripCreateTitle ||
    event.target === elements.tripCreateTimezone ||
    event.target === elements.tripCreateTravelers
  ) {
    clearTripIntakeReviewConfirmation();
    clearTripIntakeStatusMessage();
  }

  renderTripCreateAssist();
});

elements.tripCreateTimezone.addEventListener("change", () => {
  clearTripIntakeReviewConfirmation();
  clearTripIntakeStatusMessage();
  renderTripCreateAssist();
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
    reconcileIgnoredConflicts(payload.trip);
    state.selectedDay = state.selectedDay ?? state.trip.days[0]?.date ?? null;
    clearPlaceSearchSession();
    clearHistory();
    clearConflictHighlight();
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
    clearConflictHighlight();
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
  const previewFocusTarget = event.target.closest("[data-preview-focus-item-id]");
  if (previewFocusTarget) {
    focusPreviewChange(
      previewFocusTarget.dataset.previewFocusItemId ?? null,
      previewFocusTarget.dataset.previewFocusDayDate ?? null
    );
    return;
  }

  const conflictFocusTarget = event.target.closest("[data-conflict-action='focus']");
  if (conflictFocusTarget) {
    focusConflict(conflictFocusTarget.dataset.conflictId ?? null);
    return;
  }

  const clearIgnoredTarget = event.target.closest("[data-conflict-action='clear-ignored']");
  if (clearIgnoredTarget) {
    state.ignoredConflictIds.clear();
    clearConflictHighlight();
    render();
    state.statusMessage = "Kept conflicts are visible again.";
    state.statusTone = "neutral";
    renderWorkspaceNotice();
    elements.assistantStatus.textContent = state.statusMessage;
    return;
  }

  const ignoreTarget = event.target.closest("[data-conflict-action='ignore']");
  if (ignoreTarget) {
    const conflictId = ignoreTarget.dataset.conflictId;
    if (!conflictId) {
      return;
    }

    state.ignoredConflictIds.add(conflictId);
    if (state.highlightedConflictId === conflictId) {
      clearConflictHighlight();
    }
    render();
    state.statusMessage = "Conflict kept as-is for this session.";
    state.statusTone = "neutral";
    renderWorkspaceNotice();
    elements.assistantStatus.textContent = state.statusMessage;
    return;
  }

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

  if (action === "resolve-place") {
    const targetDayDate = actionTarget.dataset.dayDate;
    const targetItemId = actionTarget.dataset.itemId;
    const targetDay = activeTrip?.days.find((candidate) => candidate.date === targetDayDate) ?? null;
    const targetItem = targetDay?.items.find((candidate) => candidate.id === targetItemId) ?? null;
    if (!targetDay || !targetItem) {
      return;
    }

    state.selectedDay = targetDay.date;
    state.selectedItemId = targetItem.id;
    state.workspaceTab = "selection";
    clearConflictHighlight();
    await searchPlaces({
      mode: "replace",
      itemId: targetItem.id,
      dayDate: targetDay.date,
      query: targetItem.title,
      kind: inferInsertKindFromItem(targetItem),
      mealType: targetItem.kind === "meal" ? normalizeMealType(targetItem.category) : null,
    }, targetItem, targetDay);
    return;
  }

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

  if (formMode === "item-details") {
    const formData = new FormData(form);
    const title = String(formData.get("title") ?? "").trim();
    const kind = String(formData.get("kind") ?? selectedItem.kind);
    const status = String(formData.get("status") ?? selectedItem.status);
    const category = String(formData.get("category") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    if (!title) {
      setPending(false, "Stop title cannot be empty.", "error");
      return;
    }

    const payload = {
      title,
      kind,
      status,
      category: category || null,
      notes: notes || null,
    };
    const unchanged =
      title === selectedItem.title &&
      kind === selectedItem.kind &&
      status === selectedItem.status &&
      category === (selectedItem.category ?? "") &&
      notes === (selectedItem.notes ?? "");
    if (unchanged) {
      setPending(false, "No stop detail changes to save.");
      return;
    }

    await executeImmediately({
      commands: [
        {
          command_id: `cmd_update_${Date.now()}`,
          action: "update_item",
          item_id: selectedItem.id,
          day_date: state.selectedDay,
          reason: `Update details for ${selectedItem.title}`,
          payload,
        },
      ],
    }, {
      pendingMessage: `Saving ${selectedItem.title}…`,
      successMessage: "Stop details saved.",
      workspaceTab: "selection",
    });
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

  if (formMode === "transport-mode") {
    const formData = new FormData(form);
    const mode = String(formData.get("mode") ?? "").trim();
    const incomingRoute = findIncomingRoute(activeTrip, selectedItem.id);
    if (!incomingRoute || !mode) {
      return;
    }

    if (incomingRoute.mode === mode) {
      setPending(false, "Transport mode unchanged.");
      return;
    }

    await previewWithInput({
      commands: [
        {
          command_id: `cmd_transport_${Date.now()}`,
          action: "set_transport_mode",
          item_id: incomingRoute.from_item_id,
          target_item_id: incomingRoute.to_item_id,
          day_date: state.selectedDay,
          mode,
          reason: `Change route to ${selectedItem.title} to ${mode}`,
        },
      ],
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

elements.tripImportItinerary?.addEventListener("input", (event) => {
  const field = event.target.closest("[data-trip-intake-field]");
  if (!field) {
    return;
  }

  updateTripIntakeEditableField(field);
});

elements.tripImportSummary?.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-trip-review-action]");
  if (!actionTarget) {
    return;
  }

  if (actionTarget.dataset.tripReviewAction === "confirm") {
    state.tripIntake = {
      ...state.tripIntake,
      reviewConfirmed: true,
      statusMessage: "Import review confirmed. Ready to create.",
      statusTone: "success",
    };
    renderTripCreateAssist();
  }
});

elements.tripImportItinerary?.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-trip-intake-action]");
  if (!actionTarget) {
    return;
  }

  const dayIndex = Number.parseInt(actionTarget.dataset.dayIndex ?? "", 10);
  const itemIndex = Number.parseInt(actionTarget.dataset.itemIndex ?? "", 10);
  const action = actionTarget.dataset.tripIntakeAction;

  mutateTripIntakeItinerary((itinerary) => {
    if (action === "add-day") {
      itinerary.days.push({
        day_index: itinerary.days.length + 1,
        date: null,
        label: `Day ${itinerary.days.length + 1}`,
        summary: "",
        items: [],
      });
      return;
    }

    if (!Number.isFinite(dayIndex) || !itinerary.days[dayIndex]) {
      return;
    }

    if (action === "remove-day") {
      itinerary.days.splice(dayIndex, 1);
      return;
    }

    if (action === "add-item") {
      itinerary.days[dayIndex].items.push({
        title: "New stop",
        kind: "activity",
        category: "",
        start_time: "",
        end_time: "",
        duration_minutes: null,
        status: "suggested",
        locked: false,
        subtitle: "",
        notes: "",
        tags: [],
      });
      return;
    }

    if (action === "remove-item" && Number.isFinite(itemIndex)) {
      itinerary.days[dayIndex].items.splice(itemIndex, 1);
    }
  }, { rerender: true });
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
    state.ignoredConflictIds.clear();
    clearConflictHighlight();
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
  if (!isSameTrip) {
    state.ignoredConflictIds.clear();
  }
  reconcileIgnoredConflicts(payload.trip);
  clearHistory();
  clearConflictHighlight();
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
    clearConflictHighlight();
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
    clearConflictHighlight();
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
  const highlightedConflict = resolveHighlightedConflict(activeTrip, state.highlightedConflictId);
  const highlightedConflictItemIds = new Set(highlightedConflict?.item_ids ?? []);

  renderHeader(activeTrip, creating);
  renderMeta(activeTrip, creating);
  renderTitleEditor();
  renderTripBrowser();
  renderDayTabs(activeTrip);
  renderScheduleShell();
  renderWorkspaceShell();
  renderWorkspaceNotice();
  renderMap(activeTrip, selectedDay, selectedItem, highlightedConflictItemIds);
  renderPlan(activeTrip, selectedDay, selectedItem, highlightedConflictItemIds);
  renderTimeline(activeTrip, selectedDay, selectedItem, highlightedConflictItemIds);
  renderAssistant(activeTrip, selectedDay, selectedItem, highlightedConflict);
  syncUrlState();
}

function renderHeader(trip, creating) {
  if (creating) {
    state.titleEditing = false;
    elements.tripTitleKicker.textContent = "Planning setup";
    elements.tripTitle.textContent = "Create a New Trip";
    elements.tripSubtitle.textContent = "Paste a trip brief or fill the fields directly before opening a new workspace.";
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
  elements.tripImportParseButton.disabled = state.pending;
  renderTripCreateAssist();
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

function renderMap(trip, day, selectedItem, highlightedConflictItemIds) {
  mapController.renderMap({
    provider: state.provider,
    mapsBrowserApiKey: state.mapsBrowserApiKey,
    trip,
    day,
    selectedItem,
    highlightedConflictItemIds,
  });
}

function renderPlan(trip, day, selectedItem, highlightedConflictItemIds) {
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
          const conflictHighlight = highlightedConflictItemIds?.has(block.itemId) ? " conflict-highlight" : "";
          return `
            <article class="plan-row ${flowBlockClass(block)}${block.itemId === selectedItem?.id ? " selected" : ""}${conflictHighlight}" data-item-id="${block.itemId}">
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

function renderTimeline(trip, day, selectedItem, highlightedConflictItemIds) {
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
      const conflictHighlight = highlightedConflictItemIds?.has(block.itemId) ? " conflict-highlight" : "";
      return `
        <div
          class="event-pill ${flowBlockClass(block)} density-${density}${block.itemId === selectedItem?.id ? " selected" : ""}${block.locked ? " locked" : ""}${conflictHighlight}"
          data-item-id="${block.itemId}"
          title="${escapeHtml(block.meta || timelineBlockTitle(block, density))}"
          style="left:${left}%;width:${width}%;top:${top}px;">
          ${warning}
          <strong>${escapeHtml(timelineBlockTitle(block, density))}</strong>
          ${block.meta ? `<small>${escapeHtml(block.meta)}</small>` : ""}
        </div>
      `;
    })
    .join("");
  const transportStrips = model.transports
    .map((block) => {
      const left = clampPercent(percentFromTimelineMinute(minutesRelativeToDay(block.start_at, day.date, timeZone), window));
      const transportMinutes = exactDurationMinutes(block.start_at, block.end_at);
      const width = Math.max(14, (transportMinutes / window.totalMinutes) * 100);
      const fittedLeft = Math.max(0, Math.min(100 - width, left));
      const warning = block.warningCount
        ? `<span class="transport-alert" title="${block.warningCount} warning(s)"></span>`
        : "";
      const labelText = timelineBlockTitle(block);
      const fallbackLabel = `${transportMinutes}m`;
      const label = width >= 5.4
        ? `<span>${escapeHtml(labelText)}</span>`
        : (width >= 2.8 ? `<span>${escapeHtml(fallbackLabel)}</span>` : "");
      const conflictHighlight =
        block.fromItemId && block.toItemId &&
        highlightedConflictItemIds?.has(block.fromItemId) &&
        highlightedConflictItemIds?.has(block.toItemId)
          ? " conflict-highlight"
          : "";
      return `
        <div class="transport-strip ${block.transportClassName ?? ""}${conflictHighlight}" title="${escapeHtml(block.meta ?? labelText)}" style="left:${fittedLeft}%;width:${width}%;top:${layout.transportTop}px;">
          ${label}
          ${warning}
        </div>
      `;
    })
    .join("");

  elements.timelinePanel.innerHTML = `
    ${renderTimelineConflictPrompt(trip, day)}
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

  elements.timelinePanel.querySelectorAll("[data-timeline-conflict-id]").forEach((button) => {
    button.addEventListener("click", () => {
      focusConflict(button.dataset.timelineConflictId ?? null);
    });
  });
}

function renderTimelineConflictPrompt(trip, day) {
  const conflicts = getDayTimingConflicts(trip, day);
  if (conflicts.length === 0) {
    return "";
  }

  const shownConflicts = conflicts.slice(0, 3);
  const overflowCount = conflicts.length - shownConflicts.length;
  const hasError = conflicts.some((conflict) => conflict.severity === "error");
  const summary = `${formatCountLabel(conflicts.length, "timing issue")} needs attention on this day. Original times are kept for review.`;
  const overflow = overflowCount > 0 ? `<li class="schedule-conflict-extra">${escapeHtml(formatCountLabel(overflowCount, "more issue"))}</li>` : "";

  return `
    <section class="schedule-conflict-prompt${hasError ? " has-error" : ""}" aria-live="polite">
      <div class="schedule-conflict-copy">
        <strong>Timing needs attention</strong>
        <span>${escapeHtml(summary)}</span>
      </div>
      <ul class="schedule-conflict-list">
        ${shownConflicts
          .map((conflict) => `
            <li>
              <span>${escapeHtml(conflict.message)}</span>
              <button type="button" class="button button-small" data-timeline-conflict-id="${escapeHtml(conflict.id)}">Locate</button>
            </li>
          `)
          .join("")}
        ${overflow}
      </ul>
    </section>
  `;
}

function getDayTimingConflicts(trip, day) {
  if (!trip || !day) {
    return [];
  }

  const itemIds = new Set((day.items ?? []).map((item) => item.id));
  return (trip.conflicts ?? []).filter((conflict) => {
    if (isConflictIgnored(conflict.id)) {
      return false;
    }

    if (!["travel_time_underestimated", "overlap_conflict"].includes(conflict.type)) {
      return false;
    }

    const conflictItemIds = conflict.item_ids ?? [];
    if (conflictItemIds.length === 0) {
      return Boolean(conflict.id?.includes(day.date));
    }

    return conflictItemIds.some((itemId) => itemIds.has(itemId));
  });
}

function renderAssistant(trip, day, selectedItem, highlightedConflict) {
  elements.focusEditor.innerHTML = `
    ${renderPlaceResolutionQueue(trip, selectedItem?.id ?? null)}
    ${renderFocusedEditor(trip, day, selectedItem)}
  `;
  elements.resetButton.classList.toggle("hidden", !state.debugEnabled);
  if (!state.previewMeta) {
    elements.assistantDiff.innerHTML = `
      <div class="diff-summary">No preview yet.</div>
      <div class="diff-meta">Try the assistant box, drag a timeline card, or edit the focused item for ${escapeHtml(day.label)}.</div>
      ${renderConflicts(trip, day, {
        highlightedConflictId: highlightedConflict?.id ?? null,
        title: "Current conflicts",
      })}
    `;
    elements.applyButton.classList.add("hidden");
    elements.rejectButton.classList.add("hidden");
    return;
  }

  const previewTrip = state.preview ?? trip;
  const itemChanges = collectPreviewItemChanges(state.trip, previewTrip);
  const routeChanges = collectPreviewRouteChanges(state.trip, previewTrip, state.previewMeta.diff.patch.changed_route_ids ?? []);
  const resolvedConflicts = collectConflictSnapshots(state.trip, state.previewMeta.resolved_conflicts);
  const introducedConflicts = collectConflictSnapshots(previewTrip, state.previewMeta.introduced_conflicts);
  const previewCommands = state.previewMeta.commands;
  const commands = previewCommands
    .map((command) => `<li><code>${escapeHtml(command.action)}</code> - ${escapeHtml(command.reason)}</li>`)
    .join("");

  elements.assistantDiff.innerHTML = `
    <div class="diff-summary">${escapeHtml(state.previewMeta.diff.summary)}</div>
    <div class="diff-meta">
      Changed items: ${itemChanges.length} ·
      Changed routes: ${routeChanges.length} ·
      Resolved conflicts: ${state.previewMeta.resolved_conflicts.length} ·
      Introduced conflicts: ${state.previewMeta.introduced_conflicts.length}
    </div>
    ${renderPreviewExplanation({
      itemChanges,
      routeChanges,
      resolvedConflicts,
      introducedConflicts,
      commands: previewCommands,
    })}
    ${renderPreviewChangeList(itemChanges, routeChanges)}
    ${resolvedConflicts.length ? renderConflictSnapshotList("Resolved in this preview", resolvedConflicts, { allowFocus: false, allowRepair: false, allowIgnore: false }) : ""}
    ${introducedConflicts.length ? renderConflictSnapshotList("Conflicts after this preview", introducedConflicts, { highlightedConflictId: highlightedConflict?.id ?? null }) : ""}
    ${commands ? `<div class="diff-section"><div class="diff-section-title">Planned actions</div><ul class="diff-list">${commands}</ul></div>` : ""}
    ${renderConflicts(previewTrip, day, {
      highlightedConflictId: highlightedConflict?.id ?? null,
      title: "Preview day conflicts",
      emptyText: "No conflicts remain on this day after the preview.",
    })}
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
  const incomingRoute = findIncomingRoute(trip, selectedItem.id);

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

      <form class="editor-form editor-form-details" data-editor-form="item-details">
        <label class="editor-form-wide">
          <span>Title</span>
          <input type="text" name="title" value="${escapeHtml(selectedItem.title)}" ${disabledAttr}>
        </label>
        <label>
          <span>Type</span>
          <select name="kind" ${disabledAttr}>
            ${EDITABLE_ITEM_KINDS.map(([value, label]) => `<option value="${value}"${selectedItem.kind === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select name="status" ${disabledAttr}>
            ${EDITABLE_ITEM_STATUSES.map(([value, label]) => `<option value="${value}"${selectedItem.status === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Category</span>
          <input type="text" name="category" value="${escapeHtml(selectedItem.category ?? "")}" placeholder="museum, lunch, lodging…" ${disabledAttr}>
        </label>
        <label class="editor-form-wide">
          <span>Notes</span>
          <textarea name="notes" rows="3" ${disabledAttr}>${escapeHtml(selectedItem.notes ?? "")}</textarea>
        </label>
        <button type="submit" class="button button-primary" ${disabledAttr}>Save details</button>
      </form>

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

      ${incomingRoute ? `
        <form class="editor-form editor-form-transport" data-editor-form="transport-mode">
          <label>
            <span>Transport here</span>
            <select name="mode" ${disabledAttr}>
              ${EDITABLE_TRANSPORT_MODES.map(([value, label]) => `<option value="${value}"${incomingRoute.mode === value ? " selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <button type="submit" class="button" ${disabledAttr}>Preview route</button>
        </form>
      ` : ""}

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
  clearConflictHighlight();
  state.workspaceTab = "selection";
  render();
}

function clearConflictHighlight() {
  state.highlightedConflictId = null;
}

function focusConflict(conflictId) {
  if (!conflictId) {
    return;
  }

  const activeTrip = getActiveTrip();
  const conflict = activeTrip?.conflicts?.find((candidate) => candidate.id === conflictId);
  if (!activeTrip || !conflict) {
    return;
  }

  state.highlightedConflictId = conflict.id;
  const conflictDay = findConflictDayDate(activeTrip, conflict);
  if (conflictDay) {
    state.selectedDay = conflictDay;
  }

  const focusItemId = conflict.item_ids[0]
    ?? inferDefaultSelectedItemId(activeTrip, state.selectedDay ?? conflictDay, state.selectedItemId);
  if (focusItemId) {
    state.selectedItemId = focusItemId;
  }

  state.scheduleTab = "timeline";
  render();
}

function focusPreviewChange(itemId, dayDate) {
  if (dayDate) {
    state.selectedDay = dayDate;
  }

  if (itemId) {
    state.selectedItemId = itemId;
  }

  clearConflictHighlight();
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
    reconcileIgnoredConflicts(payload.trip);
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
  state.tripIntake = createEmptyTripIntakeState();
  elements.tripImportInput.value = "";
  elements.tripCreateTitle.value = "";
  elements.tripCreateStartDate.value = startDate;
  elements.tripCreateEndDate.value = endDate;
  ensureTimeZoneOption(BROWSER_TIME_ZONE);
  elements.tripCreateTimezone.value = BROWSER_TIME_ZONE;
  elements.tripCreateTravelers.value = "2";
  renderTripCreateAssist();
}

function createEmptyTripIntakeState() {
  return {
    parsed: false,
    draft: null,
    summary: null,
    warnings: [],
    followUpPrompt: null,
    durationDays: null,
    itinerary: null,
    clarificationHistory: [],
    lastParsedSourceText: "",
    sourceDirty: false,
    statusMessage: "",
    statusTone: "neutral",
    autoDerivedEndDate: null,
    hasExactEndDate: false,
    reviewConfirmed: false,
  };
}

function markTripImportSourceDirty() {
  if (!state.tripIntake.parsed) {
    return;
  }

  const sourceText = elements.tripImportInput.value.trim();
  const sourceDirty = sourceText !== state.tripIntake.lastParsedSourceText;
  if (!sourceDirty && !state.tripIntake.sourceDirty) {
    return;
  }

  state.tripIntake = {
    ...state.tripIntake,
    sourceDirty,
    reviewConfirmed: false,
    statusMessage: sourceDirty
      ? "The pasted plan changed. Extract again to refresh the imported itinerary."
      : "",
    statusTone: "neutral",
  };
  renderTripCreateAssist();
}

async function parseTripIntake(options = {}) {
  const sourceText = elements.tripImportInput.value.trim();
  const clarificationText = String(options.clarificationText ?? "").trim();
  if (!sourceText) {
    state.tripIntake = {
      ...createEmptyTripIntakeState(),
      statusMessage: "Paste a plan before extracting trip details.",
      statusTone: "error",
    };
    renderTripCreateAssist();
    return;
  }

  if (options.clarificationText !== undefined && !clarificationText) {
    state.tripIntake = {
      ...state.tripIntake,
      statusMessage: "Answer the follow-up before updating the extraction.",
      statusTone: "error",
    };
    renderTripCreateAssist();
    return;
  }

  setPending(true, "Extracting trip details…");
  try {
    const payload = await requestJson("/api/trips/intake/parse", {
      method: "POST",
      body: {
        source_text: sourceText,
        clarification_text: clarificationText || null,
        known_draft: state.tripIntake.parsed ? state.tripIntake.draft : null,
        known_itinerary: state.tripIntake.parsed ? state.tripIntake.itinerary : null,
      },
    });

    const clarificationHistory = clarificationText
      ? [...(state.tripIntake.clarificationHistory ?? []), clarificationText]
      : [];
    state.tripIntake = {
      parsed: true,
      draft: payload.draft ?? {},
      summary: payload.summary ?? null,
      warnings: payload.warnings ?? [],
      followUpPrompt: payload.follow_up_prompt ?? null,
      durationDays: payload.derived?.duration_days ?? null,
      itinerary: normalizeEditableTripIntakeItinerary(payload.itinerary ?? null),
      clarificationHistory,
      lastParsedSourceText: sourceText,
      sourceDirty: false,
      statusMessage: "",
      statusTone: "neutral",
      autoDerivedEndDate: null,
      hasExactEndDate: Boolean(payload.draft?.end_date),
      reviewConfirmed: false,
    };

    elements.tripCreateTitle.value = payload.draft?.title ?? "";
    elements.tripCreateStartDate.value = payload.draft?.start_date ?? "";
    elements.tripCreateEndDate.value = payload.draft?.end_date ?? "";
    if (payload.draft?.timezone) {
      ensureTimeZoneOption(payload.draft.timezone);
      elements.tripCreateTimezone.value = payload.draft.timezone;
    } else {
      elements.tripCreateTimezone.value = "";
    }
    if (payload.draft?.traveler_count) {
      elements.tripCreateTravelers.value = String(payload.draft.traveler_count);
    }

    maybeAutoFillTripEndDate();
    const resolution = resolveTripCreateState();
    state.tripIntake.statusMessage =
      resolution.canCreate && !state.tripIntake.sourceDirty
        ? "Trip details extracted. Ready to create."
        : (resolution.importReviewRequired && !resolution.importReviewConfirmed
          ? "Trip details extracted. Review the checklist before creating."
          : "Trip details extracted. Fill the highlighted fields to finish.");
    state.tripIntake.statusTone = resolution.canCreate ? "success" : "neutral";
    if (elements.tripImportFollowUpInput) {
      elements.tripImportFollowUpInput.value = "";
    }
    renderTripCreateAssist();
    setPending(false, state.tripIntake.statusMessage, state.tripIntake.statusTone);
  } catch (error) {
    state.tripIntake = {
      ...state.tripIntake,
      statusMessage: error.message,
      statusTone: "error",
    };
    renderTripCreateAssist();
    setPending(false, error.message, "error");
  }
}

function normalizeEditableTripIntakeItinerary(itinerary) {
  if (!itinerary || !Array.isArray(itinerary.days)) {
    return null;
  }

  return recountTripIntakeItinerary({
    pace: itinerary.pace ?? null,
    days: itinerary.days.map((day, dayIndex) => ({
      day_index: day.day_index ?? dayIndex + 1,
      date: day.date ?? null,
      label: day.label ?? `Day ${dayIndex + 1}`,
      summary: day.summary ?? "",
      items: Array.isArray(day.items)
        ? day.items.map((item) => ({
            title: item.title ?? "",
            kind: item.kind ?? "activity",
            category: item.category ?? "",
            start_time: item.start_time ?? "",
            end_time: item.end_time ?? "",
            duration_minutes: item.duration_minutes ?? null,
            status: item.status ?? "suggested",
            locked: Boolean(item.locked),
            subtitle: item.subtitle ?? "",
            notes: item.notes ?? "",
            tags: Array.isArray(item.tags) ? item.tags.slice() : [],
          }))
        : [],
    })),
  });
}

function recountTripIntakeItinerary(itinerary) {
  if (!itinerary) {
    return null;
  }

  const days = Array.isArray(itinerary.days)
    ? itinerary.days.map((day, index) => ({
        ...day,
        day_index: day.day_index ?? index + 1,
        items: Array.isArray(day.items) ? day.items : [],
      }))
    : [];

  return {
    pace: itinerary.pace ?? null,
    day_count: days.length,
    item_count: days.reduce((total, day) => total + day.items.length, 0),
    days,
  };
}

function clearTripIntakeReviewConfirmation() {
  if (!state.tripIntake.reviewConfirmed) {
    return;
  }

  state.tripIntake = {
    ...state.tripIntake,
    reviewConfirmed: false,
    statusMessage: "",
    statusTone: "neutral",
  };
}

function clearTripIntakeStatusMessage() {
  if (!state.tripIntake.parsed || state.tripIntake.sourceDirty || !state.tripIntake.statusMessage) {
    return;
  }

  state.tripIntake = {
    ...state.tripIntake,
    statusMessage: "",
    statusTone: "neutral",
  };
}

function maybeAutoFillTripEndDate() {
  if (!state.tripIntake.parsed || state.tripIntake.hasExactEndDate || !state.tripIntake.durationDays) {
    return;
  }

  const startDate = elements.tripCreateStartDate.value.trim();
  if (!startDate) {
    return;
  }

  const nextEndDate = addDaysToDate(startDate, state.tripIntake.durationDays - 1);
  const currentEndDate = elements.tripCreateEndDate.value.trim();
  if (!currentEndDate || currentEndDate === state.tripIntake.autoDerivedEndDate) {
    elements.tripCreateEndDate.value = nextEndDate;
    state.tripIntake.autoDerivedEndDate = nextEndDate;
  }
}

function renderTripCreateAssist() {
  if (!elements.tripImportStatus || !elements.tripImportSummary) {
    return;
  }

  const resolution = resolveTripCreateState();
  if (elements.tripCreateSubmitButton) {
    elements.tripCreateSubmitButton.disabled =
      state.pending ||
      state.tripIntake.sourceDirty ||
      (resolution.importReviewRequired && !resolution.importReviewConfirmed);
  }

  const parsed = state.tripIntake.parsed;
  const statusMessage = state.tripIntake.statusMessage
    || (parsed
      ? (resolution.canCreate
        ? "Trip details extracted. Ready to create."
        : (resolution.importReviewRequired && !resolution.importReviewConfirmed
          ? "Trip details extracted. Review the checklist before creating."
          : "Trip details extracted. Fill the highlighted fields to finish."))
      : "");
  const statusTone = state.tripIntake.statusMessage
    ? state.tripIntake.statusTone
    : (resolution.canCreate ? "success" : "neutral");

  elements.tripImportStatus.textContent = statusMessage;
  elements.tripImportStatus.dataset.tone = statusTone;
  elements.tripImportStatus.classList.toggle("hidden", !statusMessage);

  if (!parsed) {
    elements.tripImportSummary.innerHTML = "";
    elements.tripImportSummary.classList.add("hidden");
    renderTripImportFollowUp(false);
    renderTripImportItineraryEditor();
    clearTripCreateFieldHints();
    return;
  }

  const summaryParts = [];
  if (state.tripIntake.summary) {
    summaryParts.push(`<div><strong>${escapeHtml(state.tripIntake.summary)}</strong></div>`);
  }

  if (resolution.blockingMissingFields.length) {
    summaryParts.push(
      `<div>Still needed: ${escapeHtml(resolution.blockingMissingFields.map(formatTripFieldLabel).join(", "))}.</div>`
    );
  } else {
    summaryParts.push("<div>All required trip creation fields are ready.</div>");
  }

  if (state.tripIntake.sourceDirty) {
    summaryParts.push("<div>The pasted plan changed after extraction. Run extraction again before importing the itinerary.</div>");
  }

  if (resolution.endDateWillAutoFillMessage) {
    summaryParts.push(`<div>${escapeHtml(resolution.endDateWillAutoFillMessage)}</div>`);
  }

  if (state.tripIntake.followUpPrompt) {
    summaryParts.push(`<div>${escapeHtml(state.tripIntake.followUpPrompt)}</div>`);
  }

  if (!state.tripIntake.draft?.traveler_count) {
    summaryParts.push(
      `<div>Traveler count was not specified. The form is currently set to ${escapeHtml(elements.tripCreateTravelers.value || "2")}.</div>`
    );
  }

  if (state.tripIntake.warnings.length) {
    summaryParts.push(`<div>${escapeHtml(state.tripIntake.warnings.join(" "))}</div>`);
  }

  if (resolution.importDraftReady) {
    summaryParts.push(renderTripImportReviewChecklist(buildTripImportReviewContext(resolution)));
  }

  elements.tripImportSummary.innerHTML = summaryParts.join("");
  elements.tripImportSummary.classList.toggle("hidden", summaryParts.length === 0);
  renderTripImportFollowUp(Boolean(resolution.blockingMissingFields.length || (!resolution.canCreate && state.tripIntake.followUpPrompt)));
  renderTripImportItineraryEditor();
  updateTripCreateFieldHints(resolution);
}

function buildTripImportReviewContext(resolution) {
  return {
    tripIntake: state.tripIntake,
    resolution,
    pending: state.pending,
    form: {
      title: elements.tripCreateTitle.value.trim(),
      startDate: elements.tripCreateStartDate.value.trim(),
      endDate: elements.tripCreateEndDate.value.trim(),
      timezone: elements.tripCreateTimezone.value.trim(),
      travelers: elements.tripCreateTravelers.value.trim(),
    },
  };
}

function renderTripImportFollowUp(visible) {
  if (!elements.tripImportFollowUp || !elements.tripImportFollowUpPrompt) {
    return;
  }

  const shouldShow = visible && state.tripIntake.parsed;
  elements.tripImportFollowUp.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    elements.tripImportFollowUpPrompt.textContent = "";
    elements.tripImportFollowUpHistory?.classList.add("hidden");
    if (elements.tripImportFollowUpHistory) {
      elements.tripImportFollowUpHistory.innerHTML = "";
    }
    return;
  }

  elements.tripImportFollowUpPrompt.textContent = state.tripIntake.followUpPrompt
    || "Answer the missing details here and update the extraction.";
  elements.tripImportFollowUpButton.disabled = state.pending;

  const history = state.tripIntake.clarificationHistory ?? [];
  if (!elements.tripImportFollowUpHistory) {
    return;
  }

  if (!history.length) {
    elements.tripImportFollowUpHistory.innerHTML = "";
    elements.tripImportFollowUpHistory.classList.add("hidden");
    return;
  }

  elements.tripImportFollowUpHistory.innerHTML = `
    <div class="trip-import-followup-history-title">Clarifications used so far</div>
    <ul class="trip-import-followup-history-list">
      ${history.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}
    </ul>
  `;
  elements.tripImportFollowUpHistory.classList.remove("hidden");
}

function renderTripImportItineraryEditor() {
  if (!elements.tripImportItinerary) {
    return;
  }

  const itinerary = state.tripIntake.itinerary;
  if (!state.tripIntake.parsed || !itinerary?.days?.length) {
    elements.tripImportItinerary.innerHTML = "";
    elements.tripImportItinerary.classList.add("hidden");
    return;
  }

  elements.tripImportItinerary.innerHTML = `
    <div class="trip-import-itinerary-header">
      <div>
        <strong>Imported itinerary preview</strong>
        <div class="trip-import-itinerary-meta">${escapeHtml(
          state.tripIntake.sourceDirty
            ? "This preview is stale until you run extraction again."
            : "Edit the day labels, summaries, and items before creating the trip."
        )}</div>
      </div>
      <button type="button" class="button button-small" data-trip-intake-action="add-day">Add day</button>
    </div>
    <div class="trip-import-days">
      ${itinerary.days
        .map((day, dayIndex) => renderTripImportDayEditor(day, dayIndex))
        .join("")}
    </div>
  `;
  elements.tripImportItinerary.classList.remove("hidden");
}

function renderTripImportDayEditor(day, dayIndex) {
  return `
    <section class="trip-import-day-card" data-trip-intake-day-index="${dayIndex}">
      <div class="trip-import-day-header">
        <div>
          <div class="trip-import-day-kicker">Day ${dayIndex + 1}</div>
          <div class="trip-import-day-date">${escapeHtml(day.date || "Trip date will align from the final start date.")}</div>
        </div>
        <button type="button" class="button button-small" data-trip-intake-action="remove-day" data-day-index="${dayIndex}">Remove day</button>
      </div>
      <div class="trip-import-day-grid">
        <label class="trip-create-field">
          <span>Day label</span>
          <input type="text" data-trip-intake-field="day-label" data-day-index="${dayIndex}" value="${escapeHtml(day.label ?? "")}" autocomplete="off">
        </label>
        <label class="trip-create-field">
          <span>Summary</span>
          <input type="text" data-trip-intake-field="day-summary" data-day-index="${dayIndex}" value="${escapeHtml(day.summary ?? "")}" autocomplete="off">
        </label>
      </div>
      <div class="trip-import-items">
        ${day.items
          .map((item, itemIndex) => renderTripImportItemEditor(item, dayIndex, itemIndex))
          .join("")}
      </div>
      <div class="trip-import-day-actions">
        <button type="button" class="button button-small" data-trip-intake-action="add-item" data-day-index="${dayIndex}">Add item</button>
      </div>
    </section>
  `;
}

function renderTripImportItemEditor(item, dayIndex, itemIndex) {
  return `
    <article class="trip-import-item-card" data-trip-intake-item-index="${itemIndex}">
      <div class="trip-import-item-grid">
        <label class="trip-create-field">
          <span>Title</span>
          <input type="text" data-trip-intake-field="item-title" data-day-index="${dayIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.title ?? "")}" autocomplete="off">
        </label>
        <label class="trip-create-field">
          <span>Kind</span>
          <select data-trip-intake-field="item-kind" data-day-index="${dayIndex}" data-item-index="${itemIndex}">
            ${renderTripImportItemKindOptions(item.kind)}
          </select>
        </label>
        <label class="trip-create-field">
          <span>Start</span>
          <input type="time" data-trip-intake-field="item-start-time" data-day-index="${dayIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.start_time ?? "")}">
        </label>
        <label class="trip-create-field">
          <span>End</span>
          <input type="time" data-trip-intake-field="item-end-time" data-day-index="${dayIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.end_time ?? "")}">
        </label>
      </div>
      <div class="trip-import-item-meta-row">
        <div class="trip-import-item-meta">${escapeHtml(formatTripImportItemMeta(item))}</div>
        <button type="button" class="button button-small" data-trip-intake-action="remove-item" data-day-index="${dayIndex}" data-item-index="${itemIndex}">Remove</button>
      </div>
    </article>
  `;
}

function renderTripImportItemKindOptions(selectedKind) {
  const kinds = [
    "flight",
    "transit",
    "check_in",
    "check_out",
    "lodging",
    "activity",
    "meal",
    "buffer",
    "free_time",
  ];

  return kinds
    .map((kind) => `<option value="${kind}"${kind === selectedKind ? " selected" : ""}>${escapeHtml(kind.replace(/_/g, " "))}</option>`)
    .join("");
}

function formatTripImportItemMeta(item) {
  const fragments = [];
  if (item.status) {
    fragments.push(item.status);
  }
  if (item.locked) {
    fragments.push("locked");
  }
  if (item.category) {
    fragments.push(item.category);
  }
  return fragments.length ? fragments.join(" · ") : "Suggested stop";
}

function updateTripIntakeEditableField(field) {
  const dayIndex = Number.parseInt(field.dataset.dayIndex ?? "", 10);
  const itemIndex = Number.parseInt(field.dataset.itemIndex ?? "", 10);
  const fieldName = field.dataset.tripIntakeField;

  mutateTripIntakeItinerary((itinerary) => {
    if (!Number.isFinite(dayIndex) || !itinerary.days[dayIndex]) {
      return;
    }

    const day = itinerary.days[dayIndex];
    if (fieldName === "day-label") {
      day.label = field.value;
      return;
    }

    if (fieldName === "day-summary") {
      day.summary = field.value;
      return;
    }

    if (!Number.isFinite(itemIndex) || !day.items[itemIndex]) {
      return;
    }

    const item = day.items[itemIndex];
    if (fieldName === "item-title") {
      item.title = field.value;
      return;
    }

    if (fieldName === "item-kind") {
      item.kind = field.value;
      return;
    }

    if (fieldName === "item-start-time") {
      item.start_time = field.value;
      return;
    }

    if (fieldName === "item-end-time") {
      item.end_time = field.value;
    }
  });
}

function mutateTripIntakeItinerary(mutator, options = {}) {
  if (!state.tripIntake.itinerary?.days?.length) {
    return;
  }

  const nextItinerary = structuredClone(state.tripIntake.itinerary);
  mutator(nextItinerary);
  nextItinerary.days = nextItinerary.days.map((day, index) => ({
    ...day,
    day_index: index + 1,
    label: day.label || `Day ${index + 1}`,
    items: Array.isArray(day.items) ? day.items : [],
  }));
  state.tripIntake = {
    ...state.tripIntake,
    itinerary: recountTripIntakeItinerary(nextItinerary),
    reviewConfirmed: false,
    statusMessage: "",
    statusTone: "neutral",
  };

  if (options.rerender) {
    renderTripCreateAssist();
  }
}

function resolveTripCreateState() {
  const title = elements.tripCreateTitle.value.trim();
  const startDate = elements.tripCreateStartDate.value.trim();
  const timezone = elements.tripCreateTimezone.value.trim();
  const travelerCount = Number.parseInt(elements.tripCreateTravelers.value.trim(), 10);
  let endDate = elements.tripCreateEndDate.value.trim();
  let endDateIsDerived = false;
  let endDateWillAutoFillMessage = "";

  if (!endDate && startDate && state.tripIntake.durationDays && !state.tripIntake.hasExactEndDate) {
    endDate = addDaysToDate(startDate, state.tripIntake.durationDays - 1);
    endDateIsDerived = true;
  }

  if (!endDate && state.tripIntake.durationDays && !state.tripIntake.hasExactEndDate) {
    endDateWillAutoFillMessage = `End date will auto-fill from the ${state.tripIntake.durationDays}-day duration once you set the start date.`;
  } else if (endDateIsDerived) {
    endDateWillAutoFillMessage = `End date is auto-filled from the ${state.tripIntake.durationDays}-day duration.`;
  }

  const blockingMissingFields = [];
  if (!title) blockingMissingFields.push("title");
  if (!startDate) blockingMissingFields.push("start_date");
  if (!endDate) blockingMissingFields.push("end_date");
  if (!timezone) blockingMissingFields.push("timezone");

  const optionalMissingFields = Number.isFinite(travelerCount) && travelerCount > 0 ? [] : ["traveler_count"];
  const importDraftReady =
    state.tripIntake.parsed &&
    !state.tripIntake.sourceDirty &&
    (state.tripIntake.itinerary?.days?.length ?? 0) > 0;
  const importReviewRequired = Boolean(importDraftReady);
  const importReviewConfirmed = Boolean(state.tripIntake.reviewConfirmed);

  return {
    blockingMissingFields,
    optionalMissingFields,
    canCreate: blockingMissingFields.length === 0 && (!importReviewRequired || importReviewConfirmed),
    importDraftReady,
    importReviewRequired,
    importReviewConfirmed,
    endDateWillAutoFillMessage,
  };
}

function updateTripCreateFieldHints(resolution) {
  elements.tripCreateFields.forEach((field) => {
    const fieldName = field.dataset.tripField;
    const isMissing = resolution.blockingMissingFields.includes(fieldName);
    let hint = "";

    if (fieldName === "title" && isMissing) {
      hint = "Add a short trip title.";
    }

    if (fieldName === "start_date" && isMissing) {
      hint = "Add the exact trip start date.";
    }

    if (fieldName === "end_date") {
      if (isMissing && state.tripIntake.durationDays) {
        hint = `This will auto-fill from the ${state.tripIntake.durationDays}-day duration after you set the start date.`;
      } else if (isMissing) {
        hint = "Add the exact trip end date.";
      } else if (resolution.endDateWillAutoFillMessage) {
        hint = resolution.endDateWillAutoFillMessage;
      }
    }

    if (fieldName === "timezone" && isMissing) {
      hint = "Choose the trip timezone.";
    }

    if (fieldName === "traveler_count" && state.tripIntake.parsed && !state.tripIntake.draft?.traveler_count) {
      hint = `Not found in the pasted plan. Update it if ${elements.tripCreateTravelers.value} is wrong.`;
    }

    field.classList.toggle("is-missing", Boolean(isMissing));
    const hintNode = field.querySelector(".trip-field-hint");
    if (hintNode) {
      hintNode.textContent = hint;
      hintNode.classList.toggle("hidden", !hint);
    }
  });
}

function clearTripCreateFieldHints() {
  elements.tripCreateFields.forEach((field) => {
    field.classList.remove("is-missing");
    const hintNode = field.querySelector(".trip-field-hint");
    if (hintNode) {
      hintNode.textContent = "";
      hintNode.classList.add("hidden");
    }
  });
}

function formatTripFieldLabel(field) {
  const labels = {
    title: "trip title",
    start_date: "start date",
    end_date: "end date",
    timezone: "timezone",
    traveler_count: "traveler count",
  };

  return labels[field] ?? field;
}

function addDaysToDate(date, days) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

function collectPreviewItemChanges(beforeTrip, afterTrip) {
  if (!beforeTrip || !afterTrip) {
    return [];
  }

  const beforeItems = flattenTripItems(beforeTrip);
  const afterItems = flattenTripItems(afterTrip);
  const allIds = new Set([...beforeItems.keys(), ...afterItems.keys()]);

  return Array.from(allIds)
    .map((itemId) => {
      const before = beforeItems.get(itemId) ?? null;
      const after = afterItems.get(itemId) ?? null;
      if (
        JSON.stringify(toPreviewComparableItem(before?.item ?? null, before?.dayDate))
        === JSON.stringify(toPreviewComparableItem(after?.item ?? null, after?.dayDate))
      ) {
        return null;
      }

      return {
        id: itemId,
        kind: determinePreviewItemChangeKind(before, after),
        before,
        after,
        fieldChanges: describePreviewItemFieldChanges(before?.item ?? null, after?.item ?? null, before?.dayDate, after?.dayDate),
      };
    })
    .filter(Boolean)
    .sort((left, right) => comparePreviewChangeMoments(left, right));
}

function collectPreviewRouteChanges(beforeTrip, afterTrip, changedRouteIds = []) {
  if (!beforeTrip || !afterTrip) {
    return [];
  }

  const beforeRoutes = new Map(beforeTrip.routes.map((route) => [route.route_id, route]));
  const afterRoutes = new Map(afterTrip.routes.map((route) => [route.route_id, route]));
  const routeIds = Array.from(new Set([...beforeRoutes.keys(), ...afterRoutes.keys(), ...changedRouteIds]));

  return routeIds
    .map((routeId) => {
      const before = beforeRoutes.get(routeId) ?? null;
      const after = afterRoutes.get(routeId) ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) {
        return null;
      }

      return {
        id: routeId,
        before,
        after,
        beforeLabel: before ? describeRouteEndpoints(beforeTrip, before) : null,
        afterLabel: after ? describeRouteEndpoints(afterTrip, after) : null,
      };
    })
    .filter(Boolean);
}

function renderPreviewExplanation({ itemChanges, routeChanges, resolvedConflicts, introducedConflicts, commands }) {
  const lockedChanges = itemChanges.filter((change) => change.before?.item?.locked || change.after?.item?.locked);
  const introductionGrades = introducedConflicts.map((conflict) => classifyConflict(conflict));
  const mustFixCount = introductionGrades.filter((grade) => grade.level === "must-fix").length;
  const actionLines = buildPreviewActionLines(commands, itemChanges, routeChanges).slice(0, 4);
  const safetyCards = [
    {
      label: "Conflict impact",
      value: `${formatCountLabel(resolvedConflicts.length, "conflict resolved", "conflicts resolved")} · ${formatCountLabel(introducedConflicts.length, "conflict remaining", "conflicts remaining")}`,
      tone: mustFixCount ? "alert" : "ok",
      detail: mustFixCount
        ? `${formatCountLabel(mustFixCount, "must-fix issue")} still needs review.`
        : "No must-fix issues are introduced.",
    },
    {
      label: "Locked stops",
      value: lockedChanges.length
        ? formatCountLabel(lockedChanges.length, "locked stop touched", "locked stops touched")
        : "Not touched",
      tone: lockedChanges.length ? "alert" : "ok",
      detail: lockedChanges.length
        ? "Review locked-stop changes before applying."
        : "Locked stops remain protected.",
    },
    {
      label: "Schedule scope",
      value: `${formatCountLabel(itemChanges.length, "stop")} · ${formatCountLabel(routeChanges.length, "route")}`,
      tone: itemChanges.length || routeChanges.length ? "neutral" : "ok",
      detail: itemChanges.length || routeChanges.length
        ? "Only the listed stop and route changes will be applied."
        : "No visible schedule changes were produced.",
    },
  ];

  return `
    <div class="preview-explainer">
      <div class="preview-explainer-header">
        <div>
          <div class="diff-section-title">AI preview explanation</div>
          <strong>${escapeHtml(describePreviewPrimaryIntent(commands, itemChanges, routeChanges))}</strong>
        </div>
      </div>
      <div class="preview-explainer-grid">
        ${safetyCards.map((card) => `
          <div class="preview-explainer-card ${escapeHtml(card.tone)}">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.detail)}</small>
          </div>
        `).join("")}
      </div>
      ${actionLines.length ? `
        <ul class="preview-explainer-actions">
          ${actionLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      ` : ""}
    </div>
  `;
}

function describePreviewPrimaryIntent(commands, itemChanges, routeChanges) {
  const firstReason = commands.find((command) => command.reason)?.reason;
  if (firstReason) {
    return firstReason;
  }

  if (itemChanges.length) {
    return `Review ${formatCountLabel(itemChanges.length, "stop change")}.`;
  }

  if (routeChanges.length) {
    return `Review ${formatCountLabel(routeChanges.length, "route change")}.`;
  }

  return "Review the preview before applying it.";
}

function buildPreviewActionLines(commands, itemChanges, routeChanges) {
  const lines = [];
  commands.forEach((command) => {
    lines.push(describePreviewCommand(command));
  });

  if (itemChanges.length) {
    const added = itemChanges.filter((change) => change.kind === "added").length;
    const removed = itemChanges.filter((change) => change.kind === "removed").length;
    const moved = itemChanges.filter((change) => change.kind === "moved").length;
    const updated = itemChanges.filter((change) => change.kind === "updated").length;
    [
      added ? `${formatCountLabel(added, "stop")} will be added.` : "",
      removed ? `${formatCountLabel(removed, "stop")} will be removed.` : "",
      moved ? `${formatCountLabel(moved, "stop")} will move to another day.` : "",
      updated ? `${formatCountLabel(updated, "stop")} will be updated.` : "",
    ].filter(Boolean).forEach((line) => lines.push(line));
  }

  if (routeChanges.length) {
    lines.push(`${formatCountLabel(routeChanges.length, "route")} will be recalculated or retagged.`);
  }

  return Array.from(new Set(lines.filter(Boolean)));
}

function describePreviewCommand(command) {
  const labels = {
    lock_item: "Lock the selected stop.",
    unlock_item: "Unlock the selected stop.",
    move_item: "Adjust a stop time.",
    reorder_item: "Move a stop earlier or later in the day.",
    update_item: "Save stop details.",
    add_day: "Add a trip day.",
    delete_day: "Remove an empty trip day.",
    replace_place: "Swap the selected place.",
    insert_item: "Insert a new stop.",
    restore_item: "Restore a previously removed stop.",
    delete_item: "Remove a stop.",
    set_transport_mode: "Change a route transport mode.",
    optimize_day: "Optimize the day order.",
    relax_day: "Add breathing room to the day.",
    compress_day: "Tighten the day timing.",
    fill_meal: "Add a meal stop.",
    regenerate_markdown: "Regenerate itinerary notes.",
    resolve_conflict: "Try an automatic conflict fix.",
  };

  return labels[command.action] ?? command.reason ?? `Run ${command.action}.`;
}

function renderPreviewChangeList(itemChanges, routeChanges) {
  if (!itemChanges.length && !routeChanges.length) {
    return "<div class=\"diff-meta\">No visible schedule changes.</div>";
  }

  return `
    <div class="diff-section">
      <div class="diff-section-title">Before and after</div>
      <div class="preview-change-list">
        ${itemChanges.map((change) => renderPreviewItemChange(change)).join("")}
        ${routeChanges.map((change) => renderPreviewRouteChange(change)).join("")}
      </div>
    </div>
  `;
}

function renderPreviewItemChange(change) {
  const focusItemId = change.after?.item?.id ?? change.before?.item?.id ?? "";
  const focusDayDate = change.after?.dayDate ?? change.before?.dayDate ?? "";
  const title = change.after?.item?.title ?? change.before?.item?.title ?? "Updated item";
  return `
    <button
      type="button"
      class="preview-change-card ${escapeHtml(change.kind)}"
      data-preview-focus-item-id="${escapeHtml(focusItemId)}"
      data-preview-focus-day-date="${escapeHtml(focusDayDate)}">
      <div class="preview-change-header">
        <span class="preview-change-badge">${escapeHtml(change.kind)}</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div class="preview-change-columns">
        <div class="preview-change-column">
          <div class="preview-change-label">Before</div>
          ${renderPreviewItemSnapshot(change.before)}
        </div>
        <div class="preview-change-column">
          <div class="preview-change-label">After</div>
          ${renderPreviewItemSnapshot(change.after)}
        </div>
      </div>
      ${change.fieldChanges.length ? `<div class="preview-change-tags">${change.fieldChanges.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>` : ""}
    </button>
  `;
}

function renderPreviewRouteChange(change) {
  const nextRoute = change.after ?? change.before;
  const routeLabel = nextRoute
    ? `${escapeHtml(nextRoute.mode)} route`
    : "Route";
  return `
    <div class="preview-change-card route-change">
      <div class="preview-change-header">
        <span class="preview-change-badge">route</span>
        <strong>${routeLabel}</strong>
      </div>
      <div class="preview-change-columns">
        <div class="preview-change-column">
          <div class="preview-change-label">Before</div>
          <div class="preview-change-line">${escapeHtml(formatRouteSnapshot(change.before, change.beforeLabel))}</div>
        </div>
        <div class="preview-change-column">
          <div class="preview-change-label">After</div>
          <div class="preview-change-line">${escapeHtml(formatRouteSnapshot(change.after, change.afterLabel))}</div>
        </div>
      </div>
    </div>
  `;
}

function renderPreviewItemSnapshot(snapshot) {
  if (!snapshot?.item) {
    return '<div class="preview-change-line muted">Not present</div>';
  }

  const timeZone = resolveTripTimeZone(snapshot.trip);
  const lines = [
    `${snapshot.dayLabel} - ${localTime(snapshot.item.start_at, timeZone)}-${localTime(snapshot.item.end_at, timeZone)}`,
    snapshot.item.title,
  ];
  if (snapshot.placeName) {
    lines.push(snapshot.placeName);
  }

  return lines.map((line) => `<div class="preview-change-line">${escapeHtml(line)}</div>`).join("");
}

function flattenTripItems(trip) {
  const placesById = new Map(trip.places.map((place) => [place.place_id, place]));
  return new Map(
    trip.days.flatMap((day) =>
      day.items.map((item) => [
        item.id,
        {
          trip,
          dayDate: day.date,
          dayLabel: day.label,
          item,
          placeName: item.place_id ? placesById.get(item.place_id)?.name ?? null : null,
        },
      ])
    )
  );
}

function determinePreviewItemChangeKind(before, after) {
  if (!before?.item && after?.item) {
    return "added";
  }
  if (before?.item && !after?.item) {
    return "removed";
  }
  if (before?.dayDate !== after?.dayDate) {
    return "moved";
  }
  return "updated";
}

function toPreviewComparableItem(item, dayDate) {
  if (!item) {
    return null;
  }

  return {
    dayDate: dayDate ?? null,
    title: item.title ?? null,
    kind: item.kind ?? null,
    category: item.category ?? null,
    start_at: item.start_at ?? null,
    end_at: item.end_at ?? null,
    place_id: item.place_id ?? null,
    locked: Boolean(item.locked),
    status: item.status ?? null,
  };
}

function describePreviewItemFieldChanges(beforeItem, afterItem, beforeDayDate, afterDayDate) {
  const changes = [];
  if (!beforeItem || !afterItem) {
    return changes;
  }
  if (beforeDayDate !== afterDayDate) changes.push("day");
  if (beforeItem.start_at !== afterItem.start_at || beforeItem.end_at !== afterItem.end_at) changes.push("time");
  if (beforeItem.title !== afterItem.title) changes.push("title");
  if (beforeItem.place_id !== afterItem.place_id) changes.push("place");
  if (beforeItem.kind !== afterItem.kind) changes.push("kind");
  if (beforeItem.locked !== afterItem.locked) changes.push("lock");
  return changes;
}

function comparePreviewChangeMoments(left, right) {
  const leftMoment = left.after?.item?.start_at ?? left.before?.item?.start_at ?? "";
  const rightMoment = right.after?.item?.start_at ?? right.before?.item?.start_at ?? "";
  return leftMoment.localeCompare(rightMoment);
}

function describeRouteEndpoints(trip, route) {
  const items = new Map(trip.days.flatMap((day) => day.items.map((item) => [item.id, item.title])));
  const fromTitle = items.get(route.from_item_id) ?? "Previous stop";
  const toTitle = items.get(route.to_item_id) ?? "Next stop";
  return `${fromTitle} to ${toTitle}`;
}

function formatRouteSnapshot(route, label) {
  if (!route) {
    return "Not present";
  }
  return `${label ? `${label} · ` : ""}${route.mode} - ${route.duration_minutes} min`;
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

function findIncomingRoute(trip, itemId) {
  if (!trip || !itemId) {
    return null;
  }

  return trip.routes.find((route) => route.to_item_id === itemId) ?? null;
}

function renderConflicts(trip, day, options = {}) {
  const itemIds = new Set((day?.items ?? []).map((item) => item.id));
  const allConflicts = trip.conflicts.filter((conflict) => {
    if (options.conflictIds?.length) {
      return options.conflictIds.includes(conflict.id);
    }
    if (conflict.item_ids.length === 0) {
      return Boolean(day?.date && conflict.id.includes(day.date));
    }
    return conflict.item_ids.some((itemId) => itemIds.has(itemId));
  });
  const conflicts = options.allowIgnore === false
    ? allConflicts
    : allConflicts.filter((conflict) => !isConflictIgnored(conflict.id));
  const ignoredNote = options.allowIgnore === false
    ? ""
    : renderIgnoredConflictsNote(allConflicts.length - conflicts.length);

  if (conflicts.length === 0) {
    return `
      <div class="diff-meta">
        ${escapeHtml(options.emptyText ?? "No current conflicts on this day.")}
        ${ignoredNote}
      </div>
    `;
  }

  return `
    ${renderConflictSnapshotList(
    options.title ?? "Conflicts",
    conflicts.map((conflict) => ({
      id: conflict.id,
      type: conflict.type,
      severity: conflict.severity,
      message: conflict.message,
      resolution_hint: conflict.resolution_hint,
      item_ids: conflict.item_ids,
      day_date: findConflictDayDate(trip, conflict),
      repairable: isRepairableConflict(conflict),
    })),
    {
      highlightedConflictId: options.highlightedConflictId ?? null,
    }
  )}
    ${ignoredNote}
  `;
}

function renderConflictSnapshotList(title, conflicts, options = {}) {
  const visibleConflicts = conflicts
    .map(enrichConflictSnapshot)
    .filter((conflict) => options.allowIgnore === false || !isConflictIgnored(conflict.id))
    .sort((left, right) => left.grade.rank - right.grade.rank || left.message.localeCompare(right.message));

  if (visibleConflicts.length === 0) {
    return "";
  }

  return `
    <div class="diff-section">
      <div class="diff-section-title">${escapeHtml(title)}</div>
      <ul class="diff-list conflict-list">
        ${visibleConflicts
          .map((conflict) => {
            const activeClass = conflict.id === options.highlightedConflictId ? " active" : "";
            const locateButton = options.allowFocus === false ? "" : `
              <button
                type="button"
                class="button button-small"
                data-conflict-action="focus"
                data-conflict-id="${escapeHtml(conflict.id)}">
                Locate
              </button>
            `;
            const repairButton = options.allowRepair === false
              ? ""
              : conflict.repairable
              ? `<button type="button" class="button button-small" data-conflict-action="repair" data-conflict-id="${escapeHtml(conflict.id)}" data-item-id="${escapeHtml(conflict.item_ids?.[0] ?? "")}" data-day-date="${escapeHtml(conflict.day_date ?? "")}">Fix</button>`
              : "";
            const ignoreButton = options.allowIgnore === false ? "" : `
              <button
                type="button"
                class="button button-small"
                data-conflict-action="ignore"
                data-conflict-id="${escapeHtml(conflict.id)}">
                Keep as-is
              </button>
            `;
            const hint = conflict.resolution_hint ? `<div class="diff-meta">${escapeHtml(conflict.resolution_hint)}</div>` : "";
            return `
              <li class="conflict-entry ${escapeHtml(conflict.grade.level)}${activeClass}${conflict.severity === "error" ? " conflict-error" : ""}">
                <div class="conflict-row">
                  <span class="conflict-message">
                    <span class="conflict-grade ${escapeHtml(conflict.grade.level)}">${escapeHtml(conflict.grade.label)}</span>
                    <span>${escapeHtml(conflict.message)}</span>
                  </span>
                  ${(locateButton || repairButton || ignoreButton) ? `<div class="conflict-actions">${locateButton}${repairButton}${ignoreButton}</div>` : ""}
                </div>
                ${hint}
              </li>
            `;
          })
          .join("")}
      </ul>
    </div>
  `;
}

function enrichConflictSnapshot(conflict) {
  return {
    ...conflict,
    grade: classifyConflict(conflict),
  };
}

function classifyConflict(conflict) {
  if (
    conflict.severity === "error" ||
    conflict.type === "locked_item_violation" ||
    conflict.type === "overlap_conflict" ||
    conflict.type === "travel_time_underestimated"
  ) {
    return {
      level: "must-fix",
      label: "Must fix",
      rank: 0,
    };
  }

  if (
    conflict.severity === "warning" ||
    conflict.type === "opening_hours_conflict" ||
    conflict.type === "meal_window_missing" ||
    conflict.type === "pace_limit_exceeded" ||
    conflict.type === "reservation_time_mismatch"
  ) {
    return {
      level: "review",
      label: "Review",
      rank: 1,
    };
  }

  return {
    level: "fyi",
    label: "FYI",
    rank: 2,
  };
}

function renderIgnoredConflictsNote(count) {
  if (count <= 0) {
    return "";
  }

  return `
    <span class="conflict-ignored-note">
      ${escapeHtml(formatCountLabel(count, "conflict"))} kept as-is.
      <button type="button" class="button button-small" data-conflict-action="clear-ignored">Show kept</button>
    </span>
  `;
}

function isConflictIgnored(conflictId) {
  return Boolean(conflictId && state.ignoredConflictIds.has(conflictId));
}

function reconcileIgnoredConflicts(trip) {
  if (!trip) {
    state.ignoredConflictIds.clear();
    return;
  }

  const activeIds = new Set(trip.conflicts.map((conflict) => conflict.id));
  Array.from(state.ignoredConflictIds).forEach((conflictId) => {
    if (!activeIds.has(conflictId)) {
      state.ignoredConflictIds.delete(conflictId);
    }
  });
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

function findConflictDayDate(trip, conflict) {
  if (!trip || !conflict) {
    return null;
  }

  if (conflict.item_ids?.length) {
    const matchingDay = trip.days.find((day) => day.items.some((item) => conflict.item_ids.includes(item.id)));
    return matchingDay?.date ?? null;
  }

  const dateMatch = conflict.id?.match(/(\d{4}-\d{2}-\d{2})$/);
  return dateMatch?.[1] ?? null;
}

function resolveHighlightedConflict(trip, highlightedConflictId) {
  if (!trip || !highlightedConflictId) {
    return null;
  }

  const conflict = trip.conflicts.find((candidate) => candidate.id === highlightedConflictId) ?? null;
  if (!conflict && state.highlightedConflictId === highlightedConflictId) {
    clearConflictHighlight();
  }
  return conflict;
}

function collectConflictSnapshots(trip, conflictIds = []) {
  if (!trip || !Array.isArray(conflictIds)) {
    return [];
  }

  return conflictIds
    .map((conflictId) => trip.conflicts.find((candidate) => candidate.id === conflictId))
    .filter(Boolean)
    .map((conflict) => ({
      id: conflict.id,
      type: conflict.type,
      severity: conflict.severity,
      message: conflict.message,
      resolution_hint: conflict.resolution_hint,
      item_ids: conflict.item_ids,
      day_date: findConflictDayDate(trip, conflict),
      repairable: isRepairableConflict(conflict),
    }));
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
