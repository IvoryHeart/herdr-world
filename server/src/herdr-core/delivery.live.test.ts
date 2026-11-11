import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CoreClient } from "./client";
import { deliverCore } from "./delivery";
import { deliverLaunchBrief } from "./launch-brief";
import { CoreOperationFence } from "./fence";
import { coreRecipientToken } from "./recipient";
import { connectUnixStream } from "./stream";
import { connectedLive, until } from "./testing/live-world";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";
import { encodeFrame, FrameKind } from "./wire";

/**
 * Session input against a real herdr-core release (M4, §8): a message
 * arrives once; a kept replacement shell is refused before dispatch; and
 * a send core holds for a person's draft is cancelled when the agent is
 * replaced, where core alone would type it into the shell (upstream Q3).
 * Opt in with HERDR_CORE_BIN=<official binary>; Linux only, scratch
 * HOME/XDG directories, every process killed after.
 */
const bin = scratchCoreBinary();
const live = bin ? test : test.skip;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A synthetic harness: reports OSC 7501 status (`app=probe`) and logs each
 * line it reads, so a test sees exactly what reached the agent.
 */
const AGENT = `#!/bin/sh
log="$1"
printf '\\033]7501;state=%s:app=probe\\033\\\\' "\${2:-idle}"
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$log"
  printf '\\033]7501;state=working:app=probe\\033\\\\'
  printf '\\033]7501;state=idle:app=probe\\033\\\\'
done
`;

async function scratchWorld() {
  const core = new ScratchCore(bin!);
  cleanups.push(() => core.dispose());
  // A person's unsent draft holds sends for at most this long (core's
  // `HC_DRAFT_MS`, 60 s by default): long enough to replace the agent.
  core.env.HC_DRAFT_MS = "4000";
  await core.start();
  const w = await connectedLive(core.stateDir);
  cleanups.push(() => rmSync(w.root, { recursive: true, force: true }));
  cleanups.push(w.stop);
  const script = join(core.root, "agent.sh");
  writeFileSync(script, AGENT, { mode: 0o700 });
  const log = join(core.root, "agent.log");
  const read = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const start = async (name: string, status = "idle") => {
    const run = JSON.parse(
      await core.hc(
        "run",
        "--json",
        "--bg",
        "--keep",
        "--name",
        name,
        "--",
        script,
        log,
        status,
      ),
    ) as { address: string };
    // Reporting, and past core's startup settle for a first paste.
    await until(
      () =>
        w.record(run.address)?.reported === true &&
        Boolean(w.record(run.address)?.foreground),
      10_000,
    );
    return run.address;
  };
  const token = (address: string) =>
    coreRecipientToken(
      w.lease().runtime.core.epoch!.coreId,
      w.record(address),
      w.lease().runtime.core.occupancy(address),
    )!;
  const screen = async (name: string) =>
    (JSON.parse(await core.hc("read", "--json", name)) as { text?: string })
      .text ?? "";
  /** A person at the terminal: attached interactively, typing. */
  const person = async (address: string) => {
    const socket = readFileSync(
      join(core.stateDir, "core.lock"),
      "utf8",
    ).trim();
    const client = await CoreClient.open(
      await connectUnixStream(socket, new AbortController().signal),
    );
    cleanups.push(() => client.close());
    // World's client has no attach yet (#867); this test speaks it directly.
    const raw = client as unknown as {
      call(
        method: string,
        params: unknown,
        timeoutMs: number,
      ): Promise<{ channel: number }>;
      send(bytes: Uint8Array): void;
    };
    const { channel } = await raw.call(
      "terminal.attach",
      { terminal: address, cols: 80, rows: 24 },
      5_000,
    );
    return (text: string) =>
      raw.send(
        encodeFrame(channel, FrameKind.DATA, new TextEncoder().encode(text)),
      );
  };
  return { core, w, start, token, read, screen, person };
}

describe("World's session input to a real herdr-core", () => {
  live(
    "a silent harness trust dialog receives no automatic brief or Enter",
    async () => {
      const s = await scratchWorld();
      // cat reports no OSC status and records/echoes every byte it receives.
      // Its executable has a supported generic harness name, without credentials.
      const executable = join(s.core.root, "copilot");
      copyFileSync("/bin/cat", executable);
      const run = JSON.parse(
        await s.core.hc(
          "run",
          "--json",
          "--bg",
          "--keep",
          "--name",
          "silent",
          "--",
          executable,
        ),
      );
      await until(() => Boolean(s.w.record(run.address)?.foreground));
      const record = s.w.record(run.address)!;
      expect(record.reported).toBe(false);
      expect(
        await deliverLaunchBrief(s.w.lease(), record, "AUTO-BRIEF"),
      ).toMatchObject({
        status: "refused",
        message: expect.stringContaining("Open Chat to send the brief"),
      });
      expect(await s.screen("silent")).toBe("");
    },
    30_000,
  );

  for (const status of ["blocked", "working", "idle"])
    live(
      `automatic launch brief with native ${status} status`,
      async () => {
        const s = await scratchWorld();
        const address = await s.start("probe", status);
        const outcome = await deliverLaunchBrief(
          s.w.lease(),
          s.w.record(address)!,
          "AUTO-BRIEF",
        );
        expect(outcome.status).toBe(status === "idle" ? "sent" : "refused");
        expect(s.read()).toBe(status === "idle" ? "AUTO-BRIEF\n" : "");
      },
      30_000,
    );

  live(
    "a message reaches the agent once, through core's send",
    async () => {
      const s = await scratchWorld();
      const t = await s.start("probe");
      const outcome = await deliverCore(s.w.lease(), t, s.token(t), {
        kind: "message",
        text: "hello once",
      });
      expect(outcome).toMatchObject({ status: "sent", started: true });
      await until(() => s.read().includes("hello once"));
      await Bun.sleep(500);
      expect(s.read()).toBe("hello once\n");
    },
    30_000,
  );

  live(
    "a kept replacement shell is refused; nothing is typed into it",
    async () => {
      const s = await scratchWorld();
      const t = await s.start("probe");
      const token = s.token(t);
      const pid = s.w.record(t)!.pid as number;
      process.kill(pid, "SIGKILL");
      // Core keeps the terminal and starts the user's shell at the address.
      await until(
        () =>
          typeof s.w.record(t)?.pid === "number" && s.w.record(t)?.pid !== pid,
        10_000,
      );
      expect(s.w.record(t)?.argv).toEqual(["/bin/sh"]);
      const outcome = await deliverCore(s.w.lease(), t, token, {
        kind: "message",
        text: "echo REACHED-SHELL",
      });
      expect(outcome).toMatchObject({ status: "refused", reason: "changed" });
      await Bun.sleep(500);
      expect(await s.screen("probe")).not.toContain("REACHED-SHELL");
    },
    30_000,
  );

  live(
    "a held send is cancelled when the agent is replaced",
    async () => {
      const s = await scratchWorld();
      const t = await s.start("probe");
      const token = s.token(t);
      const type = await s.person(t);
      type("a draft"); // core holds sends until it is sent or cleared
      await Bun.sleep(300);
      const pending = deliverCore(s.w.lease(), t, token, {
        kind: "message",
        text: "echo HELD-REACHED-SHELL",
      });
      await Bun.sleep(500);
      process.kill(s.w.record(t)!.pid as number, "SIGKILL");
      const outcome = await pending;
      expect(outcome).toMatchObject({ status: "refused", reason: "changed" });
      expect(outcome.status === "refused" && outcome.message).toContain(
        "World cancelled the input while herdr-core held it",
      );
      await until(() => s.w.record(t)?.argv?.[0] === "/bin/sh", 10_000);
      await Bun.sleep(1_000);
      expect(await s.screen("probe")).not.toContain("HELD-REACHED-SHELL");
      expect(s.read()).not.toContain("HELD-REACHED-SHELL");
    },
    30_000,
  );

  live(
    "control: core alone types a held send into the replacement (Q3)",
    async () => {
      const s = await scratchWorld();
      const t = await s.start("probe");
      const type = await s.person(t);
      type("a draft");
      await Bun.sleep(300);
      // The same send with nobody watching the occupant, as any client.
      const lease = s.w.lease();
      const pending = lease.runtime.send(
        CoreOperationFence.admit(lease, t),
        { text: "echo Q3-WINDOW", force: false },
        { cancel: new AbortController().signal },
      );
      await Bun.sleep(500);
      process.kill(s.w.record(t)!.pid as number, "SIGKILL");
      await pending;
      await until(
        async () => (await s.screen("probe")).includes("Q3-WINDOW"),
        10_000,
      );
    },
    30_000,
  );

  live(
    "a waiting agent: core refuses a message and takes a typed answer",
    async () => {
      const s = await scratchWorld();
      const t = await s.start("probe", "blocked");
      expect(
        await deliverCore(s.w.lease(), t, s.token(t), {
          kind: "message",
          text: "not now",
        }),
      ).toMatchObject({ status: "refused", reason: "waiting" });
      expect(
        await deliverCore(s.w.lease(), t, s.token(t), {
          kind: "answer",
          text: "main",
        }),
      ).toMatchObject({ status: "sent" });
      await until(() => s.read().includes("main"));
      expect(s.read()).toBe("main\n");
    },
    30_000,
  );

  live(
    "answer keys reach the waiting program through core's key encoder",
    async () => {
      const s = await scratchWorld();
      const t = await s.start("probe", "blocked");
      expect(
        await deliverCore(s.w.lease(), t, s.token(t), {
          kind: "keys",
          keys: ["m", "a", "i", "n", "enter"],
        }),
      ).toMatchObject({ status: "sent" });
      await until(() => s.read().includes("main"));
      expect(s.read()).toBe("main\n");
    },
    30000,
  );
});
