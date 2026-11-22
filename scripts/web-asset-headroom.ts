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

/** Main records its own measured size under the same context, for PR runs to read. */
export const mainDescription = (size: Size) =>
  `main ${size.bytes} B ${size.files} files`;

export function parseMain(description: string): Size | undefined {
  const match = /^main (\d+) B (\d+) files$/.exec(description);
  return match
    ? { bytes: Number(match[1]), files: Number(match[2]) }
    : undefined;
}

export function parseDelta(description: string): Size | undefined {
  const match = /^Δ ([+-]\d+) B ([+-]\d+) files;/.exec(description);
  return match
    ? { bytes: Number(match[1]), files: Number(match[2]) }
    : undefined;
}

/**
 * Post a PR's verdict against the newest main whose size is known, and repeat
 * while main moves under it, so this run's last post is never older than a
 * main run's re-judging. A main tip without a recorded size yet is left to its
 * own run, which records the size before re-judging open PRs.
 */
export async function settleVerdict(options: {
  baseSha: string;
  base: Size;
  delta: Size;
  readTip: () => Promise<string>;
  readMainSize: (sha: string) => Promise<Size | undefined>;
  post: (state: "success" | "failure", description: string) => Promise<void>;
  rounds?: number;
  /** The web asset budget; the shipped one unless a test supplies its own. */
  budget?: Size;
}): Promise<ReturnType<typeof judge>> {
  let against = { sha: options.baseSha, size: options.base };
  let verdict = judge(against.size, options.delta, options.budget);
  for (let round = 0; ; round++) {
    await options.post(verdict.state, verdict.description);
    if (round + 1 >= (options.rounds ?? 5)) {
      // Out of rounds while main still moves: fail closed. The description
      // keeps the delta first, so main's own run re-judges it correctly.
      if ((await options.readTip()) !== against.sha) {
        const note = " — main kept moving; re-run";
        verdict = {
          ...verdict,
          state: "failure",
          description: `${verdict.description.slice(0, 140 - note.length)}${note}`,
        };
        await options.post(verdict.state, verdict.description);
      }
      break;
    }
    const tip = await options.readTip();
    if (tip === against.sha) break;
    const size = await options.readMainSize(tip);
    if (!size) break;
    against = { sha: tip, size };
    verdict = judge(size, options.delta, options.budget);
  }
  return verdict;
}

async function git(args: string[], cwd: string) {
  const child = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=web-asset-headroom",
      "-c",
      "user.email=headroom@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { ok: code === 0, out: out.trim() };
}

/**
 * A stacked PR (based on another PR's branch) may have merged newer main
 * commits that its base branch lacks. Measured against the bare base, main's
 * own growth would count as the PR's delta and then be added to main a second
 * time. With the base checked out, merge in the main the PR already contains,
 * so the delta is the PR's own. Returns what it did, for the log.
 */
export async function alignStackedBase(options: {
  cwd?: string;
  prHead: string;
  mainRef?: string;
}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const mainRef = options.mainRef ?? "origin/main";
  const seen = await git(["merge-base", options.prHead, mainRef], cwd);
  if (!seen.ok) return `base kept: no merge base with ${mainRef}`;
  const contained = await git(
    ["merge-base", "--is-ancestor", seen.out, "HEAD"],
    cwd,
  );
  if (contained.ok) return "base kept: it already contains the PR's main";
  // Where the base and main both changed a file (regenerated pictures, say),
  // main's side is enough for a size measurement.
  const merged = await git(
    ["merge", "--quiet", "--no-edit", "-X", "theirs", seen.out],
    cwd,
  );
  if (merged.ok) return `base aligned with main ${seen.out.slice(0, 12)}`;
  await git(["merge", "--abort"], cwd);
  return `base kept: merging main ${seen.out.slice(0, 12)} conflicts`;
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
  // Vite directly, without the budget step, so a base revision builds too.
  await sh(["bunx", "vite", "--config", "vite.config.ts", "build"], "web");
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

async function recorded(repo: string, sha: string) {
  const statuses = JSON.parse(
    await sh([
      "gh",
      "api",
      `repos/${repo}/commits/${sha}/statuses?per_page=100`,
    ]),
  ) as Array<{ context: string; description: string }>;
  // Newest first: the latest status for the context wins.
  return statuses.find((item) => item.context === CONTEXT)?.description ?? "";
}

async function main() {
  const repo = Bun.env.GITHUB_REPOSITORY!;
  const url = `${Bun.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${Bun.env.GITHUB_RUN_ID}`;
  if (process.argv[2] === "pr") {
    const head = Bun.env.PR_HEAD_SHA!;
    const merged = await measure();
    const prHead = await sh(["git", "rev-parse", "HEAD^2"]);
    await sh(["git", "checkout", "--quiet", "HEAD^1"]);
    const baseSha = await sh(["git", "rev-parse", "HEAD"]);
    if (Bun.env.PR_BASE_REF !== "main")
      console.info(await alignStackedBase({ prHead }));
    const base = await measure();
    const delta = {
      files: merged.files - base.files,
      bytes: merged.bytes - base.bytes,
    };
    // A fork's token cannot post statuses: the job's own result carries it.
    const post = Bun.env.PR_FROM_FORK !== "true";
    const verdict = await settleVerdict({
      baseSha,
      base,
      delta,
      readTip: async () =>
        (
          await sh(["gh", "api", `repos/${repo}/commits/main`, "--jq", ".sha"])
        ).trim(),
      readMainSize: async (sha) => parseMain(await recorded(repo, sha)),
      post: async (state, description) => {
        if (post) await status(repo, head, state, description, url);
      },
    });
    console.info(verdict.description);
    if (verdict.state === "failure") process.exitCode = 1;
    return;
  }
  if (process.argv[2] === "main") {
    const current = await measure();
    const sha = (await sh(["git", "rev-parse", "HEAD"])).trim();
    console.info(mainDescription(current));
    await status(repo, sha, "success", mainDescription(current), url);
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
      const delta = parseDelta(await recorded(repo, pull.headRefOid));
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
