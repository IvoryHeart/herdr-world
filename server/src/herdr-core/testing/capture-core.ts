/**
 * Records World's traffic with a real herdr-core release, for the committed
 * replay test. Run: HERDR_CORE_BIN=/path/to/herdr-core bun <this file> <out>
 * The core runs under scratch XDG directories with a synthetic identity.
 */
import { writeFileSync } from "node:fs";
import { CoreClient, type CoreTerminalRecord } from "../client";
import { resolveLocalCoreEndpoint } from "../endpoint";
import { connectUnixStream } from "../stream";
import { desktopPane } from "./desktop-pane";
import { ScratchCore, scratchCoreBinary } from "./scratch-core";

export type RecordedConnection = {
  label: string;
  /** Inbound byte slices exactly as read from the socket, base64. */
  inbound: string[];
  /** World's calls in order (channel 0 ids start at 1). */
  calls: string[];
};

export type CoreRecording = {
  core_version: string;
  scenario: string;
  connections: RecordedConnection[];
};

const AGENT = [
  "printf '\\033]7501;state=working\\033\\\\'",
  "sleep 0.3",
  "printf '\\033]7501;state=done\\033\\\\'",
  "exec sh",
].join("; ");

async function recordConnection(
  core: ScratchCore,
  label: string,
  steps: (client: CoreClient, calls: string[]) => Promise<void>,
): Promise<RecordedConnection> {
  const inbound: Uint8Array[] = [];
  const calls: string[] = [];
  const stream = await connectUnixStream(
    resolveLocalCoreEndpoint(core.stateDir),
  );
  const client = await CoreClient.open(stream, {
    onInbound: (bytes) => inbound.push(bytes.slice()),
  });
  await steps(client, calls);
  await client.whenClosed();
  return {
    label,
    inbound: inbound.map((bytes) => Buffer.from(bytes).toString("base64")),
    calls,
  };
}

/** The scrubber's only job: the hello line's OS login numbers. */
function scrubHello(connection: RecordedConnection): RecordedConnection {
  const first = Buffer.from(connection.inbound[0]!, "base64");
  const newline = first.indexOf(0x0a);
  const line = first.subarray(0, newline).toString("utf8");
  const reply = JSON.parse(line);
  if (reply.result?.login_session)
    reply.result.login_session = { id: 1, user: 1000 };
  const scrubbed = Buffer.concat([
    Buffer.from(JSON.stringify(reply)),
    first.subarray(newline),
  ]);
  return {
    ...connection,
    inbound: [scrubbed.toString("base64"), ...connection.inbound.slice(1)],
  };
}

export async function captureCore(bin: string): Promise<CoreRecording> {
  const core = new ScratchCore(bin, { heartbeatMs: 300 });
  try {
    await core.start();
    let version = "";
    const first = await recordConnection(
      core,
      "observe-then-crash",
      async (client, calls) => {
        version = client.hello.version;
        calls.push("server.status");
        await client.status();
        const seen: CoreTerminalRecord[] = [];
        calls.push("events.subscribe");
        await client.subscribe({
          baseline: () => {},
          line: () => {},
          end: () => {},
        });
        await core.hc(
          "run",
          "--bg",
          "--keep",
          "--name",
          "agent",
          "--",
          "sh",
          "-c",
          AGENT,
        );
        await Bun.sleep(700);
        await core.hc("label", "agent", "note=café ü✓ 漢字");
        await Bun.sleep(700);
        calls.push("terminal.read t1");
        await client.readScreen("t1");
        void seen;
        core.killCore();
      },
    );
    // Holders keep the program and start a new core on the same state.
    let second: RecordedConnection | null = null;
    for (let attempt = 0; attempt < 50 && !second; attempt++) {
      await Bun.sleep(100);
      try {
        second = await recordConnection(
          core,
          "after-restart",
          async (client, calls) => {
            calls.push("server.status");
            await client.status();
            calls.push("events.subscribe");
            await client.subscribe({
              baseline: () => {},
              line: () => {},
              end: () => {},
            });
            await Bun.sleep(700);
            client.close();
          },
        );
      } catch {
        second = null;
      }
    }
    if (!second) throw new Error("core did not come back after kill -9");
    return {
      core_version: version,
      scenario:
        "subscribe; run a kept agent reporting OSC 7501 working then done; label with multi-byte UTF-8; heartbeats; read lines:0; kill -9 of core; reconnect to the holder-respawned core",
      connections: [scrubHello(first), scrubHello(second)],
    };
  } finally {
    await core.dispose();
  }
}

/**
 * Agents that keep running, as a real harness does: core clears a status
 * once the root shell is back in the foreground (`exec sh` above).
 */
const FINISHING = [
  "printf '\\033]7501;state=working\\033\\\\'",
  "sleep 0.3",
  "printf '\\033]7501;state=done\\033\\\\'",
  "sleep 60",
].join("; ");
/** Works, then stops to ask a question (fields are `:`-separated). */
const ASKING = [
  "printf '\\033]7501;state=working\\033\\\\'",
  "sleep 0.3",
  "printf '\\033]7501;state=blocked:kind=question\\033\\\\'",
  "sleep 60",
].join("; ");

/**
 * Seen and favourite shared with another Herdr client: World raises
 * `herdr.seen` for a finished turn, the other client (the CLI standing in
 * for Herdr's app) marks it unread and pins it, World unpins it, and a
 * second agent stops to ask (push). World's own calls are recorded.
 */
export async function captureSharedState(bin: string): Promise<CoreRecording> {
  const core = new ScratchCore(bin, { heartbeatMs: 300 });
  try {
    await core.start();
    let version = "";
    const connection = await recordConnection(
      core,
      "shared-seen-and-favourite",
      async (client, calls) => {
        version = client.hello.version;
        calls.push("server.status");
        await client.status();
        calls.push("events.subscribe");
        await client.subscribe({
          baseline: () => {},
          line: () => {},
          end: () => {},
        });
        await core.hc(
          "run",
          "--bg",
          "--keep",
          "--name",
          "agent",
          "--",
          "sh",
          "-c",
          FINISHING,
        );
        await Bun.sleep(700);
        calls.push("terminal.label t1 herdr.seen=1");
        await client.shareLabel("t1", { "herdr.seen": "1" });
        await Bun.sleep(300);
        // The other client: mark unread (turn - 1), then pin.
        await core.hc("label", "agent", "herdr.seen=0");
        await Bun.sleep(300);
        await core.hc("label", "agent", "herdr.pinned=1");
        await Bun.sleep(300);
        calls.push("terminal.label t1 herdr.pinned=");
        await client.shareLabel("t1", { "herdr.pinned": "" });
        await Bun.sleep(300);
        await core.hc(
          "run",
          "--bg",
          "--keep",
          "--name",
          "asker",
          "--",
          "sh",
          "-c",
          ASKING,
        );
        await Bun.sleep(700);
        client.close();
      },
    );
    return {
      core_version: version,
      scenario:
        "subscribe; a kept agent works then finishes (turn 1); World writes herdr.seen=1; another client marks it unread (herdr.seen=0) and pins it (herdr.pinned=1); World unpins it (herdr.pinned=); a second agent works then blocks on a question",
      connections: [scrubHello(connection)],
    };
  } finally {
    await core.dispose();
  }
}

/** A program printing a 4-byte character in two writes, then more lines. */
const WATCHED = [
  "printf 'ready \\342\\234\\223\\r\\n'",
  "sleep 0.6",
  "printf 'split \\360\\237'",
  "sleep 0.3",
  "printf '\\230\\200 done\\r\\n'",
  "sleep 0.6",
  "printf 'after resize\\r\\n'",
  "sleep 0.8",
  "printf 'headless now\\r\\n'",
  "exec sleep 600",
].join("; ");

/**
 * World watches an agent while a desktop pane leads its size: the pane
 * attaches at 120x40, resizes to 90x25, closes (headless), then core is
 * killed mid-stream. Every byte World read is recorded.
 */
export async function captureWatch(bin: string): Promise<CoreRecording> {
  const core = new ScratchCore(bin, { heartbeatMs: 300 });
  try {
    await core.start();
    let version = "";
    const pane = await desktopPane(core);
    const sizes: Array<[number, number]> = [];
    const watched = await recordConnection(
      core,
      "watch-then-crash",
      async (client, calls) => {
        version = client.hello.version;
        await core.hc(
          "run",
          "--bg",
          "--name",
          "agent",
          "--",
          "sh",
          "-c",
          WATCHED,
        );
        await pane.attach("t1", 120, 40);
        calls.push("terminal.attach t1 observe");
        await client.watch(
          "t1",
          { cols: 120, rows: 40 },
          {
            resize: (cols, rows) => sizes.push([cols, rows]),
            data: () => {},
            close: () => {},
          },
        );
        await Bun.sleep(1_200);
        pane.resize(90, 25);
        await Bun.sleep(700);
        pane.detach();
        await Bun.sleep(900);
        core.killCore();
      },
    );
    pane.close();
    const after = JSON.parse(await core.hc("get", "agent", "--json"));
    return {
      core_version: version,
      scenario: `watch t1 (observe, resize_notifications) while an interactive pane attaches at 120x40, resizes to 90x25 and detaches; a 4-byte character split across writes; kill -9 of core mid-stream. Grids World received: ${sizes.map((s) => s.join("x")).join(", ")}; after restart the terminal is ${after.cols}x${after.rows}`,
      connections: [scrubHello(watched)],
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
      "usage: HERDR_CORE_BIN=<herdr-core> bun capture-core.ts <out.json> [watch|shared]",
    );
    process.exit(2);
  }
  const recording =
    process.argv[3] === "watch"
      ? await captureWatch(bin)
      : process.argv[3] === "shared"
        ? await captureSharedState(bin)
        : await captureCore(bin);
  writeFileSync(out, `${JSON.stringify(recording, null, 1)}\n`);
  console.log(`recorded ${recording.core_version}: ${out}`);
}
