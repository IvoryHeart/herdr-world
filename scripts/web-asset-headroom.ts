/**
 * Each PR passes the web asset budget against the main it was tested on, but
 * merges add up: several PRs under budget alone pushed main over it. This
 * records each PR's asset delta against its base and projects it onto current
 * main, as a commit status on the PR head ("Web asset headroom"):
 *
 * - `pr`: build the PR's base and its merge with the PR, record the delta and
 *   judge base + delta.
 * - `main`: build main, then re-judge every open PR's recorded delta on top of
 *   it, so a PR that fit yesterday's main shows red once main has grown.
 *
 * Above 95 % of a budget the status stays green but says so.
 */
const assetsModule: string = "./check-web-assets.mjs";
const { BUNDLE_BUDGET, collectAssetStats } = (await import(assetsModule)) as {
  BUNDLE_BUDGET: { files: number; bytes: number };
  collectAssetStats: () => Promise<{ fileCount: number; totalBytes: number }>;
};

export const CONTEXT = "Web asset headroom";
const WARN_AT = 0.95;
const MiB = 1024 * 1024;

export type Size = { files: number; bytes: number };

export function judge(main: Size, delta: Size, budget: Size = BUNDLE_BUDGET) {
  const projected = {
    files: main.files + delta.files,
    bytes: main.bytes + delta.bytes,
  };
  const share = Math.max(
    projected.bytes / budget.bytes,
    projected.files / budget.files,
  );
  const over = projected.bytes > budget.bytes || projected.files > budget.files;
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  // Statuses keep 140 characters; the delta leads so `main` can parse it back.
  const description = `Δ ${sign(delta.bytes)} B ${sign(delta.files)} files; with main ${(projected.bytes / MiB).toFixed(2)}/${(budget.bytes / MiB).toFixed(2)} MiB, ${projected.files}/${budget.files} files${over ? " — over budget" : share >= WARN_AT ? ` — warning: ${Math.round(share * 100)}% of budget` : ""}`;
  return {
    state: over ? ("failure" as const) : ("success" as const),
    description,
    projected,
  };
}

export function parseDelta(description: string): Size | undefined {
  const match = /^Δ ([+-]\d+) B ([+-]\d+) files;/.exec(description);
  return match
    ? { bytes: Number(match[1]), files: Number(match[2]) }
    : undefined;
}

async function sh(command: string[], cwd = process.cwd()) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})`);
  return out.trim();
}

/** Build the checked-out revision's web assets (without the budget step) and measure them. */
async function measure(): Promise<Size> {
  await sh(["bun", "install", "--frozen-lockfile"]);
  await sh(["bun", "run", "--filter", "herdr-world-web", "build:assets"]);
  const { fileCount, totalBytes } = await collectAssetStats();
  return { files: fileCount, bytes: totalBytes };
}

async function status(
  repo: string,
  sha: string,
  state: string,
  description: string,
  url?: string,
) {
  await sh([
    "gh",
    "api",
    "-X",
    "POST",
    `repos/${repo}/statuses/${sha}`,
    "-f",
    `state=${state}`,
    "-f",
    `context=${CONTEXT}`,
    "-f",
    `description=${description}`,
    ...(url ? ["-f", `target_url=${url}`] : []),
  ]);
}

async function main() {
  const repo = Bun.env.GITHUB_REPOSITORY!;
  const url = `${Bun.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${Bun.env.GITHUB_RUN_ID}`;
  if (process.argv[2] === "pr") {
    const head = Bun.env.PR_HEAD_SHA!;
    const merged = await measure();
    await sh(["git", "checkout", "--quiet", "HEAD^1"]);
    const base = await measure();
    const verdict = judge(base, {
      files: merged.files - base.files,
      bytes: merged.bytes - base.bytes,
    });
    console.info(verdict.description);
    await status(repo, head, verdict.state, verdict.description, url);
    return;
  }
  if (process.argv[2] === "main") {
    const current = await measure();
    console.info(`main: ${current.bytes} B, ${current.files} files`);
    const pulls = JSON.parse(
      await sh([
        "gh",
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,headRefOid",
      ]),
    ) as Array<{ number: number; headRefOid: string }>;
    for (const pull of pulls) {
      const recorded = JSON.parse(
        await sh([
          "gh",
          "api",
          `repos/${repo}/commits/${pull.headRefOid}/statuses?per_page=100`,
        ]),
      ) as Array<{ context: string; description: string }>;
      const delta = parseDelta(
        recorded.find((item) => item.context === CONTEXT)?.description ?? "",
      );
      if (!delta) continue; // Not measured yet; its own PR run will.
      const verdict = judge(current, delta);
      console.info(`#${pull.number}: ${verdict.description}`);
      await status(
        repo,
        pull.headRefOid,
        verdict.state,
        verdict.description,
        url,
      );
    }
    return;
  }
  throw new Error("Usage: web-asset-headroom.ts pr | main");
}

if (import.meta.main) await main();
