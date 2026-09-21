import { ApiError, type ProblemDetails } from "./errors";

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "";
let csrfToken: string | null =
  typeof document === "undefined"
    ? null
    : (document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("desk_csrf="))
        ?.split("=")[1] ?? null);

export function setCsrfToken(value: string | null) {
  csrfToken = value;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (
    csrfToken &&
    init.method &&
    !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())
  )
    headers.set("x-csrf-token", csrfToken);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: init.signal ?? controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json()) as
      T | ProblemDetails | { error?: string };
    if (!response.ok) {
      const record =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : {};
      if (typeof record.detail === "string")
        throw new ApiError(record as ProblemDetails);
      const detail =
        typeof record.error === "string" ? record.error : "Request failed.";
      throw new ApiError({
        type: "about:blank",
        title: "Request failed",
        status: response.status,
        detail,
        code: "REQUEST_FAILED",
      });
    }
    if (body && typeof body === "object" && "data" in body && "meta" in body) {
      const data = (body as { data: T }).data;
      if (
        data &&
        typeof data === "object" &&
        "csrfToken" in data &&
        typeof data.csrfToken === "string"
      )
        setCsrfToken(data.csrfToken);
      return data;
    }
    return body as T;
  } finally {
    window.clearTimeout(timeout);
  }
}
