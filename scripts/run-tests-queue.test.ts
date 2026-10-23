import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireCheckSlot, HELD_ENV } from "./check-lock";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test.each([
  "dot-file",
  "absolute-file",
  "symlink-file",
  "directory",
  "root",
  "filter",
  "flags-only",
])(
  "the actual wrapper queues browser selection %s before executing tests",
  async (selection) => {
    const root = mkdtempSync(join(tmpdir(), "test-wrapper-queue-"));
    roots.push(root);
    const marker = join(root, "ran");
    const path = join(root, "web/src/uiScale.test.ts");
    const worldPath = join(root, "web/src/world/WorldTerminalHandoff.test.ts");
    for (const file of [path, worldPath]) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(
        file,
        `import { test } from "bun:test"; test("synthetic browser fixture", async () => { await Bun.write(${JSON.stringify(marker)}, "ran"); });\n`,
      );
    }
    symlinkSync(path, join(root, "alias.test.ts"));
    const runtime = join(root, "runtime");
    const dir = join(runtime, "herdr-world-checks");
    const release = await acquireCheckSlot("browser", {
      dir,
      lane: "fixture browser holder",
      env: {},
      log: () => {},
    });
    const args: Record<string, string[]> = {
      "dot-file": ["./web/src/uiScale.test.ts"],
      "absolute-file": [path],
      "symlink-file": ["./alias.test.ts"],
      directory: ["./web/src/world"],
      root: ["."],
      filter: ["uiScale"],
      "flags-only": ["--timeout", "30000"],
    };
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "run-tests.ts"),
        ...args[selection]!,
      ],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          CI: "",
          XDG_RUNTIME_DIR: runtime,
          [HELD_ENV]: "",
          HERDR_TEST_EXCLUDE_WORLD_BROWSER: "",
        },
      },
    );
    let sawWait = false;
    const output = (async () => {
      let text = "";
      for await (const chunk of child.stdout) {
        text += new TextDecoder().decode(chunk);
        // Selections that may include a timed suite wait for the whole machine.
        if (!sawWait && /\[queue\] (browser|timed) tests waiting/.test(text)) {
          sawWait = true;
          expect(existsSync(marker)).toBe(false);
          release();
        }
      }
    })();
    try {
      const [code, , stderr] = await Promise.all([
        child.exited,
        output,
        new Response(child.stderr).text(),
      ]);
      expect(stderr).not.toContain("error:");
      expect(code).toBe(0);
      expect(sawWait).toBe(true);
      expect(existsSync(marker)).toBe(true);
    } finally {
      release();
      child.kill("SIGKILL");
      await child.exited;
    }
  },
  15000,
);
