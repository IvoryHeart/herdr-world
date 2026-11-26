import {
  SHIPYARD_LIMITS as L,
  shipyardRepository,
  type ShipyardCatalog,
  type ShipyardInstance,
  type ShipyardPipeline,
  type ShipyardSnapshot,
  type ShipyardWindow,
} from "../../../shared/shipyard";
import type { RunProcess } from "../sources/github";
import { readShipyardGitHub } from "./github";
import type { OpenProjects } from "./projects";

type Entry = {
  data: ShipyardPipeline | null;
  state: ShipyardSnapshot["state"];
  detail: string;
  checkedAt: number | null;
  lastSuccessAt: number | null;
};
export type ShipyardServiceOptions = {
  run: RunProcess;
  source(): { enabled: boolean; generation: number };
  /** The projects open in World's runtimes: the catalog's lanes (#1226). */
  projects(): Promise<OpenProjects>;
  instances(): ShipyardWindow<ShipyardInstance>;
  now?: () => number;
  waitMs?: number;
};

export class ShipyardService {
  #cache = new Map<string, Entry>();
  /** Reads running or waiting for one of `concurrentReads` slots. */
  #reads = new Map<string, Promise<void>>();
  #running = 0;
  #queue: (() => void)[] = [];
  #generation: number | null = null;
  #closed = false;
  #now: () => number;
  constructor(private readonly options: ShipyardServiceOptions) {
    this.#now = options.now ?? Date.now;
  }
  #source() {
    const source = this.options.source();
    if (source.generation !== this.#generation || !source.enabled) {
      this.#generation = source.generation;
      this.#cache.clear();
    }
    return source;
  }
  /**
   * The open projects, one per GitHub repository, every one of them: a
   * folder past the limit is counted in `omitted`, never dropped silently.
   */
  async catalog(): Promise<ShipyardCatalog> {
    const open = await this.options.projects();
    const repositories = new Set<string>();
    for (const project of open.projects)
      if (project.repo) repositories.add(shipyardRepository(project.repo));
    return {
      observedAt: this.#now(),
      repositories: [...repositories].sort(),
      projects: open.projects,
      pending: open.pending,
      omitted: open.omitted,
      instances: this.options.instances(),
      limits: L,
    };
  }
  async #slot() {
    if (this.#running >= L.concurrentReads)
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#running++;
  }
  #release() {
    this.#running--;
    this.#queue.shift()?.();
  }
  async snapshot(input: string, force = false): Promise<ShipyardSnapshot> {
    const repo = shipyardRepository(input);
    const source = this.#source();
    let entry = this.#cache.get(repo);
    if (source.enabled && !this.#closed) {
      if (!entry) {
        if (this.#cache.size >= L.pipelines) {
          // LRU, never evicting a repository whose read is running or
          // waiting. With none to give up, admit nothing: the cache and the
          // reads stay bounded, and the caller asks again shortly.
          const oldest = [...this.#cache.keys()].find(
            (key) => !this.#reads.has(key),
          );
          if (oldest === undefined)
            return {
              ...this.current(repo),
              detail:
                "Shipyard is reading as many repositories as it holds; this one waits its turn.",
              refreshing: true,
              retryAfterMs: L.waitMs,
            };
          this.#cache.delete(oldest);
        }
        entry = {
          data: null,
          state: "unavailable",
          detail: "Release pipeline has not been read yet.",
          checkedAt: null,
          lastSuccessAt: null,
        };
        this.#cache.set(repo, entry);
      } else {
        this.#cache.delete(repo);
        this.#cache.set(repo, entry);
      }
      const interval = force ? L.forcedRefreshMs : L.refreshMs;
      if (
        !this.#reads.has(repo) &&
        (entry.checkedAt === null || this.#now() - entry.checkedAt >= interval)
      ) {
        const target = entry;
        const generation = source.generation;
        const fenced = () => {
          const current = this.#source();
          return (
            this.#closed ||
            !current.enabled ||
            current.generation !== generation ||
            this.#cache.get(repo) !== target
          );
        };
        const task = (async () => {
          await this.#slot();
          try {
            // Superseded while waiting for a slot: read nothing.
            if (fenced()) return;
            const result = await readShipyardGitHub(this.options.run, repo);
            if (fenced()) return;
            target.checkedAt = this.#now();
            if (result.ok) {
              target.data = result.data;
              target.state = "fresh";
              target.detail =
                "GitHub release pipeline observed. Section limits apply.";
              target.lastSuccessAt = target.checkedAt;
            } else {
              target.state = result.state;
              target.detail = result.detail;
            }
          } finally {
            this.#release();
          }
        })();
        this.#reads.set(repo, task);
        void task.finally(() => {
          if (this.#reads.get(repo) === task) this.#reads.delete(repo);
        });
      }
      const running = this.#reads.get(repo);
      if (running) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          running,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.options.waitMs ?? L.waitMs);
          }),
        ]);
        clearTimeout(timer);
      }
    }
    return this.current(repo);
  }
  current(input: string): ShipyardSnapshot {
    const repo = shipyardRepository(input);
    const source = this.#source();
    const entry =
      source.enabled && !this.#closed ? this.#cache.get(repo) : undefined;
    const data = entry?.data ? structuredClone(entry.data) : null;
    const stale =
      !!data &&
      (entry?.state !== "fresh" ||
        this.#now() - entry.lastSuccessAt! >= L.refreshMs);
    const instances = this.options.instances();
    for (const instance of instances.items) {
      instance.releaseId =
        data && instance.repo === repo
          ? (data.releases.items.find(
              (release) =>
                release.version === instance.version.replace(/^v(?=\d)/u, ""),
            )?.id ?? null)
          : null;
    }
    return {
      observedAt: this.#now(),
      repo,
      source: "github",
      state: !source.enabled
        ? "disabled"
        : stale
          ? "stale"
          : (entry?.state ?? "unavailable"),
      detail: !source.enabled
        ? "GitHub is switched off in Sources."
        : (entry?.detail ?? "Release pipeline is unavailable."),
      checkedAt: entry?.checkedAt ?? null,
      lastSuccessAt: entry?.lastSuccessAt ?? null,
      refreshing: source.enabled && this.#reads.has(repo),
      retryAfterMs: this.#reads.has(repo)
        ? L.waitMs
        : Math.max(
            0,
            L.forcedRefreshMs - (this.#now() - (entry?.checkedAt ?? -Infinity)),
          ),
      data,
      instances,
      limits: L,
    };
  }
  close() {
    this.#closed = true;
    this.#cache.clear();
  }
}
