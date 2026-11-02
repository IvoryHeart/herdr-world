import type * as Fs from "node:fs/promises";
import type { createUsageProjection, NumericUsageRow } from "./projection";
import type { UsageState } from "../../../shared/usage";

export type HostUsage = {
  rows: (NumericUsageRow & {
    harness: string;
    session_key: string;
    file_keys: string[];
    partial: boolean;
  })[];
  sources: { harness: string; state: UsageState }[];
  truncated: boolean;
};
export type CollectorOptions = {
  now: number;
  /** Exact paths resolved by this runtime, never supplied by the browser. */
  files?: { harness: string; path: string }[];
};
export type CollectorPorts = {
  fs: typeof Fs;
  home: string;
  env: Record<string, string | undefined>;
  join(...parts: string[]): string;
  hash(value: string): string;
  decompress?(value: Uint8Array): Uint8Array | Promise<Uint8Array>;
};

/** Self-contained, with explicit builtin ports, so SSH executes this same code.
 * No transcript content or paths survive in its result. */
export async function collectHarnessUsage(
  options: CollectorOptions,
  project: typeof createUsageProjection,
  ports: CollectorPorts,
): Promise<HostUsage> {
  const { fs, home, env, join, hash } = ports;
  const start =
    Math.floor(options.now / 86_400_000) * 86_400_000 - 6 * 86_400_000;
  const expand = (value: string) =>
    value === "~"
      ? home
      : value.startsWith("~/")
        ? join(home, value.slice(2))
        : value;
  const configured = (name: string, fallback: string) =>
    expand(env[name]?.trim() || fallback);
  const roots = [
    [
      "claude",
      join(configured("CLAUDE_CONFIG_DIR", join(home, ".claude")), "projects"),
    ],
    ["codex", join(configured("CODEX_HOME", join(home, ".codex")), "sessions")],
    [
      "codex",
      join(configured("CODEX_HOME", join(home, ".codex")), "archived_sessions"),
    ],
    [
      "pi",
      join(
        configured("PI_CODING_AGENT_DIR", join(home, ".pi", "agent")),
        "sessions",
      ),
    ],
    ["gemini", join(home, ".gemini", "tmp")],
  ];
  const states = new Map<string, UsageState>(
    ["claude", "codex", "pi", "gemini"].map((h) => [h, "missing"]),
  );
  const candidates = new Map<
    string,
    { harness: string; path: string; size: number; mtime: number }
  >();
  const sessions = new Map<
    string,
    { harness: string; reader: ReturnType<typeof project>; files: Set<string> }
  >();
  const visits = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  let bytes = 0,
    lines = 0,
    truncated = false;
  const deadline = performance.now() + 10_000;
  const fail = (h: string) => {
    states.set(h, "partial");
  };
  const visit = (harness: string) => {
    const count = (visits.get(harness) ?? 0) + 1;
    visits.set(harness, count);
    return count <= 2048;
  };
  async function add(harness: string, path: string, priority = false) {
    try {
      const info = await fs.lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs < start)
        return;
      if (candidates.has(path)) return;
      if (
        candidates.size >= 384 ||
        (!priority && (fileCounts.get(harness) ?? 0) >= 64)
      ) {
        truncated = true;
        fail(harness);
        return;
      }
      candidates.set(path, {
        harness,
        path,
        size: info.size,
        mtime: info.mtimeMs,
      });
      fileCounts.set(harness, (fileCounts.get(harness) ?? 0) + 1);
    } catch {
      fail(harness);
    }
  }
  async function walk(harness: string, directory: string, depth: number) {
    if (!visit(harness) || depth > 8 || performance.now() > deadline) {
      truncated = true;
      fail(harness);
      return;
    }
    let directoryHandle;
    try {
      directoryHandle = await fs.opendir(directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") fail(harness);
      return;
    }
    if (states.get(harness) === "missing") states.set(harness, "available");
    try {
      for await (const entry of directoryHandle) {
        if (!visit(harness)) {
          truncated = true;
          fail(harness);
          break;
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(harness, path, depth + 1);
        else if (
          entry.isFile() &&
          /\.(jsonl|jsonl\.zst|json)$/.test(entry.name) &&
          (harness !== "gemini" || /^session-/.test(entry.name))
        )
          await add(harness, path);
      }
    } catch {
      fail(harness);
    }
  }
  // Exact bound files get capacity before ordinary inventory.
  for (const f of (options.files ?? []).slice(0, 128))
    if (states.has(f.harness)) await add(f.harness, f.path, true);
  for (const [harness, root] of roots) await walk(harness!, root!, 0);
  for (const file of [...candidates.values()].sort(
    (a, b) => b.mtime - a.mtime,
  )) {
    if (
      performance.now() > deadline ||
      bytes >= 256 * 1024 * 1024 ||
      lines > 500_000
    ) {
      truncated = true;
      for (const harness of states.keys()) fail(harness);
      break;
    }
    const { harness, path } = file;
    if (path.endsWith(".zst") && candidates.has(path.slice(0, -4))) continue;
    let current:
      | {
          harness: string;
          reader: ReturnType<typeof project>;
          files: Set<string>;
        }
      | undefined;
    let broken = false,
      perFile = 0;
    const feed = (record: any) => {
      const id =
        record?.sessionId ??
        (record?.type === "session_meta"
          ? record.payload?.id
          : record?.type === "session"
            ? record.id
            : undefined);
      if (!current) {
        const key = hash(
          `${harness}\0${typeof id === "string" && id.length <= 256 ? id : path.replace(/\.zst$/, "")}`,
        );
        current = sessions.get(key);
        if (!current) {
          current = {
            harness,
            reader: project(harness, options.now),
            files: new Set(),
          };
          sessions.set(key, current);
        }
        if (current.files.size < 16)
          current.files.add(hash(path.replace(/\.zst$/, "")));
        else {
          current.reader.incomplete();
          truncated = true;
        }
      }
      current.reader.accept(record);
    };
    const parse = (line: string) => {
      if (!line.trim()) return;
      if (++lines > 500_000 || line.length > 4 * 1024 * 1024) {
        broken = true;
        return;
      }
      try {
        feed(JSON.parse(line));
      } catch {
        broken = true;
      }
    };
    try {
      if (path.endsWith(".json") || path.endsWith(".zst")) {
        if (
          file.size > 16 * 1024 * 1024 ||
          bytes + file.size > 256 * 1024 * 1024
        ) {
          truncated = true;
          fail(harness);
          continue;
        }
        let raw: Uint8Array = await fs.readFile(path);
        bytes += raw.byteLength;
        if (path.endsWith(".zst")) {
          if (!ports.decompress) {
            fail(harness);
            continue;
          }
          raw = await ports.decompress(raw);
          bytes += Math.max(0, raw.byteLength - file.size);
        }
        if (raw.byteLength > 64 * 1024 * 1024) {
          truncated = true;
          fail(harness);
          continue;
        }
        const text = Buffer.from(raw).toString("utf8");
        if (path.endsWith(".json")) {
          try {
            feed(JSON.parse(text));
          } catch {
            broken = true;
          }
        } else for (const line of text.split("\n")) parse(line);
      } else {
        const handle = await fs.open(path, "r");
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const decoder = new TextDecoder();
          let tail = "",
            skipping = false;
          while (true) {
            if (
              perFile >= 64 * 1024 * 1024 ||
              bytes >= 256 * 1024 * 1024 ||
              lines > 500_000 ||
              performance.now() > deadline
            ) {
              truncated = true;
              broken = true;
              break;
            }
            const { bytesRead } = await handle.read(buffer, 0, buffer.length);
            if (!bytesRead) break;
            perFile += bytesRead;
            bytes += bytesRead;
            tail += decoder.decode(buffer.subarray(0, bytesRead), {
              stream: true,
            });
            let end;
            while ((end = tail.indexOf("\n")) >= 0) {
              if (!skipping) parse(tail.slice(0, end));
              skipping = false;
              tail = tail.slice(end + 1);
            }
            if (tail.length > 4 * 1024 * 1024) {
              tail = "";
              skipping = true;
              broken = true;
            }
          }
          // An append-in-progress fragment is a disclosed partial read.
          if (tail || skipping) broken = true;
        } finally {
          await handle.close();
        }
      }
    } catch {
      broken = true;
    }
    if (broken) {
      current?.reader.incomplete();
      fail(harness);
    }
  }
  const result: HostUsage = { rows: [], sources: [], truncated };
  for (const [session_key, session] of sessions) {
    const projected = session.reader.finish();
    if (projected.partial) fail(session.harness);
    for (const row of projected.rows) {
      if (result.rows.length >= 1024) {
        result.truncated = true;
        fail(session.harness);
        break;
      }
      result.rows.push({
        ...row,
        harness: session.harness,
        session_key,
        file_keys: [...session.files],
        partial: projected.partial,
      });
    }
  }
  for (const [harness, state] of states)
    if (
      state === "available" &&
      !result.rows.some((r) => r.harness === harness)
    )
      states.set(harness, "missing");
  result.sources = [...states].map(([harness, state]) => ({ harness, state }));
  while (
    Buffer.byteLength(JSON.stringify(result)) > 512 * 1024 &&
    result.rows.length
  ) {
    fail(result.rows.pop()!.harness);
    result.truncated = true;
    result.sources = [...states].map(([harness, state]) => ({
      harness,
      state,
    }));
  }
  return result;
}
