import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Main contains merged work. Incomplete changes stay active; never skip a conflict. */
export function archiveChanges(
  root: string,
  archive = (name: string) => {
    execFileSync(
      join(import.meta.dir, "../node_modules/.bin/openspec"),
      ["archive", name, "--yes", "--json"],
      {
        cwd: root,
        stdio: "pipe",
        env: { ...process.env, OPENSPEC_TELEMETRY: "0" },
      },
    );
  },
): { archived: string[]; skipped: string[]; stopped?: string } {
  const directory = join(root, "openspec/changes");
  const result: { archived: string[]; skipped: string[]; stopped?: string } = {
    archived: [],
    skipped: [],
  };
  // First appearance on main is the merge date; later clarifications do not reorder it.
  const mergedAt = (name: string) =>
    Number(
      execFileSync(
        "git",
        [
          "log",
          "--first-parent",
          "--reverse",
          "--format=%ct",
          "--",
          `openspec/changes/${name}`,
        ],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n")[0] || 0,
    );
  const changes = readdirSync(directory, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "archive")
    .map((d) => ({ name: d.name, date: mergedAt(d.name) }))
    .sort((a, b) => a.date - b.date || a.name.localeCompare(b.name));
  for (const { name } of changes) {
    const tasks = join(directory, name, "tasks.md");
    const taskText = existsSync(tasks) ? readFileSync(tasks, "utf8") : "";
    if (!/- \[x\]/i.test(taskText) || /- \[ \]/.test(taskText)) {
      result.skipped.push(name);
      continue;
    }
    // Archive can write several specs before failing: restore just this transaction.
    const backup = mkdtempSync(join(tmpdir(), "openspec-archive-"));
    cpSync(join(root, "openspec"), join(backup, "openspec"), {
      recursive: true,
    });
    try {
      archive(name);
      result.archived.push(name);
    } catch {
      rmSync(join(root, "openspec"), { recursive: true });
      cpSync(join(backup, "openspec"), join(root, "openspec"), {
        recursive: true,
      });
      result.stopped = name;
      break;
    } finally {
      rmSync(backup, { recursive: true, force: true });
    }
  }
  return result;
}

if (import.meta.main) {
  const result = archiveChanges(process.cwd());
  console.log(JSON.stringify(result));
  if (result.stopped) {
    process.exitCode = 1;
    console.error(
      `Stopped at ${result.stopped}; earlier archives remain reviewable. Resolve its delta before the next batch.`,
    );
  }
}
