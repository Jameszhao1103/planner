export type PlannerErrorCode =
  | "trip_not_found"
  | "version_conflict"
  | "preview_not_found"
  | "invalid_request"
  | "request_too_large"
  | "invalid_command"
  | "command_not_supported"
  | "translator_unavailable"
  | "locked_item_violation";

export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  readonly details?: unknown;

  constructor(code: PlannerErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PlannerError";
    this.code = code;
    this.details = details;
  }
}
