import type { ConnectionClient } from "./api";
import { connectionHttpPath } from "./connectionHttp";

/**
 * Uploads an image through the connection's HTTP endpoint and returns the
 * server-side path as text ready to insert at a shell or agent prompt. The
 * server formats it because only the host knows its path conventions. Callers
 * decide when (or whether) that text reaches a terminal; uploading here never
 * writes to a PTY by itself.
 */
export async function uploadTerminalImage(
  client: ConnectionClient,
  file: File,
  onProgress?: UploadProgress,
): Promise<string> {
  const ext = (file.type.split("/")[1] || "png").toLowerCase();
  return uploadTerminalPayload(
    client,
    file,
    "/upload-image",
    {
      "x-image-ext": ext,
      "content-type": file.type || "image/png",
    },
    onProgress,
  );
}

export function uploadTerminalFile(
  client: ConnectionClient,
  file: File,
  onProgress?: UploadProgress,
): Promise<string> {
  return uploadTerminalPayload(
    client,
    file,
    "/terminal-upload",
    undefined,
    onProgress,
  );
}

/** Bytes of the request body sent so far, out of the file's size. */
export type UploadProgress = (loaded: number, total: number) => void;

/**
 * fetch cannot report how much of a request body has been sent, so a caller
 * that shows byte progress gets XMLHttpRequest, answered as a Response.
 */
function postWithProgress(
  url: URL,
  file: File,
  headers: Record<string, string> | undefined,
  onProgress: UploadProgress,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "blob";
    for (const [name, value] of Object.entries(headers ?? {}))
      xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) =>
      onProgress(
        event.loaded,
        event.lengthComputable ? event.total : file.size,
      );
    xhr.onload = () => {
      const replyHeaders = new Headers();
      for (const line of xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)) {
        const at = line.indexOf(":");
        if (at > 0)
          replyHeaders.append(
            line.slice(0, at).trim(),
            line.slice(at + 1).trim(),
          );
      }
      resolve(
        new Response(xhr.response as Blob | null, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: replyHeaders,
        }),
      );
    };
    xhr.onerror = () => reject(new TypeError("Upload failed: network error"));
    xhr.onabort = () => reject(new TypeError("Upload cancelled"));
    xhr.send(file);
  });
}

async function uploadTerminalPayload(
  client: ConnectionClient,
  file: File,
  endpoint: "/upload-image" | "/terminal-upload",
  headers?: Record<string, string>,
  onProgress?: UploadProgress,
): Promise<string> {
  if (!client.isCurrent()) throw new Error("connection changed during upload");
  const uploadUrl = new URL(
    connectionHttpPath(
      client.connectionId,
      endpoint,
      client.serverRuntimeGeneration,
    ),
    window.location.origin,
  );
  if (endpoint === "/terminal-upload") {
    uploadUrl.searchParams.set("filename", file.name);
  }
  if (uploadUrl.origin !== window.location.origin) {
    throw new Error("invalid upload origin");
  }
  const res = onProgress
    ? await postWithProgress(uploadUrl, file, headers, onProgress)
    : await fetch(uploadUrl, {
        method: "POST",
        headers,
        body: file,
      });
  if (!res.ok) {
    const body = (await res.text()).trim();
    if (!client.isCurrent()) {
      throw new Error("connection changed during upload");
    }
    let detail = body;
    if (body) {
      try {
        const payload: unknown = JSON.parse(body);
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const error = (payload as { error?: unknown }).error;
          if (typeof error === "string" && error) detail = error;
        }
      } catch {
        // Auth proxies and generic HTTP servers commonly return plain text or
        // HTML errors. The response is already a failure, so preserve its body.
      }
    }
    throw new Error(
      detail || res.statusText || `Upload failed (${res.status})`,
    );
  }

  const replyConnection = res.headers.get("X-Herdr-Connection-Id");
  const replyGeneration = res.headers.get("X-Herdr-Connection-Generation");
  if (
    replyConnection !== client.connectionId ||
    replyGeneration !== String(client.serverRuntimeGeneration)
  ) {
    await res.body?.cancel();
    throw new Error("response connection identity mismatch");
  }

  const data: unknown = await res.json();
  // Return successful paths even if navigation retired the client while the
  // response was in flight. The caller must guard delivery and retain failures.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("upload response was not an object");
  }
  const payload = data as { path?: unknown; text?: unknown };
  if (typeof payload.text === "string" && payload.text.length > 0) {
    return payload.text;
  }
  if (typeof payload.path !== "string" || payload.path.length === 0) {
    throw new Error("upload response did not include a path");
  }
  return payload.path;
}
