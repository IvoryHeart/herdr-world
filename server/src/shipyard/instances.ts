import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  opendirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  SHIPYARD_LIMITS as L,
  shipyardRepository,
  type ShipyardInstance,
  type ShipyardWindow,
} from "../../../shared/shipyard";
import { assertSafeDataPath, replaceDataFile } from "../config/data-paths";
import type { Scheduler } from "../service/ports";
import { record, sha, text, window } from "./parse";

type Report = Omit<ShipyardInstance, "state" | "openUrl" | "releaseId"> & {
  loopback: boolean;
  ipv6: boolean;
  tls: boolean;
};
export type InstanceIdentity = Pick<
  Report,
  "generation" | "version" | "repo" | "branch" | "sha" | "kind" | "startedAt"
>;

/** Private local self-reports only. Reading never connects to a port or host. */
export class ShipyardInstances {
  #timer: { cancel(): void } | null = null;
  #report: Report | null = null;
  #extra: (() => Record<string, unknown>) | null = null;
  #id: string;
  constructor(
    private readonly directory: string,
    dataRoot: string,
    private readonly now: () => number,
    private readonly scheduler: Scheduler,
  ) {
    this.#id = createHash("sha256").update(dataRoot).digest("hex").slice(0, 24);
  }

  /** This World's registry ID: a hash of its data root. */
  get id() {
    return this.#id;
  }

  /**
   * `extra` adds fields to each renewed report (owner questions across
   * instances, #1152); readers here pick their own fields and ignore it.
   */
  start(
    identity: InstanceIdentity,
    port: number,
    host: string,
    tls: boolean,
    extra?: () => Record<string, unknown>,
  ) {
    if (this.#report) throw new Error("Instance is already reported");
    this.#extra = extra ?? null;
    const loopback = [
      "127.0.0.1",
      "localhost",
      "::1",
      "[::1]",
      "0.0.0.0",
      "::",
    ].includes(host);
    this.#report = {
      ...identity,
      id: this.#id,
      port,
      loopback,
      ipv6: host.includes(":"),
      tls,
      reportedAt: this.now(),
      expiresAt: this.now() + L.instanceLeaseMs,
    };
    this.#publish();
  }
  #publish() {
    const report = this.#report;
    if (!report) return;
    report.reportedAt = this.now();
    report.expiresAt = report.reportedAt + L.instanceLeaseMs;
    try {
      replaceDataFile(
        join(this.directory, `${this.#id}.json`),
        `${JSON.stringify({ ...this.#extra?.(), ...report })}\n`,
      );
    } catch {
      /* Observation failure must not break the World listener. */
    }
    this.#timer = this.scheduler.schedule(
      () => this.#publish(),
      L.instanceLeaseMs / 3,
    );
  }
  /** Renew the report now: its `extra` fields changed. */
  republish() {
    if (!this.#report) return;
    this.#timer?.cancel();
    this.#publish();
  }
  stop() {
    this.#timer?.cancel();
    this.#timer = null;
    if (!this.#report) return;
    this.#report = null;
    try {
      rmSync(join(this.directory, `${this.#id}.json`), { force: true });
    } catch {
      /* An unreadable report expires. */
    }
  }
  read(): ShipyardWindow<ShipyardInstance> {
    const items: ShipyardInstance[] = [];
    let complete = true;
    let directory: ReturnType<typeof opendirSync>;
    try {
      assertSafeDataPath(join(this.directory, "registry-check"));
      directory = opendirSync(this.directory);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? window([], true)
        : window([], false, "Local instance registry is unavailable.");
    }
    try {
      for (let count = 0; ; count++) {
        const file = directory.readSync();
        if (!file) break;
        if (count >= L.instances) {
          complete = false;
          break;
        }
        if (!file.isFile() || !/^[a-f0-9]{24}\.json$/u.test(file.name)) {
          complete = false;
          continue;
        }
        let fd: number | undefined;
        try {
          fd = openSync(
            join(this.directory, file.name),
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
          );
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.size > 4096)
            throw new Error("invalid report");
          const report = parseReport(
            JSON.parse(readFileSync(fd, "utf8")),
            this.now(),
          );
          if (!report || file.name !== `${report.id}.json`)
            throw new Error("invalid report");
          const { loopback, ipv6, tls, ...safe } = report;
          const fresh = report.expiresAt > this.now();
          items.push({
            ...safe,
            state: fresh ? "fresh" : "stale",
            openUrl:
              fresh && loopback
                ? `${tls ? "https" : "http"}://${ipv6 ? "[::1]" : "127.0.0.1"}:${report.port}/`
                : null,
            releaseId: null,
          });
        } catch {
          complete = false;
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
      }
    } finally {
      directory.closeSync();
    }
    items.sort(
      (a, b) => b.reportedAt - a.reportedAt || a.id.localeCompare(b.id),
    );
    return window(
      items,
      complete,
      complete
        ? null
        : "Instance registry is limited or contains unreadable reports; other instances may be unknown.",
    );
  }
}

function parseReport(value: unknown, now: number): Report | null {
  const row = record(value);
  if (
    !/^[a-f0-9]{24}$/u.test(String(row.id)) ||
    !/^[A-Za-z0-9_-]{16,100}$/u.test(String(row.generation)) ||
    !text(row.version, 200) ||
    !Number.isInteger(row.port) ||
    (row.port as number) < 1 ||
    (row.port as number) > 65535 ||
    !["source", "installed"].includes(String(row.kind)) ||
    typeof row.loopback !== "boolean" ||
    typeof row.ipv6 !== "boolean" ||
    typeof row.tls !== "boolean"
  )
    return null;
  for (const key of ["startedAt", "reportedAt", "expiresAt"])
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0)
      return null;
  if (
    (row.startedAt as number) > (row.reportedAt as number) ||
    (row.reportedAt as number) > now ||
    row.expiresAt !== (row.reportedAt as number) + L.instanceLeaseMs
  )
    return null;
  let repo: string | null = null;
  if (row.repo !== null) {
    try {
      repo = shipyardRepository(row.repo);
    } catch {
      return null;
    }
  }
  if (row.sha !== null && !sha(row.sha)) return null;
  if (row.branch !== null && !text(row.branch, 256)) return null;
  // Pick fields explicitly: never copy extra on-disk fields to the API.
  return {
    id: row.id as string,
    generation: row.generation as string,
    version: row.version as string,
    repo,
    branch: row.branch as string | null,
    sha: row.sha as string | null,
    kind: row.kind as Report["kind"],
    port: row.port as number,
    startedAt: row.startedAt as number,
    reportedAt: row.reportedAt as number,
    expiresAt: row.expiresAt as number,
    loopback: row.loopback,
    ipv6: row.ipv6,
    tls: row.tls,
  };
}
