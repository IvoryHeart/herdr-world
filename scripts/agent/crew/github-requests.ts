import type { Database } from "bun:sqlite";
import type { Run } from "../gate/observe";
import { deleteMeta, getMeta, setMeta } from "./store";
import { observationStamp, SAFETY_MS } from "./github-cache";

type Response = {
  body: string;
  etag?: string;
  next?: string;
  immutable: boolean;
  stamp?: string;
  at: number;
};
type Result = ReturnType<Run>;
const ok = (stdout: string): Result => ({ code: 0, stdout, stderr: "" });

/** Persistent conditional REST reads, immutable Actions objects, and per-pass accounting. */
export class GitHubPass {
  calls = 0;
  notModified = 0;
  remaining = 0;
  readonly run: Run;

  constructor(
    private db: Database,
    private repo: string,
    private raw: Run,
    private now: number,
    private persist = true,
  ) {
    this.run = (argv) => this.request(argv);
    const result = this.run(["gh", "api", "rate_limit"]);
    if (result.code !== 0)
      throw new Error(
        `GitHub quota read failed: ${result.stderr.slice(0, 200)}`,
      );
    const quota = JSON.parse(result.stdout).resources;
    this.remaining = Math.min(
      quota?.core?.remaining ?? 0,
      quota?.graphql?.remaining ?? Infinity,
    );
  }

  private request(argv: string[]): Result {
    if (argv[0] !== "gh") return this.raw(argv);
    // The crew's writes are single requests. REST pagination below counts every page.
    if (
      argv[1] !== "api" ||
      argv.includes("-f") ||
      argv.includes("-F") ||
      argv.includes("-X")
    ) {
      this.calls++;
      return this.raw(argv);
    }
    const path = argv.slice(2).find((arg) => !arg.startsWith("-"));
    if (!path || path === "graphql") {
      this.calls++;
      return this.raw(argv);
    }
    const paginate = argv.includes("--paginate");
    const pages: unknown[] = [];
    let next: string | undefined = path;
    do {
      const response = this.page(next);
      if ("code" in response) return response;
      if (!paginate) return ok(response.body);
      pages.push(JSON.parse(response.body));
      next = response.next;
    } while (next);
    return ok(
      argv.includes("--slurp")
        ? JSON.stringify(pages)
        : pages.map((page) => JSON.stringify(page)).join("\n"),
    );
  }

  private page(path: string): Response | Result {
    const runId = /\/actions\/runs\/(\d+)$/u.exec(path)?.[1];
    const finished = runId
      ? getMeta(this.db, `github:run:${this.repo}:${runId}`)
      : null;
    if (finished)
      return {
        body: JSON.stringify(JSON.parse(finished).run),
        immutable: true,
        at: this.now,
      };
    const key = `github:rest:${this.repo}:${path}`;
    const saved = getMeta(this.db, key);
    const prior = saved ? (JSON.parse(saved) as Response) : null;
    const pr = /\/(?:pulls|issues)\/(\d+)\//u.exec(path)?.[1];
    const observation = pr
      ? observationStamp(this.db, this.repo, Number(pr))
      : null;
    const stamp =
      observation && this.persist
        ? JSON.stringify([observation.stamp, observation.at])
        : undefined;
    if (
      prior?.immutable ||
      (stamp &&
        prior?.stamp === stamp &&
        this.now >= prior.at &&
        this.now - prior.at < SAFETY_MS)
    )
      return prior!;
    const argv = ["gh", "api", path, "--include"];
    if (prior?.etag) argv.push("-H", `If-None-Match: ${prior.etag}`);
    this.calls++;
    const result = this.raw(argv);
    const separator = /\r?\n\r?\n/u.exec(result.stdout);
    if (!separator)
      return result.code === 0
        ? { body: result.stdout, immutable: false, at: this.now }
        : result;
    const headers = result.stdout.slice(0, separator.index);
    const status = Number(/^HTTP\/\S+\s+(\d+)/u.exec(headers)?.[1]);
    if (status === 304 && prior) {
      this.notModified++;
      const value = { ...prior, stamp, at: this.now };
      if (this.persist) setMeta(this.db, key, JSON.stringify(value));
      return value;
    }
    if (result.code !== 0 || status < 200 || status >= 300)
      return { ...result, code: result.code || 1 };
    const body = result.stdout.slice(separator.index + separator[0].length);
    const etag = /^etag:\s*(.+)$/imu.exec(headers)?.[1]?.trim();
    const next = /<([^>]+)>;\s*rel="next"/iu.exec(headers)?.[1];
    const value: unknown = JSON.parse(body);
    const object = value as Record<string, unknown> | null;
    // Run IDs can be rerun. Only a pinned attempt's completed jobs and job IDs are immutable.
    const jobs = object?.jobs;
    const immutable =
      (/\/actions\/jobs\/\d+$/u.test(path) && object?.status === "completed") ||
      (/\/actions\/runs\/\d+\/attempts\/\d+\/jobs(?:\?|$)/u.test(path) &&
        !next &&
        Array.isArray(jobs) &&
        jobs.length > 0 &&
        jobs.every((job) => job.status === "completed"));
    if (this.persist && runId && object?.status === "completed")
      setMeta(
        this.db,
        `github:run:${this.repo}:${runId}`,
        JSON.stringify({ attempt: object.run_attempt, run: object }),
      );
    if (
      this.persist &&
      /\/actions\/runs\?/u.test(path) &&
      Array.isArray(object?.workflow_runs)
    ) {
      for (const run of object.workflow_runs as Record<string, unknown>[]) {
        const runKey = `github:run:${this.repo}:${run.id}`;
        if (
          run.status === "completed" &&
          Number.isSafeInteger(run.id) &&
          Number.isSafeInteger(run.run_attempt)
        )
          setMeta(
            this.db,
            runKey,
            JSON.stringify({ attempt: run.run_attempt, run }),
          );
        else deleteMeta(this.db, runKey);
      }
    }
    const response: Response = {
      body,
      etag,
      next,
      immutable,
      stamp,
      at: this.now,
    };
    // Quota is always live; no token or authorization headers are persisted.
    if (this.persist && path !== "rate_limit")
      setMeta(this.db, key, JSON.stringify(response));
    return response;
  }
}
