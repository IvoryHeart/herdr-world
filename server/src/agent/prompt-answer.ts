import type {
  ConversationSource,
  AnswerUnconfirmedReason,
} from "./conversation";
import { createMenuPresser } from "./menu-keys";
import type { PendingPrompt } from "./pending-prompt";
import type { HerdrCall } from "./session-types";
import { isRecord, normalizeAgentName, stringValue } from "./session-utils";
const MOVED_ON = new Set(["working", "idle", "done"]);

/** The captured empty Claude composer is one blank prompt row between rules.
 * Additional rows can contain a multiline draft, even if its first row is blank. */
function emptyDiscussionComposer(text: string | null) {
  if (text === null) return false;
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  const prompt = lines.findLastIndex((line) => line.startsWith("❯"));
  return (
    prompt > 0 &&
    /^─{3,}$/.test(lines[prompt - 1]!) &&
    /^❯[ \t\u00a0]*$/.test(lines[prompt]!) &&
    lines[prompt + 1] === lines[prompt - 1]
  );
}

type PromptActionArgs = {
  herdrCall: HerdrCall;
  agentInfo(paneId: string): Promise<Record<string, unknown> | null>;
  readPrompt(
    paneId: string,
    info: Record<string, unknown> | null,
  ): Promise<PendingPrompt | null>;
  isCodexBound(paneId: string): Promise<boolean>;
};

/** Answer only the checked screen in its originating pane and session. */
export function createPromptAnswerer(
  args: PromptActionArgs,
): ConversationSource["answer"] {
  return createPromptActions(args).answer;
}

/**
 * Chat's input to an agent's pane, one action per pane at a time: answering
 * its question, and pressing keys in its command menus or from the composer.
 */
export function createPromptActions(
  args: PromptActionArgs & {
    /** Read a command menu shown while the agent is idle or done. */
    readMenu?(
      paneId: string,
      info: Record<string, unknown> | null,
    ): Promise<PendingPrompt | null>;
    /** The session Chat would send to in this pane, or null. */
    sessionFingerprint?(paneId: string): Promise<string | null>;
    delay?(ms: number): Promise<void>;
  },
): Pick<ConversationSource, "answer" | "press"> {
  const answer: ConversationSource["answer"] = async ({
    pane_id,
    key,
    prompt_fingerprint,
    text,
  }) => {
    let discussionState: Record<string, unknown> | null = null;
    // Herdr has no conditional input (herdr#4764), so the key cannot be
    // made conditional on the prompt. World checks as close to the key as
    // it can: Herdr's state, the screen, then Herdr's state again, and any
    // difference refuses. A change between the last check and the key is
    // not caught; Chat says so on the card and docs/CHAT.md explains it.
    const before = await args.agentInfo(pane_id);
    const refuse = (
      reason: "not_blocked" | "changed" | "unknown_option" | "invalid_text",
      message: string,
      pending_prompt: PendingPrompt | null = null,
    ) => ({ status: "refused" as const, reason, message, pending_prompt });
    if (stringValue(before?.agent_status) !== "blocked")
      return refuse(
        "not_blocked",
        "The agent is no longer waiting on a question. Nothing was sent.",
      );
    if (normalizeAgentName(stringValue(before?.agent)) === "codex") {
      if (!(await args.isCodexBound(pane_id)))
        return refuse(
          "changed",
          "This Codex conversation is not tied to the pane. Answer in the Terminal.",
        );
    }
    const prompt = await args.readPrompt(pane_id, before);
    if (!prompt || prompt.fingerprint !== prompt_fingerprint)
      return refuse(
        "changed",
        "The question changed. Nothing was sent; check it and answer again.",
        prompt,
      );
    const option = prompt.options.find((candidate) => candidate.key === key);
    if (prompt.options.some((candidate) => candidate.active))
      return refuse(
        "changed",
        "A native text editor is already open. No input was sent; continue in the Terminal.",
        prompt,
      );
    if (!option)
      return refuse(
        "unknown_option",
        "That is not one of the agent's options. Nothing was sent; answer in the Terminal.",
        prompt,
      );
    if (
      option.input
        ? typeof text !== "string" ||
          !text.trim() ||
          text.length > 4000 ||
          /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text) ||
          (option.input === "chat" && /^[!#/]/.test(text.trimStart()))
        : text !== undefined
    )
      return refuse(
        "invalid_text",
        option.input
          ? "Write a single-line text answer (up to 4000 characters). Discussion replies cannot start with a command. Nothing was sent."
          : "That option does not accept text. Nothing was sent.",
        prompt,
      );
    const after = await args.agentInfo(pane_id);
    const same = (name: string) =>
      JSON.stringify(after?.[name] ?? null) ===
      JSON.stringify(before?.[name] ?? null);
    if (
      stringValue(after?.agent_status) !== "blocked" ||
      ![
        "agent",
        "terminal_id",
        "state_change_seq",
        "agent_session",
        "terminal_title",
        "revision",
      ].every(same)
    )
      return refuse(
        "changed",
        "The agent changed while Chat checked its question. Nothing was sent; check it and answer again.",
      );
    await args.herdrCall("pane.send_input", {
      pane_id,
      text: "",
      keys: [option.key],
    });
    if (option.input) {
      // Wait on Herdr's output event, then recheck the destination before
      // writing text. A selected option alone does not prove an editor opened.
      const escapedLabel = option.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      try {
        await args.herdrCall("pane.wait_for_output", {
          pane_id,
          source: "visible",
          strip_ansi: true,
          timeout_ms: 3000,
          match: {
            type: "regex",
            value:
              option.input === "text"
                ? `(?m)^\\s*❯\\s*${option.number}\\.\\s*${escapedLabel}\\s*$`
                : "(?m)^❯[ \t\u00a0]*$",
          },
        });
        if (option.input === "chat")
          await args.herdrCall("agent.wait", {
            target: pane_id,
            until: [...MOVED_ON],
            timeout_ms: 3000,
          });
      } catch {
        return refuse(
          "changed",
          "The option was selected, but Chat could not verify its text editor. No text was sent; continue in the Terminal.",
        );
      }
      const current = await args.agentInfo(pane_id);
      const sameSession =
        current &&
        ["agent", "agent_session", "revision", "terminal_id"].every(
          (name) =>
            JSON.stringify(current[name] ?? null) ===
            JSON.stringify(before?.[name] ?? null),
        );
      if (!sameSession)
        return refuse(
          "changed",
          "The pane changed after selecting the option. No text was sent; check the Terminal.",
        );
      if (option.input === "text") {
        const editor = await args.readPrompt(pane_id, current);
        const selected = editor?.options.find((item) => item.key === key);
        if (
          stringValue(current.agent_status) !== "blocked" ||
          !selected?.active ||
          selected.input !== "text" ||
          selected.label !== option.label ||
          JSON.stringify([editor?.question, editor?.request, editor?.steps]) !==
            JSON.stringify([prompt.question, prompt.request, prompt.steps])
        )
          return refuse(
            "changed",
            "The text editor no longer belongs to this question. No text was sent; check the Terminal.",
            editor,
          );
        const checked = await args.agentInfo(pane_id);
        if (
          !checked ||
          [
            "agent",
            "agent_session",
            "terminal_id",
            "state_change_seq",
            "revision",
            "terminal_title",
          ].some(
            (name) =>
              JSON.stringify(checked[name] ?? null) !==
              JSON.stringify(current[name] ?? null),
          )
        )
          return refuse(
            "changed",
            "The pane changed while Chat checked the text editor. No text was sent; check the Terminal.",
          );
        await args.herdrCall("pane.send_input", {
          pane_id,
          text: text!,
          keys: ["enter"],
        });
      } else {
        if (!MOVED_ON.has(stringValue(current.agent_status)))
          return refuse(
            "changed",
            "The agent has another question now. No text was sent; check the Terminal.",
          );
        const screen = await args.herdrCall("pane.read", {
          pane_id,
          source: "visible",
          format: "text",
          strip_ansi: true,
        });
        const content =
          isRecord(screen) &&
          isRecord(screen.read) &&
          typeof screen.read.text === "string"
            ? screen.read.text
            : null;
        const checked = await args.agentInfo(pane_id);
        if (
          !emptyDiscussionComposer(content) ||
          !checked ||
          [
            "agent",
            "agent_session",
            "revision",
            "terminal_id",
            "state_change_seq",
            "terminal_title",
            "agent_status",
          ].some(
            (name) =>
              JSON.stringify(checked[name] ?? null) !==
              JSON.stringify(current[name] ?? null),
          ) ||
          !MOVED_ON.has(stringValue(checked.agent_status))
        )
          return refuse(
            "changed",
            "The discussion composer changed or already contains text. No text was sent; continue in the Terminal.",
          );
        // The normal prompt operation pastes literal text and submits it,
        // and refuses if the agent became blocked before dispatch.
        discussionState = checked;
        const sent = await args.herdrCall("agent.prompt", {
          target: pane_id,
          text: text!,
        });
        if (
          !isRecord(sent) ||
          !isRecord(sent.agent) ||
          sent.agent.pane_id !== pane_id
        )
          throw new Error(
            "Herdr did not confirm the text submission. Check the Terminal before trying again.",
          );
        // agent.prompt confirms queuing, before hooks or screen detection can
        // report the new turn. Wait once for that evidence, without resending.
        try {
          await args.herdrCall("agent.wait", {
            target: pane_id,
            until: ["working"],
            timeout_ms: 3000,
          });
        } catch {
          // A quick turn may already be idle/done. Inspect its sequence below
          // even if the wait times out or cannot observe the working state.
        }
      }
    }
    // An answer is acknowledged only on evidence that this agent moved on
    // from this prompt: the same session, then a status that shows progress
    // (working, idle or done), or a new state and a different question on
    // a readable screen. No agent, another session, an unrecognised status,
    // an unreadable screen or the same question leaves it unconfirmed, with
    // the reason.
    const unconfirmed = await args
      .agentInfo(pane_id)
      .then(async (info): Promise<AnswerUnconfirmedReason | null> => {
        const status = stringValue(info?.agent_status);
        if (!info || !status) return "agent_missing";
        if (
          JSON.stringify(info.agent_session ?? null) !==
          JSON.stringify(before?.agent_session ?? null)
        )
          return "session_changed";
        if (discussionState) {
          if (
            ["agent", "agent_session", "revision", "terminal_id"].some(
              (name) =>
                JSON.stringify(info[name] ?? null) !==
                JSON.stringify(discussionState![name] ?? null),
            )
          )
            return "session_changed";
          const beforeSeq = discussionState.state_change_seq;
          const afterSeq = info.state_change_seq;
          if (
            typeof beforeSeq !== "number" ||
            !Number.isSafeInteger(beforeSeq) ||
            typeof afterSeq !== "number" ||
            !Number.isSafeInteger(afterSeq)
          )
            return "no_progress";
          const progress = afterSeq - beforeSeq;
          return (status === "working" && progress > 0) ||
            ((status === "idle" || status === "done") && progress >= 2)
            ? null
            : "no_progress";
        }
        if (MOVED_ON.has(status)) return null;
        if (status !== "blocked") return "unknown_status";
        // Read under the checked state, so only what the screen shows
        // counts as a different question. A form's next question can
        // follow with no new Herdr state; a new state with a changed
        // screen is the agent's next prompt.
        const shown = await args.readPrompt(pane_id, before);
        if (!shown) return "unreadable";
        const asks = (asked: PendingPrompt) =>
          JSON.stringify([
            asked.question,
            asked.request,
            asked.options.map((option) => option.label),
            asked.steps ?? null,
          ]);
        // Only a recognised menu is a next question; a partial or
        // unrecognised screen (no options) proves nothing, whether or not
        // Herdr's state moved.
        if (!shown.options.length) return "still_showing";
        return asks(shown) !== asks(prompt) ||
          (shown.fingerprint !== prompt.fingerprint &&
            info.state_change_seq !== before?.state_change_seq)
          ? null
          : "still_showing";
      })
      .catch(() => "unreadable" as const);
    return {
      status: "sent" as const,
      key: option.key,
      number: option.number,
      label: option.label,
      ...(option.input ? { text } : {}),
      acknowledged: unconfirmed === null,
      unconfirmed_reason: unconfirmed,
      prompt_fingerprint: prompt.fingerprint,
    };
  };
  const press = createMenuPresser(args);
  const active = new Set<string>();
  const once =
    <T extends { pane_id: string }, R>(
      run: (target: T) => Promise<R>,
      busy: R,
    ) =>
    async (target: T) => {
      if (active.has(target.pane_id)) return busy;
      active.add(target.pane_id);
      try {
        return await run(target);
      } finally {
        active.delete(target.pane_id);
      }
    };
  const message =
    "Chat is already sending to this pane. Check the current question before trying again.";
  return {
    answer: once(answer, {
      status: "refused",
      reason: "busy",
      message,
      pending_prompt: null,
    }),
    press: once(press, {
      status: "refused",
      reason: "busy",
      message,
      menu: null,
    }),
  };
}
