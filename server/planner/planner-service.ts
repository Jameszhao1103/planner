import { executeCommands } from "./command-executor.ts";
import { buildPreviewDiff, diffConflictIds } from "./diff.ts";
import { PlannerError } from "./errors.ts";
import { createId } from "./ids.ts";
import type { PreviewRepository, TripRepository } from "./repositories.ts";
import type {
  CommandExecutionContext,
  Itinerary,
  PlannerApplyRequest,
  PlannerApplyResponse,
  PlannerDependencies,
  PlannerExecuteRequest,
  PlannerExecuteResponse,
  PlannerCommand,
  PlannerPreview,
  PlannerPreviewRequest,
  PlannerPreviewResponse,
  PlannerRejectPreviewRequest,
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
]);

function assertDirectExecuteCommand(command: PlannerCommand): void {
  if (!DIRECT_EXECUTE_ACTIONS.has(command.action)) {
    throw new PlannerError(
      "invalid_command",
      `Direct execute only supports lock_item, unlock_item, move_item, and reorder_item. Received ${command.action}.`
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

  [...commands].reverse().forEach((command) => {
    if (!command.item_id) {
      return;
    }

    const beforeItem = beforeItems.get(command.item_id);
    const afterItem = afterItems.get(command.item_id);
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
