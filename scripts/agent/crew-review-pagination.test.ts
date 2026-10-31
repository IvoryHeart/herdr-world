import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      'if type == "array" then .[] | @json else error("expected array page") end',
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

test.skipIf(!Bun.which("gh"))(
  "a successful malformed second page holds admission with real gh pagination",
  async () => {
    const requested: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const page = url.searchParams.get("page") ?? "1";
        requested.push(page);
        if (page === "2") return Response.json({});
        return Response.json(
          [
            {
              id: 1,
              body: "valid first page",
              created_at: "2026-01-02T12:00:00Z",
            },
          ],
          { headers: { Link: `<${url.origin}/reviews?page=2>; rel="next"` } },
        );
      },
    });
    const config = await mkdtemp(join(tmpdir(), "crew-pagination-"));
    try {
      // gh runs in a separate process so the fixture can serve its requests.
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `
          import { readCrewPosts } from ${JSON.stringify(new URL("./crew/review-facts.ts", import.meta.url).pathname)};
          const run = (argv) => {
            const result = Bun.spawnSync([process.env.FIXTURE_GH, ...argv.slice(1, -1), process.env.FIXTURE_URL], {stdout: "pipe", stderr: "pipe"});
            return {code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString()};
          };
          try {
            readCrewPosts(run, "example-org/widgets", 7);
            console.log("accepted");
          } catch {
            console.log("held");
          }
        `,
        ],
        {
          env: {
            ...process.env,
            GH_TOKEN: "synthetic-fixture-token",
            GH_CONFIG_DIR: config,
            GH_PROMPT_DISABLED: "1",
            GH_NO_UPDATE_NOTIFIER: "1",
            FIXTURE_GH: Bun.which("gh")!,
            FIXTURE_URL: `${server.url}reviews`,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(requested).toEqual(["1", "2"]);
      expect(output.trim()).toBe("held");
    } finally {
      server.stop(true);
      await rm(config, { recursive: true, force: true });
    }
  },
);

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
