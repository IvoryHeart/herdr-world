import { useEffect, useMemo, useRef, useState } from "react";
import { worldLocalStorage } from "../browserStorage";
import { PixelOfficeCanvas } from "./PixelOfficeCanvas";
import {
  projectWorldOffice,
  type HerdrOfficeProjection,
} from "./herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "./officeObservability";
import { officePresentationKey } from "./officeSelection";
import {
  readOfficePreferences,
  writeOfficePreferences,
  type OfficePreferences,
} from "./officePreferences";
import type { WorldObject } from "./worldObject";

const NO_COMPLETIONS = new Set<string>();
const NO_CONVERSATIONS: never[] = [];
const roomCannotCreateSeat = () => false;
const ignoreNewSeat = () => {};

export default function PixelOfficeView({
  world,
  selectedId,
  onSelect,
}: {
  world: WorldObject;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const office = useMemo(
    (): HerdrOfficeProjection => projectWorldOffice(world, Date.now()),
    [world],
  );
  const [preferences, setPreferences] = useState(() =>
    readOfficePreferences(worldLocalStorage),
  );
  const preferencesRef = useRef(preferences);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  preferencesRef.current = preferences;

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const frame = requestAnimationFrame(() => {
      scroll.scrollLeft = preferencesRef.current.scrollLeft;
      scroll.scrollTop = preferencesRef.current.scrollTop;
    });
    const onScroll = () => {
      const next = {
        ...preferencesRef.current,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
      };
      preferencesRef.current = next;
      writeOfficePreferences(worldLocalStorage, next);
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener("scroll", onScroll);
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

  const selectedKey = officePresentationKey(office, selectedId);
  const selectOfficeKey = (key: string) => {
    const agent = office.roster.find(({ agent }) => agent.key === key)?.agent;
    if (agent) {
      onSelect(agent.nodeId);
      return;
    }
    const desk = office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    if (desk) {
      const occupant = desk.occupantAgentKey
        ? office.roster.find(
            ({ agent: candidate }) => candidate.key === desk.occupantAgentKey,
          )?.agent
        : null;
      onSelect(
        occupant?.nodeId ?? desk.terminalSelectionKeys[0] ?? desk.roomKey,
      );
      return;
    }
    onSelect(key);
  };

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
    <div className="world-office-shell world-stage-shell">
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
      <div ref={scrollRef} className="world-stage-scroll">
        <PixelOfficeCanvas
          projection={office}
          selectedKey={selectedKey}
          completionSeenKeys={NO_COMPLETIONS}
          observability={EMPTY_OFFICE_OBSERVABILITY}
          conversationTargets={NO_CONVERSATIONS}
          onSelect={selectOfficeKey}
          onActivateAgent={selectOfficeKey}
          onActivateRoom={selectOfficeKey}
          canCreateSeat={roomCannotCreateSeat}
          onNewSeat={ignoreNewSeat}
          roomAlignment={preferences.roomAlignment}
          longRoomTitleMode={preferences.longTitleMode}
        />
      </div>
    </div>
  );
}
