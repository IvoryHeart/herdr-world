import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHerdrConversationSource } from "../../agent/herdr-conversation";
import { localAgentSessionFiles } from "../../agent/session-file-access";
import { createSessionProjectionCache } from "../../agent/session-projection-cache";
import { createAgentSessionResolverContext } from "../../agent/session-resolver";
import { openWorldLedger } from "../../storage/world-storage";
import { createAskRecipients } from "../ask-recipient";
import { askSessionFingerprint } from "../world-cli-actor";
import { createAnswerRecorder } from "../answer-record";
import { createAnswerDispatcher } from "../answer-dispatch";
import { ANSWER_DELIVERY_VERB } from "../ask-delivery-types";
import type { CliActor } from "../world-ledger";

/** Synthetic Herdr transport; production Chat, binding, dispatcher and worker. */
export async function productionAnswerFixture(
  root: string,
  hooks: {
    paneRead?(): Promise<void>;
    prompt?(text: string): Promise<void>;
    generation?: number;
  } = {},
) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, "fixture-session.jsonl");
  if (!existsSync(path))
    writeFileSync(
      path,
      [
        {
          type: "user",
          message: { role: "user", content: "Earlier fixture question" },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Earlier fixture answer" }],
          },
        },
      ]
        .map((entry) =>
          JSON.stringify({
            ...entry,
            timestamp: new Date(Date.now() - 60_000).toISOString(),
          }),
        )
        .join("\n") + "\n",
    );
  let now = 1000;
  let active = true;
  const clock = { now: () => now, monotonic: () => now };
  const scheduler = {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  };
  const storage = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "legacy.json") },
    { clock, scheduler },
  );
  const info = {
    pane_id: "w1:p1",
    terminal_id: "term-fixture",
    workspace_id: "w1",
    tab_id: "w1:t1",
    agent: "claude",
    agent_status: "idle",
    terminal_title: "Fixture",
    agent_session: {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: path,
    },
  };
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "pane.get") {
      await hooks.paneRead?.();
      return { pane: info };
    }
    if (method === "pane.process_info")
      return {
        process_info: { pane_id: info.pane_id, shell_pid: process.pid },
      };
    if (method === "notification.show") return { shown: true };
    if (method === "agent.get") return { agent: info };
    if (method === "agent.prompt") {
      await hooks.prompt?.(String(params.text));
      return { type: "agent_prompted", agent: info };
    }
    throw new Error(`Unexpected synthetic Herdr method ${method}`);
  };
  const conversation = createHerdrConversationSource({
    herdrCall: call,
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
  });
  const generation = hooks.generation ?? 1;
  const lease = {
    connectionId: "studio",
    generation,
    isCurrent: () => active,
    runtime: {
      sshHost: () => null,
      herdr: { call },
      agentSessions: { conversation },
    },
  };
  const recipients = createAskRecipients({
    connections: () => ({
      list: () => [{ id: "studio" }],
      readyRuntimeLease: (id) => (id === "studio" && active ? lease : null),
    }),
    clock,
    incarnation: storage.incarnation,
  });
  const record = createAnswerRecorder({
    ledger: () => storage.ledger,
    recipients,
    now: clock.now,
  });
  const dispatcher = createAnswerDispatcher({
    ledger: () => storage.ledger,
    effects: () => storage.effects,
    incarnation: storage.incarnation,
    recipients,
    clock,
    scheduler,
    changed() {},
    log: (message) => console.warn(message),
  });
  return {
    storage,
    dispatcher,
    info,
    clock,
    scheduler,
    lease,
    time(at: number) {
      now = at;
    },
    entry: async () =>
      (await storage.outbox.forRecord("q-native")).find(
        (entry) => entry.kind === ANSWER_DELIVERY_VERB.name,
      ),
    async seed() {
      if (!storage.ledger.ask("q-native")) {
        const actor: CliActor = {
          label: "Synthetic asker",
          verified: true,
          connection_id: "studio",
          connection_generation: generation,
          pane_id: info.pane_id,
          terminal_id: info.terminal_id,
          agent_session_fingerprint: askSessionFingerprint(info.agent_session),
        };
        const recipient = await recipients.capture(actor);
        if (!recipient)
          throw new Error(
            "Synthetic asking session could not be bound through production Chat",
          );
        await storage.ledger.update((doc) =>
          doc.asks.push({
            id: "q-native",
            at: now,
            actor,
            recipient,
            question: "Proceed with the fixture?",
            options: [],
            owner_only: true,
          }),
        );
      }
      if (!storage.ledger.ask("q-native")?.answer)
        await record("q-native", "Stored fixture answer", { kind: "owner" });
    },
    async stop() {
      await dispatcher.stop();
      active = false;
      conversation.dispose();
      await storage.close();
    },
  };
}
