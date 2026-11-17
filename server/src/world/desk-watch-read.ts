import type {
  DeskReadKind,
  DeskReadTarget,
} from "../../../shared/deskAcquisition";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { deskSessionFingerprint } from "./desk-observation";
import type { DeskReadResult } from "./desk-watches";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Validate on both sides of the read; no resource may borrow a replacement's text. */
export async function readDeskWatch(
  connection: LegacyConnectionRuntime,
  kind: DeskReadKind,
  target: DeskReadTarget,
  isCurrent: () => boolean,
): Promise<DeskReadResult> {
  const pane = async () => {
    if (!isCurrent()) return null;
    const raw = await connection.herdr.call(
      "pane.get",
      { pane_id: target.pane_id },
      5000,
    );
    let observed = record(raw?.pane) ? raw.pane : record(raw) ? raw : null;
    if (!observed || observed.pane_id !== target.pane_id || !isCurrent())
      return null;
    if (
      !deskSessionFingerprint(observed.agent_session) &&
      (observed.agent || target.session)
    ) {
      const result = await connection.herdr.call(
        "agent.get",
        { target: target.pane_id },
        5000,
      );
      const agent = record(result?.agent) ? result.agent : null;
      if (
        agent &&
        agent.pane_id === target.pane_id &&
        agent.terminal_id === observed.terminal_id
      )
        observed = {
          ...observed,
          agent: observed.agent ?? agent.agent,
          agent_session: agent.agent_session,
        };
    }
    return isCurrent() &&
      deskSessionFingerprint(observed.agent_session) === target.session
      ? observed
      : null;
  };
  const before = await pane();
  if (!before) return { retired: true };
  const result =
    kind === "screen"
      ? await connection.herdr.call(
          "pane.read",
          { pane_id: target.pane_id, source: "visible", strip_ansi: true },
          8000,
        )
      : before.agent
        ? await connection.agentSessions.readTurn({
            pane_id: target.pane_id,
            workspace_id: before.workspace_id,
            tab_id: before.tab_id,
            agent: before.agent,
            ...(target.session
              ? { agent_session_fingerprint: target.session }
              : {}),
          })
        : { turn: null, agent_session_fingerprint: null };
  if (
    !(await pane()) ||
    !isCurrent() ||
    (record(result) && result.session_changed === true)
  )
    return { retired: true };
  return { result };
}
