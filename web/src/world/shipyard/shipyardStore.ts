import { useSyncExternalStore } from "react";
import { worldLocalStorage } from "../../browserStorage";
import {
  shipyardRepository,
  type ShipyardCatalog,
  type ShipyardSnapshot,
} from "../../../../shared/shipyard";
import { shipyardFixtureFetch } from "./shipyardFixture";

/**
 * The browser's Shipyard (#1028): one shared read of World's Shipyard API
 * (docs/shipyard-api.md) for Town's harbour and the Work lens's Releases
 * tab. It reads the catalog (the projects open in World's runtimes, #1226,
 * and running Worlds), then each open project's pipeline, one shipping lane
 * each in Town, plus a repository typed in "Another repository…" while it
 * is chosen. Each lane shows as soon as its own read lands. It asks for the
 * catalog every fifteen seconds while a view shows it, so lanes follow
 * projects opening and closing; a lane's pipeline every minute, sooner
 * while the service is still reading it; never while the page is hidden.
 * The service bounds every GitHub read; this only asks for what it last saw.
 */

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const PATH = "/api/world/shipyard";
/** How often the open projects are asked for. */
const POLL_MS = 15_000;
/** How often a lane's pipeline is asked for while it is not being read. */
const LANE_MS = 60_000;
/** The follow-up while the service refreshes: its hint, within these. */
const FOLLOW_UP = { min: 1_000, max: 10_000 } as const;
/** The repository last chosen, a preference on this browser only. */
export const SHIPYARD_REPO_KEY = "worldShipyardRepo.v1";
/** The repository typed in "Another repository…", while it is chosen. */
export const SHIPYARD_MANUAL_KEY = "worldShipyardManual.v1";

export type ShipyardState = {
  /** Null until the service first answers. */
  catalog: ShipyardCatalog | null;
  /** The chosen repository, or null when none is chosen or open. */
  repo: string | null;
  /**
   * A repository typed in "Another repository…": an extra lane while it is
   * the chosen one, dropped when an open project is chosen.
   */
  manual: string | null;
  /** The chosen repository's pipeline; null until it is read. */
  snapshot: ShipyardSnapshot | null;
  /**
   * Every lane's pipeline by repository, the chosen one's included: the
   * last good answer for each, kept while a later read of it fails.
   */
  snapshots: Readonly<Record<string, ShipyardSnapshot>>;
  /**
   * Lanes other than the chosen one whose last read failed, with why: their
   * kept answers read as out of date.
   */
  laneErrors: Readonly<Record<string, string>>;
  /** The service itself could not be reached or refused the read. */
  error: string | null;
};

export const EMPTY_SHIPYARD: ShipyardState = {
  catalog: null,
  repo: null,
  manual: null,
  snapshot: null,
  snapshots: {},
  laneErrors: {},
  error: null,
};

type Listener = () => void;

class ShipyardStore {
  #state = EMPTY_SHIPYARD;
  #listeners = new Set<Listener>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #fetch: FetchLike | null = null;
  /** The latest request started, and the newest catalog published. */
  #requested = 0;
  #published = 0;
  /** Per lane: the newest read published, and when it was last asked. */
  #lanePublished = new Map<string, number>();
  #laneAsked = new Map<string, number>();
  #inFlight: Promise<void> | null = null;

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#start();
    return () => {
      this.#listeners.delete(listener);
      if (!this.#listeners.size) this.#stop();
    };
  };

  state = () => this.#state;

  /** Tests and the testing fixture: use another service. */
  useFetch(fetchImpl: FetchLike | null) {
    this.#fetch = fetchImpl;
  }

  /** Tests: forget everything read. */
  reset() {
    this.#stop();
    this.#requested = 0;
    this.#published = 0;
    this.#lanePublished.clear();
    this.#laneAsked.clear();
    this.#inFlight = null;
    this.#state = EMPTY_SHIPYARD;
  }

  /**
   * Show another repository, remembered on this browser. `typed` marks one
   * entered in "Another repository…": it gets an extra lane while chosen.
   */
  choose(value: string, typed = false) {
    const repo = shipyardRepository(value);
    const state = this.#state;
    const manual = typed || repo === state.manual ? repo : null;
    try {
      worldLocalStorage.setItem(SHIPYARD_REPO_KEY, repo);
      if (manual) worldLocalStorage.setItem(SHIPYARD_MANUAL_KEY, manual);
      else worldLocalStorage.removeItem(SHIPYARD_MANUAL_KEY);
    } catch {
      // A private window keeps the choice for this page only.
    }
    // A failed read stays until a read succeeds: the chosen project's kept
    // answer reads as out of date (its own lane's failure, or the last
    // read's, which may have been the service's), and the project left
    // keeps the failure it had as the chosen one.
    const left = state.repo;
    const laneErrors = { ...state.laneErrors };
    if (left && left !== repo && state.error) laneErrors[left] = state.error;
    const error = laneErrors[repo] ?? state.error;
    delete laneErrors[repo];
    this.#set({
      ...state,
      repo,
      manual,
      snapshot:
        state.snapshot?.repo === repo
          ? state.snapshot
          : (state.snapshots[repo] ?? null),
      laneErrors,
      error,
    });
    return this.read(false, true);
  }

  /**
   * Read the catalog, then the lanes due. `force` asks the service to
   * refresh the chosen repository now (it keeps its own five-second
   * cooldown); `restart` starts a new read even while one runs (a new
   * choice). A timed `poll` asks only for lanes that are new, being read,
   * failed or a minute old; any other read asks for every lane.
   */
  read(force = false, restart = false, poll = false): Promise<void> {
    if (this.#inFlight && !force && !restart) return this.#inFlight;
    const sequence = ++this.#requested;
    const task = this.#read(sequence, force, poll)
      .catch((error: unknown) => {
        if (sequence < this.#published) return;
        this.#published = sequence;
        this.#set({
          ...this.#state,
          error: error instanceof Error ? error.message : "Shipyard failed",
        });
      })
      .finally(() => {
        if (this.#inFlight === task) this.#inFlight = null;
        this.#schedule();
      });
    this.#inFlight = task;
    return task;
  }

  async #read(sequence: number, force: boolean, poll: boolean) {
    const catalog = await this.#json<ShipyardCatalog>(PATH, "GET");
    if (sequence < this.#published) return;
    this.#published = sequence;
    // Lanes follow the open projects: a closed project's lane goes now.
    const before = this.#state;
    const lanes = shipyardLanes(catalog, before.manual);
    const repo = pickRepo(before.repo, catalog, before.manual);
    const snapshots: Record<string, ShipyardSnapshot> = {};
    const laneErrors: Record<string, string> = {};
    for (const name of lanes) {
      if (before.snapshots[name]) snapshots[name] = before.snapshots[name]!;
      if (before.laneErrors[name]) laneErrors[name] = before.laneErrors[name]!;
    }
    const error =
      repo === before.repo
        ? repo
          ? before.error
          : null
        : repo
          ? (laneErrors[repo] ?? null)
          : null;
    if (repo) delete laneErrors[repo];
    this.#set({
      catalog,
      repo,
      manual: before.manual,
      snapshot: repo ? (snapshots[repo] ?? null) : null,
      snapshots,
      laneErrors,
      error,
    });
    const now = Date.now();
    const due = lanes.filter((name) => {
      if (!poll || name === repo) return true;
      const last = snapshots[name];
      const asked = this.#laneAsked.get(name);
      return (
        !last ||
        last.refreshing ||
        name in laneErrors ||
        asked === undefined ||
        now - asked >= LANE_MS
      );
    });
    // The chosen repository first; each lane is shown as its read lands.
    due.sort((a, b) => Number(b === repo) - Number(a === repo));
    await Promise.all(
      due.map(async (name) => {
        this.#laneAsked.set(name, now);
        const refresh = force && name === repo;
        try {
          const snapshot = await this.#json<ShipyardSnapshot>(
            `${PATH}${refresh ? "/refresh" : ""}?repo=${encodeURIComponent(name)}`,
            refresh ? "POST" : "GET",
          );
          this.#lane(sequence, name, snapshot, null);
        } catch (failure) {
          this.#lane(
            sequence,
            name,
            null,
            failure instanceof Error ? failure.message : "Shipyard failed",
          );
        }
      }),
    );
  }

  /** One lane's read landed: show it, unless a newer read of it already did. */
  #lane(
    sequence: number,
    name: string,
    snapshot: ShipyardSnapshot | null,
    failure: string | null,
  ) {
    if ((this.#lanePublished.get(name) ?? 0) > sequence) return;
    this.#lanePublished.set(name, sequence);
    const state = this.#state;
    if (!state.catalog) return;
    // A project that closed while it was read has no lane to fill.
    if (
      name !== state.repo &&
      !shipyardLanes(state.catalog, state.manual).includes(name)
    )
      return;
    const chosen = name === state.repo;
    const snapshots = { ...state.snapshots };
    const laneErrors = { ...state.laneErrors };
    if (snapshot) {
      snapshots[name] = snapshot;
      delete laneErrors[name];
    } else if (!chosen) laneErrors[name] = failure!;
    this.#set({
      ...state,
      snapshots,
      laneErrors,
      ...(chosen
        ? {
            snapshot: snapshot ?? state.snapshot,
            error: snapshot ? null : failure,
          }
        : {}),
    });
  }

  async #json<T>(path: string, method: "GET" | "POST"): Promise<T> {
    const response = await (this.#fetch ?? shipyardFixtureFetch() ?? fetch)(
      path,
      {
        method,
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(70_000),
      },
    );
    if (!response.ok) throw new Error(await responseError(response));
    const body = (await response.json()) as T & { instances?: unknown };
    if (!body || typeof body !== "object" || !body.instances)
      throw new Error("Shipyard answered with something unexpected.");
    return body;
  }

  #set(state: ShipyardState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  #hidden() {
    return typeof document !== "undefined" && document.hidden;
  }

  #onVisibility = () => {
    if (this.#hidden()) this.#clearTimer();
    else void this.read();
  };

  #start() {
    if (this.#state.repo === null) {
      try {
        const stored = worldLocalStorage.getItem(SHIPYARD_REPO_KEY);
        const manual = worldLocalStorage.getItem(SHIPYARD_MANUAL_KEY);
        if (stored)
          this.#state = {
            ...this.#state,
            repo: stored,
            manual: manual === stored ? manual : null,
          };
      } catch {
        // No stored choice.
      }
    }
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.#onVisibility);
    if (!this.#hidden()) void this.read();
  }

  #schedule() {
    this.#clearTimer();
    if (!this.#listeners.size || this.#hidden()) return;
    // Sooner while any lane, or an open folder, is still being read.
    const hints = Object.values(this.#state.snapshots)
      .filter((snapshot) => snapshot.refreshing)
      .map((snapshot) => snapshot.retryAfterMs || 0);
    if (this.#state.snapshot?.refreshing)
      hints.push(this.#state.snapshot.retryAfterMs || 0);
    if (this.#state.catalog?.pending) hints.push(0);
    const delay = hints.length
      ? Math.min(FOLLOW_UP.max, Math.max(FOLLOW_UP.min, Math.min(...hints)))
      : POLL_MS;
    this.#timer = setTimeout(() => void this.read(false, false, true), delay);
  }

  #clearTimer() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #stop() {
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.#onVisibility);
    this.#clearTimer();
  }
}

/**
 * The repository to show: the one chosen while it still has a lane (an
 * open project, or the one typed), else the first open project's.
 */
export function pickRepo(
  chosen: string | null,
  catalog: ShipyardCatalog,
  manual: string | null = null,
): string | null {
  const lanes = shipyardLanes(catalog, manual);
  if (chosen) {
    try {
      const repo = shipyardRepository(chosen);
      if (lanes.includes(repo)) return repo;
    } catch {
      // A stored value that is no longer a repository name.
    }
  }
  return lanes[0] ?? null;
}

/**
 * The repositories with a shipping lane in Town: every open project's, and
 * the one typed in "Another repository…" first when no open project has it.
 */
export function shipyardLanes(
  catalog: ShipyardCatalog,
  manual: string | null,
): string[] {
  const lanes = [...catalog.repositories];
  if (manual && !lanes.includes(manual)) lanes.unshift(manual);
  return lanes;
}

export const shipyardStore = new ShipyardStore();

export function useShipyard(): ShipyardState {
  return useSyncExternalStore(
    shipyardStore.subscribe,
    shipyardStore.state,
    shipyardStore.state,
  );
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Fall through to the status.
  }
  return `Shipyard request failed (${response.status})`;
}
