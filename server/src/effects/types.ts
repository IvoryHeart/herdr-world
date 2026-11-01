import type { Actor } from "../verbs/types";
import type {
  AttentionEntry,
  AttentionTarget,
  DispatchFence,
  EffectRecovery,
} from "../storage/world-protocol";

export type EffectContract = {
  verb: string;
  version: number;
  params: Record<string, unknown>;
  targets: readonly AttentionTarget[];
  actor: { kind: Actor; subject: string; evidence: Record<string, unknown> };
  authorization: Record<string, unknown>;
  idempotency_key: string;
  preconditions: Record<string, unknown>;
  origin: string;
};
export type AttemptFence = { service_incarnation: string; attempt: number };
export type QualifiedEffectTarget = {
  capture: AttentionTarget;
  fence: DispatchFence;
};
export type EffectEntry = Omit<AttentionEntry, "state"> & {
  state: AttentionEntry["state"] | "needs-migration";
  contract: EffectContract | null;
  receipt: Record<string, unknown> | null;
  external_handle: Record<string, unknown> | null;
  targets: readonly QualifiedEffectTarget[];
  ever_dispatched: boolean;
  cancel_requested: boolean;
  not_sent: boolean;
  owner_retry_attempt: number | null;
  attempt_fence: AttemptFence | null;
  decisions: {
    action: string;
    actor: EffectContract["actor"];
    reason: string;
    at: number;
    from: number | null;
    to: number | null;
  }[];
};
export type EffectTransition =
  | { action: "claim"; id: string; incarnation: string }
  | {
      action: "begin";
      id: string;
      fence: AttemptFence;
      targets: readonly QualifiedEffectTarget[];
    }
  | {
      action: "qualify";
      id: string;
      fence: AttemptFence;
      targets: readonly QualifiedEffectTarget[];
    }
  | { action: "defer"; id: string; due_at: number; reason: string }
  | {
      action: "finish";
      id: string;
      fence: AttemptFence;
      state: AttentionEntry["state"];
      reason: string;
      due_at?: number;
      receipt?: Record<string, unknown>;
      external_handle?: Record<string, unknown>;
    }
  | {
      action: "handle";
      id: string;
      fence: AttemptFence;
      handle: Record<string, unknown>;
    }
  | {
      action: "cancel";
      id: string;
      reason: string;
      actor: EffectContract["actor"];
    }
  | { action: "version-block"; id: string; fence: AttemptFence; reason: string }
  | {
      action: "migrate";
      id: string;
      from: number;
      to: number;
      actor: EffectContract["actor"];
      reason: string;
      params?: Record<string, unknown>;
    }
  | {
      action: "decide";
      id: string;
      attempt: number;
      actor: EffectContract["actor"];
      reason: string;
      outcome?: "retry" | "close";
    };
export type EffectStore = {
  current(id: string): EffectEntry | null;
  get(id: string): Promise<EffectEntry | null>;
  list(verb?: string): Promise<EffectEntry[]>;
  transition(change: EffectTransition): Promise<EffectEntry | null>;
};
export type EffectPolicyResult = "allowed" | "wait" | "refused";
export type EffectRecoveryClass = EffectRecovery;
export type EffectReply = {
  effect: EffectEntry | null;
  attention: AttentionEntry | null;
};
