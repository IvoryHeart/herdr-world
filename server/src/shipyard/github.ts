import {
  SHIPYARD_LIMITS as L,
  shipyardRepository,
  type ShipyardPipeline,
  type ShipyardRelease,
  type ShipyardWindow,
} from "../../../shared/shipyard";
import {
  GITHUB_NOT_INSTALLED,
  GITHUB_SIGNED_OUT,
  type RunProcess,
} from "../sources/github";
import {
  parseReleases,
  parseTags,
  parseWorkflows,
  record,
  sha,
  window,
} from "./parse";
import { readWaiting } from "./waiting";

export type ShipyardRead =
  | { ok: true; data: ShipyardPipeline }
  | { ok: false; state: "not_connected" | "unavailable"; detail: string };
export type GitHubQuery = (path: string, graphql?: boolean) => Promise<unknown>;

/** Every external operation is a read, using the existing source's gh runner. */
export async function readShipyardGitHub(
  run: RunProcess,
  input: string,
  clock: () => number = Date.now,
): Promise<ShipyardRead> {
  const repo = shipyardRepository(input);
  const deadline = clock() + L.deadlineMs;
  const invoke = async (argv: string[]) => {
    const remaining = Math.min(L.requestMs, deadline - clock());
    if (remaining <= 0) throw new Error("deadline");
    const answer = await run(argv, remaining);
    if (clock() >= deadline || Buffer.byteLength(answer.stdout) > L.outputBytes)
      throw new Error("bounded read failed");
    return answer;
  };
  try {
    const auth = await invoke([
      "gh",
      "auth",
      "status",
      "--hostname",
      "github.com",
    ]);
    if (auth.code !== 0)
      return {
        ok: false,
        state: "not_connected",
        detail: auth.code === 127 ? GITHUB_NOT_INSTALLED : GITHUB_SIGNED_OUT,
      };
    const query: GitHubQuery = async (path, graphql = false) => {
      const answer = await invoke(
        graphql
          ? [
              "gh",
              "api",
              "--hostname",
              "github.com",
              "graphql",
              "-f",
              `query=${path}`,
            ]
          : ["gh", "api", "--hostname", "github.com", "--method", "GET", path],
      );
      if (answer.code !== 0) {
        // Only the documented missing latest release has a distinct meaning.
        if (
          path.endsWith("/releases/latest") &&
          /HTTP 404/u.test(answer.stderr)
        )
          return null;
        throw new Error("GitHub read failed");
      }
      const value: unknown = JSON.parse(answer.stdout);
      if (record(value).errors) throw new Error("partial GraphQL response");
      return value;
    };
    const root = `repos/${repo}`;
    const mainSha = sha(record(await query(`${root}/commits/main`)).sha);
    if (!mainSha) throw new Error("main unavailable");
    const releases = parseReleases(
      await query(`${root}/releases?per_page=${L.releases}`),
      repo,
    );
    // GitHub's designated latest stable release remains known even when many
    // prereleases push it out of the display window.
    const latest = await query(`${root}/releases/latest`);
    let baseline: ShipyardRelease | undefined;
    if (latest !== null) {
      baseline = parseReleases([latest], repo).items[0];
      if (!baseline || baseline.channel !== "stable")
        throw new Error("invalid latest release");
      if (!releases.items.some((r) => r.id === baseline!.id)) {
        if (releases.items.length >= L.releases) releases.items.pop();
        releases.items.push(baseline);
      }
    } else if (releases.complete) {
      baseline =
        releases.items.find((release) => release.channel === "stable") ??
        releases.items[0];
    }
    const tags = await optional(
      () =>
        query(`${root}/tags?per_page=${L.tags}`).then((value) =>
          parseTags(value, repo),
        ),
      "Tags are unavailable.",
    );
    const workflows = await optional(
      () =>
        query(
          `${root}/actions/runs?branch=main&head_sha=${mainSha}&per_page=${L.workflows}`,
        ).then((value) => parseWorkflows(value, repo, mainSha)),
      "Main workflow runs are unavailable.",
    );
    const runs = workflows.items;
    const health = runs.some((r) =>
      [
        "failure",
        "cancelled",
        "timed_out",
        "action_required",
        "startup_failure",
        "stale",
      ].includes(r.conclusion ?? ""),
    )
      ? "fail"
      : runs.some((r) => r.status !== "completed")
        ? "pending"
        : workflows.complete &&
            runs.length > 0 &&
            runs.every((r) => r.conclusion === "success")
          ? "pass"
          : "unknown";
    const waiting = await readWaiting(
      query,
      repo,
      mainSha,
      baseline,
      releases.complete,
    );
    return {
      ok: true,
      data: {
        repo,
        main: {
          branch: "main",
          sha: mainSha,
          health,
          workflows,
          url: `https://github.com/${repo}/actions?query=branch%3Amain`,
        },
        releases,
        tags,
        waiting,
      },
    };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { ok: false, state: "not_connected", detail: GITHUB_NOT_INSTALLED }
      : {
          ok: false,
          state: "unavailable",
          detail:
            "GitHub could not provide the release pipeline. Check repository access and refresh; last-success data may be stale.",
        };
  }
}

async function optional<T>(
  read: () => Promise<ShipyardWindow<T>>,
  detail: string,
): Promise<ShipyardWindow<T>> {
  try {
    return await read();
  } catch {
    return window<T>([], false, detail);
  }
}
