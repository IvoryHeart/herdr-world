import type { ConnectionClient } from "./api";
import type { Notice } from "./store/types";
import { terminalComposerRequest } from "./terminalComposer";

// Testing only: refuse these sends without touching a runtime. Remove the
// switch immediately; reloading the cleaned URL restores normal delivery.
const previewRefusal = (() => {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const enabled = url.searchParams.get("agentInputGuard") === "refused";
  if (url.searchParams.has("agentInputGuard")) {
    url.searchParams.delete("agentInputGuard");
    window.history.replaceState(window.history.state, "", url);
  }
  return enabled;
})();

/** @internal Request builder exported for dispatcher conformance tests. */
export function agentInputRequest(
  paneId: string,
  text: string,
  submit: boolean,
) {
  const request = terminalComposerRequest(paneId, text, submit);
  return { ...request, params: { ...request.params, agent_input: true } };
}

export async function sendAgentInput(
  client: ConnectionClient,
  paneId: string,
  text: string,
  submit: boolean,
) {
  if (!client.isCurrent())
    throw new Error("This agent's host changed; refresh before replying.");
  if (previewRefusal)
    throw new Error(
      "The agent isn't running in that terminal any more; it's a shell now. Nothing was sent.",
    );
  const request = agentInputRequest(paneId, text, submit);
  await client.call(request.method, request.params);
}

/** Preserve the exact unsent text for recovery, without retrying input. */
export function agentInputFailureNotice(text: string, error: unknown): Notice {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "error",
    message: "Not sent",
    detail: message.replace(
      /^(?:agent_not_ready|agent_input_unavailable):\s*/,
      "",
    ),
    actionLabel: "Copy",
    actionClipboardText: text,
  };
}
