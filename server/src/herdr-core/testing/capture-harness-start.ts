/**
 * Records what a real herdr-core reports while World starts Codex and Claude
 * Code the way New agent does (`coreShellArgv`, World's placement labels,
 * `herdr.seen=0`), then sends each one short message: the event lines for
 * the committed replay test (`harness-start.test.ts`).
 *
 * Run: HERDR_CORE_BIN=/path/to/herdr-core bun <this file> <out.json>
 *
 * Everything is scratch: the core runs under scratch XDG directories, and
 * each harness gets a scratch config folder (`CODEX_HOME`,
 * `CLAUDE_CONFIG_DIR`) holding only a copy of its sign-in, a trusted scratch
 * project and no update check, so no dialog stops it and the person's own
 * harness settings are never read or written. The copies are removed with
 * the core. Paths are scrubbed from the recording.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CoreClient } from "../client";
import { resolveLocalCoreEndpoint } from "../endpoint";
import { coreShellArgv } from "../shell";
import { connectUnixStream } from "../stream";
import { ScratchCore, scratchCoreBinary } from "./scratch-core";

export type HarnessStartRecording = {
  core_version: string;
  harnesses: Record<string, string>;
  scenario: string;
  /** Core's event lines in order, with ms since the first start. */
  events: { ms: number; line: { method: string; params: unknown } }[];
};

const PROMPT =
  "Reply with the single word OK and nothing else. Do not use tools.";
const SCRUBBED_PROJECT = "/srv/example/project";

async function version(exe: string): Promise<string> {
  const proc = Bun.spawn([exe, "--version"], { stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  return out.match(/\d+\.\d+\.\d+/)?.[0] ?? "unknown";
}

export async function captureHarnessStart(
  bin: string,
): Promise<HarnessStartRecording> {
  const exes = {
    codex: Bun.which("codex"),
    claude: Bun.which("claude"),
  };
  if (!exes.codex || !exes.claude) throw new Error("codex and claude needed");
  const paths = { codex: exes.codex, claude: exes.claude };
  const core = new ScratchCore(bin, { heartbeatMs: 300 });
  const project = join(core.root, "project");
  const codexHome = join(core.root, "codex");
  const claudeDir = join(core.root, "claude");
  for (const dir of [project, codexHome, claudeDir]) mkdirSync(dir);
  copyFileSync(
    join(homedir(), ".codex", "auth.json"),
    join(codexHome, "auth.json"),
  );
  writeFileSync(
    join(codexHome, "config.toml"),
    `check_for_update_on_startup = false\n[projects."${project}"]\ntrust_level = "trusted"\n`,
  );
  copyFileSync(
    join(homedir(), ".claude", ".credentials.json"),
    join(claudeDir, ".credentials.json"),
  );
  writeFileSync(
    join(claudeDir, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: "dark",
      projects: { [project]: { hasTrustDialogAccepted: true } },
    }),
  );
  Object.assign(core.env, {
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeDir,
    TERM: "xterm-256color",
  });
  const events: HarnessStartRecording["events"] = [];
  let t0 = 0;
  try {
    await core.start();
    const client = await CoreClient.open(
      await connectUnixStream(resolveLocalCoreEndpoint(core.stateDir)),
    );
    await client.subscribe({
      baseline: () => {},
      line: (line: { method: string; params: unknown }) => {
        if (line.method === "event")
          events.push({ ms: t0 ? Date.now() - t0 : 0, line });
      },
      end: () => {},
    } as never);
    t0 = Date.now();
    const started: string[] = [];
    for (const [kind, exe] of Object.entries(exes)) {
      const argv =
        kind === "claude"
          ? [exe!, "--session-id", "00000000-0000-4000-8000-000000000001"]
          : [exe!];
      const record = await client.run({
        argv: coreShellArgv(argv),
        cwd: project,
        keep: true,
        name: kind,
        labels: {
          "herdr.space": "example",
          "herdr.tab": `world-${kind}`,
          "herdr.seen": "0",
          where: `Example / ${kind}`,
        },
      });
      started.push(record.address as string);
    }
    // Startup, then one short turn each, then the end of that turn.
    await Bun.sleep(10_000);
    for (const address of started) await core.hc("send", address, PROMPT);
    for (let waited = 0; waited < 60_000; waited += 500) {
      const turns = events.filter(
        (e) =>
          (e.line.params as { type?: string; data?: { state?: string } })
            .type === "turn" &&
          (e.line.params as { data?: { state?: string } }).data?.state ===
            "done",
      );
      if (turns.length >= started.length) break;
      await Bun.sleep(500);
    }
    await Bun.sleep(1_000);
    const coreVersion = client.hello.version;
    client.close();
    const scrub = (text: string) =>
      text
        .replaceAll(paths.codex, "/usr/local/bin/codex")
        .replaceAll(paths.claude, "/usr/local/bin/claude")
        .replaceAll(project, SCRUBBED_PROJECT)
        .replaceAll(core.root, "/srv/example");
    return {
      core_version: coreVersion,
      harnesses: {
        codex: await version(paths.codex),
        claude: await version(paths.claude),
      },
      scenario:
        "World starts Codex (t1) and Claude Code (t2) through coreShellArgv with herdr.seen=0 in a trusted folder; after 10 s each gets one short message and answers it",
      events: JSON.parse(scrub(JSON.stringify(events))),
    };
  } finally {
    await core.dispose();
  }
}

if (import.meta.main) {
  const bin = scratchCoreBinary();
  const out = process.argv[2];
  if (!bin || !out) {
    console.error(
      "usage: HERDR_CORE_BIN=<herdr-core> bun capture-harness-start.ts <out.json>",
    );
    process.exit(2);
  }
  const recording = await captureHarnessStart(bin);
  writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`recorded ${recording.core_version}: ${out}`);
}
