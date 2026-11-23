import { existsSync, readFileSync } from "node:fs";
import type { WorldSnapshotResult } from "../server/src/world/snapshot-types";
import {
  assertIsolation,
  type Kit,
  paths,
  processHelper,
  run,
  startKit,
  stopKit,
} from "./runtime-isolated-kit";

/** Browser RPC, with a bounded event-driven snapshot wait instead of polling. */
export async function worldProbe(kit: Kit) {
  const base = `http://127.0.0.1:${kit.port}`;
  const password = readFileSync(
    `${paths(kit).world}/auth-token`,
    "utf8",
  ).trim();
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(5000),
  });
  if (!login.ok)
    throw new Error(`isolated World login failed (${login.status})`);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  const BrowserSocket = WebSocket as unknown as new (
    url: string,
    options: Bun.WebSocketOptions,
  ) => WebSocket;
  const ws = new BrowserSocket(`${base.replace("http:", "ws:")}/ws`, {
    headers: { cookie: cookie ?? "" },
  });
  const pending = new Map<
    string,
    { resolve(value: WorldSnapshotResult): void; reject(error: Error): void }
  >();
  let sequence = 0;
  let changed = () => {};
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const reply = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) reply.reject(new Error(JSON.stringify(message.error)));
      else reply.resolve(message.result);
    } else changed();
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("World websocket timed out")),
      5000,
    );
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("World websocket failed"));
    };
  }).catch((error) => {
    ws.close();
    throw error;
  });
  return {
    close() {
      ws.close();
    },
    until(predicate: (value: WorldSnapshotResult) => boolean) {
      return new Promise<WorldSnapshotResult>((resolve, reject) => {
        let inFlight = false;
        let dirty = false;
        let finished = false;
        let last: WorldSnapshotResult | undefined;
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `World did not observe both isolated shell agents: ${JSON.stringify(last)?.slice(0, 8000)}`,
              ),
            ),
          20_000,
        );
        const finish = (error?: Error, value?: WorldSnapshotResult) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          changed = () => {};
          if (error) reject(error);
          else resolve(value!);
        };
        const query = () => {
          if (finished) return;
          if (inFlight) {
            dirty = true;
            return;
          }
          inFlight = true;
          dirty = false;
          const id = `kit-${++sequence}`;
          pending.set(id, {
            resolve(value) {
              last = value;
              inFlight = false;
              if (predicate(value)) finish(undefined, value);
              else if (dirty) query();
            },
            reject: (error) => finish(error),
          });
          ws.send(JSON.stringify({ id, method: "world.snapshot", params: {} }));
        };
        changed = query;
        query();
      });
    },
  };
}

export async function selfTest(name: string) {
  let kit: Kit | undefined;
  let probe: Awaited<ReturnType<typeof worldProbe>> | undefined;
  try {
    kit = await startKit(name);
    console.log(
      `start: ${JSON.stringify({ url: `http://127.0.0.1:${kit.port}`, session: kit.session, versions: kit.versions })}`,
    );
    console.log(`status: ${JSON.stringify(await assertIsolation(kit))}`);
    probe = await worldProbe(kit);
    const workspace = JSON.parse(
      await run(kit, [
        kit.binaries.tui,
        "--session",
        kit.session,
        "workspace",
        "create",
        "--cwd",
        `${kit.root}/scratch`,
        "--label",
        "kit-shell",
        "--no-focus",
      ]),
    );
    const pane = workspace.result.root_pane.pane_id;
    await run(kit, [
      kit.binaries.tui,
      "--session",
      kit.session,
      "pane",
      "run",
      pane,
      "printf 'kit-shell-ready\\n'; exec /bin/sh",
    ]);
    await run(kit, [
      kit.binaries.tui,
      "--session",
      kit.session,
      "pane",
      "wait-output",
      pane,
      "--match",
      "kit-shell-ready",
      "--timeout",
      "5000",
    ]);
    const terminal = await run(kit, [
      kit.binaries.core,
      "run",
      "--bg",
      "--json",
      "--name",
      "kit-shell",
      "--no-parent",
      "--no-notify",
      "/bin/sh",
      "-c",
      "printf 'kit-shell-ready\\n'; exec /bin/sh",
    ]);
    const address = JSON.parse(terminal).address;
    console.log(
      `shells started: ${JSON.stringify({ tui_pane: pane, core: JSON.parse(terminal) })}`,
    );
    const snapshot = await probe.until((snapshot) =>
      ["startup-default", "kit-core"].every((id) => {
        const connection = snapshot.connections.find(
          (entry) => entry.connection_id === id,
        );
        return (
          connection?.state === "ready" &&
          !connection.stale &&
          connection.snapshot?.panes.some((entry) =>
            id === "startup-default"
              ? entry.pane_id === pane
              : entry.terminal_id === address || entry.pane_id === address,
          )
        );
      }),
    );
    console.log(
      `agents visible in World: ${JSON.stringify(snapshot.connections.map((entry) => ({ connection_id: entry.connection_id, state: entry.state, stale: entry.stale, panes: entry.snapshot?.panes.map((pane) => ({ pane_id: pane.pane_id, terminal_id: pane.terminal_id })) })))}`,
    );
    await assertIsolation(kit);
    const processes = JSON.parse(
      await processHelper("inspect", kit.token),
    ) as Array<{ pid: number; env: string[] }>;
    const world = processes.find((entry) =>
      entry.env.includes("WORLD_RUNTIME_ROLE=world"),
    );
    if (!world) throw new Error("isolated World process disappeared");
    process.kill(world.pid, "SIGKILL");
    console.log("crash recovery: killed isolated World before stop");
  } finally {
    probe?.close();
    if (kit) await finishSelfTest(kit);
  }
}

async function finishSelfTest(kit: Kit) {
  const receipt = await stopKit(kit);
  const processes = JSON.parse(await processHelper("inspect", kit.token));
  if (existsSync(kit.root) || processes.length)
    throw new Error("self-test cleanup left resources behind");
  console.log(
    `stop: ${JSON.stringify({ ...receipt, folder_removed: true, remaining_processes: processes.length })}`,
  );
}
