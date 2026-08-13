export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);

/**
 * Deliberately identical shape for "you lack the permission" and "that record
 * belongs to a bank you cannot see". Returning 404 for out-of-scope records
 * would leak existence; a distinct message would leak which banks exist.
 */
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "forbidden", message);

export const notFound = (message = "Record not found") => new AppError(404, "not_found", message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "unprocessable_entity", message, details);

export const tooManyRequests = (message = "Too many attempts, try again later") =>
  new AppError(429, "too_many_requests", message);

export const internal = (message = "Unexpected server error") =>
  new AppError(500, "internal_error", message);
