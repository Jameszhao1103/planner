import { PlannerError } from "./errors.ts";
import {
  extractStructuredPayload,
  nullableBooleanSchema,
  nullableNumberSchema,
  nullableStringSchema,
  safeReadText,
} from "./openai-structured-output.ts";
import type {
  TripImportedItineraryDraft,
  TripIntakeDraft,
  TripIntakeParseResult,
  TripIntakeParser,
} from "./types.ts";

const TRIP_INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["draft", "derived", "itinerary", "summary", "warnings"],
  properties: {
    draft: {
      type: "object",
      additionalProperties: false,
      required: ["title", "start_date", "end_date", "timezone", "traveler_count"],
      properties: {
        title: nullableStringSchema(),
        start_date: nullableStringSchema(),
        end_date: nullableStringSchema(),
        timezone: nullableStringSchema(),
        traveler_count: nullableNumberSchema(),
      },
    },
    derived: {
      type: "object",
      additionalProperties: false,
      required: ["duration_days"],
      properties: {
        duration_days: nullableNumberSchema(),
      },
    },
    itinerary: {
      type: "object",
      additionalProperties: false,
      required: ["pace", "days"],
      properties: {
        pace: nullableStringSchema(),
        days: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["day_index", "date", "label", "summary", "items"],
            properties: {
              day_index: nullableNumberSchema(),
              date: nullableStringSchema(),
              label: nullableStringSchema(),
              summary: nullableStringSchema(),
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "title",
                    "kind",
                    "category",
                    "start_time",
                    "end_time",
                    "duration_minutes",
                    "status",
                    "locked",
                    "subtitle",
                    "notes",
                    "tags",
                  ],
                  properties: {
                    title: nullableStringSchema(),
                    kind: nullableStringSchema(),
                    category: nullableStringSchema(),
                    start_time: nullableStringSchema(),
                    end_time: nullableStringSchema(),
                    duration_minutes: nullableNumberSchema(),
                    status: nullableStringSchema(),
                    locked: nullableBooleanSchema(),
                    subtitle: nullableStringSchema(),
                    notes: nullableStringSchema(),
                    tags: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    summary: nullableStringSchema(),
    warnings: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "You extract trip creation fields and a day-by-day itinerary draft from natural-language travel plans.",
  "Return JSON only.",
  "Suggest a concise title when a destination is clear, even if the user did not provide one explicitly.",
  "Only set start_date and end_date when the exact calendar dates can be determined.",
  "Use YYYY-MM-DD for dates.",
  "If the plan only provides trip length, set derived.duration_days and leave exact dates null.",
  "Infer an IANA timezone only when the destination context is strong and unambiguous.",
  "Do not invent traveler_count unless it is explicit.",
  "Ignore factual dates that describe park openings, policies, or external references unless they are clearly the trip dates.",
  "Build itinerary.days from the plan whenever the sequence is clear, even if exact trip dates are missing.",
  "Use one day object per described day. Prefer day_index values starting at 1.",
  "For each itinerary item, provide a reasonable local start_time and either end_time or duration_minutes.",
  "Use planner item kinds such as flight, transit, check_in, check_out, lodging, activity, meal, buffer, free_time.",
  "Use status confirmed only for anchors clearly fixed by the user; otherwise suggested.",
  "Use locked true only for fixed anchors such as flights or explicit reservations.",
  "Keep warnings short and concrete.",
].join(" ");

export type OpenAiTripIntakeParserConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class OpenAiTripIntakeParser implements TripIntakeParser {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiTripIntakeParserConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4.1-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async parse(input: {
    sourceText: string;
    clarificationText?: string | null;
    knownDraft?: TripIntakeDraft | null;
    knownItinerary?: TripImportedItineraryDraft | null;
    now?: Date;
  }): Promise<TripIntakeParseResult> {
    const sourceText = input.sourceText.trim();
    if (!sourceText) {
      throw new PlannerError("invalid_command", "Trip intake parser requires a non-empty plan.");
    }

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildTripIntakePrompt({
                  sourceText,
                  clarificationText: input.clarificationText,
                  knownDraft: input.knownDraft,
                  knownItinerary: input.knownItinerary,
                  now: input.now,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "trip_intake",
            schema: TRIP_INTAKE_SCHEMA,
            strict: true,
          },
        },
      }),
    }).catch((error) => {
      throw new PlannerError("translator_unavailable", "OpenAI trip intake request failed.", {
        cause: error instanceof Error ? error.message : String(error),
      });
    });

    if (!response.ok) {
      const details = await safeReadText(response);
      throw new PlannerError("translator_unavailable", "OpenAI trip intake returned an error.", {
        status: response.status,
        details,
      });
    }

    const payload = await response.json();
    const parsed = extractStructuredPayload(payload, {
      missingPayload: "OpenAI trip intake returned no structured payload.",
      invalidJson: "OpenAI trip intake returned invalid JSON.",
    });

    return normalizeTripIntake(parsed);
  }
}

function buildTripIntakePrompt(input: {
  sourceText: string;
  clarificationText?: string | null;
  knownDraft?: TripIntakeDraft | null;
  knownItinerary?: TripImportedItineraryDraft | null;
  now?: Date;
}): string {
  const sections = [
    `Today: ${(input.now ?? new Date()).toISOString().slice(0, 10)}`,
    "",
    "Primary trip plan:",
    input.sourceText,
  ];

  if (input.clarificationText?.trim()) {
    sections.push("", "Latest clarification from the user:", input.clarificationText.trim());
  }

  if (input.knownDraft) {
    sections.push(
      "",
      "Current extracted trip fields. Keep these unless the clarification clearly overrides them:",
      JSON.stringify(input.knownDraft, null, 2)
    );
  }

  if (input.knownItinerary?.days?.length) {
    sections.push(
      "",
      "Current imported itinerary draft. Preserve the existing sequence unless the clarification clearly changes it:",
      JSON.stringify(input.knownItinerary, null, 2)
    );
  }

  sections.push(
    "",
    "Return one complete updated extraction. Prefer preserving already-known values when the new clarification only fills gaps."
  );

  return sections.join("\n");
}

function normalizeTripIntake(value: Record<string, unknown>): TripIntakeParseResult {
  const draft = asRecord(value.draft);
  const derived = asRecord(value.derived);
  const itinerary = asRecord(value.itinerary);

  return {
    draft: {
      title: asOptionalString(draft?.title) ?? null,
      start_date: asOptionalDateString(draft?.start_date),
      end_date: asOptionalDateString(draft?.end_date),
      timezone: asOptionalString(draft?.timezone) ?? null,
      traveler_count: asOptionalWholeNumber(draft?.traveler_count),
    },
    derived: {
      duration_days: asOptionalWholeNumber(derived?.duration_days),
    },
    itinerary: {
      pace: asOptionalString(itinerary?.pace) ?? null,
      days: asDayArray(itinerary?.days),
    },
    summary: asOptionalString(value.summary) ?? null,
    warnings: asStringArray(value.warnings),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asOptionalDateString(value: unknown): string | null {
  const normalized = asOptionalString(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function asOptionalWholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asDayArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((day) => asRecord(day))
    .filter(Boolean)
    .map((day) => ({
      day_index: asOptionalWholeNumber(day?.day_index),
      date: asOptionalDateString(day?.date),
      label: asOptionalString(day?.label) ?? null,
      summary: asOptionalString(day?.summary) ?? null,
      items: asItemArray(day?.items),
    }));
}

function asItemArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .filter(Boolean)
    .map((item) => ({
      title: asOptionalString(item?.title) ?? null,
      kind: asOptionalString(item?.kind) ?? null,
      category: asOptionalString(item?.category) ?? null,
      start_time: asClockTime(item?.start_time),
      end_time: asClockTime(item?.end_time),
      duration_minutes: asOptionalWholeNumber(item?.duration_minutes),
      status: asOptionalString(item?.status) ?? null,
      locked: typeof item?.locked === "boolean" ? item.locked : null,
      subtitle: asOptionalString(item?.subtitle) ?? null,
      notes: asOptionalString(item?.notes) ?? null,
      tags: asStringArray(item?.tags),
    }));
}

function asClockTime(value: unknown): string | null {
  const normalized = asOptionalString(value);
  return normalized && /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : null;
}
