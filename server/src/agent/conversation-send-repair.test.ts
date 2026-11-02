// Safety and lifecycle boundaries of Chat's send admission, adopted from the
// independent #629 review (fake Herdr; no real harness): a failed, malformed,
// cut-off or stale observation, or a menu opened during preparation, never
// authorizes typing; identical commands are reserved once per session and
// busy interval, independent of dismissible receipts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrConversationSource } from "./herdr-conversation";
import { localAgentSessionFiles } from "./session-file-access";
import { createSessionProjectionCache } from "./session-projection-cache";
import { createAgentSessionResolverContext } from "./session-resolver";
import type { HerdrCall } from "./session-types";

const prompt = ["❯ ", "──────", "  ? for shortcuts"].join("\n");
let root = "";
let transcript = "";
let quotedTranscript = "";
const footerQuote = "Press Enter to submit and Escape to cancel";
const permissionMenu = readFileSync(
  new URL(
    "./fixtures/pending-prompts/menu-claude-permission-where.txt",
    import.meta.url,
  ),
  "utf8",
);
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "review-629-"));
  transcript = join(root, "first.jsonl");
  const line =
    JSON.stringify({
      type: "user",
      timestamp: "2026-10-01T00:00:00Z",
      message: { role: "user", content: "Tidy the README" },
    }) + "\n";
  await writeFile(transcript, line);
  quotedTranscript = join(root, "quoted.jsonl");
  await writeFile(
    quotedTranscript,
    line +
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-01T00:00:01Z",
        message: { role: "assistant", content: footerQuote },
      }) +
      "\n",
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function setup(remote = false) {
  const state = {
    status: "idle",
    terminal: "terminal-a",
    seq: 3,
    afterScreen: () => {},
    screen: prompt,
    file: transcript,
    readFails: false,
    readMalformed: false,
    loseAck: false,
    badNextInfo: false,
    rejectNextPrompt: "",
    holdNextInfo: false,
    infoGate: Promise.resolve() as Promise<void>,
    infoStarted: () => {},
    prompts: [] as string[],
  };
  const agent = () => ({
    pane_id: "w1:p1",
    agent: "claude",
    agent_status: state.status,
    state_change_seq: state.seq,
    terminal_id: state.terminal,
    terminal_title: "claude",
    agent_session: {
      source: "herdr:claude",
      agent: "claude",
      kind: "path",
      value: state.file,
    },
  });
  const call: HerdrCall = async (method, params) => {
    if (method === "agent.get") {
      if (state.badNextInfo) {
        state.badNextInfo = false;
        return {};
      }
      const info = agent();
      if (state.holdNextInfo) {
        state.holdNextInfo = false;
        state.infoStarted();
        await state.infoGate;
      }
      return { agent: info };
    }
    if (method === "pane.read") {
      if (state.readFails) throw new Error("synthetic pane read failure");
      const result = state.readMalformed
        ? { read: {} }
        : { read: { pane_id: "w1:p1", text: state.screen } };
      state.afterScreen();
      return result;
    }
    if (method === "agent.prompt") {
      if (state.rejectNextPrompt) {
        const error = state.rejectNextPrompt;
        state.rejectNextPrompt = "";
        throw new Error(error);
      }
      state.prompts.push(String((params as { text: string }).text));
      if (state.loseAck) {
        state.loseAck = false;
        throw new Error("synthetic lost prompt acknowledgement");
      }
      return { agent: agent() };
    }
    throw new Error(`unexpected ${method}`);
  };
  const files = { ...localAgentSessionFiles, remote };
  const source = createHerdrConversationSource({
    herdrCall: call,
    files,
    context: createAgentSessionResolverContext(),
    cache: createSessionProjectionCache(files),
  });
  return { source, state };
}

test("review repair: a malformed observation must not retire a live reservation", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    expect((await send()).status).toBe("sent");
    state.badNextInfo = true;
    const result = await send();
    expect(result).toMatchObject({ status: "refused", reason: "duplicate" });
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    source.dispose();
  }
});

test("review repair: an idle read started before admission cannot clear the queued command", async () => {
  const { source, state } = setup();
  let release = () => {};
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    const started = Promise.withResolvers<void>();
    state.holdNextInfo = true;
    state.infoGate = new Promise<void>((r) => {
      release = r;
    });
    state.infoStarted = () => started.resolve();
    const oldRead = source.latest({ pane_id: "w1:p1" });
    await started.promise;
    state.status = "working";
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    expect((await send()).status).toBe("sent");
    release();
    const old = await oldRead;
    expect(old.deliveries?.[0]?.waiting).toBe(true);
    const result = await send();
    expect(result).toMatchObject({ status: "refused", reason: "duplicate" });
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    release();
    source.dispose();
  }
});

test("review repair: a definite native non-submission permits the same command to retry", async () => {
  const { source, state } = setup();
  try {
    const fp = (await source.latest({ pane_id: "w1:p1" })).session_fingerprint!;
    state.status = "working";
    state.rejectNextPrompt =
      "agent_not_ready: no longer the pane foreground process";
    const send = () =>
      source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
    await expect(send()).rejects.toThrow("agent_not_ready");
    expect(state.prompts).toEqual([]);
    const result = await send();
    expect(result.status).toBe("sent");
    expect(state.prompts).toEqual(["/permissions"]);
  } finally {
    source.dispose();
  }
});

for (const status of ["", "unknown", "blocked"]) {
  test(`an observed ${JSON.stringify(status)} state cannot retire a waiting command`, async () => {
    const { source, state } = setup();
    try {
      const fp = (await source.latest({ pane_id: "w1:p1" }))
        .session_fingerprint!;
      state.status = "working";
      await source.send({
        pane_id: "w1:p1",
        text: "/permissions",
        session_fingerprint: fp,
      });
      state.status = status;
      const shown = await source.latest({ pane_id: "w1:p1" });
      expect(shown.deliveries?.[0]?.waiting).toBe(true);
      expect(
        await source.send({
          pane_id: "w1:p1",
          text: "/permissions",
          session_fingerprint: fp,
        }),
      ).toMatchObject({ status: "refused", reason: "duplicate" });
      expect(state.prompts).toEqual(["/permissions"]);
    } finally {
      source.dispose();
    }
  });
}

for (const error of [
  "agent_not_found: no agent",
  "agent_blocked: question open",
]) {
  test(`a definite ${error.split(":")[0]} rejection releases its reservation`, async () => {
    const { source, state } = setup();
    try {
      const fp = (await source.latest({ pane_id: "w1:p1" }))
        .session_fingerprint!;
      state.status = "working";
      state.rejectNextPrompt = error;
      const send = () =>
        source.send({
          pane_id: "w1:p1",
          text: "/permissions",
          session_fingerprint: fp,
        });
      if (error.startsWith("agent_blocked:"))
        expect(await send()).toMatchObject({
          status: "refused",
          reason: "blocked",
        });
      else await expect(send()).rejects.toThrow(error);
      expect(state.prompts).toEqual([]);
      expect((await send()).status).toBe("sent");
      expect(state.prompts).toEqual(["/permissions"]);
    } finally {
      source.dispose();
    }
  });
}

// Remote file operations are fake-host adapters over disposable files; no SSH,
// native harness or user configuration is touched.
for (const mode of ["local", "ssh", "ssh-baseline"]) {
  test(`an assistant's quoted footer permits ordinary text (${mode})`, async () => {
    const { source, state } = setup(mode !== "local");
    try {
      state.file = quotedTranscript;
      state.screen = footerQuote + "\n❯ ";
      const shown = await source.read({ pane_id: "w1:p1" });
      for (const text of ["Thanks, continue", "Explain the next step"]) {
        expect(
          await source.send({
            pane_id: "w1:p1",
            text,
            session_fingerprint: shown.session_fingerprint!,
            ...(mode === "ssh-baseline"
              ? {
                  baseline: shown.messages
                    .filter((m) => m.role === "user")
                    .map((m) => m.id),
                }
              : {}),
          }),
        ).toMatchObject({ status: "sent" });
      }
      expect(state.prompts).toEqual([
        "Thanks, continue",
        "Explain the next step",
      ]);
    } finally {
      source.dispose();
    }
  });
}

for (const screen of ["menu", "failed", "malformed"]) {
  test(`an SSH baseline and quoted reply never exempt a ${screen} screen`, async () => {
    const { source, state } = setup(true);
    try {
      state.file = quotedTranscript;
      const shown = await source.read({ pane_id: "w1:p1" });
      state.screen = screen === "menu" ? permissionMenu : footerQuote + "\n❯ ";
      state.readFails = screen === "failed";
      state.readMalformed = screen === "malformed";
      expect(
        await source.send({
          pane_id: "w1:p1",
          text: "Continue",
          session_fingerprint: shown.session_fingerprint!,
          baseline: [],
        }),
      ).toMatchObject({ status: "refused", reason: "menu" });
      expect(state.prompts).toEqual([]);
    } finally {
      source.dispose();
    }
  });
}

test("an SSH baseline cannot borrow a former session's quoted footer", async () => {
  const { source, state } = setup(true);
  try {
    state.file = quotedTranscript;
    const shown = await source.read({ pane_id: "w1:p1" });
    state.file = transcript;
    state.screen = footerQuote + "\n❯ ";
    expect(
      await source.send({
        pane_id: "w1:p1",
        text: "Continue",
        session_fingerprint: shown.session_fingerprint!,
        baseline: [],
      }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(state.prompts).toEqual([]);
  } finally {
    source.dispose();
  }
});

for (const remote of [false, true]) {
  test(`partial/padded menu evidence cannot authorize text (${remote ? "SSH baseline" : "local"})`, async () => {
    const boxTail = [
      "│ Run synthetic command │",
      "│ Do you want to proceed? │",
      "│ ❯ 1. Yes │",
      "│   2. No │",
      "╰──────────────────────╯",
    ].join("\n");
    const cutMenu = permissionMenu.split("\n").slice(1).join("\n");
    for (const screen of [
      boxTail,
      boxTail.replace("❯", " "),
      cutMenu + "\n".repeat(14),
    ]) {
      const { source, state } = setup(remote);
      try {
        const shown = await source.read({ pane_id: "w1:p1" });
        state.screen = screen;
        expect(
          await source.send({
            pane_id: "w1:p1",
            text: "2 please continue",
            session_fingerprint: shown.session_fingerprint!,
            ...(remote ? { baseline: [] } : {}),
          }),
        ).toMatchObject({ status: "refused", reason: "menu" });
        expect(state.prompts).toEqual([]);
      } finally {
        source.dispose();
      }
    }
  });

  test(`Claude's assistant prefix preserves a same-session quote (${remote ? "SSH baseline" : "local"})`, async () => {
    const { source, state } = setup(remote);
    try {
      state.file = quotedTranscript;
      const shown = await source.read({ pane_id: "w1:p1" });
      state.screen = "● " + footerQuote + "\n❯ ";
      expect(
        await source.send({
          pane_id: "w1:p1",
          text: "Continue",
          session_fingerprint: shown.session_fingerprint!,
          ...(remote ? { baseline: [] } : {}),
        }),
      ).toMatchObject({ status: "sent" });
      expect(state.prompts).toEqual(["Continue"]);
    } finally {
      source.dispose();
    }
  });

  test(`the final read must retain the screen's terminal and sequence (${remote ? "SSH baseline" : "local"})`, async () => {
    for (const kind of ["terminal", "sequence"]) {
      const { source, state } = setup(remote);
      try {
        const shown = await source.read({ pane_id: "w1:p1" });
        state.afterScreen = () => {
          if (kind === "terminal") state.terminal = "terminal-b";
          else state.seq += 1;
          state.screen = permissionMenu;
        };
        expect(
          await source.send({
            pane_id: "w1:p1",
            text: "Continue",
            session_fingerprint: shown.session_fingerprint!,
            ...(remote ? { baseline: [] } : {}),
          }),
        ).toMatchObject({ status: "refused", reason: "changed" });
        expect(state.prompts).toEqual([]);
      } finally {
        source.dispose();
      }
    }
  });
}
