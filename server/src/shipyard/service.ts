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

type Entry = {
  data: ShipyardPipeline | null;
  state: ShipyardSnapshot["state"];
  detail: string;
  checkedAt: number | null;
  lastSuccessAt: number | null;
};
export type ShipyardServiceOptions = {
  run: RunProcess;
  source(): { enabled: boolean; generation: number; repositories: string[] };
  instances(): ShipyardWindow<ShipyardInstance>;
  now?: () => number;
  waitMs?: number;
};

export class ShipyardService {
  #cache = new Map<string, Entry>();
  #active: { repo: string; task: Promise<void> } | null = null;
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
  catalog(): ShipyardCatalog {
    const source = this.#source();
    const instances = this.options.instances();
    const suggestions = [
      ...(source.enabled ? source.repositories : []),
      ...instances.items.flatMap((i) => (i.repo ? [i.repo] : [])),
      ...this.#cache.keys(),
    ];
    const repositories = new Set<string>();
    for (const value of suggestions) {
      try {
        repositories.add(shipyardRepository(value));
      } catch {
        /* Not a GitHub repository. */
      }
    }
    return {
      observedAt: this.#now(),
      repositories: [...repositories].sort().slice(0, L.repositories),
      instances,
      limits: L,
    };
  }
  async snapshot(input: string, force = false): Promise<ShipyardSnapshot> {
    const repo = shipyardRepository(input);
    const source = this.#source();
    let entry = this.#cache.get(repo);
    if (source.enabled && !this.#closed) {
      if (!entry) {
        if (this.#cache.size >= L.repositories)
          this.#cache.delete(
            [...this.#cache.keys()].find((key) => key !== this.#active?.repo)!,
          );
        entry = {
          data: null,
          state: "unavailable",
          detail: "Release pipeline has not been read yet.",
          checkedAt: null,
          lastSuccessAt: null,
        };
        this.#cache.set(repo, entry);
      } else {
        // LRU, excluding the one in-flight entry from eviction.
        this.#cache.delete(repo);
        this.#cache.set(repo, entry);
      }
      const interval = force ? L.forcedRefreshMs : L.refreshMs;
      if (
        !this.#active &&
        (entry.checkedAt === null || this.#now() - entry.checkedAt >= interval)
      ) {
        const target = entry;
        const generation = source.generation;
        const task = readShipyardGitHub(this.options.run, repo).then(
          (result) => {
            const current = this.#source();
            if (
              this.#closed ||
              !current.enabled ||
              current.generation !== generation ||
              this.#cache.get(repo) !== target
            )
              return;
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
          },
        );
        this.#active = { repo, task };
        void task.finally(() => {
          if (this.#active?.task === task) this.#active = null;
        });
      }
      if (this.#active?.repo === repo) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          this.#active.task,
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
      refreshing: source.enabled && this.#active?.repo === repo,
      retryAfterMs: this.#active
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
