import type { openWorldWriter } from "../../storage/world-writer";
import { WorldDeskRegistry } from "../desk-state";
import { observeDeskPanes, deskSessionFingerprint } from "../desk-observation";
import type {
  TerminalMarkPut,
  SavedTerminalMark,
} from "../../storage/terminal-marks";
import type { StorageRequest } from "../../storage/world-protocol";

/** Seed state, not event throughput: one FULL-sync transaction for each fixture phase. */
export function seedReviewStops(
  writer: ReturnType<typeof openWorldWriter>,
  connectionId: string,
  panes: Record<string, unknown>[],
  at: number,
) {
  const desk = new WorldDeskRegistry();
  observeDeskPanes(desk, connectionId, 1, panes, at);
  const byTerminal = new Map(panes.map((pane) => [pane.terminal_id, pane]));
  const current = {
    adapter: "herdr",
    instance: connectionId,
    service_incarnation: "synthetic-seed",
    generation: 1,
  };
  const inputs = desk.storedRecords().map((record) => {
    const pane = byTerminal.get(record.terminal_id)!;
    const entity = {
      native_id: String(pane.pane_id),
      terminals: [record.terminal_id],
      session: deskSessionFingerprint(pane.agent_session) ?? undefined,
    };
    const {
      reviewed_stop,
      stopped_at,
      opened_at,
      observed_stop_id,
      stateChangeSeq,
    } = record;
    return {
      kind: "desk" as const,
      body: {
        reviewed_stop,
        stopped_at,
        opened_at,
        observed_stop_id,
        stateChangeSeq,
      },
      target: {
        adapter: "herdr",
        instance: connectionId,
        kind: "pane",
        native_id: entity.native_id,
        evidence: { terminals: entity.terminals, session: entity.session! },
      },
      event: {
        type: "listing",
        fence: current,
        complete: true,
        entities: [entity],
      },
      current,
    } satisfies TerminalMarkPut;
  });
  seedMarkInputs(writer, inputs, at);
}

export function seedMarkInputs(
  writer: ReturnType<typeof openWorldWriter>,
  inputs: TerminalMarkPut[],
  at: number,
) {
  const replies = writer.batch(
    inputs.map((input, ticket) => ({
      ticket,
      request: {
        type: "terminal-mark",
        operation: { type: "put", input },
      } satisfies StorageRequest,
    })),
    at,
  );
  for (const reply of replies) if (reply.error) throw new Error(reply.error);
  return replies.map((reply) => reply.result as SavedTerminalMark);
}

export function reviewMarkInput(
  row: SavedTerminalMark,
  body = row.body,
): TerminalMarkPut {
  const current = {
    adapter: row.binding.adapter,
    instance: row.binding.instance,
    service_incarnation: "synthetic-seed",
    generation: 1,
  };
  return {
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    body,
    target: {
      adapter: row.binding.adapter,
      instance: row.binding.instance,
      kind: row.binding.kind,
      native_id: row.binding.native_id,
      evidence: row.binding.evidence,
    },
    event: {
      type: "listing",
      complete: true,
      fence: current,
      entities: [{ native_id: row.binding.native_id, ...row.binding.evidence }],
    },
    current,
  };
}
