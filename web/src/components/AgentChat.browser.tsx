import { createRoot } from "react-dom/client";
import { bridge, type BridgeControlMsg } from "../api";
import type { Pane } from "../types";
import { AgentChat, type Conversation } from "./AgentChat";
import { useAgentHistoryWindow } from "./useAgentHistoryWindow";
import { useConnectionClient } from "../useConnectionClient";
import type { ConversationStep } from "./chat/blocks/steps";
import { EMPTY_WORLD_SOURCES, worldSourcesStore } from "../world/worldSources";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";
import "./WorkspaceInspectorHost.css";

const failures: string[] = [];
function check(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

type Messages = NonNullable<Conversation["messages"]>;

function HistoryWindowProbe({
  pane,
  observe,
}: {
  pane: Pane;
  observe(value: ReturnType<typeof useAgentHistoryWindow>): void;
}) {
  const client = useConnectionClient();
  observe(useAgentHistoryWindow({ pane, client, active: true }));
  return null;
}

/** History's window of the same messages, as agent_history.get sends it. */
let historyRevision = 0;
const historyOf = (messages: Messages) => ({
  history_version: 2,
  mode: "snapshot",
  cursor: { epoch: "fixture", revision: ++historyRevision },
  window_limit: 200,
  agent: "claude",
  pane_id: "p",
  workspace_id: "Example",
  tab_id: "tab",
  updated_at: "2026-10-22T09:00:00Z",
  path: "",
  entries: messages.map((message) =>
    message.kind === "notice"
      ? {
          id: message.id,
          role: "assistant",
          kind: "message",
          text: "",
          notice: message.text,
          sent_at: message.sent_at,
        }
      : message.kind === "activity"
        ? {
            id: message.id,
            role: "tool",
            kind: "tool_call",
            tool_name: message.tools?.[0]?.name ?? "tool",
            text: "",
            sent_at: message.sent_at,
          }
        : {
            id: message.id,
            role: message.role,
            kind: message.kind === "error" ? "error" : "message",
            text: message.text,
            sent_at: message.sent_at,
          },
  ),
});

const conversation = (messages: Messages, status = "idle"): Conversation => ({
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
): Messages[number] => ({
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
  /** Replaces the snapshot answer for agent_history.get while set. */
  let historyAnswer: ((params: Record<string, unknown>) => unknown) | null =
    null;
  let answerAcknowledged = false;
  /** Answers agent_history.get for an older page (`before`) while set. */
  let olderAnswer: ((params: Record<string, unknown>) => unknown) | null = null;
  /** The step model the fixture's agent_conversation.steps answers from. */
  let fixtureSteps: ConversationStep[] = [];
  const stepsAsked: string[][] = [];
  bridge.connection = () => ({
    connectionId: "test",
    generation: 1,
    serverRuntimeGeneration: null,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "agent_conversation.send") return sendResult;
      if (method === "agent_conversation.answer")
        return {
          status: "sent",
          number: "2",
          label: "Yes, always",
          acknowledged: answerAcknowledged,
          unconfirmed_reason: answerAcknowledged ? null : "session_changed",
          prompt_fingerprint: params.prompt_fingerprint,
        };
      if (method === "pane.send_input") return {};
      if (method === "agent_history.get" && params.before && olderAnswer)
        return olderAnswer(params);
      if (method === "agent_conversation.steps") {
        stepsAsked.push(params.call_ids as string[]);
        const ids = new Set(params.call_ids as string[]);
        return {
          steps: fixtureSteps.filter(
            (step) => step.call_id && ids.has(step.call_id),
          ),
        };
      }
      if (method === "agent_conversation.latest")
        return { ...reply, messages: undefined };
      // A transcript caught mid-write fails History's read too.
      if (
        method === "agent_history.get" &&
        reply.unavailable?.reason === "read_failed"
      )
        throw new Error(reply.unavailable.detail);
      if (method === "agent_history.get")
        return historyAnswer
          ? historyAnswer(params)
          : historyOf(reply.messages ?? []);
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
  const olderReads = () =>
    calls.filter(
      (call) => call.method === "agent_history.get" && call.params.before,
    ).length;
  const count = (method: string) =>
    calls.filter((call) => call.method === method).length;
  const reads = () => count("agent_conversation.latest");
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
    const bubbles = [
      ...container.querySelectorAll(
        ".agent-history-chat-message:not(.is-pending)",
      ),
    ];
    check(
      bubbles
        .map((node) =>
          node.classList.contains("is-user") ? "user" : "assistant",
        )
        .join() === "user,assistant",
      "Chat must show user and assistant bubbles in order",
    );
    check(
      container.querySelector(".agent-history-chat-message.is-assistant strong")
        ?.textContent === "demo",
      "Assistant text must render as Markdown",
    );
    check(
      (
        container.querySelector(".agent-history-chat-tools")?.textContent ?? ""
      ).includes("Read"),
      "Tool activity must render as one collapsed tool block",
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
        ...(reply.messages ?? []),
        message("u2", "user", "Thanks"),
        message("a2", "assistant", "You're welcome."),
      ],
      "working",
    );
    push();
    await settle();
    check(reads() === 2, "A pushed change must reread the conversation");
    check(
      container.querySelectorAll(".agent-history-chat-message:not(.is-pending)")
        .length === 4,
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
    // As in World's composer, Enter is a new line: it neither sends nor is
    // held back from the textarea.
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(enter);
    await settle();
    check(
      !enter.defaultPrevented &&
        !calls.some((call) => call.method === "agent_conversation.send"),
      "Enter must start a new line, not send",
    );
    check(
      /^Send \((Ctrl|Meta|Cmd|⌘)/.test(
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Send"]')
          ?.getAttribute("title") ?? "",
      ),
      "The Send button must name its keyboard shortcut",
    );
    // The composer's send shortcut (Ctrl+Enter, Cmd+Enter on a Mac) sends.
    for (const modifier of ["ctrlKey", "metaKey"] as const) {
      if (calls.some((call) => call.method === "agent_conversation.send"))
        break;
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          [modifier]: true,
        }),
      );
      await settle();
    }
    const sent = calls.find(
      (call) => call.method === "agent_conversation.send",
    );
    check(
      sent?.params.text === "Run the tests" &&
        sent.params.session_fingerprint === "a".repeat(64) &&
        sent.params.pane_id === "p" &&
        JSON.stringify(sent.params.baseline) === JSON.stringify(["u1", "u2"]),
      "The send shortcut must send the draft with the session it was written for",
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
        pendingBubble.textContent.includes("Delivered · waiting for claude"),
      "A pending send must show only in its own conversation, as delivered and waiting",
    );
    const matched = container.querySelector('[data-delivery="matched"]');
    check(
      matched?.textContent?.includes("Thanks") === true &&
        matched.textContent.includes("matched by its words"),
      "A message matched by its words must say so",
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
      container.querySelectorAll(".agent-history-chat-message:not(.is-pending)")
        .length === 4 && !container.querySelector(".agent-chat-unavailable"),
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
      container.querySelector(".agent-history-chat-divider")?.textContent ===
        "Conversation compacted" &&
        container.querySelectorAll(
          ".agent-history-chat-message:not(.is-pending)",
        ).length === 2,
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

    // Steps: History's tool rows carry the step model's evidence, matched by
    // the harness's call ID: a plain label, a test badge and its time, and
    // when a row opens, the edit's diff or the failed run's strip. A run whose
    // tests failed reads as failed though its result was not an error.
    {
      const at = "2026-10-22T09:00:00Z";
      const step = (
        id: string,
        tool: string,
        label: string,
        extra: Partial<ConversationStep> = {},
      ): ConversationStep => ({
        id,
        call_id: id,
        tool,
        label,
        input_summary: null,
        state: "ok",
        started_at: at,
        ended_at: "2026-10-22T09:00:01Z",
        result_tail: null,
        diff: null,
        test: null,
        ...extra,
      });
      const entry = (
        id: string,
        kind: "tool_call" | "tool_result",
        tool: string,
      ) => ({
        id: `${kind}-${id}`,
        role: "tool",
        kind,
        tool_name: tool,
        source_call_id: id,
        text: kind === "tool_call" ? "{}" : "done",
        sent_at: at,
      });
      reply = conversation([message("u6", "user", "Add backoff")], "idle");
      fixtureSteps = [
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
        step("i1", "Bash", "Watch the logs", {
          state: "interrupted",
          ended_at: null,
        }),
        // Evidence from an older read: the result has since arrived.
        step("s1", "Bash", "Print the version", {
          state: "interrupted",
          ended_at: null,
        }),
      ];
      let window = [
        {
          id: "u6",
          role: "user",
          kind: "message",
          text: "Add backoff",
          sent_at: at,
        },
        entry("e1", "tool_call", "Edit"),
        entry("e1", "tool_result", "Edit"),
        entry("b1", "tool_call", "Bash"),
        entry("b1", "tool_result", "Bash"),
        entry("i1", "tool_call", "Bash"),
        entry("s1", "tool_call", "Bash"),
        entry("s1", "tool_result", "Bash"),
      ];
      historyAnswer = () => ({ ...historyOf([]), entries: window });
      render("idle", true, 45);
      push();
      await settle();
      await settle();
      check(
        container.querySelector(".agent-history-chat-tools-errors")
          ?.textContent === "1 error",
        "The block's error count must include a run whose tests failed",
      );
      container
        .querySelector<HTMLButtonElement>(".agent-history-chat-tools-toggle")
        ?.click();
      await settle();
      const cut = container.querySelectorAll(".agent-history-chat-step")[2];
      const arrived = container.querySelectorAll(".agent-history-chat-step")[3];
      check(
        cut?.classList.contains("is-interrupted") === true &&
          cut.textContent?.includes("Interrupted") === true &&
          arrived?.classList.contains("is-done") === true,
        "A call cut off must read as interrupted, and one whose result arrived must not",
      );
      const rows = [
        ...container.querySelectorAll<HTMLElement>(".agent-history-chat-step"),
      ];
      check(
        rows.length === 4 &&
          rows[0]!.querySelector(".agent-history-chat-step-name")
            ?.textContent === "Edit reconnect.ts" &&
          rows[0]!.textContent?.includes("1.0s") === true &&
          rows[1]!.classList.contains("is-error") &&
          rows[1]!.querySelector(".agent-chat-step-badge.is-red")
            ?.textContent === "1 failed",
        `Tool rows must carry their step's label, time and test badge (${rows.map((row) => row.textContent).join(" | ")})`,
      );
      rows[0]!
        .querySelector<HTMLButtonElement>(".agent-history-chat-step-row")!
        .click();
      await settle();
      check(
        rows[0]!.querySelector(".is-removed")?.textContent ===
          "-   return 1000;" &&
          rows[0]!.textContent?.includes("3 more lines; see Changes") === true,
        "Opening an edit's row must show its diff and what was cut",
      );
      rows[1]!
        .querySelector<HTMLButtonElement>(".agent-history-chat-step-row")!
        .click();
      await settle();
      check(
        rows[1]!
          .querySelector(".agent-chat-step-strip.is-red")
          ?.textContent?.includes("12 passed · 1 failed") === true &&
          rows[1]!.textContent?.includes("backs off to the cap") === true,
        "Opening a failed run's row must show its red strip and failing test",
      );
      // A call shown as interrupted is asked for again when History changes,
      // so a late result settles it.
      fixtureSteps = fixtureSteps.map((item) =>
        item.call_id === "i1"
          ? { ...item, state: "ok", ended_at: "2026-10-22T09:00:03Z" }
          : item,
      );
      window = [...window, entry("i1", "tool_result", "Bash")];
      push();
      await settle();
      await settle();
      const settled = container.querySelectorAll(".agent-history-chat-step")[2];
      check(
        settled?.classList.contains("is-done") === true &&
          settled.textContent?.includes("3.0s") === true,
        `A late result must settle an interrupted call (${settled?.textContent})`,
      );
      // Calls that leave History's window leave Chat's evidence too: one that
      // comes back is asked for again.
      const saved = window;
      window = window.filter((item) => !item.id.endsWith("-e1"));
      push();
      await settle();
      await settle();
      const before = stepsAsked.length;
      window = saved;
      push();
      await settle();
      await settle();
      check(
        stepsAsked.slice(before).some((ids) => ids.includes("e1")),
        "Evidence must be kept only for the calls in History's window",
      );
      historyAnswer = null;
      fixtureSteps = [];
    }
    // A blocked agent's question becomes an ask card with its whole
    // request. A number answers only while that card has focus; Chat then
    // says it sent the key, and that it was answered once the agent moved on.
    const asking = {
      question: ["Do you want to proceed?"],
      request: ["Bash command", "echo safe", "git push -u origin agent/demo"],
      options: [
        { number: "1", label: "Yes", key: "1" },
        { number: "2", label: "Yes, always", key: "2" },
        { number: "3", label: "No, and tell the agent what to do", key: "3" },
      ],
      fingerprint: "f1",
    };
    reply = {
      ...conversation([message("u7", "user", "Push it")], "blocked"),
      pending_prompt: asking,
    };
    render("blocked", true, 50);
    push();
    await settle();
    const card = container.querySelector<HTMLElement>(".agent-chat-ask")!;
    check(
      card.querySelector("pre")?.textContent ===
        "Bash command\necho safe\ngit push -u origin agent/demo" &&
        card.textContent?.includes("Do you want to proceed?") === true &&
        card.querySelectorAll(".agent-chat-ask-options button").length === 3,
      "A blocked agent's question must show its whole request and options",
    );
    const answers = () =>
      calls.filter((call) => call.method === "agent_conversation.answer");
    // Outside the card, a number answers nothing.
    container
      .querySelector<HTMLElement>(".agent-chat-list")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    await settle();
    check(answers().length === 0, "A number outside the card must not answer");
    // A held key repeats nothing.
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", bubbles: true, repeat: true }),
    );
    await settle();
    check(answers().length === 0, "A repeated key must not answer");
    card.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", bubbles: true }),
    );
    await settle();
    check(
      answers().length === 1 &&
        answers()[0]!.params.key === "2" &&
        answers()[0]!.params.prompt_fingerprint === "f1",
      `A number on the focused card must answer with the prompt's fingerprint (${JSON.stringify(answers()[0]?.params)})`,
    );
    check(
      (
        container.querySelector(".agent-chat-answered")?.textContent ?? ""
      ).startsWith("Sent 2 · Yes, always") &&
        !container.querySelector(".agent-chat-ask"),
      "A sent answer must replace the card with what was sent",
    );
    check(
      (
        container.querySelector(".agent-chat-answered")?.textContent ?? ""
      ).includes("another session now, so the key may have reached it"),
      "An unconfirmed answer must say why Chat cannot confirm it",
    );
    // The receipt survives the transcript moving on.
    reply = {
      ...reply,
      messages: [
        ...(reply.messages ?? []),
        message("a7", "assistant", "Pushed."),
      ],
      pending_prompt: null,
    };
    push();
    await settle();
    check(
      container.querySelector(".agent-chat-answered") !== null,
      "The answer's receipt must stay after the transcript updates",
    );
    // A prompt Chat cannot read safely offers the Terminal, never a guess.
    reply = {
      ...reply,
      pending_prompt: {
        question: ["Here is the plan:", "1. Inspect", "2. Test"],
        request: [],
        options: [],
        fingerprint: "f2",
      },
    };
    push();
    await settle();
    check(
      container.querySelectorAll(".agent-chat-ask-options button").length ===
        0 &&
        (
          container.querySelector(".agent-chat-ask")?.textContent ?? ""
        ).includes("Answer in the Terminal"),
      "An unreadable prompt must offer the Terminal and no answers",
    );
    // A question form's choices carry the description shown under each.
    reply = {
      ...reply,
      pending_prompt: {
        question: ["Which colour should the demo banner be?"],
        request: ["☐ Banner colour"],
        options: [
          {
            number: "1",
            label: "Red",
            key: "1",
            description: "Set the demo banner to red.",
          },
          { number: "2", label: "Green", key: "2" },
        ],
        fingerprint: "f2q",
      },
    };
    push();
    await settle();
    const choices = [
      ...container.querySelectorAll(".agent-chat-ask-options button"),
    ];
    check(
      choices.length === 2 &&
        choices[0]!.querySelector("small")?.textContent ===
          "Set the demo banner to red." &&
        !choices[1]!.querySelector("small"),
      "A question's choices must show their descriptions",
    );
    // Two Chats with questions: a key on one card never answers the other.
    reply = {
      ...reply,
      pending_prompt: { ...asking, fingerprint: "f3" },
    };
    root.render(
      <div>
        <AgentChat
          pane={pane("blocked", 51)}
          active
          onOpenTerminal={() => {}}
          onClose={() => {}}
        />
        <AgentChat
          pane={{ ...pane("blocked", 51), pane_id: "q" }}
          active
          onOpenTerminal={() => {}}
          onClose={() => {}}
        />
      </div>,
    );
    await settle();
    await settle();
    const cards = container.querySelectorAll<HTMLElement>(".agent-chat-ask");
    const before = answers().length;
    // This time the agent moves on, so the receipt says it was answered.
    answerAcknowledged = true;
    cards[0]!.focus();
    cards[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", bubbles: true }),
    );
    await settle();
    check(
      cards.length === 2 &&
        answers().length === before + 1 &&
        answers()[before]!.params.pane_id === "p",
      `One key must answer only the focused Chat (${answers().length - before})`,
    );
    check(
      (
        container.querySelector(".agent-chat-answered")?.textContent ?? ""
      ).startsWith("You answered 2 · Yes, always"),
      "An answer the agent moved on from must say it was answered",
    );
    render("working", true, 52);
    await settle();
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
        now.querySelector('.agent-chat-state-circle[title="Working"]') !==
          null &&
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
      const list = container.querySelector<HTMLElement>(".agent-history-chat")!;
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
        container.querySelector<HTMLButtonElement>(".agent-history-chat-jump");
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

    // A remounted Chat shows the conversation it had at once, from the kept
    // window, before the next read answers.
    {
      reply = conversation([
        message("keep-u", "user", "Keep this question"),
        message("keep-a", "assistant", "Kept answer"),
      ]);
      render("idle");
      push();
      await settle();
      await settle();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      historyAnswer = async () => {
        await gate;
        return historyOf(reply.messages ?? []);
      };
      root.render(<div />);
      await settle();
      render("idle");
      await settle();
      check(
        (
          container.querySelector(".agent-history-chat")?.textContent ?? ""
        ).includes("Kept answer"),
        "A remounted Chat lost its conversation while the next read was pending",
      );
      release();
      historyAnswer = null;
      await settle();
    }

    // A long, busy transcript stays responsive: History's window arrives once
    // and each change brings only what changed, so nothing re-reads or
    // re-renders the whole conversation. No task may block for 200 ms.
    {
      worldSourcesStore.publishSettled({
        ...EMPTY_WORLD_SOURCES,
        items: [
          {
            key: "github:pr:example/project#42",
            source: "github",
            kind: "pull_request",
            ref: "example/project#42",
            title: "Fix Chat",
            number: 42,
            repo: "example/project",
            url: "https://github.com/example/project/pull/42",
            lane: "review",
            status: "OPEN",
            roles: ["author"],
            updatedAt: 1,
          },
        ],
      });
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask" });
      let revision = 1000;
      const base: Record<string, unknown>[] = [];
      // 150 messages, so the 20 added below stay within History's window of
      // 200 conversation entries and every delta's order is the whole window.
      for (let index = 0; index < 150; index += 1) {
        base.push({
          id: `busy-${index}`,
          role: index % 2 ? "assistant" : "user",
          kind: "message",
          text:
            index === 1
              ? "READY #42"
              : `Busy message ${index}: **the queue** keeps its order.`,
          sent_at: "2026-10-22T09:00:00Z",
        });
        for (let tool = 0; tool < 15; tool += 1)
          base.push({
            id: `busy-${index}-tool-${tool}`,
            role: "tool",
            kind: tool % 2 ? "tool_result" : "tool_call",
            tool_name: "Bash",
            source_call_id: `busy-${index}-call-${tool >> 1}`,
            text: "",
            text_bytes: 5000,
            text_hash: `h${index}-${tool}`,
            sent_at: "2026-10-22T09:00:00Z",
          });
      }
      const order = base.map((entry) => entry.id as string);
      const head = {
        history_version: 2,
        window_limit: 200,
        agent: "claude",
        pane_id: "p",
        workspace_id: "Example",
        tab_id: "tab",
        updated_at: "2026-10-22T09:00:00Z",
        path: "",
      };
      let added: Record<string, unknown>[] = [];
      historyAnswer = (params) => {
        const cursor = params.cursor as { revision: number } | null;
        if (!cursor || cursor.revision < 1000)
          return {
            ...head,
            mode: "snapshot",
            cursor: { epoch: "busy", revision },
            entries: base,
          };
        const upserts = added;
        added = [];
        const base_revision = revision;
        revision += 1;
        return {
          ...head,
          mode: "delta",
          cursor: { epoch: "busy", revision },
          base_revision,
          upserts,
          removed: [],
          order: [...order],
        };
      };
      // Every call also has its step evidence, as Chat's steps read gives it.
      fixtureSteps = [];
      for (let index = 0; index < 150; index += 1)
        for (let call = 0; call < 8; call += 1) {
          const id = `busy-${index}-call-${call}`;
          fixtureSteps.push({
            id,
            call_id: id,
            tool: "Bash",
            label: "Run tests",
            input_summary: "bun test",
            state: call % 3 ? "ok" : "failed",
            started_at: "2026-10-22T09:00:00Z",
            ended_at: "2026-10-22T09:00:02Z",
            result_tail: "12 pass",
            diff: null,
            test: {
              runner: "bun",
              passed: 12,
              failed: call % 3 ? 0 : 1,
              first_failure: null,
            },
          });
        }
      reply = conversation([message("busy-0", "user", "Busy message 0")]);
      push();
      await settle();
      await settle();
      check(
        !!container.querySelector(
          '.pr-card[aria-label="Pull request example/project#42"]',
        ),
        "The busy fixture did not exercise the PR block registry",
      );
      longTasks.length = 0;
      for (let step = 0; step < 20; step += 1) {
        const id = `busy-new-${step}`;
        added.push({
          id,
          role: "tool",
          kind: "tool_call",
          tool_name: "Bash",
          text: "",
          text_bytes: 3000,
          text_hash: `n${step}`,
          sent_at: "2026-10-22T09:00:00Z",
        });
        added.push({
          id: `${id}-reply`,
          role: "assistant",
          kind: "message",
          text: `Live update ${step}.`,
          sent_at: "2026-10-22T09:00:00Z",
        });
        order.push(id, `${id}-reply`);
        push();
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await settle();
      await settle();
      observer.disconnect();
      check(
        (
          container.querySelector(".agent-history-chat")?.textContent ?? ""
        ).includes("Live update 19."),
        "The busy conversation did not show its newest message",
      );
      check(
        Math.max(0, ...longTasks) < 200,
        `A busy conversation blocked the page: long tasks ${JSON.stringify(longTasks.map(Math.round))}`,
      );

      // In the Inspector's window body, at the body sizes of a phone
      // (390×844), a laptop (1280×800), a half screen (960×1080), a wide
      // screen (1920×1080), a portrait screen (1080×1920) and a small floating
      // window, the long conversation scrolls inside the window and the
      // composer stays in it.
      for (const [width, height] of [
        [390, 660],
        [480, 525],
        [480, 800],
        [560, 800],
        [560, 1640],
        [320, 260],
      ] as const) {
        root.render(
          <div
            className="workspace-inspector-body"
            style={{ width, height, display: "flex", flex: "none" }}
          >
            <div className="workspace-inspector-resource inspector-history-resource">
              <AgentChat
                pane={pane("idle")}
                active
                onOpenTerminal={() => {}}
                onClose={() => {}}
              />
            </div>
          </div>,
        );
        await settle();
        await settle();
        const body = container
          .querySelector(".workspace-inspector-body")!
          .getBoundingClientRect();
        const list = container.querySelector<HTMLElement>(
          ".agent-history-chat",
        );
        const composer = container
          .querySelector(".agent-chat-composer")
          ?.getBoundingClientRect();
        check(
          !!list &&
            list.scrollHeight > list.clientHeight &&
            list.getBoundingClientRect().bottom <= body.bottom + 1,
          `At ${width}×${height} the conversation does not scroll inside the window`,
        );
        check(
          !!composer &&
            composer.height > 0 &&
            composer.top >= body.top &&
            composer.bottom <= body.bottom + 1,
          `At ${width}×${height} the composer is outside the window`,
        );
      }
      historyAnswer = null;
    }

    // On a phone, wide content (an unbroken path, a long command, a code
    // block, a table) wraps or scrolls inside its bubble: nothing in Chat,
    // the composer included, reaches past the window's right edge.
    {
      const wide = [
        `Saved to /srv/example/${"deeply-nested-folder/".repeat(12)}report.md`,
        "```\n" +
          `bun run check -- ${"--flag-with-a-long-name ".repeat(12)}` +
          "\n```",
        `| ${Array.from({ length: 12 }, (_, i) => `column ${i}`).join(" | ")} |\n|${" --- |".repeat(12)}\n| ${Array.from({ length: 12 }, () => "value").join(" | ")} |`,
        `https://example.com/${"segment-".repeat(30)}end`,
      ];
      const longPath = `/srv/example/${"deeply-nested-folder/".repeat(8)}shot.png`;
      reply = {
        ...conversation(
          [
            ...wide.map((text, index) =>
              message(`wide-${index}`, "assistant", text),
            ),
            message("wide-user", "user", `Please read ${"a/".repeat(60)}b.ts`),
          ],
          "working",
        ),
        terminal_title: `✳ Resume ${"the-long-running-task-name-".repeat(4)}`,
        running_tool: {
          id: "toolu_wide",
          name: "Bash",
          summary: `bun test ${"server/src/agent/very-long-path-".repeat(6)}`,
          started_at: new Date(Date.now() - 3_000).toISOString(),
        },
        deliveries: [
          {
            id: "d-wide",
            text: `Look at this ${longPath}`,
            sent_at: "2026-10-22T09:00:05Z",
            state: "pending",
            expected: "claude session shown",
            fingerprint: "b".repeat(64),
          },
        ],
        quest: {
          quest_version: 1,
          source: "todo",
          tool: "TodoWrite",
          title: `Resume ${"the-long-running-task-name-".repeat(4)}`,
          status: "active",
          steps: [
            {
              id: "s1",
              text: `Rebuild ${"a-very-long-step-description-".repeat(5)}`,
              status: "active",
              step_ids: [],
            },
          ],
          progress: { done: 0, total: 1 },
          started_at: "2026-10-22T09:00:00Z",
          updated_at: "2026-10-22T09:00:00Z",
          set_by: null,
          helpers: 0,
        },
      };
      document.documentElement.dataset.layout = "mobile";
      root.render(
        <div
          className="workspace-inspector-body"
          style={{ width: 390, height: 660, display: "flex", flex: "none" }}
        >
          <div className="workspace-inspector-resource inspector-history-resource">
            <AgentChat
              pane={{ ...pane("working"), pane_id: "wide" }}
              active
              onOpenTerminal={() => {}}
              onClose={() => {}}
            />
          </div>
        </div>,
      );
      await settle();
      await settle();
      const body = container
        .querySelector(".workspace-inspector-body")!
        .getBoundingClientRect();
      const list = container.querySelector<HTMLElement>(".agent-history-chat")!;
      // Markdown renders lazily; the code block and table are what widen.
      for (
        let tries = 0;
        tries < 50 && !container.querySelector(".agent-history-chat pre");
        tries += 1
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      await settle();
      check(
        !!container.querySelector(".agent-history-chat pre"),
        `The phone check needs its code block rendered: ${container.querySelector(".agent-history-chat-bubble")?.innerHTML.slice(0, 300)}`,
      );
      // Every element, not a chosen few: whatever widens the window counts.
      const wider = [
        ...container.querySelectorAll<HTMLElement>(".agent-chat *"),
      ]
        .filter(
          (element) =>
            element.getBoundingClientRect().width > 0 &&
            element.getBoundingClientRect().right > body.right + 1 &&
            !element.closest("pre, table"),
        )
        .slice(0, 6)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${element.className} ${Math.round(element.getBoundingClientRect().right)}`,
        );
      const resource = container.querySelector<HTMLElement>(
        ".workspace-inspector-resource",
      )!;
      check(
        wider.length === 0 && resource.scrollWidth <= resource.clientWidth + 1,
        `At 390 px these reach past the window: ${wider.join(", ")}; resource ${resource.scrollWidth}/${resource.clientWidth}`,
      );
      const cell = container.querySelector<HTMLElement>(
        ".agent-history-chat-bubble th",
      );
      check(
        !!cell && cell.getBoundingClientRect().width >= 40,
        `A wide table must scroll, not squeeze its cells (${cell?.getBoundingClientRect().width} px)`,
      );
      const outside = [
        ...container.querySelectorAll<HTMLElement>(
          ".agent-chat, .agent-history-chat-message, .agent-history-chat-bubble, .agent-chat-composer, .agent-chat-composer textarea",
        ),
      ].filter(
        (element) => element.getBoundingClientRect().right > body.right + 1,
      );
      check(
        outside.length === 0 && list.scrollWidth <= list.clientWidth + 1,
        `At 390 px wide content leaves the window: ${outside.map((element) => `${element.className} ${Math.round(element.getBoundingClientRect().right)}`).join(", ")}; list ${list.scrollWidth}/${list.clientWidth}`,
      );
      delete document.documentElement.dataset.layout;
    }

    // Scrolling back past History's window loads older messages a page at a
    // time, keeping the message being read in place.
    {
      const entry = (index: number) => ({
        id: `turn-${index}`,
        role: index % 2 ? "assistant" : "user",
        kind: "message",
        text: `Turn ${index} ${"with enough words to wrap a line. ".repeat(3)}`,
        sent_at: "2026-10-22T09:00:00Z",
      });
      const all = Array.from({ length: 60 }, (_, index) => entry(index));
      historyAnswer = () => ({
        history_version: 2,
        window_limit: 20,
        mode: "snapshot",
        cursor: { epoch: "paged", revision: 1 },
        agent: "claude",
        pane_id: "p",
        workspace_id: "Example",
        tab_id: "tab",
        updated_at: "2026-10-22T09:00:00Z",
        path: "",
        entries: all.slice(40),
      });
      olderAnswer = (params) => {
        const end = all.findIndex((item) => item.id === params.before);
        const start = Math.max(0, end - 20);
        return {
          epoch: "paged",
          entries: all.slice(start, end),
          has_more: start > 0,
        };
      };
      root.render(<div />);
      await settle();
      root.render(
        <div
          className="workspace-inspector-body"
          style={{ width: 390, height: 660, display: "flex", flex: "none" }}
        >
          <div className="workspace-inspector-resource inspector-history-resource">
            <AgentChat
              pane={{ ...pane("idle"), pane_id: "paged" }}
              active
              onOpenTerminal={() => {}}
              onClose={() => {}}
            />
          </div>
        </div>,
      );
      await settle();
      await settle();
      const list = container.querySelector<HTMLElement>(".agent-history-chat")!;
      check(
        !!container.querySelector(".agent-history-chat-older"),
        "A full window must offer earlier messages",
      );
      const before = olderReads();
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll"));
      await settle();
      await settle();
      const anchor = [
        ...container.querySelectorAll<HTMLElement>(
          ".agent-history-chat-message",
        ),
      ].find((element) => element.textContent?.includes("Turn 40 "));
      check(
        olderReads() === before + 1 &&
          (list.textContent ?? "").includes("Turn 20 ") &&
          !!anchor &&
          anchor.getBoundingClientRect().top >=
            list.getBoundingClientRect().top - 1 &&
          anchor.getBoundingClientRect().top <
            list.getBoundingClientRect().top + list.clientHeight / 2,
        `Scrolling to the top must load the previous page and keep the reader's place (${olderReads() - before} pages)`,
      );
      // The last page ends the offer.
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll"));
      await settle();
      await settle();
      check(
        (list.textContent ?? "").includes("Turn 0 ") &&
          !container.querySelector(".agent-history-chat-older"),
        "Earlier messages must load back to the first turn, then stop offering more",
      );
      historyAnswer = null;
      olderAnswer = null;
    }

    // A live refresh while the first older page is in flight: the turns the
    // window drops meanwhile stay between the page and the window.
    for (const mode of ["chat", "hook"] as const) {
      const entry = (index: number) => ({
        id: `race-${index}`,
        role: index % 2 ? "assistant" : "user",
        kind: "message",
        text: `Race ${index} ${"with enough words to wrap a line. ".repeat(3)}`,
        sent_at: "2026-10-22T09:00:00Z",
      });
      const all = Array.from({ length: 70 }, (_, index) => entry(index));
      let start = 40;
      let revision = 1;
      const paneId = `race-${mode}`;
      const probe: {
        current: ReturnType<typeof useAgentHistoryWindow> | null;
      } = {
        current: null,
      };
      historyAnswer = () => ({
        history_version: 2,
        window_limit: 20,
        mode: "snapshot",
        cursor: { epoch: "race", revision },
        agent: "claude",
        pane_id: paneId,
        workspace_id: "Example",
        tab_id: "tab",
        updated_at: "2026-10-22T09:00:00Z",
        path: "",
        entries: all.slice(start, start + 20),
      });
      const page = Promise.withResolvers<void>();
      olderAnswer = async (params) => {
        await page.promise;
        const end = all.findIndex((item) => item.id === params.before);
        return {
          epoch: "race",
          entries: all.slice(Math.max(0, end - 20), end),
          has_more: end > 20,
        };
      };
      root.render(<div />);
      await settle();
      root.render(
        <div
          className="workspace-inspector-body"
          style={{ width: 390, height: 660, display: "flex", flex: "none" }}
        >
          <div className="workspace-inspector-resource inspector-history-resource">
            {mode === "chat" ? (
              <AgentChat
                pane={{ ...pane("idle"), pane_id: paneId }}
                active
                onOpenTerminal={() => {}}
                onClose={() => {}}
              />
            ) : (
              <HistoryWindowProbe
                pane={{ ...pane("idle"), pane_id: paneId }}
                observe={(value) => {
                  probe.current = value;
                }}
              />
            )}
          </div>
        </div>,
      );
      await settle();
      await settle();
      const requestOlder = () => {
        if (mode === "hook") probe.current?.loadOlder();
        else {
          const list = container.querySelector<HTMLElement>(
            ".agent-history-chat",
          )!;
          list.scrollTop = 0;
          list.dispatchEvent(new Event("scroll"));
        }
      };
      const requestsBefore = olderReads();
      requestOlder();
      await settle();
      requestOlder();
      await settle();
      check(
        olderReads() === requestsBefore + 1,
        `${mode}: repeated requests must keep one older-page RPC while its reply is pending`,
      );
      // The window moves on by ten turns before the page arrives.
      start = 50;
      revision = 2;
      if (mode === "chat") push(paneId);
      else probe.current?.refresh();
      await settle();
      await settle();
      requestOlder();
      await settle();
      check(
        olderReads() === requestsBefore + 1,
        `${mode}: window eviction must not restart a pending older-page RPC`,
      );
      page.resolve();
      await settle();
      await settle();
      const shown =
        mode === "hook"
          ? (probe.current?.messages ?? []).map((entry) =>
              Number(/Race (\d+) /.exec(entry.text ?? "")?.[1]),
            )
          : [
              ...container.querySelectorAll<HTMLElement>(
                ".agent-history-chat-message p, .agent-history-chat-markdown",
              ),
            ]
              .map(
                (element) => /Race (\d+) /.exec(element.textContent ?? "")?.[1],
              )
              .filter((value): value is string => !!value)
              .map(Number);
      const expected = Array.from({ length: 50 }, (_, index) => index + 20);
      check(
        JSON.stringify([...new Set(shown)]) === JSON.stringify(expected),
        `${mode}: a refresh during the first older page must not leave a gap: ${JSON.stringify(shown)}`,
      );
      historyAnswer = null;
      olderAnswer = null;
    }

    // Bubbles keep a readable line length in a wide window (design docks
    // Chat at 520 px and lets it widen to 900 px or more).
    {
      reply = conversation([
        message(
          "measure",
          "assistant",
          "Measure the line length of a long answer with ordinary English words in it. ".repeat(
            6,
          ),
        ),
      ]);
      for (const width of [520, 900]) {
        root.render(
          <div
            className="workspace-inspector-body"
            style={{ width, height: 600, display: "flex", flex: "none" }}
          >
            <div className="workspace-inspector-resource inspector-history-resource">
              <AgentChat
                pane={{ ...pane("idle"), pane_id: `measure-${width}` }}
                active
                onOpenTerminal={() => {}}
                onClose={() => {}}
              />
            </div>
          </div>,
        );
        for (
          let tries = 0;
          tries < 30 &&
          !container.querySelector(".agent-history-chat-markdown p");
          tries += 1
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        await settle();
        const text = container.querySelector<HTMLElement>(
          ".agent-history-chat-markdown p",
        )!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const lines = new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top)),
        ).size;
        const perLine = Math.round(text.textContent!.length / lines);
        check(
          perLine >= 55 && perLine <= 80,
          `At ${width} px a bubble line holds about ${perLine} characters`,
        );
      }
    }

    // A send not yet in the transcript (a busy harness writes a queued
    // message only when the agent takes it up) sits at its send time, never
    // below replies written since, as delivered and waiting. A multi-line
    // turn Claude Code wrapped as a paste shows the words, marked pasted.
    {
      const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
      reply = {
        ...conversation([
          {
            ...message(
              "late-1",
              "user",
              '<pasted_content id="4821">\nEarlier question\nover two lines\n</pasted_content id="4821">',
            ),
            sent_at: ago(300_000),
          },
          {
            ...message("late-2", "assistant", "Reply after the send"),
            sent_at: ago(60_000),
          },
        ]),
        deliveries: [
          {
            id: "d-late",
            text: "Also check the docs",
            sent_at: ago(180_000),
            state: "pending",
            expected: "claude session shown",
            fingerprint: "a".repeat(64),
          },
          {
            id: "d-now",
            text: "Just sent",
            sent_at: ago(1_000),
            state: "pending",
            expected: "claude session shown",
            fingerprint: "a".repeat(64),
          },
        ],
      };
      root.render(
        <AgentChat
          pane={{ ...pane("idle"), pane_id: "late" }}
          active
          onOpenTerminal={() => {}}
          onClose={() => {}}
        />,
      );
      await settle();
      await settle();
      const order = [
        ...container.querySelectorAll<HTMLElement>(
          ".agent-history-chat-message",
        ),
      ].map(
        (element) =>
          element.dataset.delivery ??
          element.querySelector("p")?.textContent ??
          "",
      );
      check(
        JSON.stringify(order) ===
          JSON.stringify([
            "Earlier question\nover two lines",
            "pending",
            "Reply after the send",
            "pending",
          ]),
        `Unseen sends must sit at their send time: ${JSON.stringify(order)}`,
      );
      check(
        (
          container.querySelector('[data-delivery="pending"]')?.textContent ??
          ""
        ).includes("Delivered · waiting for claude"),
        "An unseen send must read as delivered and waiting",
      );
      check(
        !(container.textContent ?? "").includes("pasted_content") &&
          !!container.querySelector(".agent-history-chat-pasted"),
        "A pasted turn must show its words, marked as pasted, not its wrapper",
      );
    }

    // History's read fails while the summary reads: Chat says so instead of
    // loading forever, and Refresh retries History as well.
    {
      reply = conversation([message("r1", "assistant", "Recovered answer")]);
      historyAnswer = () => {
        throw new Error("History read failed.");
      };
      root.render(<div />);
      await settle();
      render("idle", true, 99);
      await settle();
      await settle();
      const text = () =>
        container.querySelector(".agent-chat")?.textContent ?? "";
      check(
        text().includes("History read failed.") &&
          !text().includes("Loading conversation"),
        `A failed History read was not shown: ${text().slice(0, 200)}`,
      );
      historyAnswer = null;
      container
        .querySelector<HTMLButtonElement>('[aria-label="Refresh conversation"]')
        ?.click();
      await settle();
      await settle();
      check(
        text().includes("Recovered answer") &&
          !text().includes("History read failed."),
        "Refresh did not retry History's read",
      );

      // Loaded, then a failed read, then a retry that succeeds with nothing
      // new (the same cursor): the warning goes and the messages stay.
      const refresh = () =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Refresh conversation"]',
          )
          ?.click();
      historyAnswer = () => {
        throw new Error("History read failed again.");
      };
      refresh();
      await settle();
      await settle();
      check(
        text().includes("History read failed again.") &&
          text().includes("Recovered answer"),
        "A failed History refresh must warn and keep the last window",
      );
      let unchanged = 0;
      historyAnswer = (params) => {
        unchanged += 1;
        const cursor = params.cursor as { epoch: string; revision: number };
        return {
          ...historyOf([]),
          mode: "delta",
          cursor,
          base_revision: cursor.revision,
          upserts: [],
          removed: [],
          entries: undefined,
        };
      };
      refresh();
      await settle();
      await settle();
      check(
        unchanged > 0 &&
          !text().includes("History read failed again.") &&
          text().includes("Recovered answer"),
        "A successful History retry with nothing new left the warning up",
      );
      historyAnswer = null;
    }

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
