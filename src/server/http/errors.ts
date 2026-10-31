// Stable error codes returned by the API. Messages are safe to show to users.
export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "revision_conflict"
  | "rate_limited"
  | "provider_not_configured"
  | "provider_error"
  | "payload_too_large"
  | "unavailable"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  revision_conflict: 409,
  rate_limited: 429,
  provider_not_configured: 424,
  provider_error: 502,
  payload_too_large: 413,
  unavailable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Resource") => new ApiError("not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do this") => new ApiError("forbidden", msg);
