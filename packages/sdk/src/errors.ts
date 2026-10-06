/** Any non-2xx answer from Verid. `code` is the stable machine-readable error code (see the API docs). */
export class VeridError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "VeridError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** The list of rule problems, when a validator definition was rejected. */
  get validationErrors(): string[] {
    const d = this.details as { errors?: unknown } | undefined;
    return Array.isArray(d?.errors) ? d!.errors.map(String) : [];
  }
}

/** The network was unreachable, or timed out, on every attempt. */
export class VeridNetworkError extends Error {
  declare readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "VeridNetworkError";
    this.cause = cause;
  }
}
