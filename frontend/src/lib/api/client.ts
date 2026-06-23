import type { ApiJson, ApiPrimitive } from "@/types/api";

const DEFAULT_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  readonly status: number;
  readonly details: ApiJson | undefined;

  constructor(message: string, status: number, details?: ApiJson) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export interface ApiRequestOptions<TBody extends ApiJson | undefined = undefined> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: TBody;
  query?: Record<string, ApiPrimitive | undefined>;
  timeoutMs?: number;
}

const apiBaseUrl = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").trim();

if (!apiBaseUrl) {
  throw new Error("Missing VITE_API_URL. Add it to frontend/.env.");
}

function buildUrl(path: string, query?: Record<string, ApiPrimitive | undefined>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isAbsoluteBase = /^https?:\/\//i.test(apiBaseUrl);
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = isAbsoluteBase
    ? new URL(`${new URL(apiBaseUrl).pathname.replace(/\/$/, "")}${normalizedPath}`, apiBaseUrl)
    : new URL(`${apiBaseUrl.replace(/\/$/, "")}${normalizedPath}`, origin);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

async function parseResponse(response: Response): Promise<ApiJson | undefined> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as ApiJson;
  } catch {
    return text;
  }
}

function getErrorMessage(payload: ApiJson | undefined, fallback: string) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const detail = payload.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      return "The request was not accepted by the server.";
    }
  }

  return fallback;
}

export async function apiRequest<TResponse, TBody extends ApiJson | undefined = undefined>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const payload = await parseResponse(response);

    if (!response.ok) {
      throw new ApiError(
        getErrorMessage(payload, `Request failed with status ${response.status}.`),
        response.status,
        payload,
      );
    }

    return payload as TResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The server took too long to respond. Please try again.", 408);
    }

    throw new ApiError("We could not reach EvolvED services. Check that the backend is running.", 0);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function apiBlobRequest<TBody extends ApiJson | undefined = undefined>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<Blob> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        Accept: "audio/mpeg",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await parseResponse(response);
      throw new ApiError(getErrorMessage(payload, `Request failed with status ${response.status}.`), response.status, payload);
    }

    return response.blob();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The server took too long to respond. Please try again.", 408);
    }

    throw new ApiError("We could not reach EvolvED services. Check that the backend is running.", 0);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
