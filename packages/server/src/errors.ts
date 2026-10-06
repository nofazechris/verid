/** Stable, machine-readable API error codes. Clients may branch on these. */
export type ErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "email_not_verified"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "idempotency_conflict"
  | "payload_too_large"
  | "rate_limited"
  | "unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  email_not_verified: 403,
  not_found: 404,
  conflict: 409,
  invalid_state: 409,
  idempotency_conflict: 422,
  payload_too_large: 413,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown, readonly headers?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new ApiError("not_found", `${what} not found`);
