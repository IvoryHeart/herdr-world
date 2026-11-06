import { CHAT_KEY } from "../../../shared/chatKeys";
import type { ConversationSource } from "./conversation";
import type { PendingPrompt } from "./pending-prompt";
import type { HerdrCall } from "./session-types";
import { stringValue } from "./session-utils";

/** What a command menu's text field takes: one line, no control characters. */
const FIELD_TEXT_LIMIT = 500;

// Herdr may report a command menu blocked; the reader decides whether a
// blocked screen is a menu or a question.
const MENU_STATUSES = new Set(["idle", "done", "blocked"]);
const IDENTITY = [
  "agent",
  "agent_session",
  "terminal_id",
  "state_change_seq",
  "terminal_title",
  "revision",
] as const;

/**
 * Press one key, or type into a command menu's field, in an agent's pane,
 * bound to the Chat session that showed it. With a menu fingerprint the key
 * must be one that menu names, and the pane must still show that same menu;
 * without one it is a composer key control, checked against the session
 * only. Herdr has no conditional input (herdr#4764): a change between the
 * last check and the key is not caught.
 */
export function createMenuPresser(args: {
  herdrCall: HerdrCall;
  agentInfo(paneId: string): Promise<Record<string, unknown> | null>;
  readMenu?(
    paneId: string,
    info: Record<string, unknown> | null,
  ): Promise<PendingPrompt | null>;
  sessionFingerprint?(paneId: string): Promise<string | null>;
  delay?(ms: number): Promise<void>;
}): ConversationSource["press"] {
  const delay =
    args.delay ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const readMenu = async (
    paneId: string,
    info: Record<string, unknown> | null,
  ) =>
    args.readMenu && MENU_STATUSES.has(stringValue(info?.agent_status))
      ? args.readMenu(paneId, info)
      : null;
  return async ({
    pane_id,
    key,
    text,
    session_fingerprint,
    menu_fingerprint,
  }) => {
    const refuse = (
      reason: "changed" | "unknown_option" | "invalid_text",
      message: string,
      menu: PendingPrompt | null = null,
    ) => ({ status: "refused" as const, reason, message, menu });
    const before = await args.agentInfo(pane_id);
    if (
      !before ||
      !args.sessionFingerprint ||
      !session_fingerprint ||
      (await args.sessionFingerprint(pane_id)) !== session_fingerprint
    )
      return refuse(
        "changed",
        "The conversation in this pane changed. Nothing was sent; check it before trying again.",
      );
    let menu: PendingPrompt | null = null;
    if (menu_fingerprint !== undefined) {
      menu = await readMenu(pane_id, before);
      if (!menu || menu.fingerprint !== menu_fingerprint)
        return refuse(
          "changed",
          menu
            ? "The menu changed. Nothing was sent; check it and try again."
            : "The menu is no longer open. Nothing was sent.",
          menu,
        );
      if (text !== undefined) {
        if (menu.menu?.field === undefined)
          return refuse(
            "invalid_text",
            "This menu has no text field. Nothing was sent.",
            menu,
          );
        if (
          !text ||
          text.length > FIELD_TEXT_LIMIT ||
          /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)
        )
          return refuse(
            "invalid_text",
            `Type one line of text (up to ${FIELD_TEXT_LIMIT} characters). Nothing was sent.`,
            menu,
          );
      } else if (
        !key ||
        !(
          menu.options.some((option) => option.key === key) ||
          menu.menu?.controls.some((control) => control.key === key)
        )
      )
        return refuse(
          "unknown_option",
          "That key is not one this menu offers. Nothing was sent.",
          menu,
        );
    } else if (text !== undefined || !CHAT_KEY.test(key))
      return refuse(
        "unknown_option",
        "Chat cannot press that key. Nothing was sent.",
      );
    // Check the pane again as close to the key as possible.
    const after = await args.agentInfo(pane_id);
    if (
      !after ||
      IDENTITY.some(
        (name) =>
          JSON.stringify(after[name] ?? null) !==
          JSON.stringify(before[name] ?? null),
      )
    )
      return refuse(
        "changed",
        "The agent changed while Chat checked it. Nothing was sent; check it and try again.",
      );
    await args.herdrCall(
      "pane.send_input",
      text !== undefined
        ? { pane_id, text, keys: [] }
        : { pane_id, text: "", keys: [key] },
    );
    // A harness redraws its menu shortly after a key. Read until the screen
    // differs from the one checked, for at most about half a second, so Chat
    // shows the next step rather than the one it answered.
    let next: PendingPrompt | null = menu;
    if (menu)
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await delay(150);
        const info = await args.agentInfo(pane_id);
        next = await readMenu(pane_id, info);
        if (next?.fingerprint !== menu.fingerprint) break;
      }
    return {
      status: "sent" as const,
      key: text !== undefined ? "" : key,
      ...(text !== undefined ? { text } : {}),
      menu: next,
    };
  };
}
