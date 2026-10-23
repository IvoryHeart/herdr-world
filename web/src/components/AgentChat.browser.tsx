import { createRoot } from "react-dom/client";
import { bridge, type BridgeControlMsg } from "../api";
import type { Pane } from "../types";
import { AgentChat, type Conversation } from "./AgentChat";
import type { ConversationStep } from "./StepCard";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";

const failures: string[] = [];
function check(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

const conversation = (
  messages: Conversation["messages"],
  status = "idle",
): Conversation => ({
  conversation_version: 1,
  pane_id: "p",
  agent: "claude",
  agent_status: status,
  session_binding: "reported",
  session_fingerprint: "a".repeat(64),
  session_label: "claude session shown",
  status: "ok",
  unavailable: null,
  messages,
  latest:
    [...messages].reverse().find((message) => message.role === "assistant") ??
    null,
});

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
): Conversation["messages"][number] => ({
  id,
  role,
  kind: "message",
  text,
  sent_at: "2026-10-22T09:00:00Z",
});

/**
 * Uploads with byte progress use XMLHttpRequest. Each request waits until the
 * test answers it, so the chip can be seen uploading, failing and retrying.
 */
const uploadRequests: {
  filename: string;
  answer(ok: boolean): void;
}[] = [];
class FixtureUploadRequest {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  responseType = "";
  status = 0;
  statusText = "";
  response: Blob | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = new URL(window.location.origin);
  private headers = "";
  open(_method: string, url: string | URL) {
    this.url = new URL(String(url), window.location.origin);
  }
  setRequestHeader() {}
  getAllResponseHeaders() {
    return this.headers;
  }
  send(body: Blob) {
    this.upload.onprogress?.({
      loaded: Math.floor(body.size / 2),
      total: body.size,
      lengthComputable: true,
    } as ProgressEvent);
    const filename = this.url.searchParams.get("filename") ?? "";
    uploadRequests.push({
      filename,
      answer: (ok) => {
        this.status = ok ? 200 : 507;
        this.headers =
          "content-type: application/json\r\nx-herdr-connection-id: test\r\nx-herdr-connection-generation: null";
        this.response = new Blob([
          JSON.stringify(
            ok ? { path: `/uploads/${filename}` } : { error: "disk full" },
          ),
        ]);
        this.onload?.();
      },
    });
  }
}

async function run() {
  const originalConnection = bridge.connection;
  const originalControl = bridge.onControl;
  const controls = new Set<(control: BridgeControlMsg) => void>();
  bridge.onControl = (handler) => {
    controls.add(handler);
    return () => controls.delete(handler);
  };
  const push = (pane_id = "p") =>
    controls.forEach((handler) =>
      handler({
        type: "agent_conversation_changed",
        connection_id: "test",
        pane_id,
      }),
    );
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let reply: Conversation = conversation([
    message("u1", "user", "What does the README say?"),
    {
      id: "t1",
      role: "tool",
      kind: "activity",
      text: "Used Read",
      sent_at: "2026-10-22T09:00:01Z",
      tools: [{ name: "Read", calls: 1 }],
      failed: 0,
    },
    message("a1", "assistant", "It describes the **demo** project."),
  ]);
  let sendResult: unknown = { status: "sent" };
  bridge.connection = () => ({
    connectionId: "test",
    generation: 1,
    serverRuntimeGeneration: null,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "agent_conversation.send") return sendResult;
      if (method === "pane.send_input") return {};
      if (method === "agent_conversation.get") return reply;
      if (
        method === "agent_conversation.watch" ||
        method === "agent_conversation.unwatch"
      )
        return { ok: true };
      if (method === "agent_conversation.dismiss") {
        reply = { ...reply, deliveries: [] };
        return { dismissed: true };
      }
      throw new Error(`unexpected ${method}`);
    },
  });
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:800px";
  document.body.append(container);
  const root = createRoot(container);
  const pane = (agent_status: string, state_change_seq?: number): Pane => ({
    pane_id: "p",
    terminal_id: "terminal",
    workspace_id: "Example",
    tab_id: "tab",
    focused: true,
    agent: "claude",
    agent_status,
    state_change_seq,
    revision: 1,
  });
  let terminalOpened = 0;
  const render = (status: string, active = true, sequence?: number) =>
    root.render(
      <AgentChat
        pane={pane(status, sequence)}
        active={active}
        onOpenTerminal={() => terminalOpened++}
        onClose={() => {}}
      />,
    );
  const count = (method: string) =>
    calls.filter((call) => call.method === method).length;
  const reads = () => count("agent_conversation.get");
  try {
    render("idle", false);
    await settle();
    check(reads() === 0, "A hidden Chat must not read the conversation");

    render("idle");
    await settle();
    check(reads() === 1, "Opening Chat must read the conversation once");
    check(
      count("agent_conversation.watch") === 1,
      "Opening Chat must ask the service to watch the pane",
    );
    const bubbles = [...container.querySelectorAll(".agent-chat-message")];
    check(
      bubbles.map((node) => node.getAttribute("data-role")).join() ===
        "user,assistant",
      "Chat must show user and assistant bubbles in order",
    );
    check(
      container.querySelector(".agent-chat-message.is-assistant strong")
        ?.textContent === "demo",
      "Assistant text must render as Markdown",
    );
    check(
      container.querySelector(".agent-chat-activity")?.textContent ===
        "Used Read",
      "Tool activity must render as one summary line",
    );
    check(
      !container.querySelector(".xterm, canvas, pre.terminal"),
      "Chat must never render terminal content",
    );

    // No timers: nothing rereads until the service says it changed.
    await new Promise((resolve) => setTimeout(resolve, 600));
    check(reads() === 1, "Chat must not poll");
    push("another-pane");
    await settle();
    check(reads() === 1, "A change to another pane must not reread");
    reply = conversation(
      [
        ...reply.messages,
        message("u2", "user", "Thanks"),
        message("a2", "assistant", "You're welcome."),
      ],
      "working",
    );
    push();
    await settle();
    check(reads() === 2, "A pushed change must reread the conversation");
    check(
      container.querySelectorAll(".agent-chat-message").length === 4,
      "A reread must show new messages",
    );

    const textarea = container.querySelector("textarea")!;
    const type = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type("Run the tests");
    await settle();
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    const sent = calls.find(
      (call) => call.method === "agent_conversation.send",
    );
    check(
      sent?.params.text === "Run the tests" &&
        sent.params.session_fingerprint === "a".repeat(64) &&
        sent.params.pane_id === "p" &&
        JSON.stringify(sent.params.baseline) === JSON.stringify(["u1", "u2"]),
      "Enter must send the draft with the session it was written for",
    );
    check(textarea.value === "", "A sent draft must clear");

    // A sent message is not called delivered until the transcript has it.
    const sentAt = "2026-10-22T09:00:05Z";
    reply = {
      ...reply,
      deliveries: [
        {
          id: "d1",
          text: "Run the tests",
          sent_at: sentAt,
          state: "pending",
          expected: "claude session shown",
          fingerprint: "a".repeat(64),
        },
        {
          id: "dm",
          text: "Thanks",
          sent_at: sentAt,
          state: "matched",
          expected: "claude session shown",
          fingerprint: "a".repeat(64),
          matched_id: "u2",
        },
        {
          id: "d0",
          text: "Meant for another conversation",
          sent_at: sentAt,
          state: "pending",
          expected: "claude session earlier",
          fingerprint: "b".repeat(64),
        },
      ],
    };
    push();
    await settle();
    const pendingBubbles = container.querySelectorAll(
      '[data-delivery="pending"]',
    );
    const pendingBubble = pendingBubbles[0];
    check(
      pendingBubbles.length === 1 &&
        pendingBubble?.textContent?.includes("Run the tests") === true &&
        pendingBubble.textContent.includes("not yet seen") &&
        !/delivered/i.test(container.textContent ?? ""),
      "A pending send must show only in its own conversation, and say it is not yet seen, never delivered",
    );
    const matched = container.querySelector('[data-delivery="matched"]');
    check(
      matched?.textContent?.includes("Thanks") === true &&
        matched.textContent.includes("matched by its words") &&
        !/delivered/i.test(container.textContent ?? ""),
      "A message matched by its words must say so, never that it was delivered",
    );
    const elsewhere = container.querySelector('[data-delivery="elsewhere"]');
    check(
      elsewhere?.textContent?.includes("claude session earlier") === true &&
        elsewhere.textContent.includes("Stop checking"),
      "A send to a session the pane left must stay visible, with Stop checking",
    );

    // A send that reached another session is reported loudly, by name.
    reply = {
      ...reply,
      deliveries: [
        {
          id: "d1",
          text: "Run the tests",
          sent_at: sentAt,
          state: "misdelivered",
          expected: "claude session shown",
          fingerprint: "a".repeat(64),
          delivered_to: "claude session other",
          evidence: "transcript",
        },
        {
          id: "d2",
          text: "Earlier message",
          sent_at: sentAt,
          state: "unverified",
          expected: "claude session shown",
          fingerprint: "a".repeat(64),
          detail:
            "Chat did not see it in claude session shown within 15 minutes.",
        },
        {
          id: "d3",
          text: "Close call",
          sent_at: sentAt,
          state: "uncertain",
          expected: "claude session shown",
          fingerprint: "a".repeat(64),
          detail: "The same words appeared at about the time you sent them.",
        },
      ],
    };
    push();
    await settle();
    const alert = container.querySelector(
      '.agent-chat-misdelivered[role="alert"]',
    );
    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Send"]',
    );
    type("Next");
    await settle();
    check(
      alert?.textContent?.includes("claude session other") === true &&
        alert.textContent.includes("claude session shown") &&
        !container.querySelector('[data-delivery="pending"]') &&
        sendButton?.disabled === true,
      "A misdelivered send must name the session that got it and pause Send",
    );
    const unverified = container.querySelector(".is-unverified");
    check(
      unverified?.textContent?.includes("can no longer check") === true &&
        unverified.textContent.includes("Earlier message"),
      "A send Chat cannot check any more must say so",
    );
    check(
      [...container.querySelectorAll(".is-unverified")].some((notice) =>
        notice.textContent?.includes("cannot tell where this went"),
      ) && !/went to a different session/.test(container.textContent ?? ""),
      "An ambiguous match must say Chat cannot tell, never that it went elsewhere",
    );
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Dismiss")
      ?.click();
    await settle();
    check(
      calls.some(
        (call) =>
          call.method === "agent_conversation.dismiss" &&
          call.params.delivery_id === "d1",
      ) && !container.querySelector(".agent-chat-misdelivered"),
      "Dismiss must clear the notice on the server",
    );

    sendResult = {
      status: "refused",
      reason: "blocked",
      message: "The agent is waiting on a question; answer it first.",
    };
    type("Another");
    await settle();
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Send"]')!
      .click();
    await settle();
    check(
      container.querySelector(".agent-chat-notice")?.textContent ===
        "The agent is waiting on a question; answer it first.",
      "A refused send must say why",
    );
    check(textarea.value === "Another", "A refused draft must stay");

    // Attachments upload with a chip each; Send waits for them.
    const originalRequest = window.XMLHttpRequest;
    window.XMLHttpRequest =
      FixtureUploadRequest as unknown as typeof XMLHttpRequest;
    try {
      const picker = container.querySelector<HTMLInputElement>(
        ".agent-chat-composer input[type=file]",
      )!;
      const report = new File(["synthetic report"], "report.txt", {
        type: "text/plain",
        lastModified: 1,
      });
      const pick = () => {
        const files = new DataTransfer();
        files.items.add(report);
        picker.files = files.files;
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const send = () =>
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="Send"]',
        )!;
      const chip = () =>
        container.querySelector<HTMLElement>(".agent-chat .attachment-chip");
      pick();
      await settle();
      check(
        chip()?.dataset.status === "uploading" &&
          (chip()?.textContent ?? "").includes("report.txt"),
        "An attached file must show an uploading chip",
      );
      check(
        (chip()?.textContent ?? "").includes("Uploading 50%"),
        "An uploading chip must show byte progress",
      );
      check(send().disabled, "Send must wait for uploads");
      pick();
      await settle();
      check(
        uploadRequests.length === 1,
        "The same file picked again while uploading must not upload twice",
      );
      uploadRequests[0]!.answer(false);
      await settle();
      check(
        chip()?.dataset.status === "failed" &&
          (chip()?.textContent ?? "").includes("disk full"),
        "A failed upload must say why on its chip",
      );
      check(!send().disabled, "A failed upload must not block Send");
      container
        .querySelector<HTMLButtonElement>('[aria-label="Retry report.txt"]')!
        .click();
      await settle();
      check(uploadRequests.length === 2, "Retry must upload the file again");
      uploadRequests[1]!.answer(true);
      await settle();
      check(
        chip()?.dataset.status === "done",
        "A finished upload must show a done chip",
      );
      check(
        textarea.value === "Another /uploads/report.txt ",
        "A finished upload must add its path to the message",
      );
      check(!send().disabled, "Send must be enabled once uploads finish");

      // A file that failed is retried when it is picked again.
      const notes = new File(["synthetic notes"], "notes.txt", {
        type: "text/plain",
        lastModified: 2,
      });
      const pickFile = (file: File) => {
        const files = new DataTransfer();
        files.items.add(file);
        const input = container.querySelector<HTMLInputElement>(
          ".agent-chat-composer input[type=file]",
        )!;
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      pickFile(notes);
      await settle();
      uploadRequests[2]!.answer(false);
      await settle();
      pickFile(notes);
      await settle();
      check(
        uploadRequests.length === 4,
        "Picking a failed file again must retry it",
      );

      // A path that finishes after Chat closes lands when Chat opens again.
      root.render(<div />);
      await settle();
      uploadRequests[3]!.answer(true);
      await settle();
      render("idle");
      await settle();
      check(
        (
          container.querySelector<HTMLTextAreaElement>("textarea")?.value ?? ""
        ).includes("/uploads/notes.txt"),
        "A path that finished while Chat was closed must reach the reopened draft",
      );
      // Retry after a remount delivers to the Chat now open.
      pickFile(
        new File(["synthetic log"], "log.txt", {
          type: "text/plain",
          lastModified: 3,
        }),
      );
      await settle();
      uploadRequests[4]!.answer(false);
      await settle();
      root.render(<div />);
      await settle();
      render("idle");
      await settle();
      container
        .querySelector<HTMLButtonElement>('[aria-label="Retry log.txt"]')!
        .click();
      await settle();
      uploadRequests[5]!.answer(true);
      await settle();
      check(
        (
          container.querySelector<HTMLTextAreaElement>("textarea")?.value ?? ""
        ).includes("/uploads/log.txt"),
        "A retry after Chat reopened must reach the open draft",
      );
    } finally {
      window.XMLHttpRequest = originalRequest;
    }

    // A read that fails mid-write keeps the last good conversation.
    reply = {
      ...conversation([]),
      status: "unavailable",
      session_fingerprint: null,
      unavailable: { reason: "read_failed", detail: "Unexpected end." },
    } as Conversation;
    push();
    await settle();
    check(
      container.querySelectorAll(".agent-chat-message").length === 4 &&
        !container.querySelector(".agent-chat-unavailable"),
      "A failed read must keep the last good conversation",
    );
    check(
      container
        .querySelector(".agent-chat-stale")
        ?.textContent?.includes("Unexpected end.") === true,
      "A failed read must mark the conversation stale",
    );

    // A conversation found in the pane's folder is shown, never sent to.
    reply = {
      ...conversation([message("g1", "assistant", "Guessed answer")]),
      session_binding: "guessed",
      session_fingerprint: null,
    };
    push();
    await settle();
    check(
      !container.querySelector("textarea") &&
        !!container.querySelector(".agent-chat-guessed") &&
        !container.querySelector(".agent-chat-stale"),
      "A guessed conversation must not offer a composer",
    );

    // A new Codex thread is shown, but its truncated title ID is not sent to.
    reply = {
      ...conversation([]),
      session_binding: "title",
      session_fingerprint: null,
    };
    push();
    await settle();
    check(
      !container.querySelector("textarea") &&
        container
          .querySelector(".agent-chat-guessed")
          ?.textContent?.includes("Codex title") === true,
      "An unresolved Codex thread must explain why it cannot be sent to",
    );

    reply = conversation([
      message("c0", "user", "Earlier"),
      {
        id: "n1",
        role: "assistant",
        kind: "notice",
        text: "Conversation compacted",
        sent_at: "2026-10-22T09:00:02Z",
      },
      message("c1", "assistant", "Later"),
    ]);
    push();
    await settle();
    check(
      container.querySelector(".agent-chat-divider")?.textContent ===
        "Conversation compacted" &&
        container.querySelectorAll(".agent-chat-message").length === 2,
      "A compaction must render as a divider, not a message",
    );

    reply = {
      ...conversation([]),
      status: "unavailable",
      session_fingerprint: null,
      unavailable: {
        reason: "codex_unlinked",
        detail: "This pane isn't linked to a Codex session.",
        issue: "https://example.com/issues/250",
      },
    } as Conversation;
    push();
    await settle();
    check(
      !!container.querySelector(".agent-chat-link input"),
      "An unlinked Codex pane must offer the link it names",
    );
    check(
      container
        .querySelector(".agent-chat-unavailable")
        ?.textContent?.includes(
          "This pane isn't linked to a Codex session.",
        ) === true,
      "An unavailable conversation must show its reason",
    );
    check(
      !container.querySelector("textarea"),
      "An unavailable conversation must not offer a composer",
    );
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open Terminal"))
      ?.click();
    check(terminalOpened === 1, "Unavailable Chat must link to the Terminal");

    reply = {
      ...conversation([]),
      status: "unavailable",
      session_fingerprint: null,
      unavailable: {
        reason: "no_session",
        detail: "Install the Herdr integration for this agent.",
        command: "herdr integration install kimi",
      },
    } as Conversation;
    push();
    await settle();
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".agent-chat-unavailable button",
      ),
    ].map((button) => button.textContent?.trim());
    check(
      buttons.includes("Copy command") && buttons.includes("Refresh"),
      "A missing integration must offer to copy its command and refresh",
    );

    // Steps: one card per tool call, keyed by its call ID. Reads fold into a
    // group; an edit opens to its diff; a failed test run starts open with its
    // strip; a running step spins.
    const step = (
      id: string,
      tool: string,
      label: string,
      extra: Partial<ConversationStep> = {},
    ): Conversation["messages"][number] => ({
      id,
      role: "tool",
      kind: "step",
      text: label,
      sent_at: "2026-10-22T09:00:00Z",
      step: {
        id,
        call_id: id,
        tool,
        label,
        input_summary: null,
        state: "ok",
        started_at: "2026-10-22T09:00:00Z",
        ended_at: "2026-10-22T09:00:01Z",
        result_tail: null,
        diff: null,
        test: null,
        ...extra,
      },
    });
    reply = conversation(
      [
        message("u6", "user", "Add backoff"),
        step("r1", "Read", "Read reconnect.ts", {
          input_summary: "src/reconnect.ts",
        }),
        step("r2", "Read", "Read reconnect.test.ts", {
          input_summary: "src/reconnect.test.ts",
        }),
        step("e1", "Edit", "Edit reconnect.ts", {
          diff: {
            file: "src/reconnect.ts",
            removed: ["  return 1000;"],
            added: ["  return backoff(attempt);"],
            truncated: true,
            omitted: 3,
          },
        }),
        step("b1", "Bash", "Run reconnect tests", {
          state: "failed",
          input_summary: "bun test src",
          test: {
            runner: "bun",
            passed: 12,
            failed: 1,
            first_failure: "backs off to the cap",
          },
          result_tail: "(fail) backs off to the cap",
        }),
        step("b2", "Bash", "Run reconnect tests", {
          state: "running",
          ended_at: null,
          input_summary: "bun test src",
        }),
      ],
      "working",
    );
    push();
    await settle();
    const group = container.querySelector(".agent-chat-step.is-group");
    check(
      group?.textContent?.includes("Read 2 files") === true &&
        group.textContent.includes("src/reconnect.test.ts"),
      "Consecutive reads must fold into one group with their files",
    );
    const edit = container.querySelector<HTMLElement>('[data-step-id="e1"]')!;
    check(
      !edit.querySelector(".agent-chat-step-diff"),
      "A finished edit must start folded",
    );
    edit.querySelector<HTMLButtonElement>(".agent-chat-step-head")!.click();
    await settle();
    check(
      edit.querySelector(".is-removed")?.textContent === "-   return 1000;" &&
        edit.querySelector(".is-added")?.textContent ===
          "+   return backoff(attempt);",
      "Opening an edit must show its diff",
    );
    const failed = container.querySelector('[data-step-id="b1"]');
    check(
      failed
        ?.querySelector(".agent-chat-step-strip.is-red")
        ?.textContent?.includes("12 passed · 1 failed") === true &&
        failed.textContent?.includes("backs off to the cap") === true,
      "A failed test run must start open with its red strip and failing test",
    );
    check(
      container.querySelector(
        '[data-step-id="b2"].is-running .agent-chat-spinner',
      ) !== null,
      "A running step must spin",
    );
    // The open call already has its step card, so no second running row.
    reply = {
      ...reply,
      running_tool: {
        id: "b2",
        name: "Bash",
        summary: "bun test src",
        started_at: new Date().toISOString(),
      },
    };
    render("working");
    push();
    await settle();
    check(
      !container.querySelector(".agent-chat-running") &&
        container.querySelector('[data-step-id="b2"].is-running') !== null,
      "An open call shown as a step card must not also show a running row",
    );
    check(
      edit.textContent?.includes("3 more lines; see Changes") === true,
      "A cut diff must say how much is left out and where to see it",
    );
    // Open follows a step's state as it changes, unless the reader chose.
    reply = {
      ...reply,
      messages: reply.messages.map((entry) =>
        entry.step?.id === "b2"
          ? {
              ...entry,
              step: {
                ...entry.step,
                state: "ok" as const,
                ended_at: "2026-10-22T09:00:09Z",
                result_tail: " 13 pass",
              },
            }
          : entry,
      ),
    };
    push();
    await settle();
    check(
      container.querySelector('[data-step-id="b2"].is-ok') !== null &&
        !container.querySelector('[data-step-id="b2"] .agent-chat-step-body') &&
        edit.isConnected &&
        edit.querySelector(".agent-chat-step-diff") !== null,
      "A running step that finishes must fold; one the reader opened stays open",
    );
    // The Now bar: Herdr's status, the task from the terminal title and the
    // time since the status changed; the step running now has its own timer.
    reply = {
      ...conversation([message("u8", "user", "Run the tests")], "working"),
      terminal_title: "✳ Running tests",
      running_tool: {
        id: "toolu_8",
        name: "Bash",
        summary: "bun test server/src/link",
        started_at: new Date(Date.now() - 3_000).toISOString(),
      },
    };
    render("idle", true, 60);
    push();
    await settle();
    render("working", true, 61);
    // The display clock ticks once a second from when it started, so a fixed
    // wait can read it before its first full second; wait for that instead.
    for (
      let waited = 0;
      waited < 5_000 &&
      !/^[1-9]\d*s$/.test(
        container.querySelector(".agent-chat-now .agent-chat-now-time")
          ?.textContent ?? "",
      );
      waited += 100
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    const now = container.querySelector(".agent-chat-now");
    check(
      now?.querySelector(".agent-chat-status")?.textContent === "Working" &&
        now.querySelector(".agent-chat-now-title")?.textContent ===
          "Running tests" &&
        /^[1-9]\d*s$/.test(
          now.querySelector(".agent-chat-now-time")?.textContent ?? "",
        ),
      `The Now bar must show the status, task and time (${now?.textContent})`,
    );
    const runningRow = container.querySelector(".agent-chat-running");
    check(
      runningRow?.textContent?.includes("Bash") === true &&
        runningRow.textContent.includes("bun test server/src/link") &&
        /[3-9]s$/.test(runningRow.textContent) &&
        runningRow.getAttribute("data-call-id") === "toolu_8",
      `The running step must name its tool, command and time (${runningRow?.textContent})`,
    );
    // Stop presses Esc in the pane; so does Esc twice, never once.
    const escapes = () =>
      calls.filter(
        (call) =>
          call.method === "pane.send_input" &&
          JSON.stringify(call.params.keys) === '["escape"]',
      ).length;
    container.querySelector<HTMLButtonElement>(".agent-chat-stop")!.click();
    await settle();
    check(escapes() === 1, "Stop must press Esc in the agent's pane");
    const list = container.querySelector<HTMLElement>(".agent-chat-list")!;
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    check(
      escapes() === 1 &&
        (
          container.querySelector(".agent-chat-now-note")?.textContent ?? ""
        ).includes("Press Esc again"),
      "One Esc must only ask for a second",
    );
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    check(escapes() === 2, "Esc twice must press Esc in the agent's pane");
    // Only the status and task are announced; the clocks tick silently.
    check(
      !container.querySelector(".agent-chat-now")?.hasAttribute("aria-live") &&
        container
          .querySelector(".agent-chat-now-live")
          ?.getAttribute("aria-live") === "polite" &&
        [...container.querySelectorAll(".agent-chat-now-time")].every(
          (time) =>
            time.getAttribute("aria-hidden") === "true" &&
            !time.closest("[aria-live], [role='status']"),
        ),
      "The Now bar's clocks must not be inside a live region",
    );
    // An Esc another handler used does not arm Stop, and the note to press
    // again lasts only as long as a second Esc would stop.
    await new Promise((resolve) => setTimeout(resolve, 800));
    list.addEventListener("keydown", (event) => event.preventDefault(), {
      once: true,
    });
    list.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    check(escapes() === 2, "An Esc already handled must not count");
    await new Promise((resolve) => setTimeout(resolve, 800));
    check(
      !(
        container.querySelector(".agent-chat-now-note")?.textContent ?? ""
      ).includes("Press Esc again"),
      "The note to press Esc again must clear when its window ends",
    );
    // A call still open while the agent waits for approval, or after it
    // stopped, is not running.
    for (const [status, sequence] of [
      ["blocked", 62],
      ["idle", 63],
    ] as const) {
      render(status, true, sequence);
      await settle();
      check(
        !container.querySelector(".agent-chat-running") &&
          !container.querySelector(".agent-chat-now .agent-chat-now-time"),
        `An open call must not show as running while ${status}`,
      );
    }
    // A long conversation scrolls in the window, phone and desktop widths
    // alike: it opens at the newest message, keeps the reader's place when a
    // message lands while they read back, and Jump to latest returns.
    for (const width of [390, 1300]) {
      container.style.width = `${width}px`;
      const long = Array.from({ length: 70 }, (_, index) =>
        message(
          `long-${width}-${index}`,
          index % 2 ? "assistant" : "user",
          `Message ${index}: the reception queue keeps the oldest waiting agent first.`,
        ),
      );
      reply = conversation(long);
      render("idle", false);
      await settle();
      render("idle");
      await settle();
      await settle();
      const list = container.querySelector<HTMLElement>(".agent-chat-list")!;
      check(
        list.scrollHeight > list.clientHeight * 2,
        `a long conversation should scroll at ${width}px`,
      );
      check(
        list.scrollHeight - list.scrollTop - list.clientHeight < 4,
        `Chat should open at the newest message at ${width}px`,
      );
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll"));
      await settle();
      const jump = () =>
        container.querySelector<HTMLButtonElement>(".agent-chat-jump");
      check(jump() !== null, `Jump to latest should show at ${width}px`);
      reply = conversation([
        ...long,
        message(`long-${width}-new`, "assistant", "A new message lands."),
      ]);
      push();
      await settle();
      await settle();
      check(
        list.scrollTop < 4,
        `a new message moved a reader who scrolled up at ${width}px`,
      );
      jump()!.click();
      await settle();
      check(
        list.scrollHeight - list.scrollTop - list.clientHeight < 4 &&
          jump() === null,
        `Jump to latest did not return to the newest message at ${width}px`,
      );
      const composer = container
        .querySelector("textarea")
        ?.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      check(
        composer !== undefined &&
          composer.bottom <= box.bottom + 1 &&
          composer.top >= box.top,
        `the composer should stay in the window at ${width}px`,
      );
    }
    container.style.width = "800px";

    const unwatched = count("agent_conversation.unwatch");
    render("done", false);
    await settle();
    check(
      count("agent_conversation.unwatch") === unwatched + 1,
      "Hiding Chat must stop watching the pane",
    );
  } finally {
    root.unmount();
    container.remove();
    bridge.connection = originalConnection;
    bridge.onControl = originalControl;
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
