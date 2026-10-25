import { MARKER, type Review } from "./usage-attribution";

export type Runner = (args: string[], input?: string) => Promise<string>;
export const run: Runner = async (args, input) => {
  const result = Bun.spawn(args, {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, , code] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${args[0]} ${args[1]} failed (exit ${code}); inspect authentication/availability locally`,
    );
  return output;
};
type Page<T> = T[];
export async function pages<T>(
  endpoint: string,
  runner: Runner = run,
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; ; page++) {
    const items = JSON.parse(
      await runner(["gh", "api", `${endpoint}?per_page=100&page=${page}`]),
    ) as Page<T>;
    if (!Array.isArray(items))
      throw new Error("Unexpected GitHub pagination response");
    results.push(...items);
    if (items.length < 100) return results;
  }
}
export type PrMetadata = {
  mergedAt: string | null;
  reviews: Review[];
};
export async function prMetadata(
  repo: string,
  pr: number,
  runner: Runner = run,
): Promise<PrMetadata> {
  const [pull, reviews] = await Promise.all([
    runner(["gh", "api", `repos/${repo}/pulls/${pr}`]).then(
      (value) => JSON.parse(value) as { merged_at: string | null },
    ),
    pages<{ body: string; submitted_at: string }>(
      `repos/${repo}/pulls/${pr}/reviews`,
      runner,
    ),
  ]);
  return {
    mergedAt: pull.merged_at,
    reviews: reviews
      .filter((r) => r.submitted_at)
      .map((r) => ({ body: r.body, submittedAt: r.submitted_at })),
  };
}

/** Marker AND authenticated author identify the single editable usage comment. */
export async function postComment(
  repo: string,
  pr: number,
  body: string,
  runner: Runner = run,
): Promise<"created" | "updated" | "unchanged"> {
  const user = JSON.parse(await runner(["gh", "api", "user"])) as {
    login: string;
  };
  const comments = await pages<{
    id: number;
    body: string;
    user: { login: string };
  }>(`repos/${repo}/issues/${pr}/comments`, runner);
  const matches = comments.filter(
    (c) => c.user.login === user.login && c.body.startsWith(MARKER),
  );
  if (matches.length > 1)
    throw new Error(
      "Multiple usage comments exist; resolve the duplicate locally before posting",
    );
  const prior = matches[0];
  if (prior?.body === body) return "unchanged";
  await runner(
    [
      "gh",
      "api",
      "--method",
      prior ? "PATCH" : "POST",
      prior
        ? `repos/${repo}/issues/comments/${prior.id}`
        : `repos/${repo}/issues/${pr}/comments`,
      "--input",
      "-",
    ],
    JSON.stringify({ body }),
  );
  return prior ? "updated" : "created";
}
