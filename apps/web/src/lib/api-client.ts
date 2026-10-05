import type { ApiFailure, ApiFieldError, ApiResponse, ErrorCode, PaginationMeta } from "@booking/shared";
import { publicEnv } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly errors: ApiFieldError[] = [],
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Multipart upload; the browser sets the Content-Type boundary. */
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Supabase access token; attached as a Bearer token. */
  accessToken?: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta;
  message?: string;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`/api/v1${path.startsWith("/") ? path : `/${path}`}`, publicEnv.NEXT_PUBLIC_API_URL);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Typed fetch wrapper for the Express API. Unwraps the { success, data }
 * envelope and throws ApiError for every failure so TanStack Query surfaces
 * it through `error`.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.formData ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "SERVICE_UNAVAILABLE", "Unable to reach the server. Check your connection.");
  }

  if (res.status === 204) return { data: undefined as T };

  let payload: ApiResponse<T> | undefined;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    payload = undefined;
  }

  if (!res.ok || !payload || !payload.success) {
    const failure = payload && !payload.success ? (payload as ApiFailure) : undefined;
    throw new ApiError(
      res.status,
      failure?.code ?? "INTERNAL_ERROR",
      failure?.message ?? `Request failed with status ${res.status}`,
      failure?.errors ?? [],
      failure?.requestId,
      failure?.details,
    );
  }
  return { data: payload.data, meta: payload.meta, message: payload.message };
}
