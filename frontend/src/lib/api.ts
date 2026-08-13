/**
 * The single path from the browser to the API.
 *
 * The access token is held in a module variable, never in localStorage. The
 * refresh token is an httpOnly cookie the browser sends automatically and JS
 * cannot read. A 401 triggers one refresh attempt and one replay; a second
 * failure signs the user out rather than looping.
 */

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const signOutListeners = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onForcedSignOut(listener: () => void): () => void {
  signOutListeners.add(listener);
  return () => signOutListeners.delete(listener);
}

function forceSignOut(): void {
  accessToken = null;
  signOutListeners.forEach((listener) => listener());
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the record is missing OR out of the caller's bank scope — the
   *  API deliberately does not distinguish the two. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let code = "request_failed";
  let message = response.statusText || "Request failed";
  let details: unknown;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(response.status, code, message, details);
}

async function refreshAccessToken(): Promise<string | null> {
  // Concurrent 401s must share one refresh, or they race and invalidate
  // each other's rotated token.
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Set for multipart uploads; the body is passed through untouched. */
  formData?: FormData;
  skipAuthRetry?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE_URL}/api${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (!options.formData && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const send = () =>
    fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      signal: options.signal,
      body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });

  let response = await send();

  if (response.status === 401 && !options.skipAuthRetry) {
    const token = await refreshAccessToken();
    if (!token) {
      forceSignOut();
      throw new ApiError(401, "unauthorized", "Your session has expired. Please sign in again.");
    }
    headers.Authorization = `Bearer ${token}`;
    response = await send();
    if (response.status === 401) {
      forceSignOut();
      throw new ApiError(401, "unauthorized", "Your session has expired. Please sign in again.");
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface Paginated<T> {
  data: T[];
  meta?: { page: number; pageSize: number; total: number; totalPages: number; scoped?: boolean };
}

export const api = {
  list: <T>(path: string, query?: RequestOptions["query"]) =>
    apiRequest<Paginated<T>>(path, { query }),
  get: <T>(path: string) => apiRequest<{ data: T }>(path),
  create: <T>(path: string, body: unknown) =>
    apiRequest<{ data: T }>(path, { method: "POST", body }),
  update: <T>(path: string, body: unknown) =>
    apiRequest<{ data: T }>(path, { method: "PATCH", body }),
  replace: <T>(path: string, body: unknown) =>
    apiRequest<{ data: T }>(path, { method: "PUT", body }),
  remove: (path: string) => apiRequest<void>(path, { method: "DELETE" }),
  action: <T>(path: string, body?: unknown) =>
    apiRequest<{ data: T }>(path, { method: "POST", body: body ?? {} }),
  upload: <T>(path: string, formData: FormData) =>
    apiRequest<{ data: T }>(path, { method: "POST", formData }),
};

/** Turns an unknown thrown value into something safe to show a user. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
