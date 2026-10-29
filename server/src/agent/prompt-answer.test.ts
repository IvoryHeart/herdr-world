import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createPromptAnswerer } from "./prompt-answer";
import { parsePendingPrompt } from "./pending-prompt";
import { conversationRpc } from "./conversation-rpc";
import type { ConversationSource } from "./conversation";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/pending-prompts/${name}.txt`, import.meta.url),
    "utf8",
  );
function harness(name = "claude-question") {
  const agent = name.startsWith("codex") ? "codex" : "claude";
  const state = {
    agent,
    terminal: "terminal",
    screen: fixture(name),
    status: "blocked",
    session: "fixture",
    seq: 7,
    title: "Fixture title",
    onWait: () => {},
    onRead: () => {},
    onComposerRead: () => {},
    afterText: () => {},
  };
  const writes: { method: string; params: Record<string, unknown> }[] = [];
  const info = () => ({
    agent: state.agent,
    terminal_id: state.terminal,
    agent_status: state.status,
    agent_session: state.session,
    state_change_seq: state.seq,
    terminal_title: state.title,
  });
  const read = () => {
    const prompt = parsePendingPrompt(agent, state.screen, {
      session: state.session,
      seq: state.seq,
    });
    state.onRead();
    return prompt;
  };
  const answer = createPromptAnswerer({
    agentInfo: async () => info(),
    readPrompt: async () => read(),
    isCodexBound: async () => true,
    herdrCall: async (method, params = {}) => {
      if (method === "pane.read") {
        const text = state.screen;
        state.onComposerRead();
        return { read: { text } };
      }
      if (method === "pane.wait_for_output") {
        state.onWait();
        return {};
      }
      if (method === "agent.wait") {
        if (state.status === "blocked") throw new Error("timeout");
        return {};
      }
      writes.push({ method, params });
      if (
        method === "pane.send_input" &&
        (params.keys as string[] | undefined)?.[0] === "3"
      )
        state.screen = fixture(
          name === "claude-plan" ? "claude-plan-entry" : "claude-text-entry",
        );
      else if (
        method === "pane.send_input" &&
        (params.keys as string[] | undefined)?.[0] === "4"
      ) {
        state.screen = fixture("claude-composer-empty");
        state.status = "working";
      } else {
        state.status = "working";
        state.afterText();
      }
      return method === "agent.prompt"
        ? { agent: { pane_id: params.target } }
        : {};
    },
  });
  const submit = (key = "3", text: string | undefined = "Magenta fixture") =>
    answer({
      pane_id: "w1:p1",
      key,
      text,
      prompt_fingerprint: read()!.fingerprint,
    });
  return { state, writes, answer, read, submit };
}

test("Codex digit choices are logical keys rather than pasted notes", async () => {
  const h = harness("codex-question");
  expect(
    await h.answer({
      pane_id: "w1:p1",
      key: "2",
      prompt_fingerprint: h.read()!.fingerprint,
    }),
  ).toMatchObject({ status: "sent" });
  expect(h.writes).toEqual([
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p1", text: "", keys: ["2"] },
    },
  ]);
});

test("text answers select the option, verify the inline editor, and submit literal text", async () => {
  const h = harness();
  expect(await h.submit()).toMatchObject({
    status: "sent",
    acknowledged: true,
  });
  expect(h.writes).toEqual([
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p1", text: "", keys: ["3"] },
    },
    {
      method: "pane.send_input",
      params: { pane_id: "w1:p1", text: "Magenta fixture", keys: ["enter"] },
    },
  ]);
});
test("an already active native editor receives neither a menu digit nor text", async () => {
  for (const key of ["1", "3"]) {
    const h = harness("claude-text-entry");
    expect(
      await h.answer({
        pane_id: "w1:p1",
        key,
        prompt_fingerprint: h.read()!.fingerprint,
        ...(key === "3" ? { text: "Magenta fixture" } : {}),
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(h.writes).toEqual([]);
  }
});
test("a plan's feedback uses its verified inline editor", async () => {
  const h = harness("claude-plan");
  expect(await h.submit("3", "Use teal instead.")).toMatchObject({
    status: "sent",
    acknowledged: true,
  });
  expect(h.writes[1]!.params).toMatchObject({
    text: "Use teal instead.",
    keys: ["enter"],
  });
});
test("Chat about this submits through the normal prompt operation after the menu closes", async () => {
  const h = harness();
  h.state.afterText = () => {
    h.state.seq += 1;
  };
  expect(await h.submit("4", "Discuss a violet badge.")).toMatchObject({
    status: "sent",
    acknowledged: true,
  });
  expect(h.writes[1]).toEqual({
    method: "agent.prompt",
    params: { target: "w1:p1", text: "Discuss a violet badge." },
  });
});
test("invalid, missing and command-shaped text is refused before selecting anything", async () => {
  for (const text of [
    "",
    " ",
    "a\nb",
    "a\rb",
    "a\u001bb",
    "a\u2028b",
    "x".repeat(4001),
  ]) {
    const h = harness();
    expect(await h.submit("3", text)).toMatchObject({
      status: "refused",
      reason: "invalid_text",
    });
    expect(h.writes).toEqual([]);
  }
  for (const text of ["/clear", "! echo fixture", "# memory"]) {
    const h = harness();
    expect(await h.submit("4", text)).toMatchObject({
      status: "refused",
      reason: "invalid_text",
    });
    expect(h.writes).toEqual([]);
  }
  const h = harness();
  expect(
    await h.answer({
      pane_id: "w1:p1",
      key: "3",
      prompt_fingerprint: h.read()!.fingerprint,
    }),
  ).toMatchObject({ reason: "invalid_text" });
  expect(await h.submit("1", "extra")).toMatchObject({
    reason: "invalid_text",
  });
  expect(h.writes).toEqual([]);
});
test("a session, question or status replacement after selection receives no text", async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => {
      h.state.session = "replacement";
    },
    (h: ReturnType<typeof harness>) => {
      h.state.agent = "replacement";
    },
    (h: ReturnType<typeof harness>) => {
      h.state.terminal = "replacement";
    },
    (h: ReturnType<typeof harness>) => {
      h.state.screen = h.state.screen.replace("badge use?", "banner use?");
    },
    (h: ReturnType<typeof harness>) => {
      h.state.status = "working";
    },
  ]) {
    const h = harness();
    h.state.onWait = () => mutate(h);
    expect(await h.submit()).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(h.writes).toHaveLength(1);
  }
});
test("an editor read racing a state change is checked again before typing", async () => {
  const h = harness();
  h.state.onRead = () => {
    if (h.state.screen.includes("ctrl+g to edit")) h.state.seq += 1;
  };
  expect(await h.submit()).toMatchObject({
    status: "refused",
    reason: "changed",
  });
  expect(h.writes).toHaveLength(1);
});
test("an editor wait failure leaves the text unsent and releases answer admission", async () => {
  const h = harness();
  h.state.onWait = () => {
    throw new Error("timeout");
  };
  expect(await h.submit()).toMatchObject({
    status: "refused",
    reason: "changed",
  });
  expect(h.writes).toHaveLength(1);
  h.state.onWait = () => {};
  h.state.screen = fixture("claude-question");
  expect(await h.submit()).toMatchObject({ status: "sent" });
});
test("a fresh blocked question after Chat about this prevents discussion text", async () => {
  const h = harness();
  h.state.onWait = () => {
    h.state.status = "blocked";
  };
  expect(await h.submit("4", "Discuss a violet badge.")).toMatchObject({
    status: "refused",
    reason: "changed",
  });
  expect(h.writes).toHaveLength(1);
});
test("a native discussion draft appearing after selection is preserved", async () => {
  const h = harness();
  h.state.onWait = () => {
    h.state.screen = "❯ Native draft\n";
  };
  expect(await h.submit("4", "Discuss a violet badge.")).toMatchObject({
    status: "refused",
    reason: "changed",
  });
  expect(h.writes).toHaveLength(1);
});
test("text already being edited in the Terminal is preserved", async () => {
  const h = harness("claude-text-typed");
  expect(await h.submit()).toMatchObject({
    status: "refused",
    reason: "unknown_option",
  });
  expect(h.writes).toEqual([]);
});
test("an unchanged question after text submission remains unconfirmed", async () => {
  const h = harness();
  h.state.afterText = () => {
    h.state.status = "blocked";
  };
  expect(await h.submit()).toMatchObject({
    status: "sent",
    acknowledged: false,
    unconfirmed_reason: "still_showing",
  });
});
test("concurrent answers to one pane do not interleave, and the lock is released", async () => {
  const h = harness();
  const first = h.submit();
  expect(await h.submit()).toMatchObject({ status: "refused", reason: "busy" });
  await first;
  expect(await h.submit()).toMatchObject({
    status: "refused",
    reason: "not_blocked",
  });
});
test("the RPC preserves text and refuses a non-string value rather than treating it as a digit-only choice", async () => {
  const h = harness();
  const source = { answer: h.answer } as ConversationSource;
  expect(
    await conversationRpc(
      "agent_conversation.answer",
      {
        pane_id: "w1:p1",
        key: "3",
        text: { bad: true },
        prompt_fingerprint: h.read()!.fingerprint,
      },
      source,
    ),
  ).toMatchObject({ reason: "invalid_text" });
  expect(h.writes).toEqual([]);
  expect(
    await conversationRpc(
      "agent_conversation.answer",
      {
        pane_id: "w1:p1",
        key: "3",
        text: "Magenta fixture",
        prompt_fingerprint: h.read()!.fingerprint,
      },
      source,
    ),
  ).toMatchObject({ status: "sent" });
});

test("discussion checks the complete native composer rather than its first row", async () => {
  const empty = fixture("claude-chat-typed").replace(/❯[^\n]*/, "❯");
  const lines = empty.trimEnd().split("\n");
  for (const screen of [
    fixture("claude-composer-multiline"),
    [
      ...lines.slice(0, 2),
      "  Keep this multiline native draft",
      ...lines.slice(2),
    ].join("\n"),
    "❯\n",
  ]) {
    const h = harness();
    h.state.onWait = () => {
      h.state.screen = screen;
    };
    expect(await h.submit("4", "A Chat reply")).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(h.writes).toHaveLength(1);
  }
});

test("discussion fences its screen read with unchanged sequence, title and status", async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => {
      h.state.seq += 1;
    },
    (h: ReturnType<typeof harness>) => {
      h.state.title = "New native turn";
    },
    (h: ReturnType<typeof harness>) => {
      h.state.status = "working";
    },
    (h: ReturnType<typeof harness>) => {
      h.state.seq += 1;
      h.state.status = "working";
    },
  ]) {
    const h = harness();
    h.state.onWait = () => {
      h.state.status = "idle";
    };
    h.state.onComposerRead = () => change(h);
    expect(await h.submit("4", "A Chat reply")).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(h.writes).toHaveLength(1);
  }
});

test("a successful discussion write without subsequent progress is unconfirmed", async () => {
  for (const status of ["idle", "working"]) {
    const h = harness();
    h.state.onWait = () => {
      h.state.status = status;
    };
    h.state.afterText = () => {
      h.state.status = status;
    };
    expect(await h.submit("4", "A Chat reply")).toMatchObject({
      status: "sent",
      acknowledged: false,
      unconfirmed_reason: "no_progress",
    });
  }
});

test("discussion acknowledgement needs a new working sequence after the reply", async () => {
  const h = harness();
  h.state.onWait = () => {
    h.state.status = "idle";
  };
  h.state.afterText = () => {
    h.state.seq += 1;
  };
  expect(await h.submit("4", "A Chat reply")).toMatchObject({
    status: "sent",
    acknowledged: true,
  });
});

test("prefix-shaped native drafts receive no menu digit or appended Chat text", async () => {
  const existing = harness("claude-text-entry");
  existing.state.screen = existing.state.screen.replace(
    "Type something.",
    "Chat about this later",
  );
  expect(
    await existing.answer({
      pane_id: "w1:p1",
      key: "1",
      prompt_fingerprint: existing.read()!.fingerprint,
    }),
  ).toMatchObject({ status: "refused" });
  expect(existing.writes).toEqual([]);
  for (const draft of [
    "Type something. Keep this native draft",
    "Tell Claude what to change instead",
  ]) {
    const h = harness();
    h.state.onWait = () => {
      h.state.screen = h.state.screen.replace("Type something.", draft);
    };
    expect(await h.submit()).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    expect(h.writes).toHaveLength(1);
  }
});
