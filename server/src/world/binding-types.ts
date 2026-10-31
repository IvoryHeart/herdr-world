/** Durable identity. Runtime/transport fences deliberately live outside this record. */
export type BindingKind = "pane" | "tab" | "workspace" | "terminal" | "session";
export type BindingPolicy =
  | "board-string"
  | "appearance"
  | "tab-colour"
  | "interest";
export type BindingIdentity = {
  adapter: string;
  instance: string;
  kind: BindingKind;
  native_id: string;
  evidence: { terminals: string[]; session?: string };
};
export type BindingInput = BindingIdentity & {
  record_id: string;
  slot: string;
  policy: BindingPolicy;
};
export type SourceBinding = BindingInput & {
  id: string;
  state: "attached" | "unresolved" | "unconfirmed" | "ended";
  checked_at: number | null;
};
export type BindingFence = {
  adapter: string;
  instance: string;
  service_incarnation: string;
  generation: number;
};
export type BindingEntity = {
  native_id: string;
  terminals: readonly string[];
  session?: string;
};
export type BindingEvent =
  | { type: "offline" }
  | {
      type: "listing";
      fence: BindingFence;
      complete: boolean;
      entities: readonly BindingEntity[];
    }
  | {
      type: "world-move";
      fence: BindingFence;
      from: string;
      target: BindingEntity;
    }
  | {
      type: "absence";
      fence: BindingFence;
      native_id: string;
      via: "close" | "not-found";
    }
  | { type: "user-keep"; target: BindingIdentity }
  | { type: "user-detach" };
export type BindingResolution = {
  binding: SourceBinding;
  /** Ephemeral; callers still recheck their exact runtime lease before dispatch. */
  target: (BindingIdentity & { fence: BindingFence }) | null;
};
export const bindingPolicies = {
  "board-string": {
    listingMove: false,
    close: true,
    notFound: true,
    listingAbsence: false,
    lifetime: "needs-home",
  },
  appearance: {
    listingMove: true,
    close: false,
    notFound: false,
    listingAbsence: true,
    lifetime: "clear",
  },
  "tab-colour": {
    listingMove: true,
    close: true,
    notFound: false,
    listingAbsence: true,
    lifetime: "clear",
  },
  interest: {
    listingMove: true,
    close: false,
    notFound: false,
    listingAbsence: true,
    lifetime: "clear",
  },
} as const;
