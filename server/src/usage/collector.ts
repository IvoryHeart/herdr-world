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
  resolve?(path: string): string;
  hash(value: string): string;
  clock?(): number;
  decompress?(value: Uint8Array): Uint8Array | Promise<Uint8Array>;
};
export type CollectorCache = {
  files: Map<
    string,
    {
      path: string;
      harness: string;
      size: number;
      mtime: number;
      identity: string;
      offset: number;
      complete: boolean;
      partial: boolean;
      skip: boolean;
      session: string;
      known: boolean;
      model: string;
      prefixes: string[];
      head: string;
      tail: string;
      verified_day: number;
    }
  >;
  sessions: Map<
    string,
    {
      harness: string;
      reader: ReturnType<typeof createUsageProjection>;
      files: Set<string>;
    }
  >;
  bytes?: number;
  maxEntries?: number;
  maxBytes?: number;
};

/** Self-contained, with explicit builtin ports, so SSH executes this same code.
 * No transcript content or paths survive in its result. */
export async function collectHarnessUsage(
  options: CollectorOptions,
  project: typeof createUsageProjection,
  ports: CollectorPorts,
  suppliedCache?: CollectorCache,
): Promise<HostUsage> {
  const { fs, home, env, join, hash } = ports;
  const cache =
    suppliedCache ??
    ({ files: new Map(), sessions: new Map() } as CollectorCache);
  const start =
    Math.floor(options.now / 86_400_000) * 86_400_000 - 6 * 86_400_000;
  const resolve = ports.resolve ?? ((value: string) => join(value));
  const expand = (value: string) =>
    value === "~"
      ? home
      : value.startsWith("~/")
        ? join(home, value.slice(2))
        : value;
  const configured = (name: string, fallback: string) =>
    resolve(expand(env[name]?.trim() || fallback));
  const configuredRoots = [
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
  const roots: { harness: string; raw: string; path: string }[] = [];
  const inside = (root: string, path: string) =>
    path.startsWith(join(root, "/"));
  const extension = (h: string, path: string) =>
    h === "gemini"
      ? /(?:^|[/\\])session-[^/\\]+\.jsonl?$/.test(path)
      : h === "codex"
        ? /\.jsonl(?:\.zst)?$/.test(path)
        : /\.jsonl$/.test(path);
  let truncated = false,
    identityComplete = true,
    bytes = 0,
    lines = 0;
  const workNow = ports.clock ?? (() => performance.now());
  const deadline = workNow() + 10_000;
  const fail = (h: string) => {
    states.set(h, "partial");
    if (h === "codex") identityComplete = false;
  };
  for (const [harness, raw] of configuredRoots) {
    try {
      roots.push({
        harness: harness!,
        raw: raw!,
        path: await fs.realpath(raw!),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail(harness!);
    }
  }
  type Candidate = {
    harness: string;
    path: string;
    size: number;
    mtime: number;
    identity: string;
    priority: boolean;
    aliases: string[];
  };
  const discovered = new Map<string, Candidate>();
  const fileKey = (path: string) => hash(path.replace(/\.zst$/, ""));
  async function add(
    harness: string,
    path: string,
    priority = false,
    alias?: string,
    datedOld = false,
  ) {
    if (!extension(harness, path)) {
      if (priority) fail(harness);
      return;
    }
    try {
      // A cached canonical path may now contain a replaced symlinked parent.
      if ((await fs.realpath(path)) !== path) {
        fail(harness);
        return;
      }
      const info = await fs.lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        if (harness === "codex" || priority) fail(harness);
        return;
      }
      if (datedOld && info.mtimeMs < start) {
        identityComplete = false;
        return;
      }
      if (
        info.mtimeMs < start &&
        (harness !== "codex" || !options.codex_prefixes?.length)
      )
        return;
      const prior = discovered.get(path);
      if (prior) {
        prior.priority ||= priority;
        if (alias) prior.aliases.push(fileKey(alias));
        return;
      }
      discovered.set(path, {
        harness,
        path,
        size: info.size,
        mtime: info.mtimeMs,
        identity: hash(`${info.dev}:${info.ino}`),
        priority,
        aliases: [fileKey(path), ...(alias ? [fileKey(alias)] : [])],
      });
    } catch {
      fail(harness);
    }
  }
  // Bound paths are data, never shell arguments. Resolve symlinks at this host
  // and admit only known harness roots and native transcript extensions.
  for (const bound of (options.files ?? []).slice(0, 128)) {
    const path = resolve(expand(bound.path));
    const root = roots.find(
      (r) =>
        r.harness === bound.harness &&
        (inside(r.raw, path) || inside(r.path, path)),
    );
    if (!root || !extension(bound.harness, path)) {
      fail(bound.harness);
      continue;
    }
    try {
      const actual = await fs.realpath(path).catch(async (error) => {
        if (
          bound.harness !== "codex" ||
          !path.endsWith(".jsonl") ||
          error.code !== "ENOENT"
        )
          throw error;
        return fs.realpath(`${path}.zst`);
      });
      if (!inside(root.path, actual) || !extension(bound.harness, actual)) {
        fail(bound.harness);
        continue;
      }
      await add(bound.harness, actual, true, path);
    } catch {
      fail(bound.harness);
    }
  }
  // Known active files still participate when their dated parent is pruned.
  for (const old of cache.files.values())
    if (
      old.mtime >= start &&
      roots.some((r) => r.harness === old.harness && inside(r.path, old.path))
    )
      await add(old.harness, old.path);
  const visits = new Map<string, number>();
  const visit = (h: string) => {
    const n = (visits.get(h) ?? 0) + 1;
    visits.set(h, n);
    return n <= 2048;
  };
  async function walk(
    harness: string,
    directory: string,
    parts: string[] = [],
    datedOld = false,
  ) {
    if (
      harness === "codex" &&
      parts.length > 0 &&
      parts.length <= 3 &&
      /^\d{4}$/.test(parts[0]!) &&
      parts.slice(1).every((p) => /^\d{2}$/.test(p))
    ) {
      const [y, m, d] = parts.map(Number);
      const end =
        parts.length === 1
          ? Date.UTC(y! + 1, 0, 1)
          : parts.length === 2
            ? Date.UTC(y!, m!, 1)
            : Date.UTC(y!, m! - 1, d! + 1);
      if (end <= start) {
        identityComplete = false;
        datedOld = true;
      }
    }
    if (!visit(harness) || parts.length > 8 || workNow() > deadline) {
      truncated = true;
      fail(harness);
      return;
    }
    try {
      const handle = await fs.opendir(directory),
        entries = [];
      if (states.get(harness) === "missing") states.set(harness, "available");
      for await (const entry of handle) {
        if (!visit(harness)) {
          truncated = true;
          fail(harness);
          break;
        }
        entries.push(entry);
      }
      entries.sort((a, b) => b.name.localeCompare(a.name));
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          if (harness === "codex") identityComplete = false;
          continue;
        }
        if (entry.isDirectory())
          await walk(harness, path, [...parts, entry.name], datedOld);
        else if (entry.isFile())
          await add(harness, path, false, undefined, datedOld);
      }
    } catch {
      fail(harness);
    }
  }
  for (const root of roots) await walk(root.harness, root.path);
  const selected: Candidate[] = [],
    counts = new Map<string, number>();
  let oldIdentities = 0;
  for (const file of [...discovered.values()].sort(
    (a, b) => Number(b.priority) - Number(a.priority) || b.mtime - a.mtime,
  )) {
    if (file.path.endsWith(".zst") && discovered.has(file.path.slice(0, -4)))
      continue;
    if (file.mtime < start) {
      if (++oldIdentities > 64) {
        truncated = true;
        fail(file.harness);
        continue;
      }
    } else {
      const count = (counts.get(file.harness) ?? 0) + 1;
      if (
        selected.filter((f) => f.mtime >= start).length >= 384 ||
        (!file.priority && count > 64)
      ) {
        truncated = true;
        fail(file.harness);
        continue;
      }
      counts.set(file.harness, count);
    }
    selected.push(file);
  }
  const admitted = new Map(selected.map((f) => [fileKey(f.path), f]));
  const day = Math.floor(options.now / 86_400_000);
  const dropSession = (session: string) => {
    cache.sessions.delete(session);
    for (const [key, old] of cache.files)
      if (old.session === session) cache.files.delete(key);
  };
  // Never read an admitted pathname through a replacement symlink/inode. Header
  // and numeric parsing below share this verified descriptor, including containers.
  const openVerified = async (file: Candidate) => {
    const handle = await fs.open(
      file.path,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        hash(`${info.dev}:${info.ino}`) !== file.identity ||
        info.size !== file.size ||
        info.mtimeMs !== file.mtime ||
        (await fs.realpath(file.path)) !== file.path ||
        !roots.some(
          (root) =>
            root.harness === file.harness && inside(root.path, file.path),
        )
      )
        throw new Error("Usage file changed");
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  };
  const readAt = async (
    handle: Fs.FileHandle,
    position: number,
    length: number,
  ) => {
    if (bytes + length > 256 * 1024 * 1024 || workNow() > deadline) {
      truncated = true;
      throw new Error("Usage read limit");
    }
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        length - offset,
        position + offset,
      );
      if (!bytesRead) throw new Error("Usage file shortened");
      bytes += bytesRead;
      offset += bytesRead;
    }
    return buffer;
  };
  const samples = async (handle: Fs.FileHandle, offset: number) => {
    const length = Math.min(offset, 4096);
    return {
      head: hash((await readAt(handle, 0, length)).toString("base64")),
      tail: hash(
        (await readAt(handle, offset - length, length)).toString("base64"),
      ),
    };
  };
  const reset = new Set<string>();
  for (const [key, old] of cache.files) {
    const file = admitted.get(key),
      whole = /\.(json|zst)$/.test(old.path);
    if (
      !file ||
      file.identity !== old.identity ||
      file.size < old.size ||
      file.mtime < old.mtime ||
      old.verified_day !== day ||
      (whole && (file.size !== old.size || file.mtime !== old.mtime)) ||
      (file.mtime !== old.mtime && file.size <= old.size)
    ) {
      reset.add(old.session);
      continue;
    }
    if (!whole && (file.size !== old.size || file.mtime !== old.mtime)) {
      let handle: Fs.FileHandle | undefined;
      try {
        handle = await openVerified(file);
        const current = await samples(handle, old.offset);
        if (current.head !== old.head || current.tail !== old.tail)
          reset.add(old.session);
      } catch {
        reset.add(old.session);
        fail(old.harness);
      } finally {
        await handle?.close();
      }
    }
  }
  for (const session of reset) dropSession(session);
  for (const session of cache.sessions.values()) {
    session.files.clear();
    session.reader.refresh(options.now);
  }
  const codexIdentities = new Map<string, Set<string>>();
  for (const file of selected) {
    if (workNow() > deadline || bytes >= 256 * 1024 * 1024 || lines > 500_000) {
      truncated = true;
      for (const h of states.keys()) fail(h);
      break;
    }
    const key = fileKey(file.path),
      old = cache.files.get(key),
      metadataOnly = file.mtime < start;
    let handle: Fs.FileHandle | undefined;
    try {
      let broken = false,
        permanent = false,
        fileBytes = 0,
        materialized: string | undefined;
      const unchanged =
        old &&
        old.identity === file.identity &&
        old.size === file.size &&
        old.mtime === file.mtime &&
        old.complete;
      const cursor = old ?? {
        path: file.path,
        harness: file.harness,
        size: file.size,
        mtime: file.mtime,
        identity: file.identity,
        offset: 0,
        complete: false,
        partial: false,
        skip: false,
        session: "",
        known: false,
        model: "unknown",
        prefixes: [],
        head: "",
        tail: "",
        verified_day: day,
      };
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
      const scan = async (consume: (record: any) => boolean, from: number) => {
        let stopped = false,
          position = from,
          committed = from,
          pending = Buffer.alloc(0),
          skipping = from > 0 && cursor.skip;
        let budgetStop = false;
        const parse = (line: string) => {
          if (!line.trim()) return true;
          if (lines >= 500_000) {
            truncated = broken = budgetStop = stopped = true;
            return false;
          }
          lines++;
          try {
            stopped = !consume(JSON.parse(line));
          } catch {
            broken = true;
            permanent = true;
          }
          return true;
        };
        try {
          handle ??= await openVerified(file);
          if (/\.(json|zst)$/.test(file.path)) {
            if (materialized === undefined) {
              if (
                file.size > 16 * 1024 * 1024 ||
                bytes + file.size > 256 * 1024 * 1024
              ) {
                truncated = true;
                broken = true;
                return {
                  offset: from,
                  complete: false,
                  skip: false,
                  tail: false,
                };
              }
              let raw: Uint8Array = await readAt(handle, 0, file.size);
              if (file.path.endsWith(".zst")) {
                if (!ports.decompress) throw new Error("No decoder");
                raw = await ports.decompress(raw);
                bytes += Math.max(0, raw.byteLength - file.size);
              }
              if (
                raw.byteLength > 64 * 1024 * 1024 ||
                bytes > 256 * 1024 * 1024
              )
                throw new Error("Usage read limit");
              materialized = Buffer.from(raw).toString("utf8");
            }
            if (file.path.endsWith(".json")) {
              consume(JSON.parse(materialized));
            } else
              for (const line of materialized.split("\n")) {
                if (line.length > 4 * 1024 * 1024) {
                  permanent = true;
                  continue;
                }
                parse(line);
                if (stopped) break;
              }
            return {
              offset: file.size,
              complete: !budgetStop,
              skip: false,
              tail: false,
            };
          }
          const buffer = Buffer.alloc(64 * 1024);
          while (!stopped && position < file.size) {
            if (
              fileBytes >= 64 * 1024 * 1024 ||
              bytes >= 256 * 1024 * 1024 ||
              lines > 500_000 ||
              workNow() > deadline
            ) {
              truncated = true;
              broken = true;
              break;
            }
            const { bytesRead } = await handle.read(
              buffer,
              0,
              Math.min(buffer.length, file.size - position),
              position,
            );
            if (!bytesRead) {
              broken = true;
              break;
            }
            position += bytesRead;
            fileBytes += bytesRead;
            bytes += bytesRead;
            pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
            let end;
            while (!stopped && (end = pending.indexOf(10)) >= 0) {
              const boundary = position - pending.length + end + 1;
              if (
                !skipping &&
                !parse(pending.subarray(0, end).toString("utf8"))
              )
                break;
              skipping = false;
              committed = boundary;
              pending = pending.subarray(end + 1);
            }
            if (!budgetStop && pending.length > 4 * 1024 * 1024) {
              pending = Buffer.alloc(0);
              skipping = true;
              permanent = true;
              committed = position;
            }
          }
          return {
            offset: skipping ? position : committed,
            complete: !budgetStop && (stopped || position >= file.size),
            skip: skipping,
            tail: !stopped && pending.length > 0,
          };
        } catch {
          broken = true;
          return {
            offset: committed,
            complete: false,
            skip: skipping,
            tail: false,
          };
        }
      };
      if (!unchanged && !cursor.known) {
        await scan((record) => {
          const id = identity(record);
          if (!id) return true;
          const canonical = hash(`${file.harness}\0${id}`);
          if (cursor.session && cursor.session !== canonical)
            dropSession(cursor.session);
          cursor.session = canonical;
          cursor.known = true;
          if (file.harness === "codex")
            cursor.prefixes = Array.from(
              { length: Math.max(0, Math.min(36, id.length) - 16) },
              (_, n) => hash(id.slice(0, n + 17).toLowerCase()),
            );
          return false;
        }, 0);
      }
      cursor.session ||= hash(`${file.harness}\0${file.path}`);
      if (!cursor.known) {
        broken = true;
        identityComplete = file.harness === "codex" ? false : identityComplete;
      }
      if (file.harness === "codex" && cursor.known) {
        const known = codexIdentities.get(cursor.session) ?? new Set<string>();
        for (const prefix of cursor.prefixes) known.add(prefix);
        codexIdentities.set(cursor.session, known);
      }
      if (!metadataOnly) {
        let session = cache.sessions.get(cursor.session);
        const newSession = !session;
        if (!session) {
          session = {
            harness: file.harness,
            reader: project(file.harness, options.now, hash),
            files: new Set(),
          };
          cache.sessions.set(cursor.session, session);
          cursor.offset = 0;
        }
        if (!unchanged || !old || newSession) {
          session.reader.context(cursor.model);
          const next = await scan((record) => {
            const id = identity(record);
            if (id && hash(`${file.harness}\0${id}`) !== cursor.session) {
              permanent = true;
              identityComplete = false;
              return false;
            }
            session.reader.accept(record);
            return true;
          }, cursor.offset);
          cursor.offset = next.offset;
          cursor.complete = next.complete;
          cursor.skip = next.skip;
          cursor.partial = next.tail || broken;
          cursor.model = session.reader.context();
          if (permanent) session.reader.incomplete();
        }
        for (const alias of file.aliases)
          if (session.files.size < 16 || session.files.has(alias))
            session.files.add(alias);
          else {
            session.reader.incomplete();
            truncated = true;
          }
      } else if (!unchanged) {
        cursor.complete = cursor.known && !broken;
        cursor.partial = broken;
      }
      cursor.size = file.size;
      cursor.mtime = file.mtime;
      cursor.identity = file.identity;
      if (!unchanged && !metadataOnly && cursor.offset > 0 && handle)
        Object.assign(cursor, await samples(handle, cursor.offset));
      cursor.verified_day = day;
      cache.files.set(key, cursor);
      if (broken || cursor.partial) fail(file.harness);
    } catch {
      fail(file.harness);
    } finally {
      await handle?.close();
    }
  }
  const result: HostUsage = {
    rows: [],
    sources: [],
    truncated,
    title_matches: [],
  };
  for (const [sessionKey, session] of cache.sessions) {
    if (!session.files.size) {
      dropSession(sessionKey);
      continue;
    }
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
        session_key: sessionKey,
        file_keys: [...session.files],
        partial: projected.partial || states.get(session.harness) === "partial",
      });
    }
  }
  for (const [harness, state] of states)
    if (
      state === "available" &&
      !result.rows.some((r) => r.harness === harness)
    )
      states.set(harness, "missing");
  if (
    identityComplete &&
    !result.truncated &&
    states.get("codex") === "available"
  ) {
    for (const prefix of (options.codex_prefixes ?? []).slice(0, 128)) {
      const digest = hash(prefix.toLowerCase()),
        matches = [...codexIdentities].filter(([, values]) =>
          values.has(digest),
        );
      if (matches.length === 1)
        result.title_matches!.push({
          prefix_key: digest,
          session_key: matches[0]![0],
        });
    }
  }
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
  const account = () =>
    (cache.files.size
      ? Buffer.byteLength(JSON.stringify([...cache.files]))
      : 0) +
    [...cache.sessions.values()].reduce(
      (sum, session) => sum + session.reader.cacheBytes(),
      0,
    );
  const maxEntries = Math.max(0, Math.min(448, cache.maxEntries ?? 448)),
    maxBytes = Math.max(
      0,
      Math.min(32 * 1024 * 1024, cache.maxBytes ?? 32 * 1024 * 1024),
    );
  cache.bytes = account();
  for (const [, cursor] of [...cache.files].sort(
    ([, a], [, b]) => a.mtime - b.mtime,
  )) {
    if (cache.files.size <= maxEntries && cache.bytes <= maxBytes) break;
    dropSession(cursor.session);
    cache.bytes = account();
  }
  return result;
}
