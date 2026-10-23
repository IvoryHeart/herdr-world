import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import {
  harnessReadiness,
  loginCommand,
  openHarnessLogin,
} from "./harness-readiness";

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
  const env = ["env", "-i", `HOME=${home}`, `PATH=${bin}:/usr/bin:/bin`];
  return Object.assign(
    (kinds: string[]) =>
      harnessReadiness({
        kinds,
        windows: false,
        shQuote,
        run: (argv, timeout) =>
          runProcessWithCodeTimeout([...env, ...argv], timeout),
      }),
    {
      /** Run a line as a login shell on this host would. */
      type: (line: string) =>
        runProcessWithCodeTimeout([...env, "sh", "-c", line], 10_000),
    },
  );
}

/**
 * A fake Herdr for one login tab. `screens` are successive visible reads;
 * `front` says whether the shell holds the foreground at each step.
 */
function loginHerdr(options: {
  screens: string[];
  front?: (step: number) => boolean;
  terminal?: (step: number) => string;
}) {
  const calls: [string, Record<string, unknown>][] = [];
  let step = 0;
  const call = async (method: string, params: Record<string, unknown>) => {
    calls.push([method, params]);
    if (method === "tab.create")
      return {
        tab: { tab_id: "w1:t3" },
        root_pane: { pane_id: "w1:p3", terminal_id: "term_3" },
      };
    if (method === "pane.get")
      return {
        pane: {
          pane_id: "w1:p3",
          terminal_id: options.terminal?.(step) ?? "term_3",
        },
      };
    if (method === "pane.process_info") {
      const front = options.front?.(step) ?? true;
      return {
        process_info: {
          shell_pid: 40,
          foreground_process_group_id: front ? 40 : 41,
        },
      };
    }
    if (method === "pane.read")
      return {
        read: { text: options.screens[step] ?? options.screens.at(-1) },
      };
    return {};
  };
  let clock = 0;
  const timing = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      step += 1;
    },
  };
  return { call, calls, timing };
}
/** Anything World typed or pressed in the login tab. */
const typed = (calls: [string, Record<string, unknown>][]) =>
  calls.filter(
    ([method]) => method === "pane.send_input" || method === "pane.send_text",
  );

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

  test("a Windows host is not probed and reports nothing", async () => {
    // Nothing known blocks no kind: the launcher keeps every kind Herdr
    // supports there.
    expect(
      await harnessReadiness({
        kinds: ["claude"],
        windows: true,
        shQuote,
        run: () => {
          throw new Error("probed");
        },
      }),
    ).toEqual([]);
  });

  test("login puts the harness's own login on the line once the shell settles, never pressing Enter", async () => {
    const herdr = loginHerdr({ screens: ["", "Welcome", "$ ", "$ "] });
    const opened = await openHarnessLogin(herdr.call, {
      workspace_id: "w1",
      kind: "codex",
      windows: false,
      isCurrent: () => true,
      ...herdr.timing,
    });
    expect(opened).toEqual({
      status: "typed",
      tab_id: "w1:t3",
      pane_id: "w1:p3",
      terminal_id: "term_3",
    });
    expect(typed(herdr.calls)).toEqual([
      ["pane.send_text", { pane_id: "w1:p3", text: loginCommand("codex") }],
    ]);
    await expect(
      openHarnessLogin(herdr.call, {
        workspace_id: "w1",
        kind: "pi",
        windows: false,
        isCurrent: () => true,
      }),
    ).rejects.toThrow(/no login command/);
    await expect(
      openHarnessLogin(herdr.call, {
        workspace_id: "w1",
        kind: "codex",
        windows: true,
        isCurrent: () => true,
      }),
    ).rejects.toThrow(/Windows/);
  });

  test("login types nothing into a shell that never reaches its prompt", async () => {
    const cases = {
      // Every read is empty.
      neverReady: loginHerdr({ screens: [""] }),
      // A banner, with the shell's startup still in front of it.
      bannerOnly: loginHerdr({
        screens: ["Last login: Mon", "Last login: Mon"],
        front: () => false,
      }),
    };
    for (const herdr of Object.values(cases)) {
      const outcome = await openHarnessLogin(herdr.call, {
        workspace_id: "w1",
        kind: "claude",
        windows: false,
        isCurrent: () => true,
        ...herdr.timing,
      });
      expect(outcome).toMatchObject({
        status: "uncertain",
        terminal_id: "term_3",
        message: expect.stringMatching(/nothing was typed/),
      });
      expect(typed(herdr.calls)).toEqual([]);
    }
  });

  test("login stops when the tab changes or the host reconnects", async () => {
    const changed = loginHerdr({
      screens: ["$ "],
      terminal: (step) => (step === 0 ? "term_3" : "term_9"),
    });
    expect(
      await openHarnessLogin(changed.call, {
        workspace_id: "w1",
        kind: "claude",
        windows: false,
        isCurrent: () => true,
        ...changed.timing,
      }),
    ).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/tab changed/),
    });
    expect(typed(changed.calls)).toEqual([]);

    let current = true;
    const reconnect = loginHerdr({ screens: ["$ "] });
    const outcome = await openHarnessLogin(reconnect.call, {
      workspace_id: "w1",
      kind: "claude",
      windows: false,
      isCurrent: () => current,
      now: reconnect.timing.now,
      sleep: async (ms) => {
        await reconnect.timing.sleep(ms);
        current = false;
      },
    });
    expect(outcome).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/reconnected/),
    });
    expect(typed(reconnect.calls)).toEqual([]);

    // The host reconnects during the last awaited read before typing.
    let live = true;
    let reads = 0;
    const late = loginHerdr({ screens: ["$ "] });
    const lateOutcome = await openHarnessLogin(
      async (method, params) => {
        const result = await late.call(method, params);
        if (method === "pane.read" && ++reads === 2) live = false;
        return result;
      },
      {
        workspace_id: "w1",
        kind: "claude",
        windows: false,
        isCurrent: () => live,
        ...late.timing,
      },
    );
    expect(lateOutcome).toMatchObject({ status: "failed" });
    expect(typed(late.calls)).toEqual([]);
  });

  test("a startup question in front of the shell never gets an answer", async () => {
    // A startup script waiting in `read` looks like a prompt to Herdr's
    // reports: the shell is in front and the screen is stable. World only
    // places the command; the user sees it and decides whether to press Enter.
    const herdr = loginHerdr({ screens: ["Set up now? [y/N]"] });
    expect(
      await openHarnessLogin(herdr.call, {
        workspace_id: "w1",
        kind: "claude",
        windows: false,
        isCurrent: () => true,
        ...herdr.timing,
      }),
    ).toMatchObject({ status: "typed" });
    const input = typed(herdr.calls);
    expect(input.map(([method]) => method)).toEqual(["pane.send_text"]);
    expect(JSON.stringify(input)).not.toContain("Enter");
    expect(String(input[0]?.[1].text)).not.toContain("\n");
  });

  test("login runs an install found only in its default location", async () => {
    // Not on the shell's PATH: only in ~/.local/bin, as readiness finds it.
    const fake = host(
      {},
      {
        claude: `case "$1 $2" in "auth status") echo '{"loggedIn": false}'; exit 1;; "auth login") echo "LOGIN FLOW";; esac`,
      },
    );
    expect(await fake(["claude"])).toMatchObject([
      { kind: "claude", installed: true, logged_in: false, can_log_in: true },
    ]);
    const login = await fake.type(loginCommand("claude")!);
    expect(login.stdout.trim()).toBe("LOGIN FLOW");
    const missing = await host({}).type(loginCommand("codex")!);
    expect(missing.code).toBe(127);
    expect(missing.stdout).toContain("codex is not installed here.");
  });
});
