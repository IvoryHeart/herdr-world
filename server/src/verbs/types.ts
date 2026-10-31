import type { TSchema } from "typebox";

export const ACTORS = [
  "browser",
  "cli_verified",
  "cli_unverified",
  "assistant",
  "reconciler",
  "automation",
] as const;
export type Actor = (typeof ACTORS)[number];
export type Policy = "allow" | "acknowledge" | "confirm" | "deny";
export type Recovery =
  | "read"
  | "keyed"
  | "reconcilable"
  | "reattachable"
  | "repeatable"
  | "opaque";
export type Stage =
  | "accepted"
  | "stored"
  | "sent"
  | "observed"
  | "refused"
  | "failed"
  | "uncertain";

export type Evidence =
  | { stage: "accepted" | "refused" | "failed"; reason?: string }
  | { stage: "stored"; receipt: string }
  | { stage: "sent"; connection_id: string; connection_generation: number }
  | { stage: "observed"; observation: string }
  | {
      stage: "uncertain";
      connection_id: string;
      connection_generation: number;
      reason: string;
    };

export type Acknowledgement = {
  flag: string;
  field: string;
  /** Omitted means always required; otherwise only when this field is true. */
  when?: string;
};

export type Verb = {
  name: string;
  channel: "rpc" | "cli" | "source";
  input: TSchema;
  output: TSchema;
  capabilities: readonly string[];
  policy: Readonly<Record<Actor, Policy>>;
  acknowledgements: readonly Acknowledgement[];
  preconditions: readonly string[];
  recovery: Recovery;
  queueable: false;
  stages: readonly Stage[];
};

export type Admission = {
  actor: Actor;
  /** Called again at dispatch: a captured boolean cannot authorize delayed work. */
  authorized(): boolean;
  capabilities(): ReadonlySet<string>;
  preconditions(): boolean;
  /** Existing source routes receive the owner's browser-confirmed action. */
  browserConfirmed?: boolean;
};
