import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function subscriptionEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"])
    delete result[key];
  return result;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const state = resolve(root, ".agents/upstream-local");
  mkdirSync(state, { recursive: true });
  const lock = resolve(state, "worker.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.info(
        "A local upstream worker already owns the lock. Inspect it before recovering a stale lock.",
      );
      process.exit(0);
    }
    throw error;
  }
  try {
    // Never reuse a previous run's plan if there is no new work.
    const plan = resolve(state, "plan.json");
    rmSync(plan, { force: true });
    const env = subscriptionEnvironment({
      ...process.env,
      GITHUB_REPOSITORY: "IvoryHeart/herdr-world",
    });
    const planned = spawnSync(
      process.execPath,
      [resolve(root, "scripts/upstream-sync.ts"), "local-plan"],
      { cwd: root, env, stdio: "inherit" },
    );
    if (planned.status !== 0) process.exitCode = 1;
    else if (existsSync(plan)) {
      const prompt = readFileSync(
        resolve(root, ".github/codex/upstream-local.md"),
        "utf8",
      );
      const result = spawnSync(
        "codex",
        [
          "exec",
          "--ephemeral",
          "--approve-for-me",
          "-c",
          'forced_login_method="chatgpt"',
          "-c",
          "sandbox_workspace_write.network_access=true",
          "-",
        ],
        {
          cwd: root,
          env,
          input: prompt,
          stdio: ["pipe", "inherit", "inherit"],
        },
      );
      if (result.status !== 0) {
        spawnSync(
          process.execPath,
          [resolve(root, "scripts/upstream-sync.ts"), "block"],
          { cwd: root, env, stdio: "inherit" },
        );
        process.exitCode = 1;
      }
    }
  } finally {
    rmSync(lock, { recursive: true });
  }
}
