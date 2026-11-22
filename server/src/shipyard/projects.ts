import { isAbsolute } from "node:path";
import {
  SHIPYARD_LIMITS as L,
  shipyardRepository,
  type ShipyardProject,
} from "../../../shared/shipyard";
import { sshCommandArgv } from "../bridge/ssh-command";
import type { RunProcess } from "../sources/github";
import type { CheckoutHost, TopologyConnection } from "../sources/links";
import { shQuote } from "../utils/process-utils";
import { parseReviewRemote } from "../workspace/pull-request";
import { record } from "./parse";

/**
 * The projects open in World's runtimes (#1226): Shipyard's lanes follow
 * them, not every repository GitHub knows of. A project is a room or space
 * (a workspace in the aggregate topology) whose folder is a Git checkout;
 * its release source is the checkout's GitHub remote (`origin` first).
 * Only current, non-stale connections count: cached topology of a failed
 * host grants nothing here. Lookups are qualified by connection ID and
 * runtime generation, bounded in number, time and concurrency, and cached.
 */

export type OpenProjects = {
  projects: ShipyardProject[];
  /** Folders still being read when the wait ended. */
  pending: number;
  /** Distinct folders past the limit, not read. */
  omitted: number;
};

type Folder = {
  connectionId: string;
  generation: number;
  path: string;
  rooms: number;
};
type Checkout = { toplevel: string; name: string; repo: string | null };

const LOOKUP_TIMEOUT_MS = 6_000;
const LOOKUP_CONCURRENCY = 4;
const CHECKOUT_TTL_MS = 60_000;
const MAX_PATH = 1_024;

export type ShipyardProjectsOptions = {
  run: RunProcess;
  hostOf(connectionId: string): CheckoutHost | null;
  topology(): Promise<TopologyConnection[]>;
  now?: () => number;
  waitMs?: number;
};

export class ShipyardProjects {
  #cache = new Map<string, { at: number; checkout: Checkout | null }>();
  #reading = new Map<string, Promise<void>>();
  #running = 0;
  #queue: (() => void)[] = [];
  #now: () => number;
  constructor(private readonly options: ShipyardProjectsOptions) {
    this.#now = options.now ?? Date.now;
  }

  async read(): Promise<OpenProjects> {
    const connections = await this.options.topology().catch(() => []);
    const { folders, omitted } = openFolders(connections, L.repositories);
    const keyed = folders.map((folder) => ({
      folder,
      key: JSON.stringify([
        folder.connectionId,
        folder.generation,
        this.options.hostOf(folder.connectionId),
        folder.path,
      ]),
    }));
    const waits: Promise<void>[] = [];
    for (const { folder, key } of keyed) {
      const known = this.#cache.get(key);
      if (known && this.#now() - known.at < CHECKOUT_TTL_MS) continue;
      let task = this.#reading.get(key);
      if (!task) {
        task = this.#lookup(folder).then((checkout) => {
          this.#cache.delete(key);
          this.#cache.set(key, { at: this.#now(), checkout });
          while (this.#cache.size > L.repositories * 4)
            this.#cache.delete(this.#cache.keys().next().value!);
        });
        this.#reading.set(key, task);
        void task.finally(() => this.#reading.delete(key));
      }
      waits.push(task);
    }
    if (waits.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(waits),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.options.waitMs ?? L.waitMs);
        }),
      ]);
      clearTimeout(timer);
    }
    // One project per GitHub repository; a checkout without one is its own.
    const projects = new Map<string, ShipyardProject>();
    let pending = 0;
    for (const { folder, key } of keyed) {
      const known = this.#cache.get(key);
      if (!known) {
        pending++;
        continue;
      }
      const checkout = known.checkout;
      if (!checkout) continue;
      const id = checkout.repo
        ? `repo\0${checkout.repo}`
        : `folder\0${folder.connectionId}\0${checkout.toplevel}`;
      const project = projects.get(id);
      if (project) project.rooms += folder.rooms;
      else
        projects.set(id, {
          repo: checkout.repo,
          name: checkout.name,
          rooms: folder.rooms,
        });
    }
    return {
      projects: [...projects.values()].sort((a, b) =>
        (a.repo ?? `￿${a.name}`).localeCompare(b.repo ?? `￿${b.name}`),
      ),
      pending,
      omitted,
    };
  }

  async #lookup(folder: Folder): Promise<Checkout | null> {
    const host = this.options.hostOf(folder.connectionId);
    if (!host) return null;
    await this.#slot();
    try {
      const quoted = shQuote(folder.path);
      const command = `GIT_TERMINAL_PROMPT=0 git -C ${quoted} rev-parse --show-toplevel && GIT_TERMINAL_PROMPT=0 git -C ${quoted} remote -v`;
      const argv =
        host.kind === "ssh"
          ? sshCommandArgv(host.destination, command)
          : ["sh", "-c", command];
      const result = await this.options.run(argv, LOOKUP_TIMEOUT_MS);
      return result.code === 0 ? parseProjectCheckout(result.stdout) : null;
    } catch {
      return null;
    } finally {
      this.#running--;
      this.#queue.shift()?.();
    }
  }

  async #slot() {
    if (this.#running >= LOOKUP_CONCURRENCY)
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#running++;
  }
}

/**
 * Where a connection's folders are read: on this machine, or over SSH on a
 * non-Windows host. Other connections resolve no project.
 */
export function profileCheckoutHost(
  profile:
    | { type?: string; remote_platform?: string; ssh_destination?: string }
    | undefined,
): CheckoutHost | null {
  if (profile?.type === "local") return { kind: "local" };
  if (
    profile?.type === "ssh" &&
    profile.remote_platform !== "windows" &&
    profile.ssh_destination
  )
    return { kind: "ssh", destination: profile.ssh_destination };
  return null;
}

/**
 * The distinct folders of the rooms and spaces open on current connections:
 * a room's checkout, else its own folder, else its first terminal's.
 */
export function openFolders(
  connections: readonly TopologyConnection[],
  limit: number,
): { folders: Folder[]; omitted: number } {
  const folders = new Map<string, Folder>();
  let omitted = 0;
  for (const connection of connections) {
    if (connection.stale || !connection.snapshot) continue;
    const generation = connection.snapshot_generation ?? connection.generation;
    const paneFolders = new Map<string, string>();
    for (const pane of connection.snapshot.panes) {
      const id = pane.workspace_id;
      if (typeof id === "string" && !paneFolders.has(id) && usable(pane.cwd))
        paneFolders.set(id, pane.cwd);
    }
    for (const workspace of connection.snapshot.workspaces) {
      const id = workspace.workspace_id;
      if (typeof id !== "string") continue;
      const checkout = record(workspace.worktree).checkout_path;
      const path = usable(checkout)
        ? checkout
        : usable(workspace.cwd)
          ? workspace.cwd
          : paneFolders.get(id);
      if (!path) continue;
      const key = `${connection.connection_id}\0${path}`;
      const known = folders.get(key);
      if (known) known.rooms++;
      else if (folders.size >= limit) omitted++;
      else
        folders.set(key, {
          connectionId: connection.connection_id,
          generation,
          path,
          rooms: 1,
        });
    }
  }
  return { folders: [...folders.values()], omitted };
}

/** The checkout's top folder on the first line, then `git remote -v`. */
export function parseProjectCheckout(output: string): Checkout | null {
  const [first, ...rest] = output.split(/\r?\n/u);
  const toplevel = first?.trim();
  if (!toplevel || !isAbsolute(toplevel)) return null;
  const remotes: { name: string; repo: string }[] = [];
  for (const line of rest) {
    const match = line.match(/^(\S+)\s+(.+)\s+\(fetch\)$/u);
    if (!match) continue;
    const remote = parseReviewRemote(match[1]!, match[2]!);
    if (remote?.host !== "github.com") continue;
    try {
      remotes.push({
        name: remote.name,
        repo: shipyardRepository(remote.repository),
      });
    } catch {
      // Not an owner/repository name Shipyard can read.
    }
  }
  const repo =
    (remotes.find((remote) => remote.name === "origin") ?? remotes[0])?.repo ??
    null;
  const folderName = toplevel.replace(/\/+$/u, "").split("/").pop() || toplevel;
  return {
    toplevel,
    name: repo ? repo.slice(repo.indexOf("/") + 1) : folderName,
    repo,
  };
}

function usable(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PATH &&
    isAbsolute(value) &&
    !/[\0\r\n]/u.test(value)
  );
}
