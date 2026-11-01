import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

// Chat sends by typing into the pane. With a harness menu open, typed text is
// taken as keys and can pick the menu's options, so Chat must never send then.

const menuScreen = readFileSync(
  new URL(
    "./fixtures/pending-prompts/menu-claude-permission-where.txt",
    import.meta.url,
  ),
  "utf8",
);
const promptScreen = ["❯ ", "──────", "  ? for shortcuts"].join("\n");

let root = "";
let transcript = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-world-send-menu-"));
  transcript = join(root, "demo.jsonl");
  await writeFile(
    transcript,
    `${JSON.stringify({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Tidy the README" },
    })}\n`,
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeHerdr() {
  const state = {
    status: "idle",
    screen: promptScreen,
    prompts: [] as string[],
  };
  const agent = () => ({
    pane_id: "w1:p1",
    agent: "claude",
    agent_status: state.status,
    state_change_seq: 3,
    terminal_title: "claude",
    agent_session: {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: transcript,
    },
  });
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get") return { agent: agent() };
    if (method === "pane.read")
      return { read: { pane_id: "w1:p1", text: state.screen } };
    if (method === "agent.prompt") {
      state.prompts.push(String((params as { text: string }).text));
      return { agent: agent() };
    }
    throw new Error(`unexpected ${method}`);
  };
  const source = createHerdrConversationSource({
    herdrCall: call,
    files: localAgentSessionFiles,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(localAgentSessionFiles),
  });
  return { state, source };
}

test("an open menu refuses a message and a command; nothing is typed", async () => {
  const { state, source } = fakeHerdr();
  const shown = await source.latest({ pane_id: "w1:p1" });
  const fingerprint = shown.session_fingerprint!;
  state.screen = menuScreen;
  for (const text of ["Please continue", "/permissions"]) {
    const result = await source.send({
      pane_id: "w1:p1",
      text,
      session_fingerprint: fingerprint,
    });
    expect(result).toMatchObject({ status: "refused", reason: "menu" });
    expect(result.status === "refused" && result.message).toContain(
      "Add allow permission rule",
    );
  }
  expect(state.prompts).toEqual([]);
  // Once the menu has closed, the same message goes.
  state.screen = promptScreen;
  expect(
    await source.send({
      pane_id: "w1:p1",
      text: "Please continue",
      session_fingerprint: fingerprint,
    }),
  ).toMatchObject({ status: "sent" });
  expect(state.prompts).toEqual(["Please continue"]);
  source.dispose();
});

test("a command queued while the agent is busy is not queued twice", async () => {
  const { state, source } = fakeHerdr();
  const fingerprint = (await source.latest({ pane_id: "w1:p1" }))
    .session_fingerprint!;
  state.status = "working";
  const send = (text: string) =>
    source.send({ pane_id: "w1:p1", text, session_fingerprint: fingerprint });
  expect(await send("/permissions")).toMatchObject({ status: "sent" });
  expect(await send("/permissions")).toMatchObject({
    status: "refused",
    reason: "duplicate",
  });
  // A different command, or a message, still queues.
  expect(await send("/model")).toMatchObject({ status: "sent" });
  // Once the agent is free, sending it again is the user's choice.
  state.status = "idle";
  expect(await send("/permissions")).toMatchObject({ status: "sent" });
  expect(state.prompts).toEqual(["/permissions", "/model", "/permissions"]);
  source.dispose();
});
