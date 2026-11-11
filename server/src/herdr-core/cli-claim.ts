import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CoreClient, type CoreTerminalRecord } from "./client";
import { connectUnixStream } from "./stream";

/**
 * Which herdr-core terminal a command runs in, verified (§4.10). Core gives
 * every terminal `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET`; those are only a
 * claim (any process can set them). The claim holds when that core, asked
 * directly on that socket, has the terminal live and its program is an
 * ancestor of this process. A direct socket connect never starts a core.
 */
export type CoreCallerClaim = {
  client: CoreClient;
  coreId: string;
  address: string;
  record: CoreTerminalRecord;
  /** Processes between this one and the terminal's program (1 = its child). */
  distance: number;
};

export type ClaimDeps = {
  env?: Record<string, string | undefined>;
  pid?: number;
  /** The parent of a process, or null when unknown. */
  parentOf?: (pid: number) => Promise<number | null>;
  open?: (socket: string) => Promise<CoreClient>;
};

/** `ps` is portable; Linux reads /proc without a process per step. */
async function parentOfPid(pid: number): Promise<number | null> {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    // Field 4, after the parenthesised command (which may hold spaces).
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isSafeInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {}
  try {
    const proc = Bun.spawn(["ps", "-o", "ppid=", "-p", String(pid)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    const ppid = Number(out);
    return Number.isSafeInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

/** How many steps up from `pid` `ancestor` is, or null if it is not one. */
export async function ancestorDistance(
  pid: number,
  ancestor: number,
  parentOf: (pid: number) => Promise<number | null> = parentOfPid,
): Promise<number | null> {
  let current: number | null = pid;
  for (let steps = 0; current && steps < 64; steps += 1) {
    if (current === ancestor) return steps;
    if (current === 1) return null;
    current = await parentOf(current);
  }
  return null;
}

export function coreClaimInEnvironment(
  env: Record<string, string | undefined> = process.env,
): { address: string; socket: string } | null {
  const address = env.HC_TERMINAL_ID;
  const socket = env.HC_TERMINAL_SOCKET;
  if (
    !address ||
    !/^t[1-9][0-9]{0,9}$/.test(address) ||
    !socket ||
    !isAbsolute(socket)
  )
    return null;
  return { address, socket };
}

export async function verifyCoreCaller(
  deps: ClaimDeps = {},
): Promise<CoreCallerClaim> {
  const claim = coreClaimInEnvironment(deps.env ?? process.env);
  if (!claim) throw new Error("not inside a herdr-core terminal");
  const client = await (
    deps.open ??
    (async (socket: string) =>
      CoreClient.open(
        await connectUnixStream(socket, new AbortController().signal),
      ))
  )(claim.socket);
  try {
    const record = await client.getTerminal(claim.address);
    if (record?.state !== "live" || typeof record.pid !== "number")
      throw new Error(`herdr-core has no live ${claim.address}`);
    const distance = await ancestorDistance(
      deps.pid ?? process.pid,
      record.pid,
      deps.parentOf,
    );
    if (distance === null || distance < 1)
      throw new Error(
        `this command does not run inside herdr-core terminal ${claim.address}`,
      );
    return {
      client,
      coreId: client.hello.core.id,
      address: claim.address,
      record,
      distance,
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

/** Reads an ancestor's environment (Linux), or null when it cannot. */
function environmentOf(pid: number): Map<string, string> | null {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "latin1");
    return new Map(
      raw
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const at = entry.indexOf("=");
          return [entry.slice(0, at), entry.slice(at + 1)] as const;
        }),
    );
  } catch {
    return null;
  }
}

/**
 * When both runtimes' markers are present, which one this command runs in:
 * the runtime whose terminal is the nearest ancestor. A core started inside
 * a TUI pane passes the pane's `HERDR_PANE_ID` to its terminals; a TUI
 * started inside a core terminal passes `HC_TERMINAL_ID` to its panes. The
 * TUI pane's shell is the topmost ancestor still carrying the pane ID.
 * Null when that cannot be told (no readable ancestor environments).
 */
export async function nearerRuntime(
  core: CoreCallerClaim,
  paneId: string,
  deps: {
    pid?: number;
    parentOf?: (pid: number) => Promise<number | null>;
    environment?: (pid: number) => Map<string, string> | null;
  } = {},
): Promise<"herdr-core" | "herdr" | null> {
  const parentOf = deps.parentOf ?? parentOfPid;
  const environment = deps.environment ?? environmentOf;
  let current: number | null = deps.pid ?? process.pid;
  let tuiDistance: number | null = null;
  for (let steps = 0; current && current !== 1 && steps < 64; steps += 1) {
    const env = environment(current);
    if (!env) return null;
    if (env.get("HERDR_PANE_ID") !== paneId) break;
    tuiDistance = steps;
    current = await parentOf(current);
  }
  if (tuiDistance === null) return "herdr-core";
  if (tuiDistance === core.distance) return null;
  return core.distance < tuiDistance ? "herdr-core" : "herdr";
}
