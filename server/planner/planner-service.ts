import { executeCommands } from "./command-executor.ts";
import { placeFromSnapshot, recomputeDerivedState, upsertPlace } from "./derivations.ts";
import { buildPreviewDiff, diffConflictIds } from "./diff.ts";
import { PlannerError } from "./errors.ts";
import { createId } from "./ids.ts";
import {
  addMinutesToIso,
  combineLocalDateTime,
  compareLocalTime,
  extractLocalTime,
  offsetForTimeZoneOnDate,
} from "./time.ts";
import type { PreviewRepository, TripRepository } from "./repositories.ts";
import type {
  CommandExecutionContext,
  Itinerary,
  ItineraryDay,
  ItineraryItem,
  ItineraryItemKind,
  ItineraryItemStatus,
  ItineraryPace,
  PlannerApplyRequest,
  PlannerApplyResponse,
  PlannerCreateTripRequest,
  PlannerCreateTripResponse,
  PlannerDependencies,
  PlannerExecuteRequest,
  PlannerExecuteResponse,
  PlannerRenameTripRequest,
  PlannerRenameTripResponse,
  PlannerCommand,
  PlannerPreview,
  PlannerPreviewRequest,
  PlannerPreviewResponse,
  PlannerRejectPreviewRequest,
  TripImportedDayDraft,
  TripImportedItemDraft,
  TripImportedItineraryDraft,
  TripIntakeField,
  TripIntakeParseRequest,
  TripIntakeResponse,
  TripSummary,
} from "./types.ts";

export class PlannerService {
  private readonly tripRepository: TripRepository;
  private readonly previewRepository: PreviewRepository;
  private readonly dependencies: PlannerDependencies;

  constructor(
    tripRepository: TripRepository,
    previewRepository: PreviewRepository,
    dependencies: PlannerDependencies
  ) {
    this.tripRepository = tripRepository;
    this.previewRepository = previewRepository;
    this.dependencies = dependencies;
  }

  async listTrips(): Promise<TripSummary[]> {
    const trips = await this.tripRepository.listTrips();
    return trips.map(summarizeTrip);
  }

  async createTrip(input: PlannerCreateTripRequest): Promise<PlannerCreateTripResponse> {
    const title = input.title.trim();
    if (!title) {
      throw new PlannerError("invalid_command", "Trip title cannot be empty.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
      throw new PlannerError("invalid_command", "Trip dates must use YYYY-MM-DD.");
    }

    if (input.startDate > input.endDate) {
      throw new PlannerError("invalid_command", "Trip end date must be on or after the start date.");
    }

    const timezone = canonicalizeTimeZone(input.timezone || "America/New_York");

    const trip = createTripSkeleton({
      tripId: createId("trip"),
      title,
      timezone,
      startDate: input.startDate,
      endDate: input.endDate,
      travelerCount: Math.max(1, Math.min(12, input.travelerCount ?? 2)),
      createdAt: this.now().toISOString(),
    });

    if (input.importDraft) {
      applyImportedItineraryDraft(trip, input.importDraft);
      await hydrateImportedItineraryPlaces(trip, this.dependencies);
      const importedItemCount = trip.days.reduce((total, day) => total + day.items.length, 0);
      trip.change_log[0].summary = `Created ${input.title} from an imported ${trip.days.length}-day itinerary with ${importedItemCount} items.`;
    }

    await recomputeDerivedState(trip, {
      ...this.dependencies,
      now: this.now(),
    });

    const savedTrip = await this.tripRepository.saveTrip(trip);

    return {
      trip: savedTrip,
      summary: input.importDraft
        ? `Created ${savedTrip.title} from the imported itinerary.`
        : `Created ${savedTrip.title}.`,
    };
  }

  async parseTripIntake(input: TripIntakeParseRequest): Promise<TripIntakeResponse> {
    const sourceText = typeof input.sourceText === "string" ? input.sourceText.trim() : "";
    if (!sourceText) {
      throw new PlannerError("invalid_command", "Trip intake requires a plan to parse.");
    }

    if (!this.dependencies.tripIntakeParser) {
      throw new PlannerError("translator_unavailable", "Trip intake parser is not configured.");
    }

    const parsed = await this.dependencies.tripIntakeParser.parse({
      sourceText,
      clarificationText: input.clarificationText,
      knownDraft: input.knownDraft,
      knownItinerary: input.knownItinerary,
      now: this.now(),
    });
    const warnings = [...(parsed.warnings ?? [])];
    const draft = mergeTripIntakeDrafts(
      normalizeTripIntakeDraft(input.knownDraft ?? {}, warnings),
      normalizeTripIntakeDraft(parsed.draft, warnings)
    );
    const itinerary = mergeImportedItineraryDrafts(
      normalizeImportedItineraryDraft(input.knownItinerary),
      normalizeImportedItineraryDraft(parsed.itinerary),
      {
        preserveBaseDays: Boolean(input.clarificationText?.trim() && input.knownItinerary?.days?.length),
      }
    );
    let durationDays = normalizeDurationDays(parsed.derived?.duration_days);

    if (!durationDays && draft.start_date && draft.end_date) {
      durationDays = diffDaysInclusive(draft.start_date, draft.end_date);
    }

    if (!draft.end_date && draft.start_date && durationDays) {
      draft.end_date = addDaysInclusive(draft.start_date, durationDays - 1);
    }

    if (draft.start_date && draft.end_date && draft.start_date > draft.end_date) {
      warnings.push("Ignored an invalid date range because the end date came before the start date.");
      draft.end_date = null;
    }

    const blockingMissingFields = collectTripIntakeBlockingMissingFields(draft);
    const optionalMissingFields = collectTripIntakeOptionalMissingFields(draft);

    return {
      draft: {
        title: draft.title ?? null,
        start_date: draft.start_date ?? null,
        end_date: draft.end_date ?? null,
        timezone: draft.timezone ?? null,
        traveler_count: draft.traveler_count ?? null,
      },
      derived: {
        duration_days: durationDays ?? null,
      },
      itinerary: {
        pace: itinerary.pace ?? null,
        day_count: itinerary.days.length,
        item_count: itinerary.days.reduce((total, day) => total + day.items.length, 0),
        days: itinerary.days,
      },
      summary: buildTripIntakeSummary(parsed.summary, draft, durationDays),
      warnings,
      blocking_missing_fields: blockingMissingFields,
      optional_missing_fields: optionalMissingFields,
      follow_up_prompt: buildTripIntakeFollowUp(draft, durationDays, blockingMissingFields, optionalMissingFields),
      can_create: blockingMissingFields.length === 0,
    };
  }

  async previewCommand(input: PlannerPreviewRequest): Promise<PlannerPreviewResponse> {
    const trip = await this.loadTripForMutation(input.tripId, input.baseVersion);
    const commands = await this.resolveCommands(trip, input.input);
    const working = structuredClone(trip);
    const now = this.now();
    const context: CommandExecutionContext = {
      ...this.dependencies,
      now,
    };

    await executeCommands(working, commands, context);
    working.version = trip.version + 1;

    const diff = buildPreviewDiff(trip, working, commands);
    const conflictDelta = diffConflictIds(trip, working);
    const preview: PlannerPreview = {
      previewId: createId("preview"),
      tripId: trip.trip_id,
      baseVersion: trip.version,
      resultVersion: working.version,
      commands,
      changedItemIds: diff.patch.changed_item_ids,
      warnings: working.conflicts.filter((conflict) => conflict.severity !== "info").map((conflict) => conflict.message),
      resolvedConflicts: conflictDelta.resolved,
      introducedConflicts: conflictDelta.introduced,
      diff,
      tripPreview: working,
      createdAt: now.toISOString(),
    };

    await this.previewRepository.savePreview(preview);

    return {
      preview_id: preview.previewId,
      base_version: preview.baseVersion,
      result_version: preview.resultVersion,
      commands: preview.commands,
      changed_item_ids: preview.changedItemIds,
      warnings: preview.warnings,
      resolved_conflicts: preview.resolvedConflicts,
      introduced_conflicts: preview.introducedConflicts,
      diff: preview.diff,
      trip_preview: preview.tripPreview,
    };
  }

  async applyPreview(input: PlannerApplyRequest): Promise<PlannerApplyResponse> {
    const trip = await this.loadTripForMutation(input.tripId, input.baseVersion);
    const preview = await this.previewRepository.getPreview(input.previewId);
    if (!preview || preview.tripId !== trip.trip_id) {
      throw new PlannerError("preview_not_found", `Preview not found: ${input.previewId}`);
    }

    if (preview.baseVersion !== trip.version) {
      throw new PlannerError("version_conflict", "Preview base_version is stale.");
    }

    const savedTrip = await this.tripRepository.saveTrip({
      ...preview.tripPreview,
      version: preview.resultVersion,
      change_log: [
        ...preview.tripPreview.change_log,
        {
          id: createId("change"),
          timestamp: this.now().toISOString(),
          actor: "assistant",
          summary: preview.diff.summary,
          command_ids: preview.commands.map((command) => command.command_id),
        },
      ],
    });

    await this.previewRepository.deletePreview(input.previewId);

    return {
      trip: savedTrip,
      applied_command_ids: preview.commands.map((command) => command.command_id),
    };
  }

  async rejectPreview(input: PlannerRejectPreviewRequest): Promise<void> {
    const preview = await this.previewRepository.getPreview(input.previewId);
    if (!preview || preview.tripId !== input.tripId) {
      throw new PlannerError("preview_not_found", `Preview not found: ${input.previewId}`);
    }

    await this.previewRepository.deletePreview(input.previewId);
  }

  async executeCommandsDirect(input: PlannerExecuteRequest): Promise<PlannerExecuteResponse> {
    if (input.input.utterance) {
      throw new PlannerError("invalid_command", "Direct execute only accepts structured commands.");
    }

    if (!input.input.commands?.length) {
      throw new PlannerError("invalid_command", "Direct execute requires at least one command.");
    }

    input.input.commands.forEach(assertDirectExecuteCommand);

    const trip = await this.loadTripForMutation(input.tripId, input.baseVersion);
    const working = structuredClone(trip);
    const now = this.now();
    const context: CommandExecutionContext = {
      ...this.dependencies,
      now,
    };

    await executeCommands(working, input.input.commands, context);
    working.version = trip.version + 1;

    const diff = buildPreviewDiff(trip, working, input.input.commands);
    const undoCommands = buildDirectUndoCommands(trip, working, input.input.commands);

    const savedTrip = await this.tripRepository.saveTrip({
      ...working,
      version: working.version,
      change_log: [
        ...working.change_log,
        {
          id: createId("change"),
          timestamp: now.toISOString(),
          actor: "user",
          summary: diff.summary,
          command_ids: input.input.commands.map((command) => command.command_id),
        },
      ],
    });

    return {
      trip: savedTrip,
      applied_command_ids: input.input.commands.map((command) => command.command_id),
      changed_item_ids: diff.patch.changed_item_ids,
      summary: diff.summary,
      undo_commands: undoCommands,
    };
  }

  async renameTrip(input: PlannerRenameTripRequest): Promise<PlannerRenameTripResponse> {
    const nextTitle = input.title.trim();
    if (!nextTitle) {
      throw new PlannerError("invalid_command", "Trip title cannot be empty.");
    }

    const trip = await this.loadTripForMutation(input.tripId, input.baseVersion);
    if (trip.title === nextTitle) {
      return {
        trip,
        summary: "Trip title unchanged.",
      };
    }

    const now = this.now().toISOString();
    const savedTrip = await this.tripRepository.saveTrip({
      ...trip,
      version: trip.version + 1,
      title: nextTitle,
      change_log: [
        ...trip.change_log,
        {
          id: createId("change"),
          timestamp: now,
          actor: "user",
          summary: `Renamed trip to ${nextTitle}.`,
        },
      ],
    });

    return {
      trip: savedTrip,
      summary: `Trip renamed to ${nextTitle}.`,
    };
  }

  private async resolveCommands(
    trip: Itinerary,
    input: PlannerPreviewRequest["input"]
  ) {
    if (input.commands?.length) {
      return input.commands;
    }

    if (input.utterance) {
      if (!this.dependencies.commandTranslator) {
        throw new PlannerError(
          "translator_unavailable",
          "Free-form utterance preview requires a command translator."
        );
      }

      return this.dependencies.commandTranslator.translate({
        trip,
        utterance: input.utterance,
        context: input.context,
      });
    }

    throw new PlannerError("invalid_command", "Preview requires either commands or utterance.");
  }

  private async loadTripForMutation(tripId: string, baseVersion: number): Promise<Itinerary> {
    const trip = await this.tripRepository.getTripById(tripId);
    if (!trip) {
      throw new PlannerError("trip_not_found", `Trip not found: ${tripId}`);
    }

    if (trip.version !== baseVersion) {
      throw new PlannerError("version_conflict", `Trip version ${trip.version} does not match ${baseVersion}.`);
    }

    return trip;
  }

  private now(): Date {
    return this.dependencies.clock ? this.dependencies.clock() : new Date();
  }
}

const DIRECT_EXECUTE_ACTIONS = new Set<PlannerCommand["action"]>([
  "lock_item",
  "unlock_item",
  "move_item",
  "reorder_item",
  "delete_item",
  "restore_item",
  "add_day",
  "delete_day",
]);

function assertDirectExecuteCommand(command: PlannerCommand): void {
  if (!DIRECT_EXECUTE_ACTIONS.has(command.action)) {
    throw new PlannerError(
      "invalid_command",
      `Direct execute only supports lock_item, unlock_item, move_item, reorder_item, delete_item, restore_item, add_day, and delete_day. Received ${command.action}.`
    );
  }
}

function buildDirectUndoCommands(
  before: Itinerary,
  after: Itinerary,
  commands: PlannerCommand[]
): PlannerCommand[] {
  const beforeItems = new Map(before.days.flatMap((day) => day.items).map((item) => [item.id, item]));
  const afterItems = new Map(after.days.flatMap((day) => day.items).map((item) => [item.id, item]));
  const undoCommands: PlannerCommand[] = [];
  const seenMoveItems = new Set<string>();
  const seenLockItems = new Set<string>();
  const seenDeletedItems = new Set<string>();
  const seenDays = new Set<string>();

  [...commands].reverse().forEach((command) => {
    if (command.action === "add_day" && command.day_date && !seenDays.has(command.day_date)) {
      undoCommands.push({
        command_id: createId("cmd"),
        action: "delete_day",
        day_date: command.day_date,
        reason: "Undo add day",
      });
      seenDays.add(command.day_date);
      return;
    }

    if (command.action === "delete_day" && command.day_date && !seenDays.has(command.day_date)) {
      const originalDay = before.days.find((day) => day.date === command.day_date);
      if (!originalDay) {
        return;
      }

      undoCommands.push({
        command_id: createId("cmd"),
        action: "add_day",
        day_date: command.day_date,
        reason: "Undo delete day",
        payload: {
          date: originalDay.date,
          label: originalDay.label,
        },
      });
      seenDays.add(command.day_date);
      return;
    }

    if (!command.item_id) {
      return;
    }

    const beforeItem = beforeItems.get(command.item_id);
    const afterItem = afterItems.get(command.item_id);

    if (command.action === "delete_item") {
      if (!beforeItem || seenDeletedItems.has(command.item_id)) {
        return;
      }

      undoCommands.push(buildUndoRestoreItemCommand(before, beforeItem));
      seenDeletedItems.add(command.item_id);
      return;
    }

    if (command.action === "restore_item") {
      if (!afterItem || seenDeletedItems.has(command.item_id)) {
        return;
      }

      undoCommands.push({
        command_id: createId("cmd"),
        action: "delete_item",
        item_id: afterItem.id,
        day_date: findItemDayDate(after, afterItem.id),
        reason: "Undo restore item",
      });
      seenDeletedItems.add(command.item_id);
      return;
    }

    if (!beforeItem || !afterItem) {
      return;
    }

    if (command.action === "lock_item" || command.action === "unlock_item") {
      if (beforeItem.locked === afterItem.locked || seenLockItems.has(command.item_id)) {
        return;
      }

      undoCommands.push({
        command_id: createId("cmd"),
        action: beforeItem.locked ? "lock_item" : "unlock_item",
        item_id: beforeItem.id,
        day_date: findItemDayDate(before, beforeItem.id),
        reason: `Undo ${command.action.replace(/_/g, " ")}`,
      });
      seenLockItems.add(command.item_id);
      return;
    }

    if (command.action === "move_item") {
      if (
        seenMoveItems.has(command.item_id) ||
        (beforeItem.start_at === afterItem.start_at && beforeItem.end_at === afterItem.end_at)
      ) {
        return;
      }

      undoCommands.push(buildUndoMoveCommand(before, beforeItem, command.action));
      seenMoveItems.add(command.item_id);
      return;
    }

    if (command.action === "reorder_item") {
      const changedItems = before.days
        .flatMap((day) => day.items)
        .filter((item) => {
          const current = afterItems.get(item.id);
          return current && (current.start_at !== item.start_at || current.end_at !== item.end_at);
        });

      changedItems.forEach((item) => {
        if (seenMoveItems.has(item.id)) {
          return;
        }
        undoCommands.push(buildUndoMoveCommand(before, item, command.action));
        seenMoveItems.add(item.id);
      });
    }
  });

  return undoCommands;
}

function buildUndoMoveCommand(
  itinerary: Itinerary,
  item: Itinerary["days"][number]["items"][number],
  sourceAction: PlannerCommand["action"]
): PlannerCommand {
  return {
    command_id: createId("cmd"),
    action: "move_item",
    item_id: item.id,
    day_date: findItemDayDate(itinerary, item.id),
    reason: `Undo ${sourceAction.replace(/_/g, " ")}`,
    new_start_at: item.start_at,
    new_end_at: item.end_at,
  };
}

function findItemDayDate(itinerary: Itinerary, itemId: string): string | undefined {
  return itinerary.days.find((day) => day.items.some((item) => item.id === itemId))?.date;
}

function buildUndoRestoreItemCommand(before: Itinerary, item: Itinerary["days"][number]["items"][number]): PlannerCommand {
  return {
    command_id: createId("cmd"),
    action: "restore_item",
    item_id: item.id,
    day_date: findItemDayDate(before, item.id),
    reason: "Undo delete item",
    payload: {
      item: structuredClone(item),
    },
  };
}

function createTripSkeleton(input: {
  tripId: string;
  title: string;
  timezone: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  createdAt: string;
}): Itinerary {
  const days = enumerateDates(input.startDate, input.endDate).map((date, index) => ({
    date,
    label: `Day ${index + 1}`,
    summary: "",
    items: [],
  }));

  return {
    trip_id: input.tripId,
    version: 1,
    title: input.title,
    timezone: input.timezone,
    start_date: input.startDate,
    end_date: input.endDate,
    travelers: Array.from({ length: input.travelerCount }, (_, index) => ({
      id: `traveler_${index + 1}`,
      name: `Traveler ${index + 1}`,
    })),
    preferences: {
      pace: "balanced",
      max_walk_minutes: 20,
      preferred_transport_modes: ["drive", "walk"],
      meal_windows: {
        lunch: { start: "11:30", end: "13:30" },
        dinner: { start: "18:00", end: "20:30" },
      },
      must_visit_place_ids: [],
      avoid_place_ids: [],
    },
    days,
    places: [],
    routes: [],
    conflicts: [],
    markdown_sections: [],
    change_log: [
      {
        id: createId("change"),
        timestamp: input.createdAt,
        actor: "user",
        summary: `Created ${input.title}.`,
      },
    ],
  };
}

function applyImportedItineraryDraft(itinerary: Itinerary, draft: TripImportedItineraryDraft): void {
  const normalized = normalizeImportedItineraryDraft(draft);
  if (normalized.pace) {
    itinerary.preferences.pace = normalized.pace;
  }

  const daysByDate = new Map(itinerary.days.map((day) => [day.date, day]));
  itinerary.days.forEach((day, index) => {
    const importedDay = normalized.days[index];
    if (!importedDay) {
      day.label = day.label || `Day ${index + 1}`;
      day.summary = day.summary || "";
      day.items = [];
      return;
    }

    day.label = importedDay.label ?? `Day ${index + 1}`;
    day.summary = importedDay.summary ?? "";
    day.items = buildImportedDayItems(importedDay, day.date, itinerary.timezone);
  });

  normalized.days.forEach((importedDay, index) => {
    if (!importedDay.date) {
      return;
    }

    const targetDay = daysByDate.get(importedDay.date);
    if (!targetDay) {
      return;
    }

    targetDay.label = importedDay.label ?? targetDay.label ?? `Day ${index + 1}`;
    targetDay.summary = importedDay.summary ?? targetDay.summary ?? "";
    targetDay.items = buildImportedDayItems(importedDay, targetDay.date, itinerary.timezone);
  });
}

async function hydrateImportedItineraryPlaces(
  itinerary: Itinerary,
  dependencies: PlannerDependencies
): Promise<void> {
  const context = {
    lastLodgingPlace: null as Itinerary["places"][number] | null,
    lastAirportPlace: null as Itinerary["places"][number] | null,
  };

  for (const day of itinerary.days) {
    let previousResolvedPlace = null;
    for (const item of day.items) {
      if (item.place_id) {
        const existingPlace = itinerary.places.find((place) => place.place_id === item.place_id) ?? null;
        previousResolvedPlace = existingPlace ?? previousResolvedPlace;
        updateImportedResolutionContext(context, item, existingPlace);
        continue;
      }

      const contextualPlace = resolveImportedContextualPlace(item, context);
      if (contextualPlace) {
        item.place_id = contextualPlace.place_id;
        previousResolvedPlace = contextualPlace;
        updateImportedResolutionContext(context, item, contextualPlace);
        continue;
      }

      if (!shouldAutoResolveImportedPlace(item)) {
        continue;
      }

      const snapshot = await resolveImportedPlaceSnapshot(item, itinerary, dependencies, previousResolvedPlace);
      if (!snapshot) {
        continue;
      }

      const place = placeFromSnapshot(snapshot);
      upsertPlace(itinerary, place);
      item.place_id = place.place_id;
      previousResolvedPlace = place;
      updateImportedResolutionContext(context, item, place);
    }
  }
}

function shouldAutoResolveImportedPlace(item: ItineraryItem): boolean {
  const title = item.title?.trim();
  if (!title || item.kind === "buffer" || item.kind === "free_time") {
    return false;
  }

  if (isAmbiguousImportedPlaceTitle(title)) {
    return false;
  }

  if (isGenericImportedMealReference(item)) {
    return false;
  }

  return hasSufficientImportedPlaceClues(item);
}

async function resolveImportedPlaceSnapshot(
  item: ItineraryItem,
  itinerary: Itinerary,
  dependencies: PlannerDependencies,
  nearPlace: Itinerary["places"][number] | null
) {
  const queries = buildImportedPlaceQueries(item);
  if (queries.length === 0) {
    return null;
  }

  const includedType = inferImportedPlaceSearchType(item);
  for (const query of queries) {
    if (!isImportedPlaceQuerySpecificEnough(query, item)) {
      continue;
    }

    let candidates = await dependencies.placesAdapter.searchByText({
      query,
      includedType,
      locationBias: nearPlace
        ? {
            center: { lat: nearPlace.lat, lng: nearPlace.lng },
            radiusMeters: 5000,
          }
        : undefined,
      pageSize: 5,
    });

    if (candidates.length === 0 && nearPlace && canFallbackToGlobalImportedSearch(query, item)) {
      candidates = await dependencies.placesAdapter.searchByText({
        query,
        includedType,
        pageSize: 5,
      });
    }

    const best = pickBestImportedPlaceCandidate(candidates, query, item, nearPlace);
    if (best) {
      return dependencies.placesAdapter.getPlaceDetails({ placeId: best.placeId });
    }
  }

  return null;
}

function buildImportedPlaceQueries(item: ItineraryItem): string[] {
  const title = item.title.trim();
  const queries: string[] = [];

  const addQuery = (value: string | null | undefined) => {
    const query = value?.trim();
    if (!query || query.length < 3 || queries.includes(query)) {
      return;
    }
    queries.push(query);
  };

  const venueAfterAt = title.match(/\b(?:at|in)\s+(.+)$/iu)?.[1]?.trim();
  addQuery(venueAfterAt);

  const parentheticalAlias = title.match(/\(([^)]+)\)/u)?.[1]?.trim();
  if (parentheticalAlias) {
    addQuery(parentheticalAlias);
    addQuery(title.replace(/\s*\([^)]+\)/u, "").trim());
  }

  if (item.kind === "flight") {
    const location = title.match(/\b(?:arrive(?:\s+at)?|arrival|depart(?:ure)?|from|to|in)\s+(.+)$/iu)?.[1]?.trim();
    if (location) {
      addQuery(`${location} airport`);
      addQuery(location);
    }
  }

  if (item.kind === "check_in" || item.kind === "check_out" || item.kind === "lodging") {
    const hotelName = title.replace(/\bcheck[\s-]?(?:in|out)(?:\s+at)?\b/giu, "").trim();
    if (hotelName) {
      addQuery(hotelName);
      if (!/\bhotel\b/iu.test(hotelName)) {
        addQuery(`${hotelName} hotel`);
      }
    }
  }

  if (item.kind === "meal") {
    const strippedMealPrefix = title.replace(/^(?:breakfast|brunch|lunch|dinner)\s+(?:at|in)\s+/iu, "").trim();
    if (strippedMealPrefix) {
      addQuery(strippedMealPrefix);
    }
  }

  if (item.kind === "transit") {
    const destination = title.split(/(?:→|->|to)\s+/iu).at(-1)?.trim();
    if (destination) {
      addQuery(destination);
    }
  }

  addQuery(title);
  return queries;
}

function inferImportedPlaceSearchType(item: ItineraryItem): string | undefined {
  if (isImportedAirportLikeItem(item)) return "airport";
  if (item.kind === "meal") return "restaurant";
  if (isImportedLodgingLikeItem(item)) return "hotel";

  const category = item.category?.toLowerCase();
  if (category === "museum") return "museum";
  if (category === "park") return "park";
  if (category === "shopping") return "shopping";
  if (category === "station") return "station";
  return undefined;
}

function pickBestImportedPlaceCandidate(
  candidates: Array<{
    placeId: string;
    name: string;
    formattedAddress?: string;
    primaryType?: string;
    rating?: number;
    location?: { lat: number; lng: number };
  }>,
  query: string,
  item: ItineraryItem,
  nearPlace: Itinerary["places"][number] | null
) {
  const queryTokens = tokenizeImportedPlaceText(query, { excludeGeneric: true });
  const titleTokens = collectImportedPlaceClueTokens(item);
  let bestCandidate = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const tokens = tokenizeImportedPlaceText(
      [candidate.placeId, candidate.name, candidate.formattedAddress, candidate.primaryType].filter(Boolean).join(" "),
      { excludeGeneric: true }
    );
    let score = 0;
    let matchedQueryTokens = 0;
    let matchedTitleTokens = 0;

    queryTokens.forEach((token) => {
      if (tokens.includes(token)) {
        score += 5;
        matchedQueryTokens += 1;
      }
    });

    titleTokens.forEach((token) => {
      if (tokens.includes(token)) {
        score += 2;
        matchedTitleTokens += 1;
      }
    });

    const exactNameMatch = Boolean(candidate.name && query.toLowerCase() === candidate.name.toLowerCase());
    if (exactNameMatch) {
      score += 12;
    }

    const hasLexicalMatch = exactNameMatch || matchedQueryTokens > 0 || matchedTitleTokens > 0;

    if (nearPlace && candidate.formattedAddress?.includes(nearPlace.name.split(" ")[0] ?? "")) {
      score += 1;
    }

    if (nearPlace && candidate.location) {
      const distanceMeters = haversineMeters(
        nearPlace.lat,
        nearPlace.lng,
        candidate.location.lat,
        candidate.location.lng
      );
      if (distanceMeters <= 5000) {
        score += 3;
      } else if (distanceMeters <= 15000) {
        score += 1;
      } else if (!hasStrongImportedPlaceSignal(query, item)) {
        score -= Math.min(6, distanceMeters / 20000);
      }
    }

    if (hasLexicalMatch) {
      score += candidate.rating ?? 0;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestScore >= 4 ? bestCandidate : null;
}

function tokenizeImportedPlaceText(
  value: string,
  options: { excludeGeneric?: boolean } = {}
): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 2)
    .filter((token) => !options.excludeGeneric || !IMPORTED_PLACE_CLUE_STOPWORDS.has(token));
}

function resolveImportedContextualPlace(
  item: ItineraryItem,
  context: {
    lastLodgingPlace: Itinerary["places"][number] | null;
    lastAirportPlace: Itinerary["places"][number] | null;
  }
): Itinerary["places"][number] | null {
  if (isImportedAirportLikeItem(item) && !hasStrongImportedPlaceSignal(item.title, item)) {
    return context.lastAirportPlace;
  }

  if (isImportedLodgingLikeItem(item) && !hasStrongImportedPlaceSignal(item.title, item)) {
    return context.lastLodgingPlace;
  }

  return null;
}

function updateImportedResolutionContext(
  context: {
    lastLodgingPlace: Itinerary["places"][number] | null;
    lastAirportPlace: Itinerary["places"][number] | null;
  },
  item: ItineraryItem,
  place: Itinerary["places"][number] | null
): void {
  if (!place) {
    return;
  }

  if (isImportedAirportLikeItem(item) || place.category === "airport") {
    context.lastAirportPlace = place;
  }

  if (isImportedLodgingLikeItem(item) || place.category === "hotel") {
    context.lastLodgingPlace = place;
  }
}

function isImportedAirportLikeItem(item: ItineraryItem): boolean {
  const category = item.category?.toLowerCase() ?? "";
  const title = item.title.toLowerCase();
  return (
    item.kind === "flight" ||
    category === "airport" ||
    title.includes("airport") ||
    title.includes("flight")
  );
}

function isImportedLodgingLikeItem(item: ItineraryItem): boolean {
  if (isImportedAirportLikeItem(item)) {
    return false;
  }

  const category = item.category?.toLowerCase() ?? "";
  return (
    item.kind === "check_in" ||
    item.kind === "check_out" ||
    item.kind === "lodging" ||
    category === "lodging" ||
    category === "hotel" ||
    category === "accommodation"
  );
}

function isAmbiguousImportedPlaceTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized.startsWith("optional ") ||
    /\bor\b/u.test(normalized) ||
    /\bif (?:time|energy|needed|possible|weather|flight)\b/u.test(normalized) ||
    /\bbased on energy\b/u.test(normalized)
  );
}

function isGenericImportedMealReference(item: ItineraryItem): boolean {
  if (item.kind !== "meal") {
    return false;
  }

  if (extractImportedVenuePhrase(item.title)) {
    return false;
  }

  return collectImportedPlaceClueTokens(item).length === 0;
}

function hasSufficientImportedPlaceClues(item: ItineraryItem): boolean {
  const tokens = collectImportedPlaceClueTokens(item);
  if (tokens.length >= 2) {
    return true;
  }

  if (isImportedAirportLikeItem(item)) {
    return tokens.length >= 1;
  }

  if (tokens.length === 1 && !IMPORTED_BROAD_REGION_TOKENS.has(tokens[0])) {
    return !isImportedLodgingLikeItem(item) && !isImportedAirportLikeItem(item);
  }

  if (item.kind === "meal") {
    return Boolean(extractImportedVenuePhrase(item.title));
  }

  return false;
}

function isImportedPlaceQuerySpecificEnough(query: string, item: ItineraryItem): boolean {
  if (query.trim().toLowerCase() === item.title.trim().toLowerCase()) {
    return hasSufficientImportedPlaceClues(item);
  }

  const tokens = tokenizeImportedPlaceText(query, { excludeGeneric: true });
  if (tokens.length >= 2) {
    return true;
  }

  if (item.kind === "meal") {
    return Boolean(tokens.length && extractImportedVenuePhrase(item.title));
  }

  return tokens.length === 1 && !IMPORTED_BROAD_REGION_TOKENS.has(tokens[0]);
}

function canFallbackToGlobalImportedSearch(query: string, item: ItineraryItem): boolean {
  return hasStrongImportedPlaceSignal(query, item);
}

function hasStrongImportedPlaceSignal(query: string, item: ItineraryItem): boolean {
  if (extractImportedVenuePhrase(item.title)) {
    const venueTokens = tokenizeImportedPlaceText(extractImportedVenuePhrase(item.title) ?? "", { excludeGeneric: true });
    if (venueTokens.length >= 2) {
      return true;
    }
  }

  const tokens = tokenizeImportedPlaceText(query, { excludeGeneric: true });
  if (tokens.length >= 2) {
    return true;
  }

  return tokens.length === 1 && !IMPORTED_BROAD_REGION_TOKENS.has(tokens[0]) && item.kind === "meal";
}

function collectImportedPlaceClueTokens(item: ItineraryItem): string[] {
  const source = extractImportedVenuePhrase(item.title) ?? item.title;
  return tokenizeImportedPlaceText(source, { excludeGeneric: true });
}

function extractImportedVenuePhrase(title: string): string | null {
  return title.match(/\b(?:at|in|to|from|via)\s+(.+)$/iu)?.[1]?.trim() ?? null;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const originLat = toRadians(lat1);
  const targetLat = toRadians(lat2);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(targetLat) * Math.sin(dLng / 2) ** 2;

  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

const IMPORTED_PLACE_CLUE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "at",
  "in",
  "to",
  "from",
  "via",
  "visit",
  "explore",
  "optional",
  "based",
  "energy",
  "early",
  "late",
  "morning",
  "afternoon",
  "evening",
  "entry",
  "start",
  "stop",
  "quick",
  "return",
  "drive",
  "walking",
  "walk",
  "hike",
  "boat",
  "ride",
  "check",
  "out",
  "into",
  "national",
  "park",
  "town",
  "area",
  "hotel",
  "lodging",
  "accommodation",
  "airport",
  "restaurant",
  "restaurants",
  "cafe",
  "cafes",
  "rental",
  "car",
  "flight",
  "allow",
  "allows",
  "time",
  "needed",
  "possible",
  "weather",
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "meal",
]);

const IMPORTED_BROAD_REGION_TOKENS = new Set(["yellowstone", "teton", "grand"]);

function normalizeImportedItineraryDraft(
  value: TripImportedItineraryDraft | null | undefined
): {
  pace: ItineraryPace | null;
  days: Array<{
    day_index: number | null;
    date: string | null;
    label: string | null;
    summary: string | null;
    items: Array<{
      title: string | null;
      kind: ItineraryItemKind | null;
      category: string | null;
      start_time: string | null;
      end_time: string | null;
      duration_minutes: number | null;
      status: ItineraryItemStatus | null;
      locked: boolean | null;
      subtitle: string | null;
      notes: string | null;
      tags: string[];
    }>;
  }>;
} {
  const days = Array.isArray(value?.days)
    ? value.days.map(normalizeImportedDayDraft).filter((day) => day.items.length > 0 || day.summary || day.label)
    : [];

  return {
    pace: normalizeItineraryPace(value?.pace),
    days: days.sort((left, right) => {
      const leftIndex = left.day_index ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.day_index ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      if (left.date && right.date && left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      return 0;
    }),
  };
}

function normalizeImportedDayDraft(day: TripImportedDayDraft): {
  day_index: number | null;
  date: string | null;
  label: string | null;
  summary: string | null;
  items: Array<{
    title: string | null;
    kind: ItineraryItemKind | null;
    category: string | null;
    start_time: string | null;
    end_time: string | null;
    duration_minutes: number | null;
    status: ItineraryItemStatus | null;
    locked: boolean | null;
    subtitle: string | null;
    notes: string | null;
    tags: string[];
  }>;
} {
  return {
    day_index: normalizePositiveInteger(day.day_index),
    date: normalizeExactDate(day.date),
    label: normalizeNonEmptyText(day.label),
    summary: normalizeNonEmptyText(day.summary),
    items: Array.isArray(day.items)
      ? day.items.map(normalizeImportedItemDraft).filter((item) => item.title || item.kind)
      : [],
  };
}

function normalizeImportedItemDraft(item: TripImportedItemDraft): {
  title: string | null;
  kind: ItineraryItemKind | null;
  category: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  status: ItineraryItemStatus | null;
  locked: boolean | null;
  subtitle: string | null;
  notes: string | null;
  tags: string[];
} {
  return {
    title: normalizeNonEmptyText(item.title),
    kind: normalizeItemKind(item.kind),
    category: normalizeNonEmptyText(item.category),
    start_time: normalizeClockTime(item.start_time),
    end_time: normalizeClockTime(item.end_time),
    duration_minutes: normalizePositiveInteger(item.duration_minutes),
    status: normalizeItemStatus(item.status),
    locked: typeof item.locked === "boolean" ? item.locked : null,
    subtitle: normalizeNonEmptyText(item.subtitle),
    notes: normalizeNonEmptyText(item.notes),
    tags: Array.isArray(item.tags)
      ? item.tags.map((tag) => normalizeNonEmptyText(tag)).filter(Boolean) as string[]
      : [],
  };
}

function buildImportedDayItems(
  day: ReturnType<typeof normalizeImportedDayDraft>,
  dayDate: string,
  timezone: string
): ItineraryItem[] {
  const offset = offsetForTimeZoneOnDate(dayDate, timezone);
  const items: ItineraryItem[] = [];
  let cursor = combineLocalDateTime(dayDate, defaultDayStartTime(day), offset);

  day.items.forEach((draft, index) => {
    const kind = draft.kind ?? inferKindFromCategory(draft.category) ?? "activity";
    const durationMinutes = normalizeImportedDurationForItem(draft.duration_minutes, kind);
    const explicitStart = draft.start_time ? combineLocalDateTime(dayDate, draft.start_time, offset) : null;
    const explicitEnd = draft.end_time ? combineLocalDateTime(dayDate, draft.end_time, offset) : null;
    const startAt = explicitStart
      ? (explicitStart > cursor ? explicitStart : cursor)
      : cursor;
    let endAt = explicitEnd && explicitEnd > startAt
      ? explicitEnd
      : addMinutesToIso(startAt, durationMinutes);

    if (explicitEnd && explicitEnd <= startAt) {
      endAt = addMinutesToIso(startAt, durationMinutes);
    }

    const title = draft.title ?? defaultImportedItemTitle(kind, index);
    const status = draft.status ?? inferImportedItemStatus(kind, draft.locked);
    const locked = draft.locked ?? inferImportedItemLocked(kind, status);
    const category = draft.category ?? defaultImportedItemCategory(kind, title);
    const item: ItineraryItem = {
      id: createId("item"),
      kind,
      title,
      subtitle: draft.subtitle ?? undefined,
      start_at: startAt,
      end_at: endAt,
      duration_minutes: durationMinutes,
      status,
      locked,
      source: "imported",
      category,
      notes: draft.notes ?? undefined,
      tags: draft.tags ?? [],
      validation_conflict_ids: [],
    };

    items.push(item);
    cursor = endAt;
  });

  return items;
}

function defaultDayStartTime(day: ReturnType<typeof normalizeImportedDayDraft>): string {
  const firstKind = day.items[0]?.kind;
  if (firstKind === "flight") return "09:00";
  if (day.items.some((item) => item.kind === "check_in" || item.kind === "check_out")) return "10:00";
  return "08:30";
}

function normalizeImportedDurationForItem(
  value: number | null,
  kind: ItineraryItemKind
): number {
  const explicit = normalizePositiveInteger(value);
  if (explicit) {
    return Math.min(12 * 60, explicit);
  }

  return defaultImportedDurationMinutes(kind);
}

function defaultImportedDurationMinutes(kind: ItineraryItemKind): number {
  switch (kind) {
    case "flight":
      return 120;
    case "transit":
      return 45;
    case "check_in":
    case "check_out":
      return 30;
    case "lodging":
      return 45;
    case "meal":
      return 75;
    case "buffer":
      return 30;
    case "free_time":
      return 60;
    case "activity":
    default:
      return 120;
  }
}

function normalizeItineraryPace(value: unknown): ItineraryPace | null {
  return value === "relaxed" || value === "balanced" || value === "packed"
    ? value
    : null;
}

function normalizeItemKind(value: unknown): ItineraryItemKind | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/gu, "_");
  if (
    normalized === "flight" ||
    normalized === "transit" ||
    normalized === "check_in" ||
    normalized === "check_out" ||
    normalized === "lodging" ||
    normalized === "activity" ||
    normalized === "meal" ||
    normalized === "buffer" ||
    normalized === "free_time"
  ) {
    return normalized;
  }

  if (["hotel", "stay"].includes(normalized)) return "lodging";
  if (["sight", "sightseeing", "visit", "stop"].includes(normalized)) return "activity";
  return null;
}

function normalizeItemStatus(value: unknown): ItineraryItemStatus | null {
  if (value === "confirmed" || value === "suggested" || value === "draft") {
    return value;
  }

  return null;
}

function normalizeNonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeClockTime(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())
    ? value.trim()
    : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function inferKindFromCategory(category: string | null): ItineraryItemKind | null {
  const normalized = category?.toLowerCase() ?? "";
  if (!normalized) return null;
  if (["breakfast", "brunch", "lunch", "dinner", "meal"].includes(normalized)) return "meal";
  if (["checkin", "check-in"].includes(normalized)) return "check_in";
  if (["checkout", "check-out"].includes(normalized)) return "check_out";
  if (["hotel", "lodging"].includes(normalized)) return "lodging";
  if (["buffer", "rest"].includes(normalized)) return "buffer";
  if (["free", "free_time", "free-time"].includes(normalized)) return "free_time";
  if (["flight", "airport"].includes(normalized)) return "flight";
  if (["transit", "drive", "walk", "taxi"].includes(normalized)) return "transit";
  return "activity";
}

function inferImportedItemStatus(kind: ItineraryItemKind, locked: boolean | null): ItineraryItemStatus {
  if (locked) {
    return "confirmed";
  }

  return kind === "flight" || kind === "check_in" || kind === "check_out"
    ? "confirmed"
    : "suggested";
}

function inferImportedItemLocked(kind: ItineraryItemKind, status: ItineraryItemStatus): boolean {
  if (kind === "flight") return true;
  if (kind === "check_in" || kind === "check_out") return status === "confirmed";
  return false;
}

function defaultImportedItemCategory(kind: ItineraryItemKind, title: string): string {
  if (kind === "meal") {
    const lower = title.toLowerCase();
    if (lower.includes("breakfast") || lower.includes("brunch")) return "breakfast";
    if (lower.includes("lunch")) return "lunch";
    if (lower.includes("dinner")) return "dinner";
    return "meal";
  }

  if (kind === "buffer") return "buffer";
  if (kind === "transit") return "transit";
  if (kind === "check_in") return "lodging";
  if (kind === "check_out") return "lodging";
  if (kind === "lodging") return "lodging";
  if (kind === "flight") return "flight";
  if (kind === "free_time") return "free_time";
  return "activity";
}

function defaultImportedItemTitle(kind: ItineraryItemKind, index: number): string {
  switch (kind) {
    case "flight":
      return `Flight segment ${index + 1}`;
    case "transit":
      return `Transit segment ${index + 1}`;
    case "check_in":
      return "Hotel check-in";
    case "check_out":
      return "Hotel check-out";
    case "lodging":
      return "Lodging block";
    case "meal":
      return `Meal ${index + 1}`;
    case "buffer":
      return "Buffer";
    case "free_time":
      return "Free time";
    case "activity":
    default:
      return `Activity ${index + 1}`;
  }
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function summarizeTrip(trip: Itinerary): TripSummary {
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
    last_updated_at: trip.change_log.at(-1)?.timestamp,
  };
}

function normalizeTripIntakeDraft(
  draft: {
    title?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    timezone?: string | null;
    traveler_count?: number | null;
  },
  warnings: string[]
): {
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  traveler_count: number | null;
} {
  const title = typeof draft.title === "string" && draft.title.trim() ? draft.title.trim() : null;
  const startDate = normalizeExactDate(draft.start_date);
  const endDate = normalizeExactDate(draft.end_date);
  let timezone = typeof draft.timezone === "string" && draft.timezone.trim() ? draft.timezone.trim() : null;

  if (timezone) {
    try {
      timezone = canonicalizeTimeZone(timezone);
    } catch {
      warnings.push(`Ignored invalid timezone "${timezone}".`);
      timezone = null;
    }
  }

  const travelerCount =
    typeof draft.traveler_count === "number" && Number.isFinite(draft.traveler_count)
      ? Math.max(1, Math.min(12, Math.round(draft.traveler_count)))
      : null;

  return {
    title,
    start_date: startDate,
    end_date: endDate,
    timezone,
    traveler_count: travelerCount,
  };
}

function mergeTripIntakeDrafts(
  base: {
    title: string | null;
    start_date: string | null;
    end_date: string | null;
    timezone: string | null;
    traveler_count: number | null;
  },
  next: {
    title: string | null;
    start_date: string | null;
    end_date: string | null;
    timezone: string | null;
    traveler_count: number | null;
  }
): {
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  traveler_count: number | null;
} {
  return {
    title: next.title ?? base.title,
    start_date: next.start_date ?? base.start_date,
    end_date: next.end_date ?? base.end_date,
    timezone: next.timezone ?? base.timezone,
    traveler_count: next.traveler_count ?? base.traveler_count,
  };
}

function normalizeExactDate(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeDurationDays(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.min(60, Math.round(value)))
    : null;
}

function mergeImportedItineraryDrafts(
  base: TripImportedItineraryDraft,
  next: TripImportedItineraryDraft,
  options: {
    preserveBaseDays?: boolean;
  } = {}
): TripImportedItineraryDraft {
  return {
    pace: next.pace ?? base.pace ?? null,
    days: options.preserveBaseDays
      ? base.days
      : (next.days.length > 0 ? next.days : base.days),
  };
}

function collectTripIntakeBlockingMissingFields(draft: {
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
}): TripIntakeField[] {
  const missing: TripIntakeField[] = [];
  if (!draft.title) missing.push("title");
  if (!draft.start_date) missing.push("start_date");
  if (!draft.end_date) missing.push("end_date");
  if (!draft.timezone) missing.push("timezone");
  return missing;
}

function collectTripIntakeOptionalMissingFields(draft: {
  traveler_count: number | null;
}): TripIntakeField[] {
  return draft.traveler_count ? [] : ["traveler_count"];
}

function buildTripIntakeSummary(
  preferredSummary: string | null | undefined,
  draft: {
    title: string | null;
    start_date: string | null;
    end_date: string | null;
    timezone: string | null;
    traveler_count: number | null;
  },
  durationDays: number | null
): string {
  if (preferredSummary && preferredSummary.trim()) {
    return preferredSummary.trim();
  }

  const fragments = [draft.title ?? "Trip plan"];
  if (draft.start_date && draft.end_date) {
    fragments.push(`${draft.start_date} to ${draft.end_date}`);
  } else if (durationDays) {
    fragments.push(`${durationDays} days`);
  }
  if (draft.timezone) {
    fragments.push(draft.timezone);
  }
  if (draft.traveler_count) {
    fragments.push(`${draft.traveler_count} travelers`);
  }
  return `Parsed ${fragments.join(" · ")}.`;
}

function buildTripIntakeFollowUp(
  draft: {
    title: string | null;
    start_date: string | null;
    end_date: string | null;
    timezone: string | null;
    traveler_count: number | null;
  },
  durationDays: number | null,
  blockingMissingFields: TripIntakeField[],
  optionalMissingFields: TripIntakeField[]
): string | null {
  if (blockingMissingFields.length === 0 && optionalMissingFields.length === 0) {
    return "Everything needed for trip creation is ready.";
  }

  const prompts: string[] = [];
  if (blockingMissingFields.includes("title")) {
    prompts.push("Reply with a short trip title.");
  }
  if (blockingMissingFields.includes("start_date")) {
    prompts.push("Reply with the exact start date in YYYY-MM-DD format.");
  }
  if (blockingMissingFields.includes("end_date")) {
    prompts.push(durationDays ? `Reply with the exact start date in YYYY-MM-DD format. The end date will auto-fill from the ${durationDays}-day duration.` : "Reply with the exact end date in YYYY-MM-DD format.");
  }
  if (blockingMissingFields.includes("timezone")) {
    prompts.push("Reply with the trip timezone, such as America/Denver.");
  }
  if (optionalMissingFields.includes("traveler_count") && !draft.traveler_count) {
    prompts.push("Traveler count is still optional, but you can reply with it now.");
  }

  return prompts.join(" ");
}

function diffDaysInclusive(startDate: string, endDate: string): number | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return null;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
}

function addDaysInclusive(date: string, offsetDays: number): string | null {
  const cursor = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) {
    return null;
  }

  cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
  return cursor.toISOString().slice(0, 10);
}

function canonicalizeTimeZone(timezone: string): string {
  const value = timezone.trim();
  if (!value) {
    throw new PlannerError("invalid_command", "Trip timezone cannot be empty.");
  }

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new PlannerError("invalid_command", `Invalid IANA timezone: ${value}.`);
  }
}
