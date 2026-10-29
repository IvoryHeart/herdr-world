import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refusedAgentPaths } from "./check-staged-agents";

test("only the shared skills may be committed under .agents/", () => {
  expect(
    refusedAgentPaths([
      ".agents/dispatch/BRIEF.md",
      ".agents/firstmate/ledger.md",
      ".agents/skills/candidate-delivery/SKILL.md",
      "docs/agent-development.md",
      "agents/notes.md",
    ]),
  ).toEqual([".agents/dispatch/BRIEF.md", ".agents/firstmate/ledger.md"]);
});

test("a force-added dispatcher file is refused; removing one is not", () => {
  const root = mkdtempSync(join(tmpdir(), "staged-agents-"));
  const check = () =>
    spawnSync("bun", [join(import.meta.dir, "check-staged-agents.ts")], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(root, ".gitignore"), ".agents/\n");
    mkdirSync(join(root, ".agents", "dispatch"), { recursive: true });
    writeFileSync(join(root, ".agents", "dispatch", "BRIEF.md"), "live\n");
    git("add", "-f", ".agents/dispatch/BRIEF.md");
    const refused = check();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(".agents/dispatch/BRIEF.md");
    git(
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "--no-verify",
      "-m",
      "seed",
    );
    git("rm", "-q", "--cached", ".agents/dispatch/BRIEF.md");
    expect(check().status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
