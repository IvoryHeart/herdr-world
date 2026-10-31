import type {
  AgentFieldClaims,
  FieldClaim,
  NativeSessionClaim,
} from "../../../shared/fieldClaims";
import { FieldClaims } from "../world/field-claims";
import { isRecord } from "./session-utils";

export function reportedSessionClaim(
  info: Record<string, unknown> | null,
  at: number,
): FieldClaim<NativeSessionClaim> | undefined {
  const session = info?.agent_session;
  if (
    !isRecord(session) ||
    ["source", "agent", "kind", "value"].some(
      (key) => typeof session[key] !== "string" || !session[key],
    )
  )
    return;
  return {
    value: {
      source: String(session.source),
      agent: String(session.agent),
      kind: String(session.kind),
      value: String(session.value),
    },
    source: "herdr.agent",
    author: String(session.agent),
    observed_at: at,
    basis: "reported",
    ...revision(info),
  };
}
function revision(info: Record<string, unknown> | null) {
  const seq = info?.state_change_seq;
  return typeof seq === "string" || typeof seq === "number"
    ? { source_revision: seq }
    : {};
}
type State = {
  subject: string;
  witness: string | null;
  status: FieldClaims<string>;
  session: FieldClaims<NativeSessionClaim>;
};
type Ticket = { pane: string; order: number };
type Capture = Ticket & { state: State; source_revision?: string | number };
function copyState(previous: State): State {
  const state: State = {
    subject: previous.subject,
    witness: previous.witness,
    status: new FieldClaims(),
    session: new FieldClaims(),
  };
  for (const claim of previous.status.values())
    state.status.observe(claim.source, claim, false);
  for (const claim of previous.session.values())
    state.session.observe(claim.source, claim, false);
  return state;
}

/** Owned by one runtime. Neither saved projections nor native session IDs are World identity. */
export class AgentClaims {
  #order = 0;
  #latest = new Map<string, number>();
  #panes = new Map<string, State>();
  constructor(private readonly now: () => number = Date.now) {}
  begin(pane: string): Ticket {
    const order = ++this.#order;
    this.#latest.set(pane, order);
    return { pane, order };
  }
  observe(ticket: Ticket, info: Record<string, unknown> | null): Capture {
    const at = this.now(),
      native = reportedSessionClaim(info, at);
    const subject = JSON.stringify([
      info?.terminal_id ?? ticket.pane,
      info?.agent ?? null,
    ]);
    const previous = this.#panes.get(ticket.pane);
    const witness =
      native && native.value.kind !== "unknown"
        ? JSON.stringify(native.value)
        : null;
    const state: State =
      previous?.subject === subject &&
      (!witness || previous.witness === witness)
        ? copyState(previous)
        : {
            subject,
            witness,
            status: new FieldClaims(),
            session: new FieldClaims(),
          };
    const status =
      typeof info?.agent_status === "string" && info.agent_status
        ? info.agent_status
        : undefined;
    state.status.observe(
      "herdr.agent",
      status
        ? {
            value: status,
            source: "herdr.agent",
            observed_at: at,
            basis: "reported",
            ...revision(info),
          }
        : undefined,
      true,
    );
    state.session.observe("herdr.agent", native, true);
    const capture = { ...ticket, state, ...revision(info) };
    this.#commit(capture);
    return capture;
  }
  transcript(
    capture: Capture,
    value: {
      session: NativeSessionClaim | null;
      status: string | null;
      revision: string;
    },
  ): AgentFieldClaims {
    capture = { ...capture, state: copyState(capture.state) };
    const evidence = {
      source: "world.transcript",
      observed_at: this.now(),
      basis: "inferred" as const,
      source_revision: value.revision,
    };
    capture.state.status.observe(
      evidence.source,
      value.status ? { ...evidence, value: value.status } : undefined,
      true,
    );
    capture.state.session.observe(
      evidence.source,
      value.session ? { ...evidence, value: value.session } : undefined,
      true,
    );
    this.#commit(capture);
    return this.project(capture);
  }
  title(capture: Capture, id: string | null): AgentFieldClaims {
    capture.state = copyState(capture.state);
    capture.state.session.observe(
      "herdr.title",
      id
        ? {
            value: {
              source: "codex-title",
              agent: "codex",
              kind: "id",
              value: id,
            },
            source: "herdr.title",
            author: "codex",
            observed_at: this.now(),
            basis: "reported",
            ...(capture.source_revision !== undefined
              ? { source_revision: capture.source_revision }
              : {}),
          }
        : undefined,
      true,
    );
    this.#commit(capture);
    return this.project(capture);
  }
  project(capture: Capture): AgentFieldClaims {
    return {
      agent_status: capture.state.status.project("agent_status"),
      session: capture.state.session.project("session"),
    };
  }
  #commit(capture: Capture) {
    if (this.#latest.get(capture.pane) === capture.order)
      this.#panes.set(capture.pane, capture.state);
  }
  completePanes(panes: ReadonlySet<string>) {
    for (const pane of this.#latest.keys())
      if (!panes.has(pane)) {
        this.#latest.delete(pane);
        this.#panes.delete(pane);
      }
  }
  clear() {
    this.#latest.clear();
    this.#panes.clear();
  }
}
