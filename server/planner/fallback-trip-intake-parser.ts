import { PlannerError } from "./errors.ts";
import type {
  TripImportedItineraryDraft,
  TripIntakeDraft,
  TripIntakeParseResult,
  TripIntakeParser,
} from "./types.ts";

export class FallbackTripIntakeParser implements TripIntakeParser {
  private readonly primary: TripIntakeParser;
  private readonly fallback: TripIntakeParser;

  constructor(primary: TripIntakeParser, fallback: TripIntakeParser) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async parse(input: {
    sourceText: string;
    clarificationText?: string | null;
    knownDraft?: TripIntakeDraft | null;
    knownItinerary?: TripImportedItineraryDraft | null;
    now?: Date;
  }): Promise<TripIntakeParseResult> {
    try {
      return await this.primary.parse(input);
    } catch (error) {
      if (
        !(error instanceof PlannerError) ||
        (error.code !== "translator_unavailable" && error.code !== "invalid_command")
      ) {
        throw error;
      }

      return this.fallback.parse(input);
    }
  }
}
