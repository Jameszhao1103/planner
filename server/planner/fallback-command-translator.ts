import { PlannerError } from "./errors.ts";
import type { Itinerary, PlannerCommand, PlannerCommandTranslator } from "./types.ts";

export class FallbackCommandTranslator implements PlannerCommandTranslator {
  private readonly primary: PlannerCommandTranslator;
  private readonly fallback: PlannerCommandTranslator;

  constructor(primary: PlannerCommandTranslator, fallback: PlannerCommandTranslator) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async translate(input: {
    trip: Itinerary;
    utterance: string;
    context?: { selected_day?: string; selected_item_id?: string };
  }): Promise<PlannerCommand[]> {
    try {
      return await this.primary.translate(input);
    } catch (error) {
      if (
        error instanceof PlannerError &&
        error.code !== "translator_unavailable" &&
        error.code !== "invalid_command"
      ) {
        throw error;
      }

      return this.fallback.translate(input);
    }
  }
}
