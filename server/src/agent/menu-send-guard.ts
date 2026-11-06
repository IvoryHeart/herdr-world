import type {
  Conversation,
  ConversationSendResult,
  ConversationSource,
} from "./conversation";
import type { ConversationDelivery } from "./conversation-delivery";
import {
  menuQuoted,
  parseCommandMenu,
  parsePendingPrompt,
  PROMPT_SCREEN_LINES,
  type PromptContext,
} from "./pending-prompt";
import { isSlashCommand } from "../../../shared/conversationInput";
import type { HerdrCall } from "./session-types";

type Refusal = Extract<ConversationSendResult, { status: "refused" }>;
type SendTarget = Parameters<ConversationSource["send"]>[0];

// Footer and option shapes harness menus use. Typed text is safe only when
// none shows: Chat refuses rather than guess (Claude's "Esc to cancel",
// "Enter to confirm/select", Codex's "enter select · esc back", lists with a
// cursor on a numbered option).
const MENU_FOOTER =
  /\b(esc|escape) to (cancel|close|go back|exit)\b|\benter to (confirm|select|set|continue|submit)\b|\benter select\b|\besc back\b|↑\/?↓ to (navigate|select|move)\b|\btab to (switch|cycle) (tabs|views)\b/i;
// A boxed option remains menu evidence even when its frame/cursor was cut off.
const OPTION_SHAPE = /^\s*(?:[│┃║]\s*(?:[❯›>]\s*)?|[❯›>]\s*)\d+[.)](?:\s|$)/u;

/**
 * Why typing into this pane now could be unsafe, or null when the screen was
 * read and shows no menu, question or menu-like panel. An unreadable or
 * malformed screen refuses. A footer the agent's own last message quotes
 * (Codex draws its messages where its menus go) does not count.
 */
export function screenSendRefusal({
  agent,
  screen,
  context,
  said,
}: {
  agent: string;
  screen: string | null;
  context: PromptContext;
  said: string | null;
}): Refusal | null {
  const refuse = (message: string): Refusal => ({
    status: "refused",
    reason: "menu",
    message: `${message} Nothing was sent.`,
  });
  if (screen === null)
    return refuse(
      "Chat could not read the terminal to check that no menu is open, so typing could go into one.",
    );
  const menu = parseCommandMenu(agent, screen, context);
  if (menu && !(menu.menu?.overlay && menuQuoted(menu, said)))
    return refuse(
      `A menu is open in the terminal (“${menu.question.join(" ").slice(0, 80)}”). Typing would go into it as keys; close it first with the key its card names.`,
    );
  if (parsePendingPrompt(agent, screen, context)?.options.length)
    return refuse(
      "The agent is showing a question; answer it on its card first.",
    );
  const lines = screen.split("\n").filter((line) => line.trim());
  const quoted = (line: string) => {
    const text =
      agent === "claude" ? line.trim().replace(/^●\s+/u, "") : line.trim();
    return said !== null && text.length > 0 && said.includes(text);
  };
  if (
    lines.some((line) => OPTION_SHAPE.test(line) && !quoted(line)) ||
    lines.slice(-14).some((line) => MENU_FOOTER.test(line) && !quoted(line))
  )
    return refuse(
      "The terminal shows what looks like a menu Chat cannot read. Typing would go into it as keys; close it in the Terminal first.",
    );
  return null;
}

/**
 * Read the pane's screen as the menu card does and check it for sending; a
 * failed or malformed read refuses.
 */
export async function sendScreenRefusal(
  herdrCall: HerdrCall,
  paneId: string,
  rest: Omit<Parameters<typeof screenSendRefusal>[0], "screen">,
) {
  const screen = await herdrCall("pane.read", {
    pane_id: paneId,
    source: "recent",
    lines: PROMPT_SCREEN_LINES,
    format: "text",
    strip_ansi: true,
  }).then(readScreenText, () => null);
  return screenSendRefusal({ ...rest, screen });
}

/** Snapshot the native identity under which a screen is checked for typing. */
export function inputWitness(info: Record<string, unknown> | null) {
  return JSON.stringify(
    [
      "agent",
      "agent_session",
      "terminal_id",
      "state_change_seq",
      "terminal_title",
      "revision",
      "agent_status",
      "pane_id",
    ].map((field) => info?.[field] ?? null),
  );
}

/** The agent's last message text, for the quoted-footer exception. */
export function lastAgentMessage(shown: Conversation | null): string | null {
  if (!shown || shown.status !== "ok") return null;
  let said: string | null = "";
  for (const message of shown.messages ?? [])
    if (message.role === "assistant" && message.kind === "message")
      said = message.text;
  return said;
}

type Reservation = {
  paneId: string;
  fingerprint: string;
  text: string;
  state: "admitting" | "queued";
  deliveryId?: string;
  epoch: number;
};

/**
 * Slash commands World has admitted to a pane that may still be waiting in
 * the agent's own queue. An entry is reserved before any await, so two sends
 * of one command cannot both reach the agent; it is released only when
 * nothing reached the pane. A command sent while the agent worked, or whose
 * acknowledgement was lost, stays until a fresh qualified read shows a new
 * session or an idle/done state. Dismissing its receipt does not retire it.
 */
export function createCommandReservations() {
  const entries = new Set<Reservation>();
  let epoch = 0;
  const key = (paneId: string, fingerprint: string, text: string) =>
    JSON.stringify([paneId, fingerprint, text.trim()]);
  const keyOf = (entry: Reservation) =>
    key(entry.paneId, entry.fingerprint, entry.text);
  return {
    /** Reserve the command, or null when the same one is pending. */
    reserve(paneId: string, fingerprint: string, text: string) {
      const wanted = key(paneId, fingerprint, text);
      for (const entry of entries) if (keyOf(entry) === wanted) return null;
      const entry: Reservation = {
        paneId,
        fingerprint,
        text,
        state: "admitting",
        epoch: ++epoch,
      };
      entries.add(entry);
      return entry;
    },
    /** Whether the same command is admitted and possibly queued. */
    queued(paneId: string, fingerprint: string, text: string) {
      const wanted = key(paneId, fingerprint, text);
      for (const entry of entries)
        if (keyOf(entry) === wanted && entry.state === "queued") return true;
      return false;
    },
    release(entry: Reservation) {
      entries.delete(entry);
    },
    queue(entry: Reservation, deliveryId?: string) {
      entry.epoch = ++epoch;
      entry.state = "queued";
      entry.deliveryId = deliveryId;
    },
    /** Capture before the native read, never when its response arrives. */
    beginObservation() {
      return ++epoch;
    },
    /**
     * Only a qualified, successful read begun after dispatch can establish
     * that this session/queue interval ended. Unknown states (including a
     * blocked turn still awaiting input) cannot establish consumption.
     */
    deliveries(
      paneId: string,
      shown: Pick<
        Conversation,
        "status" | "session_binding" | "session_fingerprint" | "agent_status"
      >,
      ledger: { list(paneId: string): ConversationDelivery[] },
      observedAt: number,
    ) {
      const fingerprint = shown.session_fingerprint;
      const status = shown.agent_status;
      if (
        shown.status === "ok" &&
        (shown.session_binding === "reported" ||
          shown.session_binding === "title") &&
        fingerprint &&
        (status === "working" ||
          status === "idle" ||
          status === "done" ||
          status === "blocked")
      ) {
        for (const entry of entries)
          if (
            entry.paneId === paneId &&
            entry.state === "queued" &&
            observedAt > entry.epoch &&
            (entry.fingerprint !== fingerprint ||
              status === "idle" ||
              status === "done")
          )
            entries.delete(entry);
      }
      return this.mark(paneId, ledger.list(paneId));
    },
    /** Receipts of commands still waiting for the agent to reach them. */
    mark(paneId: string, list: ConversationDelivery[]) {
      const waiting = new Set<string>();
      for (const entry of entries)
        if (entry.paneId === paneId && entry.deliveryId)
          waiting.add(entry.deliveryId);
      return list.map((delivery) =>
        waiting.has(delivery.id) ? { ...delivery, waiting: true } : delivery,
      );
    },
  };
}

/** Native precondition failures establish no input; other errors are uncertain. */
export async function submitPrompt(
  call: HerdrCall,
  target: SendTarget,
  dispatched: WeakSet<object>,
): Promise<{ result: unknown } | Refusal> {
  dispatched.add(target);
  try {
    return {
      result: await call("agent.prompt", {
        target: target.pane_id,
        text: target.text,
      }),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      /^(agent_blocked|agent_not_ready|agent_not_found):/.test(error.message)
    )
      dispatched.delete(target);
    if (error instanceof Error && /^agent_blocked:/.test(error.message))
      return {
        status: "refused",
        reason: "blocked",
        message:
          "The agent is waiting on a question; answer it first. Nothing was sent.",
      };
    throw error;
  }
}

/**
 * Chat's sends to a pane, one World input at a time (shared with answers and
 * menu keys), with identical slash commands reserved before any await.
 * `dispatched` holds the targets whose native prompt was attempted, so an
 * error after it is treated as an uncertain submission, not as nothing sent.
 */
export function guardSends(
  send: ConversationSource["send"],
  reservations: ReturnType<typeof createCommandReservations>,
  active: Set<string>,
  dispatched: WeakSet<object>,
  /** Read the pane once, so its reservations reflect its current state. */
  observe: (paneId: string) => Promise<unknown>,
): ConversationSource["send"] {
  return async (target: SendTarget) => {
    const command = isSlashCommand(target.text);
    const { pane_id, session_fingerprint, text } = target;
    let reservation = command
      ? reservations.reserve(pane_id, session_fingerprint, text)
      : undefined;
    // A queued one may have run since: read the pane once, then try again.
    // One still being admitted is in flight and always refuses.
    if (
      reservation === null &&
      reservations.queued(pane_id, session_fingerprint, text)
    ) {
      await observe(pane_id).catch(() => undefined);
      reservation = reservations.reserve(pane_id, session_fingerprint, text);
    }
    if (reservation === null)
      return {
        status: "refused",
        reason: "duplicate",
        message: `${target.text.trim().split(/\s/)[0]} is already waiting for the agent to reach it. Nothing was sent.`,
      };
    if (active.has(target.pane_id)) {
      if (reservation) reservations.release(reservation);
      return {
        status: "refused",
        reason: "busy",
        message:
          "Chat is already sending to this pane. Nothing was sent; try again in a moment.",
      };
    }
    active.add(target.pane_id);
    try {
      const result = await send(target);
      if (reservation) {
        if (result.status === "sent" && result.delivery.queued)
          reservations.queue(reservation, result.delivery.id);
        else reservations.release(reservation);
      }
      return result;
    } catch (error) {
      // Nothing reached the pane unless the native prompt was attempted; if
      // it was, its fate is unknown and an identical retry stays refused.
      if (reservation) {
        if (dispatched.has(target)) reservations.queue(reservation);
        else reservations.release(reservation);
      }
      throw error;
    } finally {
      active.delete(target.pane_id);
    }
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The text of a `pane.read` reply, wherever Herdr nests it. */
export function readScreenText(result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (typeof result.text === "string") return result.text;
  for (const value of Object.values(result)) {
    const nested = readScreenText(value);
    if (nested !== null) return nested;
  }
  return null;
}

/** The per-source state of Chat's sends: reservations, lock and dispatches. */
export function createSendGuard() {
  return {
    reservations: createCommandReservations(),
    active: new Set<string>(),
    dispatched: new WeakSet<object>(),
  };
}

/** `source` with its sends guarded by `guard`. */
export function guardSource<T extends ConversationSource>(
  source: T,
  guard: ReturnType<typeof createSendGuard>,
): T {
  const { reservations, active, dispatched } = guard;
  return {
    ...source,
    send: guardSends(source.send, reservations, active, dispatched, (paneId) =>
      source.latest({ pane_id: paneId }),
    ),
  };
}
