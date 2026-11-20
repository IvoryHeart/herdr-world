import {
  SHIPYARD_LIMITS as L,
  type ShipyardPipeline,
  type ShipyardPullRequest,
  type ShipyardRelease,
} from "../../../shared/shipyard";
import type { GitHubQuery } from "./github";
import { date, integer, record, sha, text } from "./parse";

export async function readWaiting(
  query: GitHubQuery,
  repo: string,
  mainSha: string,
  release: ShipyardRelease | undefined,
  releasesComplete: boolean,
): Promise<ShipyardPipeline["waiting"]> {
  const waiting: ShipyardPipeline["waiting"] = {
    state: "no_baseline",
    baseline: null,
    mainSha,
    aheadBy: null,
    commits: [],
    pullRequests: [],
    complete: false,
    detail: releasesComplete
      ? "No published release establishes a baseline."
      : "No stable baseline was found; the release window is incomplete.",
    compareUrl: null,
    pullRequestsUrl: `https://github.com/${repo}/pulls?q=${encodeURIComponent("is:pr is:merged base:main")}`,
  };
  if (!release) return waiting;
  try {
    const baseSha = sha(
      record(
        await query(`repos/${repo}/commits/${encodeURIComponent(release.tag)}`),
      ).sha,
    );
    if (!baseSha) throw new Error("release tag unavailable");
    waiting.baseline = {
      releaseId: release.id,
      tag: release.tag,
      sha: baseSha,
      channel: release.channel,
    };
    waiting.compareUrl = `https://github.com/${repo}/compare/${baseSha}...${mainSha}`;
    const commits = new Set<string>();
    let expected: number | undefined;
    for (let page = 1; page <= L.commits / 100; page++) {
      const answer = record(
        await query(
          `repos/${repo}/compare/${baseSha}...${mainSha}?per_page=100&page=${page}`,
        ),
      );
      if (!["ahead", "identical"].includes(String(answer.status))) {
        waiting.state = "diverged";
        waiting.detail =
          "The release tag is not an ancestor of this main head; the waiting list is unknown.";
        return waiting;
      }
      if (
        !Number.isSafeInteger(answer.ahead_by) ||
        (answer.ahead_by as number) < 0 ||
        answer.total_commits !== answer.ahead_by ||
        !Array.isArray(answer.commits) ||
        answer.commits.length > 100 ||
        (expected !== undefined && expected !== answer.ahead_by)
      )
        throw new Error("invalid comparison");
      expected = answer.ahead_by as number;
      waiting.aheadBy = expected;
      for (const value of answer.commits) {
        const commit = sha(record(value).sha);
        if (!commit || commits.has(commit)) throw new Error("invalid commit");
        commits.add(commit);
      }
      if (commits.size >= expected) break;
      if (answer.commits.length !== 100) throw new Error("short comparison");
    }
    waiting.commits = [...commits];
    let complete = commits.size === expected;
    const prs = new Map<number, ShipyardPullRequest>();
    const [owner, name] = repo.split("/");
    for (let start = 0; start < waiting.commits.length; start += 25) {
      const batch = waiting.commits.slice(start, start + 25);
      const objects = batch
        .map(
          (commit, index) =>
            `c${index}: object(expression: ${JSON.stringify(commit)}) { ... on Commit { oid associatedPullRequests(first: ${L.prsPerCommit}) { pageInfo { hasNextPage } nodes { number title mergedAt baseRefName repository { nameWithOwner } mergeCommit { oid } } } } }`,
        )
        .join("\n");
      const response = record(
        await query(
          `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${objects} } }`,
          true,
        ),
      );
      const repository = record(record(response.data).repository);
      for (let index = 0; index < batch.length; index++) {
        const commit = record(repository[`c${index}`]);
        const associated = record(commit.associatedPullRequests);
        const more = record(associated.pageInfo).hasNextPage;
        if (
          commit.oid !== batch[index] ||
          !Array.isArray(associated.nodes) ||
          associated.nodes.length > L.prsPerCommit ||
          typeof more !== "boolean"
        )
          throw new Error("incomplete PR membership");
        if (more) complete = false;
        for (const value of associated.nodes) {
          const pr = record(value);
          const prRepository = text(record(pr.repository).nameWithOwner, 200);
          if (!prRepository) throw new Error("missing PR repository");
          if (prRepository.toLowerCase() !== repo) continue;
          if (
            typeof pr.baseRefName !== "string" ||
            (pr.mergedAt !== null && date(pr.mergedAt) === null)
          )
            throw new Error("invalid PR membership");
          if (pr.baseRefName !== "main" || pr.mergedAt === null) continue;
          const mergeSha = sha(record(pr.mergeCommit).oid);
          if (!mergeSha) {
            complete = false;
            continue;
          }
          if (!commits.has(mergeSha)) continue;
          const number = integer(pr.number),
            title = text(pr.title),
            mergedAt = date(pr.mergedAt);
          if (!number || !title || mergedAt === null)
            throw new Error("invalid PR");
          prs.set(number, {
            number,
            title,
            mergedAt,
            mergeSha,
            url: `https://github.com/${repo}/pull/${number}`,
          });
        }
      }
    }
    waiting.pullRequests = [...prs.values()].sort(
      (a, b) => b.mergedAt - a.mergedAt || b.number - a.number,
    );
    waiting.complete = complete;
    waiting.state = complete ? "ready" : "limited";
    waiting.detail = complete
      ? null
      : "Commit or associated-PR window is limited; this is only the observed part of the waiting list.";
  } catch {
    waiting.state = "unavailable";
    waiting.detail =
      "The release-to-main comparison or its pull requests are unavailable; the waiting list is unknown.";
  }
  return waiting;
}
