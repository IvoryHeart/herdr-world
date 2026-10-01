import { execFileSync, spawnSync } from "node:child_process";

function changedPaths(args: string[]): string[] {
  return execFileSync("git", ["diff", ...args, "--name-only", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

const staged = new Set(changedPaths(["--cached"]));
if (changedPaths([]).some((path) => staged.has(path))) {
  console.error(
    "format:staged: a staged file has unstaged edits; stage or separate them before formatting.",
  );
  process.exit(1);
}

const result = spawnSync(
  "biome",
  ["format", "--write", "--staged", "--no-errors-on-unmatched"],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
