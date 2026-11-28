import { expect, jest, test } from "bun:test";
import { readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FILE_DEADLINES_ENV,
  FILE_TIMEOUT_MS,
  clearFileDeadline,
  fileDeadline,
  spawnTestBatch,
  watchTestFiles,
} from "./file-deadline";

function publishMarker(marker: string, file: string, token: string) {
  writeFileSync(marker, JSON.stringify({ file, token }));
  const seconds = Date.now() / 1000;
  utimesSync(marker, seconds, seconds);
}

test("a stopped fixture Date cannot change a loader marker's real start time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-native-start-"));
  const previousDirectory = process.env[FILE_DEADLINES_ENV];
  const before = Date.now();
  process.env[FILE_DEADLINES_ENV] = directory;
  jest.useFakeTimers();
  jest.setSystemTime(0);
  let close = () => {};
  try {
    fileDeadline("fixture.test.ts");
    const [name] = await readdir(directory);
    // Model the parent, which keeps real time while the fixture's clock is stopped.
    jest.setSystemTime(before);
    const expired: string[] = [];
    let changed!: (filename: string | null) => void;
    close = watchTestFiles(
      directory,
      (file) => expired.push(file),
      (notify) => {
        changed = notify;
        return () => {};
      },
    );
    changed(name!);
    jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
    expect(expired).toEqual([]);
    jest.advanceTimersByTime(FILE_TIMEOUT_MS);
    expect(expired).toEqual(["fixture.test.ts"]);
    clearFileDeadline("fixture.test.ts");
    expect(await readdir(directory)).toEqual([]);
  } finally {
    close();
    jest.useRealTimers();
    if (previousDirectory === undefined) delete process.env[FILE_DEADLINES_ENV];
    else process.env[FILE_DEADLINES_ENV] = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["removed", "replaced"] as const)(
  "a %s marker cannot expire its completed file when watch events are lost",
  async (change) => {
    const directory = await mkdtemp(join(tmpdir(), "deadline-missed-event-"));
    const marker = join(directory, "fixture.json");
    const expired: string[] = [];
    let changed!: (filename: string | null) => void;
    jest.useFakeTimers();
    const close = watchTestFiles(
      directory,
      (file) => expired.push(file),
      (notify) => {
        changed = notify;
        return () => {};
      },
    );
    const publish = (file: string, token: string) => {
      publishMarker(marker, file, token);
    };
    try {
      publish("passing.test.ts", "first-start");
      changed("fixture.json");
      jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
      if (change === "removed") rmSync(marker);
      else publish("hung.test.ts", "second-start");
      // Deliberately deliver neither the removal nor the replacement event.
      jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
      expect(expired).toEqual([]);
      if (change === "replaced") {
        jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
        expect(expired).toEqual(["hung.test.ts"]);
      }
    } finally {
      close();
      jest.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("duplicate file events keep the original deadline and closing cancels it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-duplicate-event-"));
  const expired: string[] = [];
  let changed!: (filename: string | null) => void;
  jest.useFakeTimers();
  const close = watchTestFiles(
    directory,
    (file) => expired.push(file),
    (notify) => {
      changed = notify;
      return () => {};
    },
  );
  try {
    publishMarker(
      join(directory, "fixture.json"),
      "active.test.ts",
      "same-start",
    );
    changed("fixture.json");
    jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
    changed("fixture.json");
    jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
    expect(expired).toEqual(["active.test.ts"]);
    changed("fixture.json");
    close();
    jest.advanceTimersByTime(FILE_TIMEOUT_MS);
    expect(expired).toEqual(["active.test.ts"]);
  } finally {
    close();
    jest.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a delayed file notification retains the loader's start time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-late-event-"));
  const expired: string[] = [];
  let changed!: (filename: string | null) => void;
  jest.useFakeTimers();
  const close = watchTestFiles(
    directory,
    (file) => expired.push(file),
    (notify) => {
      changed = notify;
      return () => {};
    },
  );
  try {
    publishMarker(
      join(directory, "fixture.json"),
      "active.test.ts",
      "original-start",
    );
    jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
    changed("fixture.json");
    jest.advanceTimersByTime(FILE_TIMEOUT_MS / 2);
    expect(expired).toEqual(["active.test.ts"]);
  } finally {
    close();
    jest.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  }
});

test("healthy sequential files can outlive the first file's deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-sequential-"));
  const expired: string[] = [];
  let changed!: (filename: string | null) => void;
  jest.useFakeTimers();
  const close = watchTestFiles(
    directory,
    (file) => expired.push(file),
    (notify) => {
      changed = notify;
      return () => {};
    },
  );
  try {
    for (const file of ["quick", "b1", "b2"]) {
      const name = `${file}.json`;
      publishMarker(join(directory, name), `${file}.test.ts`, file);
      changed(name);
      jest.advanceTimersByTime(file === "quick" ? 1 : FILE_TIMEOUT_MS * 0.65);
      // Coalesce away every removal event, just as the native watcher can.
      rmSync(join(directory, name));
    }
    jest.advanceTimersByTime(FILE_TIMEOUT_MS);
    expect(expired).toEqual([]);
  } finally {
    close();
    jest.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the loader publishes once and injected cleanup preserves source lines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-source-lines-"));
  const file = join(directory, "source-lines.test.ts");
  const completed = join(directory, "registration-completed");
  try {
    await writeFile(
      join(directory, "marker-observer.ts"),
      `
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const directory = process.env.HERDR_TEST_FILE_DEADLINES!;
export const marker = join(directory, readdirSync(directory).find(name => name.endsWith(".json"))!);
export const published = statSync(marker).ino;
`,
    );
    await writeFile(
      file,
      `import { expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { marker, published } from "./marker-observer";
test("one registration", () => { expect(statSync(marker).ino).toBe(published); writeFileSync(${JSON.stringify(completed)}, "registered once"); });
test("stack location", () => { throw new Error("stack-location-probe"); });
`,
    );
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "../run-tests.ts"), file],
      {
        env: {
          ...process.env,
          // Bun suppresses passing-test output in agent mode. Prove completion
          // through a fixture receipt rather than depending on reporter text.
          CLAUDECODE: "1",
          AGENT: "1",
          HERDR_TEST_EXCLUDE_WORLD_BROWSER: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, , stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(1);
    expect(await Bun.file(completed).text()).toBe("registered once");
    expect(stderr).toContain(`${file}:5:`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(
  [1, 2].flatMap((parallel) =>
    ["import", "module", "sync", "beforeAll", "test", "afterAll"].map(
      (phase) => [phase, parallel] as const,
    ),
  ),
)(
  "a hung %s fails with its file name and stopped clock (parallel=%i)",
  async (phase, parallel) => {
    const directory = await mkdtemp(join(tmpdir(), "file-deadline-"));
    const file = join(directory, "hung.test.ts");
    const passing = join(directory, "a-passing.test.ts");
    const completed = join(directory, "passing-completed");
    try {
      await writeFile(
        passing,
        `import { jest, test } from "bun:test"; import { writeFileSync } from "node:fs"; jest.useFakeTimers(); jest.setSystemTime(0); test("passes first", () => writeFileSync(${JSON.stringify(completed)}, "passed first"));`,
      );
      await writeFile(
        join(directory, "hung-import.ts"),
        'import { jest } from "bun:test"; jest.useFakeTimers(); await new Promise(() => {});',
      );
      await writeFile(
        file,
        `${phase === "import" ? 'import "./hung-import.ts";' : ""}
import { jest, beforeAll, afterAll, test } from "bun:test";
jest.useFakeTimers(); jest.setSystemTime(0);
const hang = () => new Promise<void>(() => {});
${phase === "module" ? "await hang();" : phase === "sync" ? "for (;;) {}" : ""}
${phase === "beforeAll" ? "beforeAll(hang);" : ""}
test("fixture", ${phase === "test" ? "hang" : "() => {}"});
${phase === "afterAll" ? "afterAll(hang);" : ""}
`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../run-tests.ts"),
          passing,
          file,
          `--parallel=${parallel}`,
        ],
        {
          env: {
            ...process.env,
            CLAUDECODE: "1",
            AGENT: "1",
            HERDR_TEST_EXCLUDE_WORLD_BROWSER: "1",
            HERDR_TEST_FILE_TIMEOUT_MS: "100",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      // A broken watchdog must fail this regression without leaving its child alive.
      const supervisor = setTimeout(() => child.kill("SIGKILL"), 1500);
      try {
        const [code, , stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code).toBe(124);
        expect(stderr).toContain(`[test-file-timeout] ${file} exceeded 100 ms`);
        expect(await Bun.file(completed).text()).toBe("passed first");
        expect(stderr).not.toContain(`[test-file-timeout] ${passing}`);
      } finally {
        clearTimeout(supervisor);
        child.kill("SIGKILL");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("a batch that cannot start releases its deadline registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-start-failure-"));
  try {
    expect(() =>
      spawnTestBatch([join(directory, "missing-synthetic-command")], {
        env: { ...process.env, TMPDIR: directory },
        stdout: "ignore",
        stderr: "ignore",
      }),
    ).toThrow();
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a file deadline retires descendants and closes inherited output pipes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-descendants-"));
  const pidFile = join(directory, "descendant.pid");
  const fixture = join(directory, "fixture.ts");
  const supervisor = join(directory, "supervisor.ts");
  let forced = false;
  const killDescendant = () => {
    try {
      const pid = Number(readFileSync(pidFile, "utf8"));
      // Never interpret an empty/malformed fixture receipt as a process group.
      if (Number.isSafeInteger(pid) && pid > 1) process.kill(pid, "SIGKILL");
    } catch (error) {
      if (
        !["ENOENT", "ESRCH"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        throw error;
    }
  };
  try {
    await writeFile(
      fixture,
      `
import { renameSync, writeFileSync } from "node:fs";
import { fileDeadline } from ${JSON.stringify(join(import.meta.dir, "file-deadline.ts"))};
const descendant = Bun.spawn([process.execPath, "-e", 'import { createServer } from "node:net"; createServer().listen(0, "127.0.0.1", () => console.log("ready"));'], { stdout: "pipe", stderr: "inherit" });
await descendant.stdout.getReader().read();
writeFileSync(${JSON.stringify(pidFile + ".tmp")}, String(descendant.pid));
renameSync(${JSON.stringify(pidFile + ".tmp")}, ${JSON.stringify(pidFile)});
fileDeadline("synthetic-hung.test.ts");
await descendant.exited;
`,
    );
    await writeFile(
      supervisor,
      `
import { spawnTestBatch } from ${JSON.stringify(join(import.meta.dir, "file-deadline.ts"))};
const batch = spawnTestBatch([process.execPath, ${JSON.stringify(fixture)}], { env: { ...process.env, HERDR_TEST_FILE_TIMEOUT_MS: "100" }, stdout: "inherit", stderr: "inherit" });
process.exit(await batch.exited);
`,
    );
    const child = Bun.spawn([process.execPath, supervisor], {
      env: { ...process.env, HERDR_TEST_FILE_TIMEOUT_MS: "100" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const deadline = setTimeout(() => {
      forced = true;
      killDescendant();
      child.kill("SIGKILL");
    }, 1500);
    try {
      const [code, , stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toContain(
        "[test-file-timeout] synthetic-hung.test.ts exceeded 100 ms",
      );
      expect(code).toBe(124);
      expect(forced).toBe(false);
    } finally {
      clearTimeout(deadline);
      killDescendant();
      child.kill("SIGKILL");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
