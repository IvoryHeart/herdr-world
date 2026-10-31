import { expect, test } from "bun:test";
import { githubQuery, refreshGitHub } from "./github";

test("exhaustive four-search completeness requires affirmative end-of-list evidence for every PR search", async () => {
  const flags = [undefined, false, true];
  for (const authored of flags)
    for (const reviewing of flags)
      for (const assigned of flags)
        for (const merged of flags) {
          const data = Object.fromEntries(
            Object.entries({ authored, reviewing, assigned, merged }).map(
              ([name, hasNextPage]) => [
                name,
                { nodes: [], pageInfo: { hasNextPage } },
              ],
            ),
          );
          const result = await refreshGitHub(
            async (argv) => ({
              code: 0,
              stdout: argv[1] === "auth" ? "" : JSON.stringify({ data }),
              stderr: "",
            }),
            100,
          );
          expect(result.ok).toBe(true);
          if (result.ok)
            expect(result.pullRequestsComplete).toBe(
              [authored, reviewing, assigned, merged].every(
                (flag) => flag === false,
              ),
            );
        }
  const query = githubQuery(100);
  for (const alias of ["authored", "reviewing", "assigned"])
    expect(query).toMatch(
      new RegExp(`${alias}: search[^\\n]+pageInfo \\{ hasNextPage \\}`),
    );
});

test("malformed row sets and a capped merged search cannot prove claim absence", async () => {
  const complete = { nodes: [], pageInfo: { hasNextPage: false } };
  for (const missing of ["authored", "reviewing", "assigned", "merged"]) {
    const data = Object.fromEntries(
      ["authored", "reviewing", "assigned", "merged"].map((alias) => [
        alias,
        alias === missing ? { pageInfo: { hasNextPage: false } } : complete,
      ]),
    );
    const result = await refreshGitHub(
      async (argv) => ({
        code: 0,
        stdout: argv[1] === "auth" ? "" : JSON.stringify({ data }),
        stderr: "",
      }),
      100,
    );
    expect(result.ok && result.pullRequestsComplete).toBe(false);
  }
  let pages = 0;
  const result = await refreshGitHub(async (argv) => {
    if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
    pages++;
    return {
      code: 0,
      stdout: JSON.stringify({
        data: {
          authored: complete,
          reviewing: complete,
          assigned: complete,
          merged: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: `synthetic-${pages}` },
          },
        },
      }),
      stderr: "",
    };
  }, 100);
  expect(pages).toBe(10);
  expect(result.ok && result.pullRequestsComplete).toBe(false);
});
