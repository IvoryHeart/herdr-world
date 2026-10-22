import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { harnessReadiness, openHarnessLogin } from "./harness-readiness";

/** A host with fake harnesses: some on PATH, one in a default location. */
function host(
  fakes: Record<string, string>,
  inHome: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "world-harness-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const write = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  for (const [name, body] of Object.entries(fakes))
    write(join(bin, name), body);
  for (const [name, body] of Object.entries(inHome))
    write(join(home, ".local", "bin", name), body);
  return (kinds: string[]) =>
    harnessReadiness({
      kinds,
      windows: false,
      shQuote,
      run: (argv, timeout) =>
        runProcessWithCodeTimeout(
          ["env", "-i", `HOME=${home}`, `PATH=${bin}:/usr/bin:/bin`, ...argv],
          timeout,
        ),
    });
}

describe("Harness readiness", () => {
  test("reads each harness's own status without forwarding its output", async () => {
    const check = host(
      {
        claude: `[ "$1 $2" = "auth status" ] && echo '{"loggedIn": true, "authMethod": "claude.ai", "email": "dev@example.com"}'`,
        codex: `[ "$1 $2" = "login status" ] && { echo "Not logged in"; exit 1; }`,
      },
      { pi: "exit 0" },
    );
    const readiness = await check(["claude", "codex", "pi", "gemini"]);
    expect(readiness).toEqual([
      {
        kind: "claude",
        installed: true,
        logged_in: true,
        method: "claude.ai",
        can_log_in: true,
      },
      { kind: "codex", installed: true, logged_in: false, can_log_in: true },
      { kind: "pi", installed: true, logged_in: null, can_log_in: false },
      { kind: "gemini", installed: false, logged_in: null, can_log_in: false },
    ]);
    expect(JSON.stringify(readiness)).not.toContain("example.com");
  });

  test("a logged-in Codex reports how; a logged-out Claude says so", async () => {
    const check = host({
      claude: `echo '{"loggedIn": false}'; exit 1`,
      codex: `echo "Logged in using ChatGPT"`,
    });
    expect(await check(["claude", "codex"])).toMatchObject([
      { kind: "claude", installed: true, logged_in: false },
      { kind: "codex", logged_in: true, method: "ChatGPT" },
    ]);
  });

  test("a Windows host is not probed", async () => {
    expect(
      await harnessReadiness({
        kinds: ["claude"],
        windows: true,
        shQuote,
        run: () => {
          throw new Error("probed");
        },
      }),
    ).toEqual([
      { kind: "claude", installed: false, logged_in: null, can_log_in: false },
    ]);
  });

  test("login opens a tab running the harness's own login command", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    let reads = 0;
    const opened = await openHarnessLogin(
      async (method, params) => {
        calls.push([method, params]);
        if (method === "tab.create")
          return {
            tab: { tab_id: "w1:t3" },
            root_pane: { pane_id: "w1:p3", terminal_id: "term_3" },
          };
        if (method === "pane.read")
          return { read: { text: ++reads > 2 ? "$ " : "" } };
        return {};
      },
      { workspace_id: "w1", kind: "codex", sleep: async () => {} },
    );
    expect(opened).toEqual({
      tab_id: "w1:t3",
      pane_id: "w1:p3",
      terminal_id: "term_3",
    });
    expect(calls.at(-1)).toEqual([
      "pane.send_input",
      { pane_id: "w1:p3", text: "codex login --device-auth", keys: ["Enter"] },
    ]);
    await expect(
      openHarnessLogin(async () => ({}), { workspace_id: "w1", kind: "pi" }),
    ).rejects.toThrow(/no login command/);
  });
});
