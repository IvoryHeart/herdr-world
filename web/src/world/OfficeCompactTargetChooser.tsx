import { useRef, type ReactNode } from "react";
import {
  OFFICE_PRESENTATION_BOUNDS,
  type HerdrOfficeProjection,
} from "./herdrOfficeProjection";

export function OfficeCompactTargetChooser({
  projection,
  selectedKey,
  onSelect,
  onActivateAgent,
  onActivateDesk,
}: {
  projection: HerdrOfficeProjection;
  selectedKey: string | null;
  onSelect(key: string): void;
  onActivateAgent(key: string): void;
  onActivateDesk(key: string): void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const pageSize = OFFICE_PRESENTATION_BOUNDS.rosterPage;
  const agents = projection.roster.slice(0, pageSize);
  const rooms = projection.roomRoster.slice(0, pageSize);
  const desks = projection.deskRoster.slice(0, pageSize);
  const select = (key: string) => {
    onSelect(key);
    detailsRef.current?.removeAttribute("open");
  };
  const activate = (key: string, callback: (key: string) => void) => {
    callback(key);
    detailsRef.current?.removeAttribute("open");
  };

  return (
    <details ref={detailsRef} className="world-compact-target-chooser">
      <summary>
        <span>Office targets</span>
        <small>
          {projection.roster.length} agents · {projection.roomRoster.length}{" "}
          rooms
        </small>
      </summary>
      <div className="world-compact-target-panel">
        <TargetSection
          title="Agents"
          total={projection.roster.length}
          shown={agents.length}
        >
          {agents.map(({ agent, roomLabel, hostLabel }) => (
            <li key={agent.key}>
              <TargetButton
                targetKey={agent.key}
                selectedKey={selectedKey}
                title={agent.displayLabel}
                detail={`${agent.stale ? "stale" : (agent.stateLabels[agent.semanticStatus] ?? agent.semanticStatus)} · ${roomLabel} · ${hostLabel}`}
                summary={agent.taskSummary}
                onSelect={select}
              />
              {agent.canOpenInSpaces ? (
                <button
                  type="button"
                  className="world-compact-target-open"
                  aria-label={`Open ${agent.displayLabel} terminal`}
                  onClick={() => activate(agent.key, onActivateAgent)}
                >
                  Terminal
                </button>
              ) : null}
            </li>
          ))}
        </TargetSection>
        <TargetSection
          title="Rooms"
          total={projection.roomRoster.length}
          shown={rooms.length}
        >
          {rooms.map((room) => (
            <li key={room.key}>
              <TargetButton
                targetKey={room.key}
                selectedKey={selectedKey}
                title={room.displayLabel}
                detail={`${room.stale ? "stale · " : ""}${room.hostLabel}`}
                onSelect={select}
              />
            </li>
          ))}
        </TargetSection>
        <TargetSection
          title="Desks"
          total={projection.deskRoster.length}
          shown={desks.length}
        >
          {desks.map(({ desk, roomLabel, hostLabel }) => (
            <li key={desk.key}>
              <TargetButton
                targetKey={desk.key}
                selectedKey={selectedKey}
                title={desk.displayLabel}
                detail={`${roomLabel} · ${hostLabel}`}
                onSelect={select}
              />
              {desk.canOpenInSpaces && desk.terminalSelectionKeys.length ? (
                <button
                  type="button"
                  className="world-compact-target-open"
                  aria-label={`Open ${desk.displayLabel} terminal`}
                  onClick={() => activate(desk.key, onActivateDesk)}
                >
                  Terminal
                </button>
              ) : null}
            </li>
          ))}
        </TargetSection>
      </div>
    </details>
  );
}

function TargetButton({
  targetKey,
  selectedKey,
  title,
  detail,
  summary,
  onSelect,
}: {
  targetKey: string;
  selectedKey: string | null;
  title: string;
  detail: string;
  summary?: string;
  onSelect(key: string): void;
}) {
  return (
    <button
      type="button"
      className="world-compact-target-select"
      data-target-key={targetKey}
      aria-pressed={selectedKey === targetKey}
      onClick={() => onSelect(targetKey)}
    >
      <strong>{title}</strong>
      <span>{detail}</span>
      {summary ? <small>{summary}</small> : null}
    </button>
  );
}

function TargetSection({
  title,
  total,
  shown,
  children,
}: {
  title: string;
  total: number;
  shown: number;
  children: ReactNode;
}) {
  if (!total) return null;
  const id = `world-targets-${title.toLowerCase()}`;
  return (
    <section className="world-compact-target-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul>{children}</ul>
      {total > shown ? (
        <p>
          Showing {shown} of {total} {title.toLowerCase()}.
        </p>
      ) : null}
    </section>
  );
}
