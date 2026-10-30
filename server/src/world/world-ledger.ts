import type { OutboxEffect } from "../storage/world-protocol";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { replaceDataFile } from "../config/data-paths";
import type { TerminalRef } from "../../../shared/relations";
import type { BoardOp } from "./board-store";

/**
 * What agents and other terminals did through the `herdr-world` CLI
 * (world-cli.ts): every change with its actor and time, and an undo for the
 * World-side ones; questions for the owner; and task results. One small
 * revisioned file, written atomically like Board's.
 */

export type CliActor = {
  /** How World shows the caller, e.g. "claude in w1:p2" or "terminal with no pane". */
  label: string;
  /** True only when the service saw the calling process run in that pane. */
  verified: boolean;
  connection_id?: string;
  pane_id?: string;
  connection_generation?: number;
  workspace_id?: string;
  agent_session_id?: string;
  agent_session_fingerprint?: string;
  terminal_id?: string;
  agent?: string;
  /** Herdr's name for the asking agent (`agent.get`), kept with a question. */
  name?: string;
};

/** One aspect of one card or terminal a change touched. */
export type LedgerProbe = {
  aspect: "pinned" | "offset" | "colour" | "group";
  key: string;
  ref?: TerminalRef;
};

export type LedgerChange = {
  id: string;
  at: number;
  actor: CliActor;
  /** The CLI command, e.g. "board card pin". */
  command: string;
  summary: string;
  /** Board operations that undo it; null for Herdr changes, which World cannot take back. */
  undo: BoardOp[] | null;
  /** The change that undid this one. */
  undone_by?: string;
  /** What the change left behind: it is undone only while that still holds. */
  expect?: { probe: LedgerProbe; value: string };
  /** The operations that made it, put back if its undo cannot be recorded. */
  redo?: BoardOp[];
  /** A group change: the group the terminal was in before, rebuilt on undo. */
  regroup?: { ref: TerminalRef; members: TerminalRef[] | null };
};

export type LedgerAsk = {
  id: string;
  at: number;
  actor: CliActor;
  question: string;
  /** Idempotency key, scoped to the verified asking occupant. */
  key?: string;
  withdrawn?: { at: number };
  options: string[];
  /** Only the owner, in World, may answer. */
  owner_only: boolean;
  answer?: { text: string; at: number; by: string };
  /** Closed by the owner without an answer; the asker's `--wait` ends. */
  dismissed?: { at: number; by: string };
  /** Durable attention evidence; an uncertain answer is always retrievable. */
  delivery?: {
    notification?: { state: string; reason?: string };
  };
};

/** An answered, dismissed or withdrawn question is closed. */
export const askClosed = (ask: LedgerAsk) =>
  Boolean(ask.answer || ask.dismissed || ask.withdrawn);

export type ResultStatus = "done" | "blocked" | "failed";
export const RESULT_STATUSES: readonly ResultStatus[] = [
  "done",
  "blocked",
  "failed",
];

export type LedgerResult = {
  id: string;
  at: number;
  actor: CliActor;
  task: string;
  summary: string;
  status: ResultStatus;
  pr?: number;
};

export type LedgerDocument = {
  version: 1;
  revision: number;
  changes: LedgerChange[];
  asks: LedgerAsk[];
  results: LedgerResult[];
};

/** Committed reads; writes may cross the asynchronous persistence boundary. */
export interface LedgerStore {
  nextId(kind: "c" | "q" | "r"): string;
  get(): LedgerDocument;
  ask(id: string): LedgerAsk | undefined;
  change(id: string): LedgerChange | undefined;
  openAsks(): { revision: number; asks: LedgerAsk[] };
  update(
    change: (document: LedgerDocument) => void,
    effects?: readonly OutboxEffect[] | (() => readonly OutboxEffect[]),
  ): number | Promise<number>;
}

export const LEDGER_LIMITS = {
  changes: 2000,
  asks: 500,
  /** Open questions one caller may have at once. */
  asksPerActor: 20,
  results: 1000,
  text: 4000,
  options: 12,
  option: 200,
  task: 120,
};

const empty = (): LedgerDocument => ({
  version: 1,
  revision: 0,
  changes: [],
  asks: [],
  results: [],
});

export class WorldLedger {
  private document: LedgerDocument;
  private sequence = 0;
  #closed = false;

  constructor(
    private readonly path: string,
    private readonly options: {
      now?: () => number;
      log?: (message: string) => void;
      /** Writes nothing when false, for tests. */
      persist?: boolean;
    } = {},
  ) {
    this.document = this.load();
  }

  private load(): LedgerDocument {
    if (this.options.persist === false || !existsSync(this.path))
      return empty();
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.changes) ||
        !Array.isArray(parsed.asks) ||
        !Array.isArray(parsed.results)
      )
        throw new Error("not a World ledger");
      return parsed as LedgerDocument;
    } catch (error) {
      const aside = `${this.path}.unreadable-${this.now()}`;
      try {
        renameSync(this.path, aside);
      } catch {
        // The next save replaces it.
      }
      this.options.log?.(
        `world ledger unreadable (${String(error)}); kept at ${aside}`,
      );
      return empty();
    }
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }

  /** A short ID: a kind letter, the time and a counter, e.g. "c-lq3x9-1". */
  nextId(kind: "c" | "q" | "r") {
    this.sequence += 1;
    return `${kind}-${this.now().toString(36)}-${this.sequence.toString(36)}`;
  }

  get(): LedgerDocument {
    return structuredClone(this.document);
  }

  /** One question, copied without the rest of the document. */
  ask(id: string): LedgerAsk | undefined {
    const ask = this.document.asks.find((entry) => entry.id === id);
    return ask && structuredClone(ask);
  }

  /** One change, copied without the rest of the document. */
  change(id: string): LedgerChange | undefined {
    const change = this.document.changes.find((entry) => entry.id === id);
    return change && structuredClone(change);
  }

  /** The unanswered questions, as World's pages show them. */
  openAsks(): { revision: number; asks: LedgerAsk[] } {
    return {
      revision: this.document.revision,
      asks: structuredClone(
        this.document.asks.filter((ask) => !askClosed(ask)),
      ),
    };
  }

  /** Refuse every later change: the service that owns this file stopped. */
  close(): void {
    this.#closed = true;
  }

  /** Change the document and save it; returns the new revision. */
  update(change: (document: LedgerDocument) => void): number {
    if (this.#closed) throw new Error("World storage is closed");
    const next = structuredClone(this.document);
    change(next);
    next.revision = this.document.revision + 1;
    trim(next.changes, LEDGER_LIMITS.changes);
    trim(next.results, LEDGER_LIMITS.results);
    // Keep open questions: only closed ones are dropped, oldest first
    // (`ask` refuses a new question when the open ones fill the list).
    while (next.asks.length > LEDGER_LIMITS.asks) {
      const answered = next.asks.findIndex(askClosed);
      if (answered < 0) break;
      next.asks.splice(answered, 1);
    }
    if (this.options.persist !== false)
      replaceDataFile(this.path, JSON.stringify(next));
    this.document = next;
    return next.revision;
  }
}

function trim<T>(list: T[], max: number) {
  if (list.length > max) list.splice(0, list.length - max);
}
