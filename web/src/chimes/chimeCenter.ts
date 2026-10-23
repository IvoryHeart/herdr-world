import {
  type ChangeKind,
  type ChimeSender,
  DEFAULT_CHIMES,
  type Motif,
  type Timbre,
  chimePriority,
  chimeReason,
  motifFor,
  shouldChime,
  timbreFor,
} from "../../../shared/chimes";
import type { Interest } from "../../../shared/interest";
import { worldLocalStorage } from "../browserStorage";
import {
  type ProfilesDocument,
  profileFor,
  profilesSnapshot,
} from "../world/agentProfiles";
import { chimeAudioReady, playChime } from "./player";

/**
 * Turns a change that needs the owner into a chime and the reason line that
 * travels with it. Changes within a burst window play one chime: the first
 * at once, and a higher-priority one once more when the window ends. The
 * toast for a burst reads "N changes" with each reason.
 */

export const BURST_MS = 3_000;

/** This device's sound settings; not synced (each device decides). */
export type ChimeDevice = { on: boolean; volume: number };
const DEVICE_KEY = "chimeDevice";
const DEFAULT_DEVICE: ChimeDevice = { on: true, volume: 0.6 };

export function chimeDevice(): ChimeDevice {
  try {
    const stored = JSON.parse(
      worldLocalStorage.getItem(DEVICE_KEY) ?? "null",
    ) as Partial<ChimeDevice> | null;
    return {
      on: stored?.on !== false,
      volume:
        typeof stored?.volume === "number" &&
        stored.volume >= 0 &&
        stored.volume <= 1
          ? stored.volume
          : DEFAULT_DEVICE.volume,
    };
  } catch {
    return { ...DEFAULT_DEVICE };
  }
}
export function setChimeDevice(device: ChimeDevice) {
  try {
    worldLocalStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch {
    // Storage may be unavailable; the setting then lasts for this page.
  }
  deviceOverride = device;
}
let deviceOverride: ChimeDevice | null = null;
const currentDevice = () => deviceOverride ?? chimeDevice();

/** The viewer's interest, from layers' Interest once it lands. */
type InterestSource = {
  interestOf(connectionId: string, terminalId: string): Interest;
  anyFocused(): boolean;
};
let interest: InterestSource | null = null;
export function setChimeInterestSource(source: InterestSource | null) {
  interest = source;
}

export type Change = {
  kind: ChangeKind;
  connectionId: string;
  /** Null when Herdr gave no pane (custom notifications). */
  terminalId: string | null;
  /** The agent's own label (Herdr's agent name or kind), if known. */
  agent: string | null;
  /** What happened, from Herdr's title or body. */
  detail: string | null;
};

export type Announcement = {
  /** The toast or notification headline: the reason, or "N changes". */
  message: string;
  /** Every reason in the burst, newest last. */
  reasons: string[];
  /** World played (or will play) the sound, so the OS stays quiet. */
  chimed: boolean;
  /** Mark the OS notification silent: World owns the sound on this page. */
  silent: boolean;
};

type Deps = {
  now: () => number;
  document: () => ProfilesDocument | null;
  device: () => ChimeDevice;
  ready: () => boolean;
  play: (timbre: Timbre, motif: Motif, volume: number) => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
};

const browserDeps: Deps = {
  now: () => Date.now(),
  document: profilesSnapshot,
  device: currentDevice,
  ready: chimeAudioReady,
  play: playChime,
  setTimer: (run, ms) => setTimeout(run, ms),
};

/** Who sent a change, from the Town master role and the launch profile. */
export function senderOf(
  document: ProfilesDocument | null,
  change: Pick<Change, "connectionId" | "terminalId" | "agent">,
): (ChimeSender & { name: string }) | null {
  if (!change.terminalId) return null;
  const master = document?.town_master;
  const profile = profileFor(document, change.connectionId, change.terminalId);
  return {
    townMaster: Boolean(
      master &&
        master.connection_id === change.connectionId &&
        master.terminal_id === change.terminalId,
    ),
    profileChime: profile?.chime ?? null,
    name: profile?.name ?? change.agent ?? "Agent",
  };
}

export function createChimeCenter(deps: Deps = browserDeps) {
  let burst: {
    start: number;
    reasons: string[];
    played: number | null;
    pending: { timbre: Timbre; motif: Motif; priority: number } | null;
  } | null = null;

  function announce(change: Change): Announcement {
    const document = deps.document();
    const settings = document?.chimes ?? DEFAULT_CHIMES;
    const device = deps.device();
    const sender = senderOf(document, change);
    const motif = motifFor(change.kind);
    const reason = chimeReason({
      // Herdr's own agent label still names a pane World hasn't listed yet.
      who: sender?.name ?? change.agent,
      motif,
      detail: change.detail,
    });
    const townMaster = sender?.townMaster ?? false;
    const wanted =
      device.on &&
      shouldChime({
        motif,
        townMaster,
        settings,
        // A change on screen never reaches here (the store drops it).
        seen: false,
        ...(sender && change.terminalId && interest
          ? {
              interest: interest.interestOf(
                change.connectionId,
                change.terminalId,
              ),
              anyFocused: interest.anyFocused(),
            }
          : { anyFocused: interest?.anyFocused() ?? false }),
      });
    const timbre = timbreFor(sender, settings);
    const priority = chimePriority(motif, townMaster);
    const now = deps.now();
    if (!burst || now - burst.start >= BURST_MS)
      burst = { start: now, reasons: [], played: null, pending: null };
    const current = burst;
    current.reasons.push(reason);
    let chimed = false;
    if (wanted && deps.ready()) {
      if (current.played === null) {
        chimed = deps.play(timbre, motif, device.volume);
        if (chimed) current.played = priority;
      } else if (
        priority > current.played &&
        priority > (current.pending?.priority ?? -1)
      ) {
        // Escalate once, when the window ends.
        if (!current.pending)
          deps.setTimer(
            () => {
              const pending = current.pending;
              current.pending = null;
              if (pending)
                deps.play(pending.timbre, pending.motif, deps.device().volume);
            },
            current.start + BURST_MS - now,
          );
        current.pending = { timbre, motif, priority };
        chimed = true;
      } else chimed = true; // Covered by the burst's chime.
    }
    return {
      message:
        current.reasons.length > 1
          ? `${current.reasons.length} changes`
          : reason,
      reasons: [...current.reasons],
      chimed,
      silent: device.on ? deps.ready() : true,
    };
  }
  return {
    announce,
    reset() {
      burst = null;
    },
  };
}

/** The page's chime center. */
const pageCenter = createChimeCenter();
export const announceChange = pageCenter.announce;
/** Forget the current burst (tests). */
export const resetChimeBursts = pageCenter.reset;

/** A burst lists each change's reason; one change keeps its own detail. */
export function burstDetail(announcement: Announcement, detail: string) {
  return announcement.reasons.length > 1
    ? announcement.reasons.join(" · ")
    : detail;
}
