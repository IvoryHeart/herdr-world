import { withBrowserDeadline } from "../../../web/src/browserChrome";

export class PreviewSessionDetachedError extends Error {
  constructor(sessionId: string) {
    super(`Preview CDP session detached: ${sessionId}`);
  }
}

// Only this browser fixture uses the client. A CSP-blocked canary frame can
// disappear between auto-attach setup replies and the continuation that resumes
// it. Retire its pending work from the detach event, never from an error string.
export function createPreviewCdp(send: (message: string) => void) {
  let id = 0;
  let closed = false;
  const sessions = new Map<string, boolean>();
  const pending = new Map<
    number,
    {
      sessionId?: string;
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }
  >();

  const cdp = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<any> => {
    if (closed) return Promise.reject(new Error("CDP connection closed"));
    if (sessionId && sessions.get(sessionId) === false)
      return Promise.reject(new PreviewSessionDetachedError(sessionId));
    const requestId = ++id;
    return withBrowserDeadline(
      new Promise((resolve, reject) => {
        pending.set(requestId, { sessionId, resolve, reject });
        send(JSON.stringify({ id: requestId, method, params, sessionId }));
      }),
      method,
    ).finally(() => pending.delete(requestId));
  };

  const receive = (message: any) => {
    if (message.method === "Target.attachedToTarget")
      sessions.set(message.params.sessionId, true);
    if (message.method === "Target.detachedFromTarget") {
      const sessionId = message.params.sessionId;
      sessions.set(sessionId, false);
      for (const [requestId, request] of pending) {
        if (request.sessionId !== sessionId) continue;
        pending.delete(requestId);
        request.reject(new PreviewSessionDetachedError(sessionId));
      }
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };

  const close = () => {
    closed = true;
    for (const request of pending.values())
      request.reject(new Error("CDP connection closed"));
    pending.clear();
  };

  return { cdp, receive, close };
}
