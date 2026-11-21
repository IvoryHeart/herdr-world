import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform === "win32").each([false, true])(
  "CI warms Chrome only for a browser selection (browser=%s)",
  async (browser) => {
    const root = mkdtempSync(join(tmpdir(), "test-wrapper-warmup-"));
    const marker = join(root, "chrome-started");
    const chrome = join(root, "chrome");
    const file = browser
      ? "web/src/uiScale.test.ts"
      : "scripts/verification-resources.live.test.ts";
    try {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(
        join(root, file),
        'import { test } from "bun:test"; test("synthetic selection", () => {});\n',
      );
      // A marker makes unwanted startup deterministic without a slow browser
      // or waiting for the resource preflight's 45-second deadline.
      writeFileSync(chrome, '#!/bin/sh\nprintf started > "$WARMUP_MARKER"\n', {
        mode: 0o755,
      });
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "run-tests.ts"),
          ...(browser ? [] : ["--live"]),
          `./${file}`,
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            CI: "true",
            CHROME_BIN: chrome,
            WARMUP_MARKER: marker,
            HERDR_CHROME_WARM: "",
            HERDR_TEST_EXCLUDE_WORLD_BROWSER: "",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toContain("1 pass");
      expect(code).toBe(0);
      expect(existsSync(marker)).toBe(browser);
      expect(stdout.includes("[chrome-warmup]")).toBe(browser);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
