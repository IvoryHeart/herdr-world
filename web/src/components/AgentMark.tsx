import { AGENT_MARKS, agentMarkKind, type AgentMarkKind } from "../agentMarks";
import "./AgentMark.css";

/** An agent's state as its one glyph and colour; the word is its title. */
export function AgentMark({
  kind,
  label,
}: {
  kind: AgentMarkKind;
  /** Read instead of the word, such as the question an agent asks. */
  label?: string;
}) {
  const mark = AGENT_MARKS[kind];
  return (
    <span
      className="agent-mark"
      data-mark={kind}
      title={label ?? mark.word}
      aria-label={label ?? mark.word}
      role="img"
    >
      {mark.glyph}
    </span>
  );
}

/** An agent's mark followed by its word, for a row's status. */
export function AgentState(props: {
  status: string | null | undefined;
  asking?: boolean;
  reviewed?: boolean;
}) {
  const kind = agentMarkKind(props.status, props);
  return (
    <>
      <AgentMark kind={kind} />
      {AGENT_MARKS[kind].word}
    </>
  );
}
