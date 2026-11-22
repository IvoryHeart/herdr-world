import { ArrowLeft, Building2, Play, Search, Trash2 } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ApartmentHistory,
  type ApartmentResident,
  apartmentProject,
  apartmentResumeArgs,
  apartmentResumeCommand,
  searchApartments,
} from "../../../../shared/apartments";
import { AgentHistoryChat } from "../../components/AgentHistoryChat";
import { AgentIcon } from "../../components/AgentIcon";
import type { HistoryEntry } from "../../components/agentHistory";
import { groupHistoryChatItems } from "../../components/agentHistoryView";
import { CloseButton } from "../../components/CloseButton";
import { useLayer } from "../../layerStack";
import { store } from "../../store";
import { formatUiDateTime } from "../../uiLocale";
import {
  harnessLabel,
  launchAgent,
  type LaunchTarget,
  type ProfilesDocument,
  useAgentProfiles,
} from "../agentProfiles";
import { launchConfirmedTerminal, noteAgentStarted } from "../agentStarts";
import { ProfileSprite } from "../ProfileSprite";
import { TERMINAL_COLOR_HEX } from "../terminalColor";
import { ResidentUsageLine } from "../usage/ResidentUsageLine";
import { residentUsageSharing } from "../usage/usageModel";
import { type OpenUsage, useUsageOpener } from "../usage/usageOpener";
import { useUsageAnalytics, type UsageReadState } from "../usage/usageStore";
import type { WorldObject, WorldSpaceObject } from "../worldObject";
import { residentLook, residentLookNote } from "./residentLook";
import { useApartments, worldApartmentsStore } from "./useApartments";
import "./apartments.css";

/** Rows shown at once; a search narrows a long history. */
export const APARTMENT_ROWS_SHOWN = 200;
const when = (at: number) => formatUiDateTime(new Date(at).toISOString());

/** Rooms that can start an agent on this resident's host. */
export function resumeRooms(
  world: Pick<WorldObject, "spaces" | "hosts">,
  resident: Pick<ApartmentResident, "connection_id">,
): WorldSpaceObject[] {
  return world.spaces.filter((space) => {
    if (space.connectionId !== resident.connection_id || space.stale)
      return false;
    if (space.actionable || space.coreControl) return true;
    const host = world.hosts.find(({ id }) => id === space.parentId);
    return (
      host?.connection.state === "ready" &&
      host.connection.generation === space.generation
    );
  });
}

/**
 * Apartments: every agent not running now, searchable; one opens with its
 * history and resumes into a room on the host where it ran. Each resident
 * shows its week of usage, which opens Usage's Breakdown on that agent
 * while Town is shown (#1101).
 */
export function ApartmentsDialog({
  world,
  initialQuery = "",
  onOpen,
  onClose,
}: {
  world: WorldObject;
  initialQuery?: string;
  onOpen(terminal: {
    connectionId: string;
    runtimeGeneration: number;
    terminalId: string;
  }): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const apartments = useApartments();
  const profiles = useAgentProfiles().document;
  const [query, setQuery] = useState(initialQuery);
  const [openId, setOpenId] = useState<string | null>(null);
  useLayer(true, onClose, { element: () => ref.current });
  // One usage read for every resident's line.
  const usage = useUsageAnalytics("agent", "7d");
  const opener = useUsageOpener();
  const openUsage = useMemo<OpenUsage | null>(
    () =>
      opener &&
      ((tab, filter) => {
        onClose();
        opener(tab, filter);
      }),
    [opener, onClose],
  );
  const found = useMemo(
    () => searchApartments(apartments.residents, query),
    [apartments.residents, query],
  );
  // Runs in one shell terminal share usage rows; their lines say so.
  const sharing = useMemo(
    () => residentUsageSharing(apartments.residents),
    [apartments.residents],
  );
  const open = openId
    ? (apartments.residents.find((item) => item.id === openId) ?? null)
    : null;
  const shown = found.slice(0, APARTMENT_ROWS_SHOWN);

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal apartments-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Apartments"
      >
        <div className="modal-head">
          {open ? (
            <button type="button" onClick={() => setOpenId(null)}>
              <ArrowLeft size={14} aria-hidden="true" /> Residents
            </button>
          ) : (
            <h2>
              <Building2 size={16} aria-hidden="true" /> Apartments
            </h2>
          )}
          <CloseButton onClick={onClose} label="Close apartments" />
        </div>
        {open ? (
          <ResidentDetail
            key={open.id}
            resident={open}
            profiles={profiles}
            world={world}
            usage={usage}
            usageShared={sharing.get(open.id) ?? 0}
            onOpenUsage={openUsage}
            element={() => ref.current}
            onOpen={onOpen}
            onClose={onClose}
            onBack={() => setOpenId(null)}
          />
        ) : (
          <>
            <label className="apartments-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Name, project, summary, #PR or 2026-11-19"
                aria-label="Search residents"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <p aria-live="polite">
              {!apartments.verified && !apartments.residents.length
                ? "Reading residents…"
                : query.trim()
                  ? `${found.length} of ${apartments.residents.length} residents`
                  : `${apartments.residents.length} residents · up to ${apartments.capacity}, newest kept`}
              {found.length > shown.length
                ? ` · newest ${shown.length} shown; search to find older`
                : ""}
            </p>
            {found.length ? (
              <ul className="apartments-list" aria-label="Residents">
                {shown.map((resident) => (
                  <li key={resident.id}>
                    <ResidentRow
                      resident={resident}
                      profiles={profiles}
                      onOpen={() => setOpenId(resident.id)}
                    />
                    <ResidentUsageLine
                      resident={resident}
                      usage={usage}
                      shared={sharing.get(resident.id) ?? 0}
                      onOpen={openUsage}
                    />
                  </li>
                ))}
              </ul>
            ) : apartments.verified || apartments.residents.length ? (
              <p>
                {apartments.residents.length
                  ? "No resident matches."
                  : "No one lives here yet. Agents from connected hosts' Claude, Codex and Pi histories move in asleep; an agent whose terminal ends, or that the bus takes, moves in too."}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A resident's avatar: the Town character it had (residentLook.ts), on its
 * colour, with its harness's icon, as the Inspector shows a live agent.
 */
export function ResidentAvatar({
  resident,
  profiles,
  large = false,
}: {
  resident: ApartmentResident;
  profiles: Pick<ProfilesDocument, "profiles"> | null;
  large?: boolean;
}) {
  const look = useMemo(
    () => residentLook(resident, profiles),
    [resident, profiles],
  );
  const color = resident.appearance?.color;
  const note = residentLookNote(look);
  return (
    <span
      className="apartments-avatar"
      data-large={large || undefined}
      data-avatar-source={look.source}
      style={
        color
          ? ({ "--agent-colour": TERMINAL_COLOR_HEX[color] } as CSSProperties)
          : undefined
      }
      title={note ?? undefined}
    >
      <ProfileSprite look={look.look} scale={large ? 3 : 2} />
      <span className="apartments-avatar-harness">
        <AgentIcon agent={resident.harness ?? undefined} compact />
      </span>
    </span>
  );
}

function ResidentRow({
  resident,
  profiles,
  onOpen,
}: {
  resident: ApartmentResident;
  profiles: Pick<ProfilesDocument, "profiles"> | null;
  onOpen(): void;
}) {
  const project = apartmentProject(resident);
  return (
    <button type="button" className="apartments-row" onClick={onOpen}>
      <ResidentAvatar resident={resident} profiles={profiles} />
      <span className="apartments-row-body">
        <span className="apartments-row-head">
          <strong>{resident.name}</strong>
          <time
            className="apartments-muted"
            dateTime={new Date(resident.moved_out_at).toISOString()}
          >
            {when(resident.moved_out_at)}
          </time>
        </span>
        <span className="apartments-muted">
          {[
            resident.harness ? harnessLabel(resident.harness) : null,
            project,
            resident.room && resident.room !== project ? resident.room : null,
            resident.connection_label,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {resident.summary ? (
          <span className="apartments-row-summary">{resident.summary}</span>
        ) : null}
        {resident.links.length ? (
          <span className="apartments-row-links">
            {resident.links.map((link) => (
              <span key={`${link.kind}${link.repo ?? ""}${link.number}`}>
                {link.kind === "pr" ? "PR" : "Issue"} #{link.number}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ResidentDetail({
  resident,
  profiles,
  world,
  usage,
  usageShared,
  onOpenUsage,
  element,
  onOpen,
  onClose,
  onBack,
}: {
  resident: ApartmentResident;
  profiles: Pick<ProfilesDocument, "profiles"> | null;
  world: WorldObject;
  usage: UsageReadState;
  usageShared: number;
  onOpenUsage: OpenUsage | null;
  element(): Element | null;
  onOpen(terminal: {
    connectionId: string;
    runtimeGeneration: number;
    terminalId: string;
  }): void;
  onClose(): void;
  /** Back to the list (also after eviction). */
  onBack(): void;
}) {
  // Its own layer above the dialog's: Esc goes back, a second Esc closes.
  useLayer(true, onBack, { element });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const rooms = useMemo(() => resumeRooms(world, resident), [world, resident]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const room =
    rooms.find((space) => space.id === roomId) ??
    rooms.find((space) => space.label === resident.room) ??
    rooms[0] ??
    null;
  const resumable = apartmentResumeArgs(resident) !== null;
  const command = apartmentResumeCommand(resident);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEvict, setConfirmEvict] = useState(false);

  const resume = async () => {
    if (!room || busy) return;
    const target: LaunchTarget = {
      connectionId: room.connectionId,
      generation: room.generation,
      workspaceId: room.nativeId,
      workspaceLabel: room.label,
      ...(room.coreControl ? { runtime: "herdr-core" as const } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const result = await launchAgent(target, {
        label: resident.name,
        text: "",
        resumeResident: resident.id,
      });
      const terminalId = launchConfirmedTerminal(result);
      if (terminalId)
        noteAgentStarted({
          connectionId: target.connectionId,
          generation: target.generation,
          terminalId,
          from: "elsewhere",
        });
      if (!terminalId) {
        if (mounted.current)
          setError(result.message ?? "World could not confirm the resume.");
        return;
      }
      if (target.runtime === "herdr-core") {
        store.notify({
          kind: "info",
          message:
            result.message ??
            `${resident.name} is back in ${target.workspaceLabel}.`,
        });
      } else
        onOpen({
          connectionId: target.connectionId,
          runtimeGeneration: target.generation,
          terminalId,
        });
      onClose();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const evict = async () => {
    setBusy(true);
    const failed = await worldApartmentsStore().evict([resident.id]);
    if (!mounted.current) return;
    setBusy(false);
    if (failed) setError(failed);
    else onBack();
  };

  return (
    <div className="apartments-detail">
      <header className="apartments-detail-head">
        <ResidentAvatar resident={resident} profiles={profiles} large />
        <div>
          <h2>{resident.name}</h2>
          <p className="apartments-muted">
            {[
              resident.harness ? harnessLabel(resident.harness) : null,
              resident.room,
              resident.connection_label,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <ResidentUsageLine
            resident={resident}
            usage={usage}
            shared={usageShared}
            onOpen={onOpenUsage}
          />
        </div>
      </header>
      <dl className="apartments-facts">
        <dt>Harness</dt>
        <dd>{resident.harness ? harnessLabel(resident.harness) : "Unknown"}</dd>
        <dt>Project</dt>
        <dd>{resident.cwd ?? apartmentProject(resident) ?? "Unknown"}</dd>
        <dt>Room</dt>
        <dd>
          {[resident.room, resident.tab].filter(Boolean).join(" · ") ||
            "Unknown"}{" "}
          on {resident.connection_label}
          {resident.runtime === "herdr-core" ? " (herdr-core)" : ""}
        </dd>
        <dt>Ran</dt>
        <dd>
          {when(resident.first_seen_at)} – {when(resident.moved_out_at)}
        </dd>
        <dt>Moved in</dt>
        <dd>
          {resident.move_out === "retired"
            ? "Retired by the bus"
            : resident.move_out === "found"
              ? "Asleep: found in its harness's history"
              : "Its terminal ended"}
        </dd>
      </dl>
      {resident.summary ? (
        <section aria-label="Summary">
          <h3>Summary</h3>
          <p>{resident.summary}</p>
        </section>
      ) : null}
      {resident.last_report ? (
        <section aria-label="Last report">
          <h3>Last report</h3>
          <p className="apartments-report">{resident.last_report}</p>
        </section>
      ) : null}
      {resident.links.length ? (
        <section aria-label="Linked work">
          <h3>Linked work</h3>
          <ul>
            {resident.links.map((link) => {
              const label = `${link.kind === "pr" ? "PR" : "Issue"} #${link.number}${link.repo ? ` · ${link.repo}` : ""}`;
              return (
                <li key={`${link.kind}${link.repo ?? ""}${link.number}`}>
                  {link.url ? (
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                  {link.title ? (
                    <span className="apartments-muted"> {link.title}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-label="Resume">
        <h3>Resume</h3>
        {!resumable ? (
          <p className="apartments-muted">
            World cannot resume this agent:{" "}
            {resident.session_id
              ? `it does not know how to resume ${resident.harness ? harnessLabel(resident.harness) : "this harness"}.`
              : "it never reported its session."}
          </p>
        ) : rooms.length === 0 ? (
          <p className="apartments-muted">
            Connect {resident.connection_label} to resume it there.
          </p>
        ) : (
          <div className="apartments-resume">
            <select
              aria-label="Room to resume in"
              value={room?.id ?? ""}
              onChange={(event) => setRoomId(event.target.value)}
            >
              {rooms.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.label} · {space.hostLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="apartments-resume-button"
              disabled={busy || !room}
              onClick={() => void resume()}
            >
              <Play size={13} aria-hidden="true" /> Resume in room
            </button>
          </div>
        )}
        {command ? (
          <p className="apartments-muted">
            Or in a terminal there: <code>{command}</code>
          </p>
        ) : null}
        {error ? (
          <p className="apartments-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <ResidentHistory resident={resident} />

      <section aria-label="Move out" className="apartments-evict">
        {confirmEvict ? (
          <>
            <span>
              Forget {resident.name}? Its transcript stays on the host.
            </span>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void evict()}
            >
              Evict
            </button>
            <button type="button" onClick={() => setConfirmEvict(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmEvict(true)}>
            <Trash2 size={13} aria-hidden="true" /> Evict…
          </button>
        )}
      </section>
    </div>
  );
}

function ResidentHistory({ resident }: { resident: ApartmentResident }) {
  const [history, setHistory] = useState<ApartmentHistory | "loading" | null>(
    null,
  );
  const [full, setFull] = useState<HistoryEntry | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () =>
      history && history !== "loading"
        ? groupHistoryChatItems(
            history.messages.map(
              (message): HistoryEntry => ({
                id: message.id,
                role: message.role,
                kind: "message",
                text: message.text,
                sent_at: message.sent_at,
              }),
            ),
          )
        : [],
    [history],
  );
  const load = async () => {
    setHistory("loading");
    try {
      setHistory(await worldApartmentsStore().history(resident.id));
    } catch (cause) {
      setHistory({
        status: "unavailable",
        detail: cause instanceof Error ? cause.message : String(cause),
        messages: [],
        truncated: false,
        report: null,
      });
    }
  };
  return (
    <section aria-label="History">
      <h3>History</h3>
      {history === null ? (
        <button type="button" onClick={() => void load()}>
          Read history
        </button>
      ) : history === "loading" ? (
        <p className="apartments-muted">Reading its transcript…</p>
      ) : history.status === "unavailable" ? (
        <p className="apartments-muted">{history.detail}</p>
      ) : full ? (
        <div>
          <button type="button" onClick={() => setFull(null)}>
            <ArrowLeft size={13} aria-hidden="true" /> Conversation
          </button>
          <p className="apartments-report">{full.text}</p>
        </div>
      ) : (
        <>
          {history.truncated ? (
            <p className="apartments-muted">Showing the latest messages.</p>
          ) : null}
          {items.length ? (
            <div className="apartments-chat agent-history-chat-frame">
              <AgentHistoryChat
                items={items}
                listRef={listRef}
                contentRef={contentRef}
                speechScopeKey={`apartment:${resident.id}`}
                onOpen={setFull}
              />
            </div>
          ) : (
            <p className="apartments-muted">The transcript has no messages.</p>
          )}
        </>
      )}
    </section>
  );
}
