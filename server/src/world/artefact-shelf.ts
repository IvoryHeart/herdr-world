import {
  ARTEFACT_SHELF_LIMIT,
  type AgentArtefact,
  type ArtefactShelf,
  type ShelvedArtefact,
} from "../../../shared/agentArtefacts";
import type { ApartmentResident } from "../../../shared/apartments";
import {
  localArtefactStat,
  ownedArtefacts,
  withArtefactPresence,
  type ArtefactCandidate,
} from "../agent/artefacts";
import type { AgentQuest } from "../agent/quest";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import { readSessionProjection } from "../agent/session-projection-cache";
import { resolveResidentSession } from "./apartment-history";

/** The most gone agents one shelf read looks at, newest move-out first. */
const SHELF_RESIDENTS = 40;
/**
 * A gone agent's transcript is read again after this long.
 * @internal
 */
export const SHELF_RESIDENT_TTL_MS = 10 * 60_000;
const RESIDENT_CACHE = 256;

export type ArtefactShelfHost = {
  /** The live agents' desk reads (quest, stop, artefacts) on this host. */
  quests(): Promise<AgentQuest[]>;
  /** The host's transcript files. */
  files: AgentSessionFileAccess;
  /**
   * The host's rooms now (Herdr workspaces: ID and label). Apartments
   * records a gone maker's room by its label, so the shelf finds the room
   * that still has it.
   */
  rooms(): Promise<readonly ArtefactShelfRoom[]>;
};

export type ArtefactShelfRoom = { workspace_id: string; label: string };

/**
 * The room a gone maker sat in, by the label Apartments recorded: the one
 * room on the host with that label now, else unknown (gone, renamed, or
 * several share it).
 */
function roomIds(rooms: readonly ArtefactShelfRoom[]) {
  const byLabel = new Map<string, string | null>();
  for (const room of rooms)
    byLabel.set(room.label, byLabel.has(room.label) ? null : room.workspace_id);
  return (label: string | null) =>
    label === null ? null : (byLabel.get(label) ?? null);
}

/**
 * The Library's "Made by agents" shelf for one host (#1327), derived on each
 * read and never stored: the artefacts its running agents' desk reads
 * report, plus those in the transcripts of agents that have gone
 * (Apartments' records on that host), so a gone agent's work stays on the
 * shelf with the maker named as it was. One record per place; a running
 * maker's record wins over a gone one's, else the newest.
 */
export function createArtefactShelf(deps: {
  /** The host at exactly this generation, or null when it is not current. */
  host(connectionId: string, generation: number): ArtefactShelfHost | null;
  /** Apartments' residents (agents not running now). */
  residents(): readonly ApartmentResident[];
  now(): number;
}) {
  const gone = new Map<
    string,
    { at: number; candidates: readonly ArtefactCandidate[] }
  >();

  async function residentCandidates(
    resident: ApartmentResident,
    files: AgentSessionFileAccess,
  ): Promise<readonly ArtefactCandidate[]> {
    const key = `${resident.id}\0${resident.session_id}`;
    const cached = gone.get(key);
    if (cached && deps.now() - cached.at < SHELF_RESIDENT_TTL_MS)
      return cached.candidates;
    let candidates: readonly ArtefactCandidate[] = [];
    try {
      const found = await resolveResidentSession(resident, files);
      if (found.ok)
        candidates = (
          await readSessionProjection(
            found.resolved.agent,
            found.resolved.file,
            files,
          )
        ).artefacts;
    } catch {
      // An unreadable transcript adds nothing; the next read tries again.
      return cached?.candidates ?? [];
    }
    gone.delete(key);
    gone.set(key, { at: deps.now(), candidates });
    while (gone.size > RESIDENT_CACHE) gone.delete(gone.keys().next().value!);
    return candidates;
  }

  async function goneArtefacts(
    connectionId: string,
    files: AgentSessionFileAccess,
    roomOf: (label: string | null) => string | null,
  ): Promise<ShelvedArtefact[]> {
    const residents = deps
      .residents()
      .filter(
        (resident) =>
          resident.connection_id === connectionId && resident.session_id,
      )
      .sort((a, b) => b.moved_out_at - a.moved_out_at)
      .slice(0, SHELF_RESIDENTS);
    const lists = await Promise.all(
      residents.map(async (resident) => {
        const candidates = await residentCandidates(resident, files);
        if (!candidates.length) return [];
        const present = await withArtefactPresence(
          candidates,
          files.remote ? null : localArtefactStat,
        );
        return ownedArtefacts(present, connectionId, () => ({
          connection_id: connectionId,
          pane_id: resident.terminal_id,
          agent: resident.harness ?? "",
          workspace_id: roomOf(resident.room),
          // Continuity evidence matters only while a maker runs.
          session: null,
        })).map((artefact) => ({
          ...artefact,
          gone_maker: resident.name,
          gone_room: resident.room,
        }));
      }),
    );
    return lists.flat();
  }

  return {
    async list(
      connectionId: string,
      generation: number,
    ): Promise<ArtefactShelf> {
      const host = deps.host(connectionId, generation);
      if (!host)
        throw new Error("That host is not connected at this generation");
      // A failed room read leaves gone makers' rooms unknown, not the shelf.
      const rooms = await host.rooms().catch(() => []);
      const [quests, past] = await Promise.all([
        host.quests(),
        goneArtefacts(connectionId, host.files, roomIds(rooms)),
      ]);
      const live: ShelvedArtefact[] = quests.flatMap((quest) =>
        (quest.artefacts ?? []).map((artefact) => ({
          ...artefact,
          gone_maker: null,
          gone_room: null,
        })),
      );
      const byPlace = new Map<string, ShelvedArtefact>();
      for (const artefact of [...live, ...past]) {
        const known = byPlace.get(artefact.id);
        if (!known || newer(artefact, known))
          byPlace.set(artefact.id, artefact);
      }
      const all = [...byPlace.values()].sort(byNewest);
      return {
        connection_id: connectionId,
        connection_generation: generation,
        observed_at: deps.now(),
        artefacts: all.slice(0, ARTEFACT_SHELF_LIMIT),
        truncated: all.length > ARTEFACT_SHELF_LIMIT,
      };
    },
  };
}

const time = (artefact: Pick<AgentArtefact, "made_at">) =>
  artefact.made_at ? Date.parse(artefact.made_at) || 0 : 0;
/** A running maker's record wins; between equals, the newest. */
function newer(a: ShelvedArtefact, b: ShelvedArtefact) {
  if ((a.gone_maker === null) !== (b.gone_maker === null))
    return a.gone_maker === null;
  return time(a) > time(b);
}
const byNewest = (a: ShelvedArtefact, b: ShelvedArtefact) => time(b) - time(a);

export type ArtefactShelfService = ReturnType<typeof createArtefactShelf>;
