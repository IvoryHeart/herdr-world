import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { seededProfiles } from "../agent/profile-store";
import { openWorldLedger } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";

const root = mkdtempSync(join(tmpdir(), "profile-crash-tests-"));
const source = resolve(import.meta.dir, "testing/profile-crash-fixture.ts");
let binary: string;
beforeAll(async () => {
  const built = join(
    root,
    process.platform === "win32" ? "build.exe" : "build",
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      "--sourcemap",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      resolve(import.meta.dir, "../testing/profile-crash-entry.ts"),
      resolve(import.meta.dir, "world-worker.ts"),
      "--outfile",
      built,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, errors] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`compiled profile fixture failed: ${errors}`);
  mkdirSync(join(root, "standalone"));
  binary = join(
    root,
    "standalone",
    process.platform === "win32" ? "profiles.exe" : "profiles",
  );
  copyFileSync(built, binary);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const paths = (directory: string) => ({
  database: join(directory, "world.sqlite"),
  ledger: join(directory, "ledger.json"),
  profiles: join(directory, "agent-profiles.json"),
});
const open = (directory: string) =>
  openWorldLedger(paths(directory), {
    clock: systemClock,
    scheduler: systemScheduler,
  });

async function crash(
  executable: string[],
  directory: string,
  phase: string,
  kill = true,
) {
  const child = Bun.spawn([...executable, directory, phase], {
    cwd: join(root, "standalone"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const timeout = setTimeout(() => child.kill(), 15_000);
  let output = "";
  try {
    while (!output.includes("\n")) {
      const part = await reader.read();
      if (part.done)
        throw new Error(
          `profile fixture ended early: ${await new Response(child.stderr).text()}`,
        );
      output += new TextDecoder().decode(part.value);
    }
    expect(output.trim()).toBe(phase);
  } finally {
    if (kill) child.kill("SIGKILL");
    const code = await child.exited;
    if (!kill) expect(code).toBe(0);
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

for (const compiled of [false, true]) {
  const label = compiled ? "standalone" : "source";
  const command = () => (compiled ? [binary] : [process.execPath, source]);
  for (const phase of ["before-commit", "after-commit", "worker-ack"])
    test(`${label}: profile/chime/import-state crash ${phase} is atomic`, async () => {
      const directory = mkdtempSync(join(root, "edits-"));
      const initial = await open(directory);
      const before = initial.profiles.get();
      await initial.close();
      await crash(command(), directory, phase);
      const reopened = await open(directory);
      try {
        const after = reopened.profiles.get(),
          committed = phase !== "before-commit";
        expect(reopened.profiles.profile("builder")?.role).toBe(
          committed
            ? "Committed synthetic role"
            : before.profiles.find((profile) => profile.id === "builder")!.role,
        );
        expect(after.chimes.motifs.for_you).toBe(
          committed ? false : before.chimes.motifs.for_you,
        );
        expect(after.terminal_settings!.highest_master_revision).toBe(
          committed ? 321 : 0,
        );
        expect(after.terminal_settings!.imported_connections).toEqual(
          committed ? ["studio"] : [],
        );
        expect((await reopened.inspect()).integrity).toBe("ok");
      } finally {
        await reopened.close();
      }
    });
  for (const phase of ["import-before-commit", "import-after-commit"])
    test(`${label}: ${phase} restarts the JSON import exactly once`, async () => {
      const directory = mkdtempSync(join(root, "import-"));
      const document = {
        ...seededProfiles(),
        revision: 7,
        terminal_settings: {
          imported_connections: ["earlier-host"],
          highest_master_revision: 123,
        },
      };
      const original = JSON.stringify(document);
      writeFileSync(paths(directory).profiles, original, { mode: 0o600 });
      await crash(command(), directory, phase);
      const db = new Database(paths(directory).database);
      try {
        const count = phase === "import-after-commit" ? 1 : 0;
        expect(
          db.query("SELECT count(*) AS count FROM profile_store_meta").get(),
        ).toEqual({ count });
        expect(
          db
            .query(
              "SELECT count(*) AS count FROM imports WHERE name='agent-profiles-json'",
            )
            .get(),
        ).toEqual({ count });
        expect(
          db.query("SELECT count(*) AS count FROM agent_profiles").get(),
        ).toEqual({ count: count * 4 });
        expect(
          db.query("SELECT count(*) AS count FROM profile_chimes").get(),
        ).toEqual({ count });
      } finally {
        db.close();
      }
      if (phase === "import-after-commit")
        writeFileSync(
          paths(directory).profiles,
          "{ ignored after committed import",
        );
      const reopened = await open(directory);
      expect(reopened.profiles.get()).toEqual(document);
      await reopened.close();
      const again = await open(directory);
      expect(again.profiles.get()).toEqual(document);
      await again.close();
    });
  test(`${label}: close drains a partial profile group and leaves its committed cache usable`, async () => {
    const directory = mkdtempSync(join(root, "drain-"));
    await crash(command(), directory, "worker-drain", false);
    const reopened = await open(directory);
    expect(reopened.profiles.profile("builder")?.name).toBe("Synthetic 32");
    expect(reopened.profiles.get().revision).toBe(33);
    await reopened.close();
    expect(reopened.profiles.profile("builder")?.name).toBe("Synthetic 32");
    const database = readFileSync(paths(directory).database);
    await expect(reopened.profiles.delete("builder")).rejects.toThrow(/clos/);
    expect(readFileSync(paths(directory).database)).toEqual(database);
  });
}
