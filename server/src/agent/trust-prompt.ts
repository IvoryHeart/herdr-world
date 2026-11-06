import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { PendingPrompt } from "./pending-prompt";
import { PROMPT_SCREEN_LINES } from "./pending-prompt";
import type { HerdrCall } from "./session-types";
import { isRecord, normalizeAgentName, stringValue } from "./session-utils";

/**
 * Claude Code's folder-trust question, shown before Claude starts a session:
 * "Quick safety check: …", two unnumbered choices with "No, exit" first and
 * the ❯ cursor on exactly one, and the footer "Enter to confirm · Esc to
 * cancel". The arrow keys move the cursor and Enter confirms the choice under
 * it; there are no digit shortcuts.
 *
 * With no session there is no session fingerprint to bind input to, so Chat
 * binds it to a pre-session witness instead: this connection's runtime (the
 * source belongs to one), the pane, its terminal, Claude as the agent with no
 * session reported, and the pane's foreground process group and processes.
 * Every key is sent only after the witness and the exact menu are read again;
 * a session arriving, another process, another terminal or another menu
 * refuses. Ordinary Chat sending stays bound to a session.
 */
export type TrustChoice = "cancel" | "confirm";

const FOOTER = /^\s*Enter to confirm · Esc to cancel\s*$/u;
const LABELS: Record<string, TrustChoice> = {
  "No, exit": "cancel",
  "No, continue without these permissions": "cancel",
  "Yes, I trust this folder": "confirm",
};
const OPTION = /^\s*(❯)?\s*(\S.*?)\s*$/u;
const QUICK = /^\s*Quick safety check:/u;
const EDGE = /^\s*(?:[─━▔]{3,}|╭─+╮)\s*$/u;

type ParsedTrust = {
  shown: string[];
  request: string[];
  question: string[];
  options: { label: string; choice: TrustChoice; cursor: boolean }[];
};

/** The complete trust question at the bottom of a screen, or null. */
export function parseTrustPrompt(screen: string): ParsedTrust | null {
  const lines = screen.split("\n").map((line) => line.replace(/\s+$/, ""));
  let end = lines.length - 1;
  while (end >= 0 && !lines[end]!.trim()) end -= 1;
  if (end < 0 || !FOOTER.test(lines[end]!)) return null;
  let row = end - 1;
  while (row >= 0 && !lines[row]!.trim()) row -= 1;
  // Exactly two choice rows, directly one above the other.
  if (row < 1 || !lines[row - 1]!.trim()) return null;
  const rows = [lines[row - 1]!, lines[row]!].map((line) => OPTION.exec(line));
  const options = rows.map((match) => ({
    label: match?.[2] ?? "",
    choice: LABELS[match?.[2] ?? ""],
    cursor: Boolean(match?.[1]),
  }));
  if (
    options[0]?.choice !== "cancel" ||
    options[1]?.choice !== "confirm" ||
    options.filter((option) => option.cursor).length !== 1
  )
    return null;
  // The question sits above the choices, below the dialog's edge if drawn.
  let quick = row - 2;
  while (quick >= Math.max(0, row - 30) && !QUICK.test(lines[quick]!))
    quick -= 1;
  if (quick < 0 || !QUICK.test(lines[quick]!)) return null;
  let top = quick - 1;
  while (top >= Math.max(0, quick - 12) && !EDGE.test(lines[top]!)) top -= 1;
  const start = top >= 0 && EDGE.test(lines[top]!) ? top + 1 : quick;
  const body = lines.slice(quick, row - 1);
  if (body.some((line) => FOOTER.test(line) || /^\s*❯/u.test(line)))
    return null;
  const trim = (part: string[]) =>
    part.map((line) => line.trim()).filter(Boolean);
  return {
    shown: lines.slice(start, end + 1),
    request: trim(lines.slice(start, quick)),
    question: trim(body),
    options: options as ParsedTrust["options"],
  };
}

/** Fields of Herdr's agent record that must not change around a key. */
const IDENTITY = [
  "pane_id",
  "agent",
  "agent_session",
  "terminal_id",
  "state_change_seq",
  "terminal_title",
  "revision",
] as const;

export type TrustResult =
  | {
      status: "sent";
      choice: TrustChoice;
      label: string;
      /** The trust question no longer shows after Enter. */
      acknowledged: boolean;
    }
  | {
      status: "refused";
      reason: "changed" | "unknown_option" | "busy";
      message: string;
      prompt: PendingPrompt | null;
    };

const CHANGED =
  "Claude's trust question changed, or Claude has started. Nothing was sent; check it and try again.";

export function createTrustPrompts(args: {
  herdrCall: HerdrCall;
  agentInfo(paneId: string): Promise<Record<string, unknown> | null>;
  /** Panes with a World input in flight, shared with Chat's other input. */
  active: Set<string>;
  delay?(ms: number): Promise<void>;
}) {
  // A witness cannot be replayed in another connection runtime or source.
  const runtime = randomUUID();
  let closed = false;
  const delay =
    args.delay ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  /** The pre-session witness: null once a session or another agent shows. */
  const witness = async (paneId: string) => {
    if (closed) return null;
    const info = await args.agentInfo(paneId);
    if (
      !info ||
      info.pane_id !== paneId ||
      normalizeAgentName(stringValue(info.agent)) !== "claude" ||
      (info.agent_session !== undefined && info.agent_session !== null) ||
      !stringValue(info.terminal_id)
    )
      return null;
    const result = await args.herdrCall("pane.process_info", {
      pane_id: paneId,
    });
    const process =
      isRecord(result) && isRecord(result.process_info)
        ? result.process_info
        : null;
    const foreground = Array.isArray(process?.foreground_processes)
      ? process.foreground_processes
      : [];
    if (
      !foreground.length ||
      !foreground.every(
        (item) =>
          isRecord(item) &&
          Number.isSafeInteger(item.pid) &&
          Number(item.pid) > 1,
      ) ||
      !Number.isSafeInteger(process?.foreground_process_group_id) ||
      Number(process?.foreground_process_group_id) <= 1
    )
      return null;
    const current = await args.agentInfo(paneId);
    if (
      closed ||
      !current ||
      IDENTITY.some(
        (name) =>
          JSON.stringify(current[name] ?? null) !==
          JSON.stringify(info[name] ?? null),
      )
    )
      return null;
    return {
      info,
      key: JSON.stringify([
        runtime,
        paneId,
        "claude",
        info.terminal_id,
        process!.foreground_process_group_id,
        foreground
          .map((item) => [item.pid, basename(stringValue(item.name))])
          .sort(),
      ]),
    };
  };

  /** The trust question shown under `seen`, or null. */
  const readUnder = async (
    paneId: string,
    seen: { key: string },
  ): Promise<{ prompt: PendingPrompt; menu: string } | null> => {
    const result = await args.herdrCall("pane.read", {
      pane_id: paneId,
      source: "recent",
      lines: PROMPT_SCREEN_LINES,
      format: "text",
      strip_ansi: true,
    });
    const text =
      isRecord(result) &&
      isRecord(result.read) &&
      typeof result.read.text === "string"
        ? result.read.text
        : null;
    const parsed = text === null ? null : parseTrustPrompt(text);
    if (!parsed) return null;
    const hash = (value: unknown) =>
      createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex")
        .slice(0, 32);
    const cursor = parsed.options.find((option) => option.cursor)!.choice;
    return {
      prompt: {
        question: parsed.question,
        request: parsed.request,
        options: parsed.options.map((option) => ({
          number: "",
          label: option.label,
          key: option.choice,
          ...(option.cursor ? { cursor: true } : {}),
        })),
        trust: { cursor },
        fingerprint: hash(["trust", seen.key, parsed.shown]),
      },
      // The same menu with the cursor anywhere.
      menu: hash([
        seen.key,
        parsed.shown.map((line) => line.replace(/❯/gu, " ")),
      ]),
    };
  };

  /** The trust question in a pane with no session, or null. */
  const read = async (paneId: string): Promise<PendingPrompt | null> => {
    const seen = await witness(paneId);
    if (!seen) return null;
    const shown = await readUnder(paneId, seen);
    // Read again: the question belongs to the witness only if it held.
    const after = await witness(paneId);
    return shown &&
      after?.key === seen.key &&
      IDENTITY.every(
        (name) =>
          JSON.stringify(after.info[name] ?? null) ===
          JSON.stringify(seen.info[name] ?? null),
      )
      ? shown.prompt
      : null;
  };

  /**
   * Send one key, only while the witness holds and the pane shows exactly
   * `expected`; Herdr's record must not change across that check.
   */
  const sendChecked = async (
    paneId: string,
    seen: { key: string },
    expected: string,
    key: string,
  ) => {
    const before = await witness(paneId);
    if (before?.key !== seen.key) return false;
    const shown = await readUnder(paneId, seen);
    if (shown?.prompt.fingerprint !== expected) return false;
    const after = await witness(paneId);
    if (
      closed ||
      after?.key !== seen.key ||
      IDENTITY.some(
        (name) =>
          JSON.stringify(after.info[name] ?? null) !==
          JSON.stringify(before.info[name] ?? null),
      )
    )
      return false;
    await args.herdrCall("pane.send_input", {
      pane_id: paneId,
      text: "",
      keys: [key],
    });
    return true;
  };

  const choose = async ({
    pane_id,
    prompt_fingerprint,
    choice,
  }: {
    pane_id: string;
    prompt_fingerprint: string;
    choice: string;
  }): Promise<TrustResult> => {
    const refuse = (
      message: string,
      prompt: PendingPrompt | null = null,
      reason: "changed" | "unknown_option" = "changed",
    ): TrustResult => ({ status: "refused", reason, message, prompt });
    if (choice !== "cancel" && choice !== "confirm")
      return refuse(
        "That is not one of Claude's choices. Nothing was sent.",
        null,
        "unknown_option",
      );
    const seen = await witness(pane_id);
    if (!seen) return refuse(CHANGED);
    let shown = await readUnder(pane_id, seen);
    if (!shown || shown.prompt.fingerprint !== prompt_fingerprint)
      return refuse(CHANGED, shown?.prompt ?? null);
    const menu = shown.menu;
    const label = shown.prompt.options.find(
      (option) => option.key === choice,
    )!.label;
    // Two choices: one arrow key at most puts the cursor on the one picked.
    if (shown.prompt.trust!.cursor !== choice) {
      const from = shown.prompt.fingerprint;
      if (
        !(await sendChecked(
          pane_id,
          seen,
          from,
          choice === "confirm" ? "down" : "up",
        ))
      )
        return refuse(CHANGED);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await delay(150);
        const now = await witness(pane_id);
        shown = now?.key === seen.key ? await readUnder(pane_id, seen) : null;
        if (!shown || shown.menu !== menu)
          return refuse(
            "The trust question changed after Chat moved its selection, so Chat did not confirm anything. Check the Terminal.",
            shown?.prompt ?? null,
          );
        if (shown.prompt.fingerprint !== from) break;
      }
      if (shown.prompt.trust!.cursor !== choice)
        return refuse(
          `Claude did not move its selection to "${label}" (it ignores keys just after the question opens). Nothing was confirmed; try again.`,
          shown.prompt,
        );
    }
    if (!(await sendChecked(pane_id, seen, shown.prompt.fingerprint, "enter")))
      return refuse(CHANGED);
    let acknowledged = false;
    for (let attempt = 0; attempt < 4 && !acknowledged; attempt += 1) {
      await delay(150);
      const now = await witness(pane_id);
      acknowledged =
        now?.key !== seen.key ||
        (await readUnder(pane_id, seen))?.menu !== menu;
    }
    return { status: "sent", choice, label, acknowledged };
  };

  return {
    close: () => {
      closed = true;
    },
    read,
    /** One input per pane at a time, shared with Chat's other input. */
    choose: async (target: Parameters<typeof choose>[0]) => {
      if (args.active.has(target.pane_id))
        return {
          status: "refused",
          reason: "busy",
          message:
            "Chat is already sending to this pane. Check the current question before trying again.",
          prompt: null,
        } satisfies TrustResult;
      args.active.add(target.pane_id);
      try {
        return await choose(target);
      } catch {
        return {
          status: "refused",
          reason: "changed",
          message:
            "Chat could not verify Claude's trust question. Check the Terminal before trying again.",
          prompt: null,
        } satisfies TrustResult;
      } finally {
        args.active.delete(target.pane_id);
      }
    },
  };
}
