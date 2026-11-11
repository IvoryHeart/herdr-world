import type { CoreMirrorTerminal } from "./mirror";

/**
 * What Herdr's clients share through terminal labels (desktop app
 * `docs/labels.md`): the last turn a person looked at, and the favourite.
 * World writes only these two keys, and only through the rules below.
 *
 * - `herdr.seen=<turn>`: raise-only. A missing label is not 0. Another
 *   client's "mark unread" is the one lower write (`turn - 1`).
 * - `herdr.pinned`: present and non-empty is the favourite; writing it empty
 *   removes it.
 *
 * Labels are last-writer-wins in core: there is no compare-and-set, so a
 * write World decided on can still land after another client's (upstream
 * question Q7). World re-reads its ordered observation right before every
 * write, writes seen only while it still holds the value the browser decided
 * on, and never writes a seen value that would lower it.
 */
export const SEEN_LABEL = "herdr.seen";
export const PINNED_LABEL = "herdr.pinned";

/** The only label changes World ever sends. */
export type SharedLabelChange =
  | { readonly [SEEN_LABEL]: string }
  | { readonly [PINNED_LABEL]: "1" | "" };

const SHARED_KEYS: ReadonlySet<string> = new Set([SEEN_LABEL, PINNED_LABEL]);

/** True only for a change of exactly one shared key with a valid value. */
export function isSharedLabelChange(
  value: unknown,
): value is SharedLabelChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length !== 1) return false;
  const [key, text] = entries[0]!;
  if (!SHARED_KEYS.has(key) || typeof text !== "string") return false;
  return key === SEEN_LABEL ? /^\d{1,15}$/.test(text) : text === "1" || !text;
}

/** Core's turn counter: it goes up each time the terminal stops working. */
export function coreTurn(record: object): number {
  const value = (record as { turn?: unknown }).turn;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

function labelsOf(record: object): Record<string, unknown> {
  const labels = (record as { labels?: unknown }).labels;
  return labels && typeof labels === "object" && !Array.isArray(labels)
    ? (labels as Record<string, unknown>)
    : {};
}

/** The shared seen turn, or null when no client has written one. */
export function sharedSeen(record: object): number | null {
  const text = labelsOf(record)[SEEN_LABEL];
  return typeof text === "string" && /^\d{1,15}$/.test(text.trim())
    ? Number(text.trim())
    : null;
}

/** Present and non-empty: the agent is a favourite in every Herdr client. */
export function isFavourite(record: object): boolean {
  const text = labelsOf(record)[PINNED_LABEL];
  return typeof text === "string" && text.length > 0;
}

/** A program that reports status (OSC 7501): only agents have turns. */
function reportsStatus(record: CoreMirrorTerminal): boolean {
  const status = record.status as { state?: unknown } | null | undefined;
  return typeof status?.state === "string" && status.state.length > 0;
}

function writable(record: CoreMirrorTerminal | undefined) {
  return Boolean(record && !record.remote && record.state === "live");
}

/**
 * The `herdr.seen` value to write because a person looked at `turn`, or
 * null when nothing should be written. `expected` is the label the look was
 * decided on (null: missing). Writes only while the label still holds it, so
 * another client's look or "mark unread" after that decision stands; only
 * raises, also when the label is missing (so terminals started elsewhere
 * join), never past the turn core has reached, and only for a live local
 * agent.
 */
export function seenToShare(
  record: CoreMirrorTerminal | undefined,
  turn: number,
  expected: number | null,
): SharedLabelChange | null {
  if (!record || !writable(record) || !reportsStatus(record)) return null;
  if (!Number.isSafeInteger(turn) || turn < 0 || turn > coreTurn(record))
    return null;
  const shared = sharedSeen(record);
  if (shared !== expected) return null;
  if (shared !== null && shared >= turn) return null;
  return { [SEEN_LABEL]: String(turn) };
}

/** The `herdr.pinned` change that makes `favourite` true, or null if it is. */
export function favouriteToShare(
  record: CoreMirrorTerminal | undefined,
  favourite: boolean,
): SharedLabelChange | null {
  if (!record || !writable(record)) return null;
  if (isFavourite(record) === favourite) return null;
  return { [PINNED_LABEL]: favourite ? "1" : "" };
}

export type CoreAlertKind = "blocked" | "completed";

const stuck = (word: string | null) => word === "blocked" || word === "error";
const busy = (word: string | null) => word === "working" || stuck(word);

/**
 * Herdr's attention rule (desktop app `Model::alert`) for one change of a
 * program's OSC 7501 word: needing you always alerts; finishing alerts when
 * it was busy. World's service cannot know whether a person is looking, so
 * it never assumes one is.
 */
export function attentionFor(
  previous: string | null,
  next: string | null,
): CoreAlertKind | null {
  if (stuck(next) && !stuck(previous)) return "blocked";
  if (busy(previous) && next !== null && !busy(next)) return "completed";
  return null;
}

function wordOf(record: CoreMirrorTerminal | undefined): string | null {
  const status = record?.status as { state?: unknown } | null | undefined;
  return typeof status?.state === "string" && status.state
    ? status.state.slice(0, 32)
    : null;
}

export type CoreAlert = { address: string; kind: CoreAlertKind };

/**
 * What World has accounted for at one address: the last status word, and
 * how many turns have ended. Core raises `turn` when the root record leaves
 * `working` and sends that as its own `turn` event right after the status
 * event (herdr-core `status.rs`, `events_arrive_in_order_after_a_snapshot`),
 * so a status event that leaves `working` already accounts for that turn.
 */
type Accounted = { word: string | null; turns: number };

/**
 * Push decisions from core's status events, kept per core across one World
 * service's reconnects (like World's first sight): a turn that ends while
 * World is disconnected alerts once at the next cut, unless a person has
 * already seen it in some client. A cut compares the turn as well as the
 * word, because a whole turn can start and end inside the gap and leave the
 * word as it was. A terminal World has never seen, and a kept replacement
 * (`restarted`), is learned without alerting. Sub-agents report to their
 * parent and linked machines are discovery only, as in Herdr's apps.
 */
export class CoreAttention {
  private coreId: string | null = null;
  private readonly accounted = new Map<string, Accounted>();

  private reset(coreId: string) {
    if (coreId === this.coreId) return;
    this.coreId = coreId;
    this.accounted.clear();
  }

  private change(
    record: CoreMirrorTerminal,
    afterGap: boolean,
  ): CoreAlert | null {
    const address = record.address;
    const before = this.accounted.get(address);
    const next = wordOf(record);
    const turn = coreTurn(record);
    // A cut's turn is final; an event's turn trails its status by one event.
    const turns =
      afterGap || !before
        ? turn
        : Math.max(
            before.turns,
            before.word === "working" && next !== "working" ? turn + 1 : turn,
          );
    this.accounted.set(address, { word: next, turns });
    if (!before || record.remote || record.state !== "live") return null;
    const parent = record.parent;
    if (typeof parent === "string" && parent) return null;
    let kind = attentionFor(before.word, next);
    // Turns ended unseen by World, and it is not working on another now.
    if (!kind && afterGap && turn > before.turns && next && next !== "working")
      kind = stuck(next) ? "blocked" : "completed";
    if (!kind) return null;
    // A cut's turn is final: a turn someone already saw is not news.
    if (kind === "completed" && afterGap) {
      const seen = sharedSeen(record);
      if (seen !== null && seen >= turn) return null;
    }
    return { address, kind };
  }

  /** A full snapshot (subscribe or `missed`): every record at once. */
  cut(coreId: string, records: readonly CoreMirrorTerminal[]): CoreAlert[] {
    this.reset(coreId);
    const live = new Set<string>();
    const alerts: CoreAlert[] = [];
    for (const record of records) {
      live.add(record.address);
      const alert = this.change(record, true);
      if (alert) alerts.push(alert);
    }
    for (const address of this.accounted.keys())
      if (!live.has(address)) this.accounted.delete(address);
    return alerts;
  }

  /** One applied event, read back from the mirror after it applied. */
  event(
    coreId: string,
    type: string,
    address: string,
    record: CoreMirrorTerminal | undefined,
  ): CoreAlert[] {
    this.reset(coreId);
    if (type === "removed" || !record) {
      this.accounted.delete(address);
      return [];
    }
    if (type === "created" || type === "restarted") {
      // A new program at this address: its first word is not a change.
      this.accounted.set(address, {
        word: wordOf(record),
        turns: coreTurn(record),
      });
      return [];
    }
    const before = this.accounted.get(address);
    if (type === "turn" && before)
      before.turns = Math.max(before.turns, coreTurn(record));
    if (type !== "status") return [];
    const alert = this.change(record, false);
    return alert ? [alert] : [];
  }
}
