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
 * tab. It reads the catalog (suggested repositories and running Worlds),
 * then every suggested repository's pipeline, one shipping lane each in
 * Town, and the chosen one's for the Releases tab. It asks again every minute while a
 * view shows it, sooner while the service says it is still refreshing, and
 * never while the page is hidden. The service bounds every GitHub read;
 * this only asks for what it last saw.
 */

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const PATH = "/api/world/shipyard";
const POLL_MS = 60_000;
/** The follow-up while the service refreshes: its hint, within these. */
const FOLLOW_UP = { min: 1_000, max: 10_000 } as const;
/** The repository last chosen, a preference on this browser only. */
export const SHIPYARD_REPO_KEY = "worldShipyardRepo.v1";

export type ShipyardState = {
  /** Null until the service first answers. */
  catalog: ShipyardCatalog | null;
  /** The chosen repository, or null when none is chosen or suggested. */
  repo: string | null;
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
  /** The latest request started, and the newest one published. */
  #requested = 0;
  #published = 0;
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
    this.#inFlight = null;
    this.#state = EMPTY_SHIPYARD;
  }

  /** Show another repository, remembered on this browser. */
  choose(value: string) {
    const repo = shipyardRepository(value);
    try {
      worldLocalStorage.setItem(SHIPYARD_REPO_KEY, repo);
    } catch {
      // A private window keeps the choice for this page only.
    }
    this.#set({
      ...this.#state,
      repo,
      snapshot:
        this.#state.snapshot?.repo === repo
          ? this.#state.snapshot
          : (this.#state.snapshots[repo] ?? null),
    });
    return this.read(false, true);
  }

  /**
   * Read the catalog, then the chosen repository. `force` asks the service
   * to refresh GitHub now (it keeps its own five-second cooldown);
   * `restart` starts a new read even while one runs (a new choice).
   */
  read(force = false, restart = false): Promise<void> {
    if (this.#inFlight && !force && !restart) return this.#inFlight;
    const sequence = ++this.#requested;
    const task = this.#read(sequence, force)
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

  async #read(sequence: number, force: boolean) {
    const catalog = await this.#json<ShipyardCatalog>(PATH, "GET");
    const repo = pickRepo(this.#state.repo, catalog);
    const lanes = shipyardLanes(catalog, repo);
    const ask = (name: string) => {
      const refresh = force && name === repo;
      return this.#json<ShipyardSnapshot>(
        `${PATH}${refresh ? "/refresh" : ""}?repo=${encodeURIComponent(name)}`,
        refresh ? "POST" : "GET",
      );
    };
    // The chosen repository's read decides the Shipyard's health; another
    // lane's failure keeps that lane's last answer, as out of date.
    const rest = lanes.filter((name) => name !== repo);
    const [chosen, ...others] = await Promise.allSettled(
      [repo, ...rest].map((name) => (name ? ask(name) : Promise.resolve(null))),
    );
    if (chosen!.status === "rejected") throw chosen!.reason;
    const snapshot = chosen!.value;
    if (sequence < this.#published) return;
    this.#published = sequence;
    const snapshots: Record<string, ShipyardSnapshot> = {};
    for (const name of lanes) {
      const last = this.#state.snapshots[name];
      if (last) snapshots[name] = last;
    }
    const laneErrors: Record<string, string> = {};
    if (chosen!.status === "fulfilled" && chosen!.value)
      snapshots[chosen!.value.repo] = chosen!.value;
    others.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value) snapshots[result.value.repo] = result.value;
      } else
        laneErrors[rest[index]!] =
          result.reason instanceof Error
            ? result.reason.message
            : "Shipyard failed";
    });
    // A choice made while this read ran wins over the repository it read.
    const picked = pickRepo(this.#state.repo, catalog);
    this.#set({
      catalog,
      repo: picked,
      snapshot: snapshot && snapshot.repo === picked ? snapshot : null,
      snapshots,
      laneErrors,
      error: null,
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
        if (stored) this.#state = { ...this.#state, repo: stored };
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
    const snapshot = this.#state.snapshot;
    const delay = snapshot?.refreshing
      ? Math.min(
          FOLLOW_UP.max,
          Math.max(FOLLOW_UP.min, snapshot.retryAfterMs || 0),
        )
      : POLL_MS;
    this.#timer = setTimeout(() => void this.read(), delay);
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
 * The repository to show: the one chosen (kept even when the catalog no
 * longer suggests it), else the catalog's first suggestion.
 */
export function pickRepo(
  chosen: string | null,
  catalog: ShipyardCatalog,
): string | null {
  if (chosen) {
    try {
      return shipyardRepository(chosen);
    } catch {
      // A stored value that is no longer a repository name.
    }
  }
  return catalog.repositories[0] ?? null;
}

/**
 * The repositories with a shipping lane in Town: every one the catalog
 * suggests, and the chosen one first when the catalog no longer does.
 */
export function shipyardLanes(
  catalog: ShipyardCatalog,
  chosen: string | null,
): string[] {
  const lanes = [...catalog.repositories];
  if (chosen && !lanes.includes(chosen)) lanes.unshift(chosen);
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
