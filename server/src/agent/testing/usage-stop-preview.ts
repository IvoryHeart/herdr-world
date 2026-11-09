/** Testing-only preview; no Herdr runtime, real transcripts or World server. */
import { createHerdrConversationSource } from "../herdr-conversation";
import type { AgentSessionFileAccess } from "../session-file-access";
import { createSessionProjectionCache } from "../session-projection-cache";
import { createAgentSessionResolverContext } from "../session-resolver";

const page = `<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Usage-stop rewrite preview</title>
<style>body{font:18px system-ui;max-width:48rem;margin:2rem auto;padding:1rem}
button{font:inherit;margin:.3rem;padding:.6rem}pre{white-space:pre-wrap}</style>
<h1>Usage-stop rewrite preview</h1>
<p>Synthetic Claude transcript with constant file size, identity and timestamps.
The buttons call the real conversation source and projection cache.</p>
<p>Click Read Chat to cache a future stop, then Rewrite with expired reset.
Read quests and Chat again: both usage stops should be null.</p>
<button data-path="chat">Read Chat</button>
<button data-path="quests">Read quests</button>
<button data-path="rewrite" data-write>Rewrite with expired reset</button>
<button data-path="active" data-write>Restore future reset</button>
<pre aria-live="polite" id="result">Ready. Click Read Chat.</pre>
<script>
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-path]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch("/" + button.dataset.path, {
      method: button.hasAttribute("data-write") ? "POST" : "GET"
    });
    document.getElementById("result").textContent =
      JSON.stringify(await response.json(), null, 2);
  } catch (error) {
    document.getElementById("result").textContent = String(error);
  } finally { button.disabled = false; }
});
</script></html>`;

export function createUsageStopPreview() {
  const now = Math.floor(Date.now() / 1000);
  const path = "/synthetic/usage-stop-session.jsonl";
  const refusal = (resetsAt: number) =>
    `${JSON.stringify({
      type: "assistant",
      timestamp: new Date(now * 1000).toISOString(),
      isApiErrorMessage: true,
      error: "rate_limit",
      apiError: "usage_limit_reached",
      apiErrorParams: { rate_limit_info: { resetsAt } },
      message: {
        model: "<synthetic>",
        content: [{ type: "text", text: "SYNTHETIC" }],
      },
    })}\n`;
  const active = refusal(now + 3600);
  const expired = refusal(now - 7200);
  let text = active;
  const file = {
    path,
    mtimeMs: now * 1000,
    size: Buffer.byteLength(active),
    identity: "synthetic",
    changeToken: "unchanged",
  };
  const files: AgentSessionFileAccess = {
    remote: false,
    async statFile() {
      return { ...file };
    },
    async readText() {
      return text;
    },
    async readPrefix(_path, limit) {
      return Buffer.from(text).subarray(0, limit);
    },
    async readDownloadBody() {
      return text;
    },
    async findPiSessionById() {
      return null;
    },
    async findCodexSessionById() {
      return null;
    },
    async findCodexSessionByPrefix() {
      return null;
    },
  };
  const agent = {
    pane_id: "preview:pane",
    workspace_id: "preview",
    tab_id: "preview:tab",
    agent: "claude",
    agent_status: "done",
    cwd: "/synthetic",
    agent_session: {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: path,
    },
  };
  const chat = createHerdrConversationSource({
    files,
    cache: createSessionProjectionCache(files),
    context: createAgentSessionResolverContext(),
    async herdrCall(method) {
      if (method === "agent.get") return { agent };
      if (method === "agent.list") return { agents: [agent] };
      if (method === "pane.read") return { read: { text: "❯ " } };
      throw new Error(`Unexpected preview call: ${method}`);
    },
  });
  return async (request: Request) => {
    const route = new URL(request.url).pathname;
    if (request.method === "GET" && route === "/")
      return new Response(page, { headers: { "Content-Type": "text/html" } });
    if (request.method === "POST" && ["/rewrite", "/active"].includes(route)) {
      text = route === "/rewrite" ? expired : active;
      return Response.json({
        transcript: route === "/rewrite" ? "expired" : "active",
        metadata: file,
      });
    }
    if (request.method === "GET" && route === "/chat") {
      const conversation = await chat.read({ pane_id: agent.pane_id });
      return Response.json({
        read: "Chat",
        status: conversation.status,
        usage_stop: conversation.usage_stop,
      });
    }
    if (request.method === "GET" && route === "/quests") {
      const quests = await chat.quests();
      return Response.json({
        read: "quests",
        usage_stop: quests[0]?.usage_stop,
      });
    }
    return new Response("Not found", { status: 404 });
  };
}

if (import.meta.main) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createUsageStopPreview(),
  });
  console.info(`Usage-stop preview: ${server.url}`);
}
