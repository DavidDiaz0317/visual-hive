import type { ApiResult, Snapshot } from "../types/controlPlane";

export function getConnectionFromLocation(): string | undefined {
  const connection = new URLSearchParams(window.location.search).get("connection");
  return connection || undefined;
}

export function apiUrl(path: string, connection?: string): string {
  const url = new URL(path, window.location.origin);
  if (connection) {
    url.searchParams.set("connection", connection);
  }
  return `${url.pathname}${url.search}`;
}

export function artifactUrl(path: string, kind: "file" | "image" = "file", connection?: string): string {
  const url = new URL(kind === "image" ? "/api/image" : "/api/file", window.location.origin);
  url.searchParams.set("path", path);
  if (connection) {
    url.searchParams.set("connection", connection);
  }
  return `${url.pathname}${url.search}`;
}

export async function fetchSnapshot(connection?: string): Promise<Snapshot> {
  return readJson<Snapshot>(apiUrl("/api/snapshot", connection));
}

export async function postJson<T extends ApiResult>(path: string, body: Record<string, unknown>, connection?: string): Promise<T> {
  const response = await fetch(apiUrl(path, connection), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    throw new Error(String(payload.error ?? text ?? `Request failed with ${response.status}`));
  }
  return payload;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}
