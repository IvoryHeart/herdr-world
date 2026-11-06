import { expect, test } from "bun:test";
import { conversationRpc } from "./conversation-rpc";
import type { ConversationSource } from "./conversation";
import { createTrustPrompts, parseTrustPrompt } from "./trust-prompt";
import type { HerdrCall } from "./session-types";

// A synthetic folder-trust screen in Claude Code's layout: unnumbered
// choices, "No, exit" first under the cursor, and its confirm footer. The
// folder is a reserved example path.
const trustScreen = (cursor: "cancel" | "confirm" = "cancel") =>
  [
    "previous output",
    "────────────────────────────────────────────────────────",
    " Accessing workspace:",
    "",
    " /work/example",
    "",
    " Quick safety check: Is this a project you created or one you trust?",
    " (Like your own code, a well-known open source project, or work from",
    " your team). If not, take a moment to review what's in this folder first.",
    "",
    " Claude Code will be able to read, edit, and execute files here.",
    "",
    " Security guide",
    "",
    ` ${cursor === "cancel" ? "❯" : " "} No, exit`,
    ` ${cursor === "confirm" ? "❯" : " "} Yes, I trust this folder`,
    "",
    " Enter to confirm · Esc to cancel",
    "",
  ].join("\n");

test("only the complete trust question with one cursor is recognised", () => {
  expect(parseTrustPrompt(trustScreen())).toMatchObject({
    request: ["Accessing workspace:", "/work/example"],
    question: [
      "Quick safety check: Is this a project you created or one you trust?",
      "(Like your own code, a well-known open source project, or work from",
      "your team). If not, take a moment to review what's in this folder first.",
      "Claude Code will be able to read, edit, and execute files here.",
      "Security guide",
    ],
    options: [
      { label: "No, exit", choice: "cancel", cursor: true },
      { label: "Yes, I trust this folder", choice: "confirm", cursor: false },
    ],
  });
  for (const changed of [
    // Numbered rows, two cursors, no cursor, swapped order, unknown label.
    trustScreen().replace("❯ No, exit", "❯ 1. No, exit"),
    trustScreen().replace("  Yes, I", "❯ Yes, I"),
    trustScreen().replace("❯ No, exit", "  No, exit"),
    trustScreen()
      .replace("No, exit", "SWAP")
      .replace("Yes, I trust this folder", "No, exit")
      .replace("SWAP", "Yes, I trust this folder"),
    trustScreen().replace("Yes, I trust this folder", "Yes, always"),
    // Its footer replaced, cut off, or the question scrolled away.
    trustScreen().replace(
      "Enter to confirm · Esc to cancel",
      "Press Esc again to exit",
    ),
    trustScreen().replace(" Enter to confirm · Esc to cancel", ""),
    trustScreen().replace(/ Quick safety check:/u, " Something else:"),
    // A third row among the choices.
    trustScreen().replace("   Yes, I", "   Maybe\n   Yes, I"),
  ])
    expect(parseTrustPrompt(changed)).toBeNull();
});

function fakeHerdr() {
  const state = {
    session: null as null | Record<string, unknown>,
    agent: "claude",
    terminal: "t1",
    seq: 4,
    pid: 4242,
    group: 4242,
    pane: "w1:p1",
    revision: 1,
    title: "Claude",
    processes: null as unknown[] | null,
    failRead: false,
    onProcess: () => {},
    cursor: "cancel" as "cancel" | "confirm",
    screen: null as string | null,
    ignoreKeys: false,
    sent: [] as string[],
    /** Runs after each screen read, as a change racing the check. */
    onRead: () => {},
    /** Runs after each key, as Claude redrawing. */
    onKey: () => {},
  };
  const call: HerdrCall = async (method, params) => {
    const target = (params as { pane_id?: string; target?: string }) ?? {};
    if ((target.pane_id ?? target.target) !== "w1:p1")
      throw new Error("another pane");
    if (method === "agent.get")
      return {
        agent: {
          pane_id: state.pane,
          revision: state.revision,
          terminal_title: state.title,
          agent: state.agent,
          agent_status: "blocked",
          terminal_id: state.terminal,
          state_change_seq: state.seq,
          agent_session: state.session,
        },
      };
    if (method === "pane.process_info") {
      const result = {
        process_info: {
          foreground_process_group_id: state.group,
          foreground_processes: state.processes ?? [
            { pid: state.pid, name: "claude" },
          ],
        },
      };
      state.onProcess();
      return result;
    }
    if (method === "pane.read") {
      if (state.failRead) throw new Error("synthetic unreadable screen");
      const text = state.screen ?? trustScreen(state.cursor);
      state.onRead();
      return { read: { text } };
    }
    if (method === "pane.send_input") {
      const key = (params as { keys: string[] }).keys[0]!;
      state.sent.push(key);
      if (state.ignoreKeys) return {};
      if (key === "down") state.cursor = "confirm";
      if (key === "up") state.cursor = "cancel";
      if (key === "enter") {
        state.screen = "";
        state.session = { kind: "id", value: "synthetic-session" };
      }
      state.onKey();
      return {};
    }
    throw new Error(`unexpected ${method}`);
  };
  const agentInfo = async (paneId: string) =>
    ((await call("agent.get", { target: paneId })) as { agent: never }).agent;
  const active = new Set<string>();
  const trust = createTrustPrompts({
    herdrCall: call,
    agentInfo,
    active,
    delay: async () => {},
  });
  return {
    state,
    trust,
    active,
    another: () =>
      createTrustPrompts({
        herdrCall: call,
        agentInfo,
        active,
        delay: async () => {},
      }),
  };
}

const fingerprint = async (trust: ReturnType<typeof fakeHerdr>["trust"]) =>
  (await trust.read("w1:p1"))!.fingerprint;

test("the question is offered only to Claude with no session in a live process", async () => {
  const { state, trust } = fakeHerdr();
  expect(await trust.read("w1:p1")).toMatchObject({
    options: [
      { label: "No, exit", key: "cancel", cursor: true, number: "" },
      { label: "Yes, I trust this folder", key: "confirm", number: "" },
    ],
    trust: { cursor: "cancel" },
  });
  state.session = { kind: "id", value: "synthetic-session" };
  expect(await trust.read("w1:p1")).toBeNull();
  state.session = null;
  state.agent = "codex";
  expect(await trust.read("w1:p1")).toBeNull();
  state.agent = "claude";
  // A process replaced during the read does not own the question.
  state.onRead = () => {
    state.pid += 1;
  };
  expect(await trust.read("w1:p1")).toBeNull();
});

test("trusting moves the cursor, checks it moved, then confirms", async () => {
  const { state, trust } = fakeHerdr();
  const result = await trust.choose({
    pane_id: "w1:p1",
    prompt_fingerprint: await fingerprint(trust),
    choice: "confirm",
  });
  expect(result).toEqual({
    status: "sent",
    choice: "confirm",
    label: "Yes, I trust this folder",
    acknowledged: true,
  });
  expect(state.sent).toEqual(["down", "enter"]);
});

test("a choice already under the cursor is confirmed with Enter alone", async () => {
  const { state, trust } = fakeHerdr();
  const result = await trust.choose({
    pane_id: "w1:p1",
    prompt_fingerprint: await fingerprint(trust),
    choice: "cancel",
  });
  expect(result).toMatchObject({ status: "sent", label: "No, exit" });
  expect(state.sent).toEqual(["enter"]);
});

test("stale, unknown, raced and concurrent input sends nothing", async () => {
  const stale = fakeHerdr();
  const old = await fingerprint(stale.trust);
  stale.state.cursor = "confirm";
  expect(
    await stale.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: old,
      choice: "cancel",
    }),
  ).toMatchObject({ status: "refused", reason: "changed" });
  expect(
    await stale.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: await fingerprint(stale.trust),
      choice: "always",
    }),
  ).toMatchObject({ status: "refused", reason: "unknown_option" });
  expect(stale.state.sent).toEqual([]);

  // The session arrives after Chat showed the question.
  const arrived = fakeHerdr();
  const shown = await fingerprint(arrived.trust);
  arrived.state.session = { kind: "id", value: "synthetic-session" };
  expect(
    await arrived.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: shown,
      choice: "confirm",
    }),
  ).toMatchObject({ status: "refused", reason: "changed" });
  expect(arrived.state.sent).toEqual([]);

  // Herdr's record changes while Chat checks, just before the key.
  const raced = fakeHerdr();
  const before = await fingerprint(raced.trust);
  raced.state.onRead = () => {
    raced.state.seq += 1;
  };
  expect(
    await raced.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: before,
      choice: "cancel",
    }),
  ).toMatchObject({ status: "refused" });
  expect(raced.state.sent).toEqual([]);

  // Another input to this pane is in flight.
  const busy = fakeHerdr();
  busy.active.add("w1:p1");
  expect(
    await busy.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: await fingerprint(busy.trust),
      choice: "cancel",
    }),
  ).toMatchObject({ status: "refused", reason: "busy" });
  expect(busy.state.sent).toEqual([]);
});

test("after the arrow key, a new process, a new menu or no move refuses Enter", async () => {
  const replaced = fakeHerdr();
  const first = await fingerprint(replaced.trust);
  const realSend = replaced.state.sent;
  replaced.state.onRead = () => {
    if (realSend.includes("down")) replaced.state.pid = 9999;
  };
  expect(
    await replaced.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: first,
      choice: "confirm",
    }),
  ).toMatchObject({ status: "refused" });
  expect(replaced.state.sent).toEqual(["down"]);

  const redrawn = fakeHerdr();
  const shown = await fingerprint(redrawn.trust);
  // Another folder's question, drawn as the arrow key lands.
  redrawn.state.onKey = () => {
    redrawn.state.screen = trustScreen("confirm").replace(
      "/work/example",
      "/work/other",
    );
  };
  expect(
    await redrawn.trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: shown,
      choice: "confirm",
    }),
  ).toMatchObject({ status: "refused" });
  expect(redrawn.state.sent).toEqual(["down"]);

  const ignored = fakeHerdr();
  ignored.state.ignoreKeys = true;
  const result = await ignored.trust.choose({
    pane_id: "w1:p1",
    prompt_fingerprint: await fingerprint(ignored.trust),
    choice: "confirm",
  });
  expect(result).toMatchObject({ status: "refused" });
  expect(result.status === "refused" && result.message).toContain(
    "did not move",
  );
  expect(ignored.state.sent).toEqual(["down"]);
});

test("the trust method reaches only a source that offers it", async () => {
  const seen: unknown[] = [];
  const source = {
    trust: async (target: unknown) => {
      seen.push(target);
      return { status: "sent", choice: "cancel", label: "No, exit" };
    },
  } as unknown as ConversationSource;
  await conversationRpc(
    "agent_conversation.trust",
    { pane_id: "w1:p1", prompt_fingerprint: "abc", choice: "cancel" },
    source,
  );
  expect(seen).toEqual([
    { pane_id: "w1:p1", prompt_fingerprint: "abc", choice: "cancel" },
  ]);
  expect(
    await conversationRpc(
      "agent_conversation.trust",
      { pane_id: "w1:p1", prompt_fingerprint: "abc", choice: "cancel" },
      {} as ConversationSource,
    ),
  ).toMatchObject({ status: "refused" });
});

test("every pre-session authority field revokes stale choices before input", async () => {
  const mutations: ((state: ReturnType<typeof fakeHerdr>["state"]) => void)[] =
    [
      (s) => {
        s.session = { value: "arrived" };
      },
      (s) => {
        s.agent = "codex";
      },
      (s) => {
        s.terminal = "replacement";
      },
      (s) => {
        s.pane = "w2:p2";
      },
      (s) => {
        s.pid += 1;
      },
      (s) => {
        s.group += 1;
      },
      (s) => {
        s.processes = [];
      },
      (s) => {
        s.processes = [{ pid: 1, name: "claude" }];
      },
      (s) => {
        s.processes = [{ pid: 4242, name: "claude" }, null];
      },
      (s) => {
        s.group = 0;
      },
      (s) => {
        s.screen = trustScreen().replace("/work/example", "/work/other");
      },
      (s) => {
        s.screen = "Quick safety check:";
      },
    ];
  for (const mutate of mutations) {
    const { state, trust } = fakeHerdr();
    const shown = await fingerprint(trust);
    mutate(state);
    expect(
      await trust.choose({
        pane_id: "w1:p1",
        prompt_fingerprint: shown,
        choice: "confirm",
      }),
    ).toMatchObject({ status: "refused" });
    expect(state.sent).toEqual([]);
  }
});

test("replacement, session arrival and record races during final reads refuse each key", async () => {
  const mutations: ((state: ReturnType<typeof fakeHerdr>["state"]) => void)[] =
    [
      (s) => {
        s.pid += 1;
      },
      (s) => {
        s.group += 1;
      },
      (s) => {
        s.terminal = "replaced";
      },
      (s) => {
        s.session = { value: "arrived" };
      },
      (s) => {
        s.agent = "codex";
      },
      (s) => {
        s.seq += 1;
      },
      (s) => {
        s.revision += 1;
      },
      (s) => {
        s.title = "replaced";
      },
      (s) => {
        s.pane = "w2:p2";
      },
    ];
  for (const mutate of mutations)
    for (const afterArrow of [false, true]) {
      const { state, trust } = fakeHerdr();
      const shown = await fingerprint(trust);
      let reads = 0;
      state.onRead = () => {
        reads += 1;
        // First send checks the second read; Enter checks the fourth.
        if (reads === (afterArrow ? 4 : 2)) mutate(state);
      };
      expect(
        await trust.choose({
          pane_id: "w1:p1",
          prompt_fingerprint: shown,
          choice: "confirm",
        }),
      ).toMatchObject({ status: "refused" });
      expect(state.sent).toEqual(afterArrow ? ["down"] : []);
    }
});

test("runtime replay, disposed sources and unreadable screens cannot send", async () => {
  const { state, trust, another, active } = fakeHerdr();
  const shown = await fingerprint(trust);
  expect(
    await another().choose({
      pane_id: "w1:p1",
      prompt_fingerprint: shown,
      choice: "cancel",
    }),
  ).toMatchObject({ status: "refused" });
  state.failRead = true;
  expect(
    await trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: shown,
      choice: "cancel",
    }),
  ).toMatchObject({ status: "refused" });
  expect(active.size).toBe(0);
  state.failRead = false;
  trust.close();
  expect(await trust.read("w1:p1")).toBeNull();
  expect(
    await trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: shown,
      choice: "cancel",
    }),
  ).toMatchObject({ status: "refused" });
  expect(state.sent).toEqual([]);
});

test("a real concurrent trust choice is refused while the input lock is held", async () => {
  const { state, trust } = fakeHerdr();
  const shown = await fingerprint(trust);
  const entered = Promise.withResolvers<void>();
  state.onProcess = () => {
    entered.resolve();
  };
  // The first request yields while reading its process witness; a second
  // request must be refused before the first completes.
  const first = trust.choose({
    pane_id: "w1:p1",
    prompt_fingerprint: shown,
    choice: "cancel",
  });
  await entered.promise;
  expect(
    await trust.choose({
      pane_id: "w1:p1",
      prompt_fingerprint: shown,
      choice: "confirm",
    }),
  ).toMatchObject({ status: "refused", reason: "busy" });
  expect(await first).toMatchObject({ status: "sent" });
  expect(state.sent).toEqual(["enter"]);
});
