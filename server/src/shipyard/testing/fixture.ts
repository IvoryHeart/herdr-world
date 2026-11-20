import type { RunProcess } from "../../sources/github";

export const MAIN_SHA = "a".repeat(40);
export const BASE_SHA = "b".repeat(40);
export const MERGE_SHA = "c".repeat(40);
export const SHIPYARD_SCENARIOS = [
  "populated",
  "empty",
  "limited",
  "diverged",
  "old-head",
  "no-actions",
  "offline",
] as const;
export type ShipyardScenario = (typeof SHIPYARD_SCENARIOS)[number];
const release = (
  id: number,
  tag: string,
  prerelease: boolean,
  day: number,
) => ({
  id,
  tag_name: tag,
  name: tag,
  draft: false,
  prerelease,
  published_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`,
});

/** Testing-only, no external reads. The same acquisition/projection serves demos. */
export function githubFixture(scenario: ShipyardScenario = "populated") {
  const calls: string[][] = [];
  const run: RunProcess = async (argv) => {
    calls.push(argv);
    const ok = (value: unknown) => ({
      code: 0,
      stdout: JSON.stringify(value),
      stderr: "",
    });
    const fail = {
      code: 1,
      stdout: "",
      stderr: "synthetic private error must never be displayed",
    };
    if (scenario === "offline") return fail;
    if (argv[1] === "auth") return ok({});
    const path = argv.at(-1)!;
    if (argv.includes("graphql")) {
      const expressions = [
        ...path.matchAll(/c(\d+): object\(expression: "([a-f0-9]{40})"\)/gu),
      ];
      const repository = Object.fromEntries(
        expressions.map(([, index, oid]) => [
          `c${index}`,
          {
            oid,
            associatedPullRequests: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  number: 42,
                  title: "Ship the synthetic widget",
                  repository: { nameWithOwner: "example-org/widgets" },
                  mergedAt: "2026-01-03T00:00:00Z",
                  baseRefName: "main",
                  mergeCommit: { oid: MERGE_SHA },
                },
                {
                  number: 41,
                  title: "Already released",
                  repository: { nameWithOwner: "example-org/widgets" },
                  mergedAt: "2026-01-03T00:00:00Z",
                  baseRefName: "main",
                  mergeCommit: { oid: BASE_SHA },
                },
                {
                  number: 43,
                  title: "Other branch",
                  repository: { nameWithOwner: "example-org/widgets" },
                  mergedAt: "2026-01-03T00:00:00Z",
                  baseRefName: "next",
                  mergeCommit: { oid: MERGE_SHA },
                },
                {
                  number: 44,
                  title: "Other repository",
                  repository: { nameWithOwner: "example-org/other" },
                  mergedAt: "2026-01-03T00:00:00Z",
                  baseRefName: "main",
                  mergeCommit: { oid: MERGE_SHA },
                },
              ],
            },
          },
        ]),
      );
      return ok({ data: { repository } });
    }
    if (path.endsWith("/commits/main")) return ok({ sha: MAIN_SHA });
    if (path.endsWith("/releases/latest"))
      return scenario === "empty"
        ? { code: 1, stdout: "", stderr: "HTTP 404" }
        : ok(release(1, "v1.0.0", false, 1));
    if (path.includes("/releases?"))
      return ok(
        scenario === "empty"
          ? []
          : [
              release(2, "v1.1.0-rc.1", true, 2),
              release(1, "v1.0.0", false, 1),
              { draft: true },
            ],
      );
    if (path.includes("/tags?"))
      return ok([{ name: "v1.0.0", commit: { sha: BASE_SHA } }]);
    if (path.includes("/actions/runs?"))
      return scenario === "no-actions"
        ? fail
        : ok({
            total_count: 1,
            workflow_runs: [
              {
                id: 17,
                workflow_id: 7,
                name: "Checks",
                head_branch: "main",
                head_sha: scenario === "old-head" ? BASE_SHA : MAIN_SHA,
                event: "push",
                status: "completed",
                conclusion: "success",
                run_number: 10,
                run_attempt: 1,
                updated_at: "2026-01-03T00:00:00Z",
              },
            ],
          });
    if (path.includes("/compare/")) {
      const limited = scenario === "limited";
      const start = path.endsWith("page=2") ? 100 : 0;
      return ok({
        status: scenario === "diverged" ? "diverged" : "ahead",
        ahead_by: limited ? 201 : 1,
        total_commits: limited ? 201 : 1,
        commits: limited
          ? Array.from({ length: 100 }, (_, index) => ({
              sha: (start + index + 1).toString(16).padStart(40, "0"),
            }))
          : [{ sha: MERGE_SHA }],
      });
    }
    if (path.includes("/commits/")) return ok({ sha: BASE_SHA });
    throw new Error("Unexpected synthetic request");
  };
  return { run, calls };
}
