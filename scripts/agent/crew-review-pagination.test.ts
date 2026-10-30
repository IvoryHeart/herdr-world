import { expect, test } from "bun:test";
import { readCrewPosts } from "./crew/review-facts";
import type { Run } from "./gate/observe";

test("review pagination works with gh 2.45 and preserves multiline JSON across pages", () => {
  const calls: string[][] = [];
  const run: Run = (argv) => {
    calls.push(argv);
    if (argv.includes("--slurp"))
      return { code: 1, stdout: "", stderr: "unknown flag: --slurp" };
    const rows = argv.at(-1)!.includes("/reviews?")
      ? [
          {
            id: 1,
            body: "Reviewer: rev2\nRESULT #7: 0/0 resolved, 1 new\nP2 synthetic.ts:1 repair",
            submitted_at: "2026-01-02T12:00:00Z",
            commit_id: "a".repeat(40),
          },
          {
            id: 2,
            body: "second page\nwith a newline",
            submitted_at: "2026-01-02T12:01:00Z",
          },
        ]
      : argv.at(-1)!.includes("/issues/")
        ? [
            {
              id: 3,
              body: '[builder]\nsynthetic.ts:1 fixed: "quoted"',
              created_at: "2026-01-02T12:02:00Z",
            },
          ]
        : [];
    return {
      code: 0,
      stdout: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      stderr: "",
    };
  };
  const posts = readCrewPosts(run, "example-org/widgets", 7);
  expect(posts.map((post) => post.id)).toEqual(["1", "2", "3"]);
  expect(posts[1]!.body).toBe("second page\nwith a newline");
  expect(posts[2]!.body).toContain('"quoted"');
  for (const argv of calls) {
    expect(argv).not.toContain("--slurp");
    expect(argv).toContain("--paginate");
    expect(argv.slice(argv.indexOf("--jq"), argv.indexOf("--jq") + 2)).toEqual([
      "--jq",
      ".[] | @json",
    ]);
  }
});

test("empty paginated collections contain no posts", () => {
  expect(
    readCrewPosts(
      () => ({ code: 0, stdout: "", stderr: "" }),
      "example-org/widgets",
      7,
    ),
  ).toEqual([]);
});

test("partial or malformed paginated output cannot establish complete replies", () => {
  for (const result of [
    { code: 1, stdout: '{"id":1}\n', stderr: "page request failed" },
    { code: 0, stdout: '{"id":1}\nbroken\n', stderr: "" },
    { code: 0, stdout: "[]\n", stderr: "" },
  ])
    expect(() =>
      readCrewPosts(() => result, "example-org/widgets", 7),
    ).toThrow();
});
