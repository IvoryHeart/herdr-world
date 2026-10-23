import { expect, test } from "bun:test";
import type { ConnectionClient } from "../api";
import type { AgentQuest, Quest } from "../../../server/src/agent/quest";
import { AgentQuestReads } from "./agentQuests";
import type { WorldLeafObject } from "./worldObject";

const quest = (title: string): Quest => ({
  quest_version: 1,
  source: "todo",
  tool: "TodoWrite",
  title,
  status: "active",
  steps: [],
  progress: { done: 0, total: 1 },
  started_at: "2026-10-22T10:00:00.000Z",
  updated_at: "2026-10-22T10:00:01.000Z",
  set_by: null,
  helpers: 0,
});

const leaf = (session?: string) =>
  ({
    id: "leaf-1",
    kind: "agent",
    connectionId: "example",
    generation: 1,
    status: "idle",
    pane: { pane_id: "w1:p1" },
    agentSessionFingerprint: session,
  }) as unknown as WorldLeafObject;

const entry = (
  fields: Partial<AgentQuest> & Pick<AgentQuest, "quest">,
): AgentQuest => ({
  pane_id: "w1:p1",
  agent: "claude",
  session_binding: "reported",
  session_fingerprint: "session-a",
  ...fields,
});

/** A client whose answers the test hands out, one call at a time. */
function fakeClient() {
  const pending: ((reply: unknown) => void)[] = [];
  const failures: (() => void)[] = [];
  const client = {
    connectionId: "example",
    generation: 1,
    isCurrent: () => true,
    call: () =>
      new Promise((resolve, reject) => {
        pending.push(resolve);
        failures.push(() => reject(new Error("offline")));
      }),
  } as unknown as ConnectionClient;
  return { client, pending, failures };
}

const titleOf = (reads: AgentQuestReads) =>
  reads.quests().get("leaf-1")?.title ?? null;

test("an older read that answers last does not replace a newer one", async () => {
  const { client, pending } = fakeClient();
  const reads = new AgentQuestReads(() => client);
  const older = reads.read([leaf("L1")]);
  const newer = reads.read([leaf("L1")]);
  pending[1]!({ quests: [entry({ quest: quest("Newer") })] });
  expect(await newer).toEqual({ changed: true, working: false });
  expect(titleOf(reads)).toBe("Newer");
  pending[0]!({ quests: [entry({ quest: quest("Older") })] });
  expect(await older).toBeNull();
  expect(titleOf(reads)).toBe("Newer");
});

test("a failed read keeps the last quest only for the same session", async () => {
  const { client, pending, failures } = fakeClient();
  const reads = new AgentQuestReads(() => client);
  const answer = async (
    shown: WorldLeafObject,
    settle: (index: number) => void,
  ) => {
    const read = reads.read([shown]);
    settle(pending.length - 1);
    await read;
    return titleOf(reads);
  };
  const first = await answer(leaf("L1"), (index) =>
    pending[index]!({ quests: [entry({ quest: quest("Session A") })] }),
  );
  expect(first).toBe("Session A");

  // The transcript is unreadable for a moment; the service names the same
  // session, so the quest stays.
  expect(
    await answer(leaf("L1"), (index) =>
      pending[index]!({
        quests: [entry({ quest: null, read_failed: true })],
      }),
    ),
  ).toBe("Session A");

  // The connection fails outright; the World still shows the same session.
  expect(await answer(leaf("L1"), (index) => failures[index]!())).toBe(
    "Session A",
  );

  // The service reports another session in the pane: never keep A's quest.
  expect(
    await answer(leaf("L1"), (index) =>
      pending[index]!({
        quests: [
          entry({
            quest: null,
            read_failed: true,
            session_fingerprint: "session-b",
          }),
        ],
      }),
    ),
  ).toBeNull();
});

test("a pane reused by another session drops the last quest on failure", async () => {
  const { client, pending, failures } = fakeClient();
  const reads = new AgentQuestReads(() => client);
  let read = reads.read([leaf("L1")]);
  pending[0]!({ quests: [entry({ quest: quest("Session A") })] });
  await read;
  expect(titleOf(reads)).toBe("Session A");
  // The World now sees another session in the pane and the read fails.
  read = reads.read([leaf("L2")]);
  failures[1]!();
  await read;
  expect(titleOf(reads)).toBeNull();
});

test("without a session fingerprint a failed read keeps nothing", async () => {
  const { client, pending, failures } = fakeClient();
  const reads = new AgentQuestReads(() => client);
  let read = reads.read([leaf()]);
  pending[0]!({
    quests: [entry({ quest: quest("Unbound"), session_fingerprint: null })],
  });
  await read;
  expect(titleOf(reads)).toBe("Unbound");
  read = reads.read([leaf()]);
  failures[1]!();
  await read;
  expect(titleOf(reads)).toBeNull();
});
