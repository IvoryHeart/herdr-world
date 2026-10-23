import { sshCommandArgv } from "../bridge/ssh-command";
import { isRecord } from "./session-utils";

/** Read-only evidence, never an authenticated pane/thread identity. */
export type CodexDaemonThread = {
  id: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "active" | "notLoaded";
  waiting: boolean;
};

const TIMEOUT_MS = 3000;
const MAX_BYTES = 1024 * 1024;
const MAX_THREADS = 500;
const THREAD_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** null means the source cannot safely exclude a potential TUI competitor. */
function interactiveSource(source: unknown): boolean | null {
  if (source === "cli" || source === "vscode") return true;
  if (source === "exec" || source === "appServer") return false;
  if (!isRecord(source) || Object.keys(source).length !== 1) return null;
  if (typeof source.custom === "string") return false;
  const subagent = source.subAgent;
  if (
    subagent === "review" ||
    subagent === "compact" ||
    subagent === "memory_consolidation"
  )
    return false;
  if (!isRecord(subagent) || Object.keys(subagent).length !== 1) return null;
  if (typeof subagent.other === "string") return false;
  const spawned = subagent.thread_spawn;
  if (
    isRecord(spawned) &&
    typeof spawned.parent_thread_id === "string" &&
    THREAD_ID.test(spawned.parent_thread_id) &&
    typeof spawned.depth === "number" &&
    Number.isSafeInteger(spawned.depth) &&
    spawned.depth >= 0 &&
    [spawned.agent_path, spawned.agent_nickname, spawned.agent_role].every(
      (value) => value === null || typeof value === "string",
    )
  )
    return false;
  return null;
}

export function codexDaemonProxyArgv(sshHost?: string) {
  return sshHost
    ? sshCommandArgv(sshHost, "bash -lc 'exec codex app-server proxy'")
    : ["codex", "app-server", "proxy"];
}

/**
 * Connect to an existing daemon only. `proxy` does not start one. Never resume,
 * subscribe to, or send input to threads. A partial listing proves no uniqueness.
 * The same transport runs on the selected SSH host; there is no local fallback.
 */
export async function listCodexDaemonThreads(
  cwd: string | undefined,
  options: { sshHost?: string; argv?: string[]; timeoutMs?: number } = {},
): Promise<CodexDaemonThread[] | null> {
  let child;
  try {
    child = Bun.spawn(options.argv ?? codexDaemonProxyArgv(options.sshHost), {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
  } catch {
    return null;
  }
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let stopped = false;
  const fail = () => {
    if (stopped) return;
    stopped = true;
    for (const request of pending.values())
      request.reject(new Error("Codex discovery unavailable"));
    pending.clear();
    child.kill("SIGKILL");
  };
  const timer = setTimeout(fail, options.timeoutMs ?? TIMEOUT_MS);
  const reader = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    let bytes = 0;
    try {
      for await (const chunk of child.stdout) {
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) throw new Error("Codex listing too large");
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const message: unknown = JSON.parse(line);
          if (!isRecord(message)) throw new Error("Invalid Codex response");
          if (message.method || typeof message.id !== "number") continue;
          const request = pending.get(message.id);
          if (!request) continue;
          pending.delete(message.id);
          if (message.error) request.reject(new Error("Codex request failed"));
          else request.resolve(message.result);
        }
      }
    } catch {
      // Unavailable, malformed and oversized responses all fail closed.
    } finally {
      fail();
    }
  })();
  let sequence = 0;
  const request = (method: string, params: unknown) => {
    if (stopped) throw new Error("Codex proxy closed");
    const id = ++sequence;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        Promise.resolve(child.stdin.flush()).catch((error) => {
          pending.delete(id);
          reject(error);
        });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };
  try {
    await request("initialize", {
      clientInfo: { name: "herdr_world_history", version: "1" },
      capabilities: { experimentalApi: false },
    });
    child.stdin.write('{"method":"initialized"}\n');
    await child.stdin.flush();
    const threads: CodexDaemonThread[] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const result = await request("thread/list", {
        cwd,
        cursor,
        limit: 100,
        modelProviders: [],
        sourceKinds: ["cli", "vscode"],
        archived: false,
        useStateDbOnly: true,
      });
      if (
        !isRecord(result) ||
        !Array.isArray(result.data) ||
        !(result.nextCursor === null || typeof result.nextCursor === "string")
      )
        return null;
      for (const item of result.data) {
        if (
          !isRecord(item) ||
          typeof item.id !== "string" ||
          !THREAD_ID.test(item.id) ||
          !(
            item.parentThreadId === null ||
            (typeof item.parentThreadId === "string" &&
              THREAD_ID.test(item.parentThreadId))
          ) ||
          typeof item.cwd !== "string" ||
          !item.cwd ||
          typeof item.createdAt !== "number" ||
          !Number.isFinite(item.createdAt) ||
          typeof item.updatedAt !== "number" ||
          !Number.isFinite(item.updatedAt) ||
          !isRecord(item.status) ||
          seen.has(item.id.toLowerCase())
        )
          return null;
        seen.add(item.id.toLowerCase());
        if (seen.size > MAX_THREADS) return null;
        if (cwd !== undefined && item.cwd !== cwd) return null;
        const interactive = interactiveSource(item.source);
        if (interactive === null) return null;
        if (
          item.status.type !== "idle" &&
          item.status.type !== "active" &&
          item.status.type !== "notLoaded"
        )
          return null;
        // A child thread is not the conversation a TUI displays.
        if (item.parentThreadId !== null || !interactive) continue;
        if (
          item.status.type === "active" &&
          (!Array.isArray(item.status.activeFlags) ||
            item.status.activeFlags.some(
              (flag) =>
                !["waitingOnApproval", "waitingOnUserInput"].includes(flag),
            ))
        )
          return null;
        threads.push({
          id: item.id.toLowerCase(),
          cwd: item.cwd,
          createdAt: item.createdAt * 1000,
          updatedAt: item.updatedAt * 1000,
          status: item.status.type,
          waiting:
            Array.isArray(item.status.activeFlags) &&
            item.status.activeFlags.some((flag) =>
              ["waitingOnApproval", "waitingOnUserInput"].includes(flag),
            ),
        });
      }
      cursor = result.nextCursor;
      if (
        cursor !== null &&
        (cursors.has(cursor) || cursors.size >= 5 || seen.size >= MAX_THREADS)
      )
        return null;
      if (cursor !== null) cursors.add(cursor);
    } while (cursor !== null);
    return threads;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    fail();
    await Promise.all([reader, child.exited]);
  }
}
