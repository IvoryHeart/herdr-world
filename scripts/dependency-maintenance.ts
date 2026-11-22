import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dependencyInventory, type AppLock } from "./dependency-security";
import { generateDependencyArtifacts } from "./dependency-notices";
import { verificationNotices } from "./verification-notices";
import { githubJson } from "./dependency-security-issues";

export type DependencyPR = {
  number: number;
  body: string | null;
  user: { login: string; type: string };
  base: { sha: string; ref: string; repo: { full_name: string } };
  head: { sha: string; ref: string; repo: { full_name: string } };
};
export type Maintenance = {
  head: string;
  body: string;
  files: Record<string, string>;
};
const manifests = [
  "package.json",
  "web/package.json",
  "server/package.json",
  "bun.lock",
  "tools/quint/package.json",
  "tools/quint/package-lock.json",
];
const notices = [
  "DEPENDENCY_NOTICES.md",
  "DEPENDENCY_LICENSES.md",
  "tools/quint/DEPENDENCY_NOTICES.md",
];

export function acceptsDependencyPR(pr: DependencyPR, paths: string[]) {
  return (
    pr.user.login === "dependabot[bot]" &&
    pr.user.type === "Bot" &&
    pr.base.ref === "main" &&
    pr.head.repo.full_name === pr.base.repo.full_name &&
    /^[a-f0-9]{40}$/.test(pr.head.sha) &&
    /^[a-f0-9]{40}$/.test(pr.base.sha) &&
    paths.length > 0 &&
    paths.every(
      (path) =>
        manifests.includes(path) ||
        notices.includes(path) ||
        path === `changes/dependencies-${pr.number}.md` ||
        /^\.github\/workflows\/[\w-]+\.yml$/.test(path),
    )
  );
}

export function shippedGraphChanged(base: AppLock, head: AppLock) {
  const runtime = (deps: AppLock["workspaces"][string]) =>
    ["dependencies", "optionalDependencies", "peerDependencies"].map((kind) => [
      kind,
      Object.entries(deps[kind as keyof typeof deps] ?? {}).sort(),
    ]);
  const shipped = (lock: AppLock) => {
    const ids = new Set(
      dependencyInventory(lock)
        .filter((pkg) => pkg.shipped)
        .map((pkg) => `${pkg.name}@${pkg.version}`),
    );
    // Include roots and resolution paths, not just the set of versions. A
    // runtime can move to a version already shipped by another consumer.
    // Conservatively include every resolution of a potentially shipped ID.
    return JSON.stringify({
      roots: Object.entries(lock.workspaces)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, deps]) => [name, runtime(deps)]),
      resolutions: Object.entries(lock.packages)
        .filter(([, entry]) => ids.has(entry[0]))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, entry]) => [path, entry[0], runtime(entry[2]), entry[3]]),
    });
  };
  return shipped(base) !== shipped(head);
}

export function maintenanceBody(
  body: string | null,
  shipped: boolean,
  number: number,
) {
  const clean = (body ?? "")
    .replace(
      /\n?<!-- dependency-maintenance -->[\s\S]*?<!-- \/dependency-maintenance -->\n?/g,
      "",
    )
    .trimEnd();
  return `${clean}\n\n<!-- dependency-maintenance -->\n${shipped ? `Changelog: changes/dependencies-${number}.md` : "Changelog: none — dependency maintenance changes only development tooling or Actions; the shipped runtime graph is unchanged."}\nSpec impact: none — dependency version updates do not change product or API contracts.\nVerification impact: none — dependency maintenance does not change ordering, ownership, authority or recovery contracts.\nDocumentation impact: dependency notices regenerated; existing product and release instructions remain accurate.\n<!-- /dependency-maintenance -->\n`;
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

/** Executed from the trusted base checkout, without a write token. Only
 * dependency data is read from the candidate; candidate code/hooks never run.
 */
export async function prepareMaintenance(
  candidate: string,
  pr: DependencyPR,
  output: string,
) {
  const paths = git(
    candidate,
    "diff",
    "--name-only",
    "--no-renames",
    `${pr.base.sha}...${pr.head.sha}`,
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!acceptsDependencyPR(pr, paths))
    throw new Error(
      "Not a supported same-repository Dependabot-only dependency PR",
    );
  if (git(candidate, "rev-parse", "HEAD").trim() !== pr.head.sha)
    throw new Error("Candidate revision changed");
  const baseLock = Bun.JSONC.parse(
    git(candidate, "show", `${pr.base.sha}:bun.lock`),
  ) as AppLock;
  const headLock = Bun.JSONC.parse(
    await readFile(resolve(candidate, "bun.lock"), "utf8"),
  ) as AppLock;
  const shipped = shippedGraphChanged(baseLock, headLock);
  const files: Record<string, string> = {};
  if (paths.includes("bun.lock")) {
    execFileSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: candidate,
      stdio: "inherit",
      timeout: 120_000,
    });
    const artifacts = await generateDependencyArtifacts(candidate);
    files["DEPENDENCY_NOTICES.md"] = artifacts.notices;
    files["DEPENDENCY_LICENSES.md"] = artifacts.licenses;
  }
  if (paths.includes("tools/quint/package-lock.json")) {
    execFileSync(
      "npm",
      [
        "ci",
        "--prefix",
        "tools/quint",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: candidate, stdio: "inherit", timeout: 120_000 },
    );
    await verificationNotices(false, candidate);
    files["tools/quint/DEPENDENCY_NOTICES.md"] = await readFile(
      resolve(candidate, "tools/quint/DEPENDENCY_NOTICES.md"),
      "utf8",
    );
  }
  if (shipped)
    files[`changes/dependencies-${pr.number}.md`] =
      "### Fixed\n\n- Update bundled application dependencies to their maintained versions.\n";
  // Omit identical blobs, so a rebase/retry does not add empty commits.
  for (const [path, text] of Object.entries(files)) {
    try {
      if (git(candidate, "show", `${pr.head.sha}:${path}`) === text)
        delete files[path];
    } catch {
      /* New artifact. */
    }
  }
  await writeFile(
    output,
    `${JSON.stringify({ head: pr.head.sha, body: maintenanceBody(pr.body, shipped, pr.number), files } satisfies Maintenance)}\n`,
  );
}

/** Write job checks out only trusted main, installs nothing, executes no PR
 * code, validates the artifact allowlist and advances the bot branch by CAS.
 */
export async function publishMaintenance(
  pr: DependencyPR,
  plan: Maintenance,
  request = githubJson,
) {
  const repository = pr.base.repo.full_name;
  const current = (await request(
    `/repos/${repository}/pulls/${pr.number}`,
  )) as DependencyPR;
  if (
    current.head.sha !== plan.head ||
    pr.head.sha !== plan.head ||
    !acceptsDependencyPR(
      current,
      Object.keys(plan.files).length ? Object.keys(plan.files) : ["bun.lock"],
    )
  )
    throw new Error("Dependency PR identity/revision changed");
  for (const [path, text] of Object.entries(plan.files)) {
    if (
      !notices.includes(path) &&
      path !== `changes/dependencies-${pr.number}.md`
    )
      throw new Error("Unexpected generated path");
    if (typeof text !== "string" || text.length > 2_000_000)
      throw new Error("Invalid generated content");
  }
  if (Object.keys(plan.files).length) {
    const parent = (await request(
      `/repos/${repository}/git/commits/${plan.head}`,
    )) as { tree: { sha: string } };
    const tree = (await request(`/repos/${repository}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: Object.entries(plan.files).map(([path, content]) => ({
          path,
          mode: "100644",
          type: "blob",
          content,
        })),
      }),
    })) as { sha: string };
    const commit = (await request(`/repos/${repository}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: "docs: maintain dependency notices and changelog",
        tree: tree.sha,
        parents: [plan.head],
      }),
    })) as { sha: string };
    await request(
      `/repos/${repository}/git/refs/heads/${encodeURIComponent(current.head.ref)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
    );
  }
  await request(`/repos/${repository}/pulls/${pr.number}`, {
    method: "PATCH",
    body: JSON.stringify({ body: plan.body }),
  });
  // Token-created commits/metadata do not trigger CI themselves. Explicitly
  // dispatch both gates; dispatches retain the required exact-head checks.
  for (const workflow of ["ci.yml", "dependency-security.yml"])
    await request(
      `/repos/${repository}/actions/workflows/${workflow}/dispatches`,
      { method: "POST", body: JSON.stringify({ ref: current.head.ref }) },
    );
}

if (import.meta.main) {
  const [command, eventFile, data, output] = process.argv.slice(2);
  const event = JSON.parse(await readFile(eventFile!, "utf8")) as {
    pull_request: DependencyPR;
  };
  if (command === "prepare")
    await prepareMaintenance(resolve(data!), event.pull_request, output!);
  else if (command === "publish")
    await publishMaintenance(
      event.pull_request,
      JSON.parse(await readFile(data!, "utf8")),
    );
  else
    throw new Error(
      "Usage: dependency-maintenance.ts prepare <event> <candidate> <output> | publish <event> <plan>",
    );
}
