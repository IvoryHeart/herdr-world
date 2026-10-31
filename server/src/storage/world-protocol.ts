import type { AnswerIntent } from "../world/ask-delivery-types";
import type {
  LedgerAsk,
  LedgerChange,
  LedgerDocument,
  LedgerResult,
  LedgerStore,
} from "../world/world-ledger";
import type { Clock, Scheduler } from "../service/ports";

export type StoragePorts = { clock: Clock; scheduler: Scheduler };
export type AttentionState =
  | "pending"
  | "dispatching"
  | "delivered"
  | "uncertain"
  | "refused"
  | "cancelled";
export type DispatchFence = {
  connection_id: string;
  generation: number;
  service_incarnation: string;
};
export type AttentionTarget =
  | { connection_id: string }
  | {
      adapter: string;
      connection_id: string;
      kind: string;
      native_id: string;
      evidence: { terminal_id?: string; session_fingerprint?: string };
    };
export type EffectRecovery =
  | "keyed"
  | "reconcilable"
  | "reattachable"
  | "repeatable"
  | "opaque";
export type OutboxEffect = {
  kind: string;
  record_id: string;
  recovery: EffectRecovery;
  target: AttentionTarget | null;
  initial_claim?: DispatchFence;
  due_at?: number;
  initial_state?: "pending" | "refused";
  reason?: string;
  intent?: AnswerIntent;
};
export type AnswerAttempt = {
  attempt: number;
  state: AttentionState | "claimed";
  fence: DispatchFence | null;
  created_at: number;
  finished_at: number | null;
  reason: string;
};
export type AttentionEntry = {
  id: string;
  operation_id: string;
  kind: string;
  record_id: string;
  target: AttentionTarget | null;
  intent: AnswerIntent | null;
  claimed: boolean;
  cli_received_at: number | null;
  attempts?: AnswerAttempt[];
  prior_uncertainty?: boolean;
  recovery: EffectRecovery;
  state: AttentionState;
  due_at: number;
  created_at: number;
  attempt: number;
  resolved_at: number | null;
  evidence: { reason: string; fence?: DispatchFence } | null;
};
export const attentionFinished = (state: AttentionState) =>
  ["delivered", "refused", "cancelled"].includes(state);
export type Rows<T> = { put: T[]; remove: string[] };
export type LedgerWrite = {
  at: number;
  revision: number;
  asks: Rows<LedgerAsk>;
  changes: Rows<LedgerChange>;
  results: Rows<LedgerResult>;
  effects: readonly OutboxEffect[];
};
export type LedgerCommit = {
  revision: number;
  attention: AttentionEntry[];
  removed_attention: string[];
};
export type StorageRequest =
  | { type: "load" }
  | { type: "issue-id"; kind: string }
  | { type: "profiles"; operation: import("./world-profiles").ProfileOperation }
  | { type: "binding"; operation: import("./world-bindings").BindingOperation }
  | { type: "write"; write: LedgerWrite }
  | {
      type: "outbox";
      record_id?: string;
      id?: string;
      kind?: string;
      ready_only?: boolean;
    }
  | { type: "notices"; kind: string; after?: string; limit: number }
  | {
      type: "begin-dispatch";
      id: string;
      attempt: number;
      fence: DispatchFence;
    }
  | {
      type: "acknowledge";
      id: string;
      occurrence: string;
      attempt: number;
      actor: import("../world/world-ledger").CliActor;
    }
  | {
      type: "decide";
      id: string;
      occurrence: string;
      attempt: number;
      action: "resend" | "close";
    }
  | { type: "claim"; id: string; fence?: DispatchFence }
  | {
      type: "finish";
      id: string;
      attempt: number;
      state: AttentionState;
      reason: string;
      due_at?: number;
    }
  | {
      type: "replay";
      cursor: { incarnation: string; seq: number } | null;
      limit: number;
    }
  | { type: "inspect" };
export type StorageInfo = {
  sqlite: string;
  journal_mode: string;
  synchronous: number;
  locking_mode: string;
  integrity: string;
};
export type ReplayPage = {
  incarnation: string;
  reset: boolean;
  watermark: number;
  changes: { seq: number; kind: string; record_id: string }[];
};
export type AttentionNotices = {
  entries: AttentionEntry[];
  checks: number;
  waiting: number;
  connections: Record<string, number>;
};
export type AttentionOutbox = {
  /** At most 100 pending/uncertain rows, ordered by deadline. */
  list(kind?: string, readyOnly?: boolean): Promise<AttentionEntry[]>;
  notices(
    kind: string,
    after?: string,
    limit?: number,
  ): Promise<AttentionNotices>;
  beginDispatch(
    id: string,
    attempt: number,
    fence: DispatchFence,
  ): Promise<AttentionEntry | null>;
  acknowledge(
    id: string,
    occurrence: string,
    attempt: number,
    actor: import("../world/world-ledger").CliActor,
  ): Promise<AttentionEntry | null>;
  decide(
    id: string,
    occurrence: string,
    attempt: number,
    action: "resend" | "close",
  ): Promise<AttentionEntry | null>;
  get(id: string): Promise<AttentionEntry | null>;
  forRecord(id: string): Promise<AttentionEntry[]>;
  claim(id: string, fence?: DispatchFence): Promise<AttentionEntry | null>;
  finish(
    id: string,
    attempt: number,
    state: AttentionState,
    reason: string,
    dueAt?: number,
  ): Promise<AttentionEntry | null>;
};
export type WorldLedgerStorage = {
  profiles: import("../agent/profile-store").ProfileStorePort;
  bindings: import("./world-bindings").WorldBindings;
  ids: import("./world-ids").WorldIds;
  ledger: LedgerStore;
  outbox: AttentionOutbox;
  incarnation: string;
  replay(
    cursor: { incarnation: string; seq: number } | null,
    limit?: number,
  ): Promise<ReplayPage>;
  inspect(): Promise<StorageInfo>;
  /** Resolves only on unexpected storage loss. The service must stop. */
  failed: Promise<Error>;
  close(): Promise<void>;
};
export type WorkerRequest =
  | {
      type: "open";
      path: string;
      legacy: string;
      legacyProfiles?: string;
      at: number;
      incarnation: string;
    }
  | {
      type: "batch";
      requests: { ticket: number; request: StorageRequest }[];
      at: number;
    }
  | { type: "close" };
export type StorageSnapshot = {
  profiles?: import("../agent/profile-store").ProfilesDocument;
  document: LedgerDocument;
  attention: AttentionEntry[];
};
export type WorkerReply =
  | { type: "ready"; snapshot: StorageSnapshot }
  | {
      type: "results";
      results: { ticket: number; result?: unknown; error?: string }[];
    }
  | { type: "fatal"; error: string }
  | { type: "closed" };
export class StorageOutcomeUnknown extends Error {
  readonly outcome = "unknown";
}
export class StorageWriteRejected extends Error {
  readonly outcome = "not-committed";
}
export const STORAGE_BOUNDS = {
  operations: 32,
  delayMs: 5,
  requestBytes: 1024 * 1024,
  batchBytes: 4 * 1024 * 1024,
  queuedBytes: 16 * 1024 * 1024,
  queuedOperations: 256,
  replayRows: 10_000,
  replayAgeMs: 24 * 60 * 60 * 1000,
} as const;

export const attentionRetryDelay = (attempt: number) =>
  Math.min(30 * 60_000, 30_000 * 2 ** Math.min(10, Math.max(0, attempt - 1)));
