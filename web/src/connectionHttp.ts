import { type ConnectionClient, UncertainRequestError } from "./api";

/** Decode a resource only while its captured runtime lease remains admitted. */
export async function connectionHttpResource<T>(
  client: ConnectionClient,
  endpoint: string,
  decode: (response: Response) => Promise<T>,
  init?: RequestInit,
): Promise<T> {
  const assertCurrent = () => {
    if (client.serverRuntimeGeneration === null || !client.isCurrent()) {
      throw new Error("connection runtime generation is unavailable");
    }
  };
  assertCurrent();
  const path = connectionHttpPath(
    client.connectionId,
    endpoint,
    client.serverRuntimeGeneration,
  );
  const method = (init?.method ?? "GET").toUpperCase();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      redirect: "error",
    });
  } catch (error) {
    if (method !== "GET" && method !== "HEAD") {
      throw new UncertainRequestError(
        `HTTP ${method}`,
        error instanceof Error ? error.message : "resource request failed",
      );
    }
    throw error;
  }
  try {
    assertCurrent();
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  if (
    response.headers.get("X-Herdr-Connection-Id") !== client.connectionId ||
    response.headers.get("X-Herdr-Connection-Generation") !==
      String(client.serverRuntimeGeneration)
  ) {
    await response.body?.cancel();
    throw new Error("response connection identity mismatch");
  }
  if (!response.ok) {
    let message = `resource request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: unknown } | null;
      if (payload && typeof payload.error === "string" && payload.error)
        message = payload.error;
    } catch {
      // Preserve the status when its explanation cannot be decoded.
    }
    assertCurrent();
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      response.headers.get("X-Herdr-Request-Outcome") === "uncertain"
    ) {
      throw new UncertainRequestError(`HTTP ${method}`, message);
    }
    throw new Error(message);
  }
  let resource: T;
  try {
    resource = await decode(response);
  } catch (error) {
    if (method !== "GET" && method !== "HEAD") {
      throw new UncertainRequestError(
        `HTTP ${method}`,
        error instanceof Error
          ? error.message
          : "resource response interrupted",
      );
    }
    throw error;
  }
  assertCurrent();
  return resource;
}

export function connectionHttpPath(
  connectionId: string,
  endpoint: string,
  connectionGeneration?: number | null,
): string {
  if (!connectionId) throw new Error("invalid connection_id");
  const suffix = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const path = `/api/connections/${encodeURIComponent(connectionId)}${suffix}`;
  if (connectionGeneration === undefined || connectionGeneration === null) {
    return path;
  }
  if (!Number.isSafeInteger(connectionGeneration) || connectionGeneration < 0) {
    throw new Error("invalid connection_generation");
  }
  return `${path}${path.includes("?") ? "&" : "?"}connection_generation=${connectionGeneration}`;
}
