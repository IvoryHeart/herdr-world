import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { worldLocalStorage } from "../browserStorage";
import type { WorldObject, WorldHostState } from "./worldObject";
import {
  projectWorldOffice,
  type OfficeAgent,
  type OfficeDesk,
  type OfficeRoom,
} from "./officeProjection";
import {
  readOfficePreferences,
  writeOfficePreferences,
  type OfficePreferences,
} from "./officePreferences";

export default function PixelOfficeView({
  world,
  selectedId,
  onSelect,
}: {
  world: WorldObject;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const office = useMemo(() => projectWorldOffice(world, Date.now()), [world]);
  const [preferences, setPreferences] = useState(() =>
    readOfficePreferences(worldLocalStorage),
  );
  const preferencesRef = useRef(preferences);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  preferencesRef.current = preferences;

  useEffect(() => {
    const stage = sceneRef.current?.closest<HTMLElement>(".world-view-stage");
    if (!stage) return;
    const frame = requestAnimationFrame(() => {
      stage.scrollLeft = preferencesRef.current.scrollLeft;
      stage.scrollTop = preferencesRef.current.scrollTop;
    });
    const onScroll = () => {
      const next = {
        ...preferencesRef.current,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      preferencesRef.current = next;
      writeOfficePreferences(worldLocalStorage, next);
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("scroll", onScroll);
    };
  }, []);

  function updatePreferences(patch: Partial<OfficePreferences>) {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      preferencesRef.current = next;
      writeOfficePreferences(worldLocalStorage, next);
      return next;
    });
  }

  if (!world.hosts.length) {
    return (
      <div className="world-empty" role="status">
        <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
        <h2>No connected spaces yet</h2>
        <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
      </div>
    );
  }
  return (
    <div className="world-office-shell">
      <div className="world-office-toolbar" aria-label="Office layout">
        <label>
          <span>Room alignment</span>
          <select
            value={preferences.roomAlignment}
            onChange={(event) =>
              updatePreferences({
                roomAlignment: event.target
                  .value as OfficePreferences["roomAlignment"],
              })
            }
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label>
          <span>Long room titles</span>
          <select
            value={preferences.longTitleMode}
            onChange={(event) =>
              updatePreferences({
                longTitleMode: event.target
                  .value as OfficePreferences["longTitleMode"],
              })
            }
          >
            <option value="expand">Expand room</option>
            <option value="compact">Ellipsis</option>
          </select>
        </label>
      </div>
      <div
        ref={sceneRef}
        className={`world-office world-office-align-${preferences.roomAlignment} world-office-titles-${preferences.longTitleMode}`}
        data-office-version={office.version}
      >
        <section className="world-office-ceo" aria-label="CEO Office">
          <div className="world-ceo-desk">
            <span className="world-ceo-character" aria-hidden="true">
              YOU
            </span>
            <div>
              <small>CEO Office</small>
              <strong>Visual control plane</strong>
            </div>
          </div>
          <div className="world-office-board" aria-label="Office status">
            <strong>WORLD STATUS</strong>
            <span>{office.coverage.observedHosts} hosts observed</span>
            <span>{office.coverage.observedWorkspaces} rooms</span>
            <span>{office.coverage.observedAgents} agents</span>
            {office.coverage.omittedRooms || office.coverage.omittedDesks ? (
              <span className="world-office-omission">
                {office.coverage.omittedRooms} rooms ·{" "}
                {office.coverage.omittedDesks} desks omitted
              </span>
            ) : null}
          </div>
          <div className="world-agent-bar" aria-label="Agent Bar">
            <div className="world-agent-bar-shelf" aria-hidden="true" />
            <strong>AGENT BAR</strong>
            <div className="world-agent-bar-occupants">
              {office.barAgents.map((agent) => (
                <OfficeAgentButton
                  key={agent.key}
                  agent={agent}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
              {!office.barAgents.length ? <small>Quiet for now</small> : null}
            </div>
            <div className="world-agent-bar-counter" aria-hidden="true" />
          </div>
        </section>
        <section
          className="world-office-receptions"
          aria-label="Host receptions"
        >
          {office.receptions.map((reception) => {
            const host = office.hosts.find(
              ({ key }) => key === reception.hostKey,
            );
            return (
              <article
                key={reception.key}
                className={`world-reception ${reception.stale ? "is-stale" : ""}`}
              >
                <button
                  type="button"
                  className={`world-host-sign ${selectedId === reception.hostKey ? "is-selected" : ""}`}
                  onClick={() => onSelect(reception.hostKey)}
                >
                  <span>{reception.hostLabel}</span>
                  <small>
                    {host
                      ? hostStateLabel(host.connectionState)
                      : "Unavailable"}
                  </small>
                </button>
                <div className="world-reception-desk" aria-hidden="true" />
                <div className="world-reception-agents">
                  {reception.waitingAgents.map((agent) => (
                    <OfficeAgentButton
                      key={agent.key}
                      agent={agent}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  ))}
                  {reception.overflowCount ? (
                    <small>+{reception.overflowCount} waiting</small>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
        <div className="world-office-road" aria-hidden="true">
          <span />
          <span />
        </div>
        <section className="world-office-rooms" aria-label="Work rooms">
          {office.rooms.length ? (
            office.rooms.map((room) => (
              <OfficeRoomView
                key={room.key}
                room={room}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))
          ) : (
            <div className="world-office-no-rooms">No observed spaces</div>
          )}
        </section>
      </div>
    </div>
  );
}

function OfficeRoomView({
  room,
  selectedId,
  onSelect,
}: {
  room: OfficeRoom;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  return (
    <article
      className={`world-office-room ${room.stale ? "is-stale" : ""}`}
      style={
        {
          "--office-desk-columns": Math.min(4, Math.max(2, room.desks.length)),
        } as CSSProperties
      }
    >
      <button
        type="button"
        className={`world-room-title ${selectedId === room.key ? "is-selected" : ""}`}
        onClick={() => onSelect(room.key)}
      >
        <span>{room.displayLabel}</span>
        <small>
          {room.observedDeskCount} desks · {room.observedAgentCount} agents
        </small>
      </button>
      <div className="world-desk-grid">
        {room.desks.map((desk) => (
          <OfficeDeskButton
            key={desk.key}
            desk={desk}
            room={room}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div className="world-standing-agents" aria-label="Standing agents">
        {room.roomAgents
          .filter(({ placement }) => placement === "standing")
          .map((agent) => (
            <OfficeAgentButton
              key={agent.key}
              agent={agent}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
      </div>
      {room.omittedDeskCount || room.omittedAgentCount ? (
        <small className="world-room-overflow">
          {room.omittedDeskCount ? `+${room.omittedDeskCount} desks` : ""}
          {room.omittedDeskCount && room.omittedAgentCount ? " · " : ""}
          {room.omittedAgentCount ? `+${room.omittedAgentCount} agents` : ""}
        </small>
      ) : null}
    </article>
  );
}

function OfficeDeskButton({
  desk,
  room,
  selectedId,
  onSelect,
}: {
  desk: OfficeDesk;
  room: OfficeRoom;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const agent = desk.occupantAgentKey
    ? room.roomAgents.find(({ key }) => key === desk.occupantAgentKey)
    : null;
  const target = agent?.nodeId ?? desk.terminalSelectionKeys[0] ?? room.key;
  return (
    <button
      type="button"
      className={`world-desk ${agent ? `world-status-${agent.semanticStatus}` : "world-status-empty"} ${
        selectedId === target ? "is-selected" : ""
      }`}
      onClick={() => onSelect(target)}
      aria-label={`${desk.displayLabel}, ${agent ? agent.displayLabel : "empty desk"}`}
    >
      <span className="world-character-frame">
        {agent ? (
          <OfficeCharacter agent={agent} />
        ) : (
          <span aria-hidden="true">·</span>
        )}
      </span>
      <span className="world-desk-top" />
      <span className="world-desk-label">{desk.displayLabel}</span>
      {desk.completionAgentKeys.length ? (
        <span className="world-completion-marker" aria-label="Completed work">
          ✓
        </span>
      ) : null}
    </button>
  );
}

function OfficeAgentButton({
  agent,
  selectedId,
  onSelect,
}: {
  agent: OfficeAgent;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  return (
    <button
      type="button"
      className={`world-office-agent world-status-${agent.semanticStatus} ${
        selectedId === agent.nodeId ? "is-selected" : ""
      }`}
      onClick={() => onSelect(agent.nodeId)}
      aria-label={`${agent.displayLabel}, ${agent.semanticStatus}`}
      title={agent.taskSummary ?? agent.displayLabel}
    >
      <OfficeCharacter agent={agent} />
      <span>{agent.displayLabel}</span>
    </button>
  );
}

function OfficeCharacter({ agent }: { agent: OfficeAgent }) {
  return (
    <img
      src={`/world/characters/${agent.characterIndex + 1}-D-1.png`}
      alt=""
      draggable={false}
    />
  );
}

function hostStateLabel(state: WorldHostState) {
  switch (state) {
    case "active":
      return "Active";
    case "ready-inactive":
      return "Ready · inactive";
    case "reconnecting":
      return "Reconnecting";
    case "offline-stale":
      return "Offline · stale";
  }
}
