import { useRef, useState, type ReactNode } from "react";
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
  const [pages, setPages] = useState({
    agents: 0,
    rooms: 0,
    desks: 0,
    panes: 0,
  });
  const agents = rosterPage(projection.roster, pages.agents, pageSize);
  const rooms = rosterPage(projection.roomRoster, pages.rooms, pageSize);
  const desks = rosterPage(projection.deskRoster, pages.desks, pageSize);
  const panes = rosterPage(projection.paneRoster ?? [], pages.panes, pageSize);
  const changePage = (section: keyof typeof pages, page: number) => {
    setPages((current) => ({ ...current, [section]: page }));
  };
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
          page={agents}
          onPageChange={(page) => changePage("agents", page)}
        >
          {agents.items.map(({ agent, roomLabel, hostLabel }) => (
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
          page={rooms}
          onPageChange={(page) => changePage("rooms", page)}
        >
          {rooms.items.map((room) => (
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
          page={desks}
          onPageChange={(page) => changePage("desks", page)}
        >
          {desks.items.map(({ desk, roomLabel, hostLabel }) => (
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
        <TargetSection
          title="Panes"
          total={projection.paneRoster?.length ?? 0}
          page={panes}
          onPageChange={(page) => changePage("panes", page)}
        >
          {panes.items.map(({ device, deskLabel, roomLabel, hostLabel }) => (
            <li key={device.key}>
              <TargetButton
                targetKey={device.key}
                selectedKey={selectedKey}
                title={device.displayLabel}
                detail={`${deskLabel} · ${roomLabel} · ${hostLabel}${device.stale ? " · stale" : ""}`}
                onSelect={select}
              />
              {device.canOpenInSpaces ? (
                <button
                  type="button"
                  className="world-compact-target-open"
                  aria-label={`Open ${device.displayLabel} terminal`}
                  onClick={() => activate(device.key, onActivateDesk)}
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

function rosterPage<T>(
  items: readonly T[],
  requestedPage: number,
  size: number,
) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const index = Math.min(requestedPage, pageCount - 1);
  const start = index * size;
  return { items: items.slice(start, start + size), index, pageCount, start };
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
  page,
  onPageChange,
  children,
}: {
  title: string;
  total: number;
  page: ReturnType<typeof rosterPage>;
  onPageChange(page: number): void;
  children: ReactNode;
}) {
  if (!total) return null;
  const id = `world-targets-${title.toLowerCase()}`;
  return (
    <section className="world-compact-target-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul>{children}</ul>
      {page.pageCount > 1 ? (
        <nav aria-label={`${title} pages`}>
          <button
            type="button"
            disabled={page.index === 0}
            onClick={() => onPageChange(page.index - 1)}
          >
            Previous
          </button>
          <span>
            {page.start + 1}–{page.start + page.items.length} of {total}
          </span>
          <button
            type="button"
            disabled={page.index === page.pageCount - 1}
            onClick={() => onPageChange(page.index + 1)}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
