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
  /** Private, hashed title-prefix resolutions; never exposed by World usage. */
  title_matches?: { prefix_key: string; session_key: string }[];
};
export type CollectorOptions = {
  now: number;
  /** Exact paths resolved by this runtime, never supplied by the browser. */
  files?: { harness: string; path: string }[];
  codex_prefixes?: string[];
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
  // Numeric retention never proves identity absence. Keep old Codex metadata
  // in a separate bounded inventory so it cannot crowd out current usage.
  const identityOnly: typeof candidates = new Map();
  const needCodexIdentity = (options.codex_prefixes ?? []).some((prefix) =>
    /^[0-9a-f-]{17,36}$/i.test(prefix),
  );
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
      if (!info.isFile() || info.isSymbolicLink()) {
        if (harness === "codex" && needCodexIdentity && info.isSymbolicLink())
          fail(harness);
        return;
      }
      if (candidates.has(path) || identityOnly.has(path)) return;
      if (info.mtimeMs < start) {
        if (harness !== "codex" || !needCodexIdentity) return;
        if (identityOnly.size >= 64) {
          truncated = true;
          fail(harness);
          return;
        }
        identityOnly.set(path, {
          harness,
          path,
          size: info.size,
          mtime: info.mtimeMs,
        });
        return;
      }
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
        if (harness === "codex" && needCodexIdentity && entry.isSymbolicLink())
          fail(harness);
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
  const codexSessions = new Map<string, string>();
  for (const file of [...candidates.values(), ...identityOnly.values()].sort(
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
    if (
      path.endsWith(".zst") &&
      (candidates.has(path.slice(0, -4)) || identityOnly.has(path.slice(0, -4)))
    )
      continue;
    let broken = false,
      fileBytes = 0;
    let materialized: string | undefined;
    const identity = (record: any) => {
      const id =
        record?.sessionId ??
        (record?.type === "session_meta"
          ? record.payload?.id
          : record?.type === "session"
            ? record.id
            : undefined);
      return typeof id === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,159}$/.test(id)
        ? id
        : null;
    };
    // Resolve identity before committing a reader. Preambles retain no content;
    // replaying the prefix into the canonical reader also dedupes copied files.
    const read = async (consume: (record: any) => boolean) => {
      let stop = false;
      const parse = (line: string) => {
        if (stop || !line.trim()) return;
        if (++lines > 500_000 || line.length > 4 * 1024 * 1024) {
          broken = true;
          return;
        }
        try {
          stop = !consume(JSON.parse(line));
        } catch {
          broken = true;
        }
      };
      try {
        if (path.endsWith(".json") || path.endsWith(".zst")) {
          if (materialized === undefined) {
            if (
              file.size > 16 * 1024 * 1024 ||
              bytes + file.size > 256 * 1024 * 1024
            ) {
              truncated = true;
              broken = true;
              return;
            }
            let raw: Uint8Array = await fs.readFile(path);
            bytes += raw.byteLength;
            if (path.endsWith(".zst")) {
              if (!ports.decompress) {
                broken = true;
                return;
              }
              raw = await ports.decompress(raw);
              bytes += Math.max(0, raw.byteLength - file.size);
            }
            if (
              raw.byteLength > 64 * 1024 * 1024 ||
              bytes > 256 * 1024 * 1024
            ) {
              truncated = true;
              broken = true;
              return;
            }
            materialized = Buffer.from(raw).toString("utf8");
          }
          const text = materialized;
          if (path.endsWith(".json")) {
            try {
              consume(JSON.parse(text));
            } catch {
              broken = true;
            }
          } else
            for (const line of text.split("\n")) {
              parse(line);
              if (stop) break;
            }
        } else {
          const handle = await fs.open(path, "r");
          try {
            const buffer = Buffer.alloc(64 * 1024),
              decoder = new TextDecoder();
            let tail = "",
              skipping = false;
            while (!stop) {
              if (
                fileBytes >= 64 * 1024 * 1024 ||
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
              fileBytes += bytesRead;
              bytes += bytesRead;
              tail += decoder.decode(buffer.subarray(0, bytesRead), {
                stream: true,
              });
              let end;
              while (!stop && (end = tail.indexOf("\n")) >= 0) {
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
            if (!stop && (tail || skipping)) broken = true;
          } finally {
            await handle.close();
          }
        }
      } catch {
        broken = true;
      }
    };
    let nativeId: string | null = null;
    await read((record) => {
      nativeId = identity(record);
      return nativeId === null;
    });
    const key = hash(`${harness}\0${nativeId ?? path.replace(/\.zst$/, "")}`);
    if (harness === "codex" && nativeId) codexSessions.set(key, nativeId);
    if (identityOnly.has(path)) {
      if (broken || !nativeId) fail(harness);
      continue;
    }
    let current = sessions.get(key);
    if (!current) {
      current = {
        harness,
        reader: project(harness, options.now),
        files: new Set(),
      };
      sessions.set(key, current);
    }
    if (!nativeId) broken = true; // No canonical identity is explicitly partial.
    if (current.files.size < 16)
      current.files.add(hash(path.replace(/\.zst$/, "")));
    else {
      current.reader.incomplete();
      truncated = true;
    }
    await read((record) => {
      const nextId = identity(record);
      if (nextId && nativeId && nextId !== nativeId) {
        broken = true;
        return false;
      }
      current.reader.accept(record);
      return true;
    });
    if (broken) {
      current.reader.incomplete();
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
  result.title_matches = [];
  if (!result.truncated && states.get("codex") === "available") {
    for (const prefix of (options.codex_prefixes ?? []).slice(0, 128)) {
      if (!/^[0-9a-f-]{17,36}$/i.test(prefix)) continue;
      const matches = [...codexSessions].filter(([, id]) =>
        id.toLowerCase().startsWith(prefix.toLowerCase()),
      );
      if (matches.length === 1)
        result.title_matches.push({
          prefix_key: hash(prefix.toLowerCase()),
          session_key: matches[0]![0],
        });
    }
  }
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
