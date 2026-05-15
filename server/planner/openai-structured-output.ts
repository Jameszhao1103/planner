import { PlannerError } from "./errors.ts";

export function extractStructuredPayload(
  payload: unknown,
  messages: {
    missingPayload: string;
    invalidJson: string;
  }
): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    const candidate = payload as {
      output_parsed?: unknown;
      output_text?: unknown;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
          json?: unknown;
        }>;
      }>;
    };

    if (candidate.output_parsed && typeof candidate.output_parsed === "object") {
      return candidate.output_parsed as Record<string, unknown>;
    }

    if (typeof candidate.output_text === "string" && candidate.output_text.trim()) {
      return parseJsonPayload(candidate.output_text, messages.invalidJson);
    }

    if (Array.isArray(candidate.output)) {
      for (const block of candidate.output) {
        for (const content of block.content ?? []) {
          if (content?.json && typeof content.json === "object") {
            return content.json as Record<string, unknown>;
          }

          if (typeof content?.text === "string" && content.text.trim()) {
            return parseJsonPayload(content.text, messages.invalidJson);
          }
        }
      }
    }
  }

  throw new PlannerError("translator_unavailable", messages.missingPayload);
}

function parseJsonPayload(text: string, invalidJsonMessage: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Parsed payload was not an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new PlannerError("translator_unavailable", invalidJsonMessage, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (_error) {
    return "";
  }
}

export function nullableStringSchema() {
  return {
    anyOf: [{ type: "string" }, { type: "null" }],
  };
}

export function nullableNumberSchema() {
  return {
    anyOf: [{ type: "number" }, { type: "null" }],
  };
}

export function nullableBooleanSchema() {
  return {
    anyOf: [{ type: "boolean" }, { type: "null" }],
  };
}

export function nullableEnumSchema(values: string[]) {
  return {
    anyOf: [
      {
        type: "string",
        enum: values,
      },
      { type: "null" },
    ],
  };
}
