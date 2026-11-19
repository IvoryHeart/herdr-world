import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claudeLaunchTapArgs } from "./claude-launch-settings";
import { claudeTapArgs } from "./claude-tap";
import { runProcessWithCodeTimeout } from "../utils/process-utils";

const runtime = { kind: "bun" as const, path: process.execPath };

test("Windows keeps the inline tap without preparing a Unix settings file", async () => {
  expect(
    await claudeLaunchTapArgs({
      runtime,
      windows: true,
      run: async () => {
        throw new Error("must not run");
      },
    }),
  ).toEqual(claudeTapArgs(runtime));
});

for (const answer of [
  { code: 1, stdout: "" },
  { code: 0, stdout: JSON.stringify("relative.json") },
  { code: 0, stdout: JSON.stringify("/bad\npath.json") },
])
  test("refuses a failed preparation or invalid host path", async () => {
    await expect(
      claudeLaunchTapArgs({
        runtime,
        windows: false,
        run: async () => ({ ...answer, stderr: "" }),
      }),
    ).rejects.toThrow();
  });

(process.platform === "win32" ? test.skip : test)(
  "tap files are private, atomic and reused by content without modifying user settings",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "tap-settings-"));
    try {
      const userSettings = join(home, ".claude", "settings.json");
      mkdirSync(dirname(userSettings));
      const original =
        '{"statusLine":{"type":"command","command":"printf mine"}}';
      writeFileSync(userSettings, original);
      const options = {
        runtime,
        windows: false,
        run: (argv: string[], timeout: number) =>
          runProcessWithCodeTimeout(argv, timeout, {
            env: { ...process.env, HOME: home },
          }),
      };
      const [a, b] = await Promise.all([
        claudeLaunchTapArgs(options),
        claudeLaunchTapArgs(options),
      ]);
      expect(a).toEqual(b);
      const file = a[1]!;
      expect(readFileSync(file, "utf8")).toBe(claudeTapArgs(runtime)[1]!);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
      expect(readdirSync(dirname(file))).toEqual([
        file.slice(dirname(file).length + 1),
      ]);
      expect(readFileSync(userSettings, "utf8")).toBe(original);
      // Replacing a hostile cache entry must replace the symlink itself, never
      // write through it into a user's settings.
      rmSync(file);
      symlinkSync(userSettings, file);
      expect(await claudeLaunchTapArgs(options)).toEqual(a);
      expect(readFileSync(userSettings, "utf8")).toBe(original);
      expect(readFileSync(file, "utf8")).toBe(claudeTapArgs(runtime)[1]!);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
