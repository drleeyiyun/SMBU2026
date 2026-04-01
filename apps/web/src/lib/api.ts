/** API origin. Empty string = same origin (use Vite dev proxy in development). */
export function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? "";
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${apiBase()}${path}`;
  const headers = new Headers(init.headers);
  if (
    init.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
}

export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === "string") return data.error;
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}
