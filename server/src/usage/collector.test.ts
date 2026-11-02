import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessUsage, type CollectorCache } from "./collector";
import { createUsageProjection } from "./projection";
import {
  usageDigest,
  usageHostProgram,
  validateHostUsage,
  boundedUsageDecompress,
} from "./host";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "numeric-usage-"));
  roots.push(root);
  return root;
}
async function write(root: string, name: string, records: unknown[]) {
  const path = join(root, name);
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(
    path,
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return path;
}
const now = Date.now() + 1000;
const assistant = (id = "response-a") => ({
  type: "assistant",
  sessionId: "synthetic-session",
  timestamp: new Date(now - 500).toISOString(),
  message: {
    id,
    model: "model-a",
    content: "PRIVATE_SENTINEL",
    usage: { input_tokens: 10, output_tokens: 3 },
  },
});

test("host inventory counts sessions without pane links and dedupes copied session files", async () => {
  const home = await fixture();
  await write(home, ".claude/projects/synthetic/session.jsonl", [assistant()]);
  await write(home, ".claude/projects/duplicate/session.jsonl", [assistant()]);
  const result = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env: {},
    join,
    hash: usageDigest,
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    harness: "claude",
    responses: 1,
    tokens: { input: 10, output: 3 },
  });
  expect(result.rows[0]!.session_key).toBe(
    usageDigest("claude\0synthetic-session"),
  );
  expect(result.sources.find((s) => s.harness === "pi")?.state).toBe("missing");
  const serialized = JSON.stringify(result);
  for (const privateValue of [
    "PRIVATE_SENTINEL",
    "synthetic-session",
    home,
    "response-a",
  ])
    expect(serialized).not.toContain(privateValue);
});

test("cached files read only appended complete records and reset on truncation", async () => {
  const home = await fixture(),
    path = await write(home, ".claude/projects/synthetic/session.jsonl", [
      assistant(),
    ]);
  const cache = { files: new Map(), sessions: new Map() };
  let bytes = 0;
  const files = {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read")
            return async (...values: any[]) => {
              const result = await Reflect.apply(target.read, target, values);
              bytes += result.bytesRead;
              return result;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const read = () =>
    collectHarnessUsage(
      { now },
      createUsageProjection,
      { fs: files, home, env: {}, join, hash: usageDigest },
      cache,
    );
  expect((await read()).rows[0]?.tokens.input).toBe(10);
  bytes = 0;
  await read();
  expect(bytes).toBe(0);
  const appended = JSON.stringify(assistant("response-b")) + "\n";
  await fs.appendFile(path, appended.slice(0, 20));
  expect((await read()).rows[0]?.partial).toBe(true);
  bytes = 0;
  await fs.appendFile(path, appended.slice(20));
  const completed = await read();
  expect(completed.rows[0]?.tokens.input).toBe(20);
  expect(completed.rows[0]?.partial).toBe(false);
  expect(bytes).toBeGreaterThanOrEqual(Buffer.byteLength(appended));
  expect(bytes).toBeLessThanOrEqual(Buffer.byteLength(appended) + 16 * 1024);
  await fs.writeFile(path, JSON.stringify(assistant("response-c")) + "\n");
  expect((await read()).rows[0]?.tokens.input).toBe(10);
});

test("host projection bounds and incomplete writes disclose coverage loss", async () => {
  const home = await fixture();
  const path = await write(home, ".claude/projects/synthetic/session.jsonl", [
    assistant(),
  ]);
  await fs.appendFile(path, '{"partial":');
  const result = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env: {},
    join,
    hash: usageDigest,
  });
  expect(result.sources.find((s) => s.harness === "claude")?.state).toBe(
    "partial",
  );
  expect(result.rows[0]?.partial).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(512 * 1024);
});

test("a preamble cannot hide canonical session identity or duplicate copied responses", async () => {
  const home = await fixture();
  for (const name of ["original", "copy"])
    await write(home, `.claude/projects/synthetic/${name}.jsonl`, [
      {
        type: "file-history-snapshot",
        snapshot: { content: "PRIVATE_SENTINEL" },
      },
      assistant(),
    ]);
  const result = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env: {},
    join,
    hash: usageDigest,
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    session_key: usageDigest("claude\0synthetic-session"),
    responses: 1,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
});

test("numeric collector ignores symlink files and reads configured session roots", async () => {
  const home = await fixture(),
    outside = await fixture();
  const target = await write(outside, "custom.jsonl", [assistant()]);
  await fs.mkdir(join(home, ".claude/projects/synthetic"), { recursive: true });
  await fs.symlink(target, join(home, ".claude/projects/synthetic/link.jsonl"));
  const empty = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env: {},
    join,
    hash: usageDigest,
  });
  expect(empty.rows).toEqual([]);
  const found = await collectHarnessUsage(
    { now, files: [{ harness: "claude", path: target }] },
    createUsageProjection,
    { fs, home, env: {}, join, hash: usageDigest },
  );
  expect(found.rows).toHaveLength(0);
  const allowed = await write(home, ".claude/projects/synthetic/bound.jsonl", [
    assistant(),
  ]);
  expect(
    (
      await collectHarnessUsage(
        { now, files: [{ harness: "claude", path: allowed }] },
        createUsageProjection,
        { fs, home, env: {}, join, hash: usageDigest },
      )
    ).rows,
  ).toHaveLength(1);
});

test("the exact SSH program executes under Node and Bun with only numeric output", async () => {
  const home = await fixture(),
    codex = join(home, "codex"),
    pi = join(home, "pi");
  const path = await write(home, "claude/projects/synthetic/session.jsonl", [
    assistant(),
  ]);
  for (const executable of [process.execPath, "node"]) {
    const program = usageHostProgram({
      now,
      files: [{ harness: "claude", path }],
    });
    const proc = Bun.spawn(
      executable === "node"
        ? [executable, "--input-type=module"]
        : [executable, "run", "-"],
      {
        env: {
          ...process.env,
          HOME: home,
          CLAUDE_CONFIG_DIR: join(home, "claude"),
          CODEX_HOME: codex,
          PI_CODING_AGENT_DIR: pi,
        },
        stdin: Buffer.from(program),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exit, text, error] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(error).toBe("");
    expect(exit).toBe(0);
    const result = validateHostUsage(JSON.parse(text));
    expect(result.rows).toHaveLength(1);
    expect(text).not.toContain("PRIVATE_SENTINEL");
    expect(text).not.toContain(home);
  }
});

test("compressed Codex representations are read once with bounded decompression", async () => {
  const home = await fixture();
  const records = [
    { type: "session_meta", payload: { id: "session-codex" } },
    { type: "turn_context", payload: { model: "m" } },
    {
      type: "event_msg",
      timestamp: new Date(now - 500).toISOString(),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 10, output_tokens: 2 },
          last_token_usage: { input_tokens: 10, output_tokens: 2 },
        },
      },
    },
  ];
  const path = await write(
    home,
    ".codex/sessions/synthetic/session.jsonl",
    records,
  );
  await fs.writeFile(
    `${path}.zst`,
    Bun.zstdCompressSync(await fs.readFile(path)),
  );
  await fs.unlink(path);
  const cache = { files: new Map(), sessions: new Map() };
  let decodes = 0;
  const read = () =>
    collectHarnessUsage(
      { now },
      createUsageProjection,
      {
        fs,
        home,
        env: {},
        join,
        hash: usageDigest,
        decompress: async (value) => {
          decodes++;
          return boundedUsageDecompress(value);
        },
      },
      cache,
    );
  const result = await read();
  await read();
  expect(decodes).toBe(1);
  expect(result.rows[0]).toMatchObject({
    harness: "codex",
    tokens: { input: 10, output: 2 },
  });
});

test("remote projection validation rejects malformed numeric values and strips extra content", () => {
  const base = {
    rows: [],
    truncated: false,
    sources: ["claude", "codex", "pi", "gemini"].map((harness) => ({
      harness,
      state: "missing",
      content: "PRIVATE_SENTINEL",
    })),
  };
  expect(JSON.stringify(validateHostUsage(base))).not.toContain(
    "PRIVATE_SENTINEL",
  );
  expect(() =>
    validateHostUsage({ ...base, rows: [{ tokens: { input: -1 } }] }),
  ).toThrow();
});

test("ordinary inventory cannot crowd out an exact bound file and discloses its cap", async () => {
  const home = await fixture();
  for (let i = 0; i < 65; i++)
    await write(home, `.claude/projects/synthetic/session-${i}.jsonl`, [
      { ...assistant(`response-${i}`), sessionId: `session-${i}` },
    ]);
  const bound = await write(home, ".claude/projects/bound/session.jsonl", [
    { ...assistant("bound-response"), sessionId: "bound-session" },
  ]);
  const newest = join(home, ".claude/projects/synthetic/session-0.jsonl");
  await fs.utimes(newest, new Date(now), new Date(now));
  const result = await collectHarnessUsage(
    { now, files: [{ harness: "claude", path: bound }] },
    createUsageProjection,
    { fs, home, env: {}, join, hash: usageDigest },
  );
  expect(result.truncated).toBe(true);
  expect(result.rows.length).toBeLessThanOrEqual(64);
  expect(
    result.rows.some(
      (row) => row.session_key === usageDigest("claude\0session-0"),
    ),
  ).toBe(true);
  expect(
    result.rows.some(
      (r) => r.session_key === usageDigest("claude\0bound-session"),
    ),
  ).toBe(true);
  expect(result.sources.find((s) => s.harness === "claude")?.state).toBe(
    "partial",
  );
});

test("bundling preserves the self-contained host program used by compiled services", async () => {
  const root = await fixture();
  const entry = join(root, "entry.ts");
  await fs.writeFile(
    entry,
    `export {usageHostProgram} from ${JSON.stringify(join(import.meta.dir, "host.ts"))};`,
  );
  const build = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    format: "esm",
    minify: true,
  });
  expect(build.success).toBe(true);
  const path = join(root, "bundle.mjs");
  await fs.writeFile(path, await build.outputs[0]!.text());
  const bundled = await import(path);
  const program = bundled.usageHostProgram({ now: 1 });
  const proc = Bun.spawn(["node", "--input-type=module"], {
    stdin: Buffer.from(program),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: root,
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
      PI_CODING_AGENT_DIR: join(root, "pi"),
    },
  });
  const [exit, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(validateHostUsage(JSON.parse(stdout)).rows).toEqual([]);
});

test("the production local adapter runs its numeric collector in an owned worker", async () => {
  const home = await fixture();
  await write(home, "claude/projects/synthetic/session.jsonl", [assistant()]);
  const source = `import {readHostUsage} from ${JSON.stringify(join(import.meta.dir, "host.ts"))};
process.stdout.write(JSON.stringify(await readHostUsage({now:${now}})));`;
  const proc = Bun.spawn([process.execPath, "-e", source], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, "claude"),
      CODEX_HOME: join(home, "codex"),
      PI_CODING_AGENT_DIR: join(home, "pi"),
    },
  });
  const [exit, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(validateHostUsage(JSON.parse(stdout)).rows[0]?.tokens.input).toBe(10);
  expect(stdout).not.toContain("PRIVATE_SENTINEL");
  expect(stdout).not.toContain(home);
});

test("the SSH program's input lifetime channel ends blocked remote work", async () => {
  const home = await fixture();
  const source = usageHostProgram({ now }, "ssh").replace(
    "value:await collect(request.options,project,ports,cache)",
    "value:await (async()=>{process.stderr.write('ready');await new Promise(()=>{});})()",
  );
  const proc = Bun.spawn(["node", "--input-type=module", "-e", source], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, "claude"),
      CODEX_HOME: join(home, "codex"),
      PI_CODING_AGENT_DIR: join(home, "pi"),
    },
  });
  await proc.stdin.write(JSON.stringify({ id: 1, options: { now } }) + "\n");
  await proc.stdin.flush();
  const fallback = setTimeout(() => proc.kill("SIGKILL"), 2000);
  const reader = proc.stderr.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready");
    await proc.stdin.end();
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stdout).text()).toBe("");
  } finally {
    clearTimeout(fallback);
    proc.kill();
    await proc.exited;
    await reader.cancel();
    reader.releaseLock();
  }
});

test("Codex title prefixes resolve only against a unique complete numeric session inventory", async () => {
  const home = await fixture(),
    id = "11111111-1111-4111-8111-111111111111",
    prefix = id.slice(0, 29);
  const records = (session: string) => [
    { type: "session_meta", payload: { id: session } },
    { type: "turn_context", payload: { model: "m" } },
    {
      type: "event_msg",
      timestamp: new Date(now - 500).toISOString(),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 10, output_tokens: 2 },
          last_token_usage: { input_tokens: 10, output_tokens: 2 },
        },
      },
    },
  ];
  await write(home, ".codex/sessions/synthetic/first.jsonl", records(id));
  const read = () =>
    collectHarnessUsage(
      { now, codex_prefixes: [prefix] },
      createUsageProjection,
      { fs, home, env: {}, join, hash: usageDigest },
    );
  const first = await read();
  expect(first.title_matches).toEqual([
    {
      prefix_key: usageDigest(prefix),
      session_key: usageDigest(`codex\0${id}`),
    },
  ]);
  expect(JSON.stringify(first)).not.toContain(id);
  await write(
    home,
    ".codex/sessions/synthetic/second.jsonl",
    records(id.slice(0, -1) + "2"),
  );
  expect((await read()).title_matches).toEqual([]);
});

test.each(["budget", "unavailable"])(
  "incomplete old-session identity evidence preserves current numbers without guessing a prefix: %s",
  async (reason) => {
    const home = await fixture(),
      id = "11111111-1111-4111-8111-111111111111",
      prefix = id.slice(0, 29);
    await write(home, ".codex/sessions/synthetic/current.jsonl", [
      { type: "session_meta", payload: { id } },
      { type: "turn_context", payload: { model: "m" } },
      {
        type: "event_msg",
        timestamp: new Date(now - 500).toISOString(),
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 10, output_tokens: 0 },
            last_token_usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
      },
    ]);
    let unavailable = "";
    for (let i = 0; i < (reason === "budget" ? 65 : 1); i++) {
      const path = await write(
        home,
        `.codex/archived_sessions/synthetic/old-${i}.jsonl`,
        [
          {
            type: "session_meta",
            payload: {
              id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
            },
          },
        ],
      );
      const old = new Date(now - 8 * 86_400_000);
      await fs.utimes(path, old, old);
      if (reason === "unavailable") unavailable = path;
    }
    const files = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        if (args[0] === unavailable)
          throw new Error("synthetic unavailable metadata");
        return fs.open(...args);
      },
    };
    const result = await collectHarnessUsage(
      { now, codex_prefixes: [prefix] },
      createUsageProjection,
      { fs: files, home, env: {}, join, hash: usageDigest },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.tokens.input).toBe(10);
    expect(result.title_matches).toEqual([]);
    expect(
      result.sources.find((source) => source.harness === "codex")?.state,
    ).toBe("partial");
    expect(result.truncated).toBe(reason === "budget");
  },
);

test("the private parser cache evicts whole sessions to honor entry and byte caps", async () => {
  const home = await fixture();
  for (const id of ["first", "second"])
    await write(home, `.claude/projects/synthetic/${id}.jsonl`, [
      { ...assistant(id), sessionId: id },
    ]);
  const cache: CollectorCache = {
    files: new Map(),
    sessions: new Map(),
    maxEntries: 1,
  };
  const read = () =>
    collectHarnessUsage(
      { now },
      createUsageProjection,
      { fs, home, env: {}, join, hash: usageDigest },
      cache,
    );
  expect((await read()).rows).toHaveLength(2);
  expect(cache.files.size).toBe(1);
  expect(cache.sessions.size).toBe(1);
  cache.maxBytes = 0;
  expect((await read()).rows).toHaveLength(2);
  expect(cache.files.size).toBe(0);
  expect(cache.sessions.size).toBe(0);
  expect(cache.bytes).toBe(0);
});

test("pruned Codex dates are never opened or treated as proof a title prefix is unique", async () => {
  const home = await fixture(),
    id = "11111111-1111-4111-8111-111111111111",
    prefix = id.slice(0, 29);
  const records = (session: string) => [
    { type: "session_meta", payload: { id: session } },
    { type: "turn_context", payload: { model: "m" } },
    {
      type: "event_msg",
      timestamp: new Date(now - 1).toISOString(),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 10, output_tokens: 0 },
          last_token_usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    },
  ];
  const day = (at: number) =>
    new Date(at).toISOString().slice(0, 10).replaceAll("-", "/");
  await write(home, `.codex/sessions/${day(now)}/current.jsonl`, records(id));
  const old = await write(
    home,
    `.codex/sessions/${day(now - 8 * 86400000)}/older.jsonl`,
    records(id.slice(0, -1) + "2"),
  );
  await fs.utimes(
    old,
    new Date(now - 8 * 86400000),
    new Date(now - 8 * 86400000),
  );
  const opened: string[] = [];
  const files = {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      opened.push(String(args[0]));
      return fs.open(...args);
    },
  };
  const result = await collectHarnessUsage(
    { now, codex_prefixes: [prefix] },
    createUsageProjection,
    { fs: files, home, env: {}, join, hash: usageDigest },
  );
  expect(result.rows[0]?.tokens.input).toBe(10);
  expect(result.title_matches).toEqual([]);
  expect(result.truncated).toBe(false);
  expect(opened).not.toContain(old);
});

test("bound paths cannot escape harness roots or select unsupported extensions", async () => {
  const home = await fixture(),
    outside = await fixture();
  const target = await write(outside, "private.jsonl", [assistant()]);
  const wrong = await write(home, ".claude/projects/synthetic/private.txt", [
    assistant(),
  ]);
  const link = join(home, ".claude/projects/synthetic/escape");
  await fs.symlink(outside, link);
  const result = await collectHarnessUsage(
    {
      now,
      files: [
        { harness: "claude", path: target },
        { harness: "claude", path: wrong },
        { harness: "claude", path: join(link, "private.jsonl") },
      ],
    },
    createUsageProjection,
    { fs, home, env: {}, join, hash: usageDigest },
  );
  expect(result.rows).toEqual([]);
  expect(
    result.sources.find((source) => source.harness === "claude")?.state,
  ).toBe("partial");
  const cache = { files: new Map(), sessions: new Map() };
  const warm = await write(home, ".claude/projects/warm/private.jsonl", [
    assistant(),
  ]);
  const read = () =>
    collectHarnessUsage(
      { now },
      createUsageProjection,
      { fs, home, env: {}, join, hash: usageDigest },
      cache,
    );
  expect((await read()).rows).toHaveLength(1);
  await fs.rm(join(warm, ".."), { recursive: true });
  await fs.symlink(outside, join(warm, ".."));
  expect((await read()).rows).toEqual([]);
});

test("growing rewrites rebuild the canonical session and match a cold reader", async () => {
  const home = await fixture(),
    path = await write(home, ".claude/projects/synthetic/session.jsonl", [
      {
        ...assistant("old"),
        message: {
          ...assistant("old").message,
          usage: { input_tokens: 90, output_tokens: 0 },
        },
      },
    ]);
  const cache: CollectorCache = { files: new Map(), sessions: new Map() };
  const read = (retained = cache) =>
    collectHarnessUsage(
      { now },
      createUsageProjection,
      { fs, home, env: {}, join, hash: usageDigest },
      retained,
    );
  expect((await read()).rows[0]?.tokens.input).toBe(90);
  await fs.writeFile(
    path,
    [10, 20]
      .map((input, index) =>
        JSON.stringify({
          ...assistant(`new-${index}`),
          message: {
            ...assistant(`new-${index}`).message,
            usage: { input_tokens: input, output_tokens: 0 },
          },
        }),
      )
      .join("\n") + "\n",
  );
  expect((await read()).rows[0]?.tokens.input).toBe(30);
  expect(
    (await read({ files: new Map(), sessions: new Map() })).rows[0]?.tokens
      .input,
  ).toBe(30);
  const day = [...cache.files.values()][0]!.verified_day;
  await collectHarnessUsage(
    { now: now + 86400000 },
    createUsageProjection,
    { fs, home, env: {}, join, hash: usageDigest },
    cache,
  );
  expect([...cache.files.values()][0]!.verified_day).toBe(day + 1);
});

test("line budget retry resumes before rejected records and clears partial only after recovery", async () => {
  const home = await fixture(),
    path = await write(home, ".claude/projects/synthetic/session.jsonl", [
      assistant(),
    ]);
  await fs.appendFile(
    path,
    "{}\n".repeat(499999) + JSON.stringify(assistant("response-b")) + "\n",
  );
  const cache: CollectorCache = { files: new Map(), sessions: new Map() };
  const read = () =>
    collectHarnessUsage(
      { now },
      createUsageProjection,
      { fs, home, env: {}, join, hash: usageDigest },
      cache,
    );
  const first = await read();
  expect(first.truncated).toBe(true);
  expect(first.rows[0]?.partial).toBe(true);
  expect([...cache.files.values()][0]!.offset).toBeLessThan(
    (await fs.stat(path)).size,
  );
  await fs.appendFile(path, JSON.stringify(assistant("response-c")) + "\n");
  const next = await read();
  expect(next.rows[0]?.tokens.input).toBe(30);
  expect(next.rows[0]?.responses).toBe(3);
  expect(next.rows[0]?.partial).toBe(false);
  expect(next.truncated).toBe(false);
});

test.each(["deadline", "host-bytes"])(
  "cached sessions recover together with cursors after %s exhaustion",
  async (reason) => {
    const home = await fixture(),
      first = await write(home, ".claude/projects/synthetic/a.jsonl", [
        assistant(),
      ]);
    await write(home, ".claude/projects/synthetic/b.jsonl", [
      { ...assistant("other"), sessionId: "other-session" },
    ]);
    let clock = 0,
      exhaust = false;
    const cache: CollectorCache = { files: new Map(), sessions: new Map() };
    const files = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        if (exhaust && reason === "deadline") clock = 20000;
        return fs.open(...args);
      },
    };
    const read = (retained = cache) =>
      collectHarnessUsage(
        { now },
        createUsageProjection,
        {
          fs: files,
          home,
          env: {},
          join,
          hash: usageDigest,
          clock: () => clock,
          decompress: () => ({ byteLength: 256 * 1024 * 1024 }) as Uint8Array,
        },
        retained,
      );
    const total = (result: Awaited<ReturnType<typeof read>>) =>
      result.rows.reduce((sum, row) => sum + row.tokens.input, 0);
    expect(total(await read())).toBe(20);
    await fs.appendFile(first, JSON.stringify(assistant("appended")) + "\n");
    const compressed = join(home, ".codex/sessions/synthetic/budget.jsonl.zst");
    if (reason === "host-bytes") {
      await fs.mkdir(join(compressed, ".."), { recursive: true });
      await fs.writeFile(compressed, "synthetic");
      await fs.utimes(compressed, new Date(now), new Date(now));
    }
    exhaust = true;
    expect((await read()).truncated).toBe(true);
    exhaust = false;
    clock = 0;
    if (reason === "host-bytes") await fs.unlink(compressed);
    expect(total(await read())).toBe(30);
    expect(total(await read({ files: new Map(), sessions: new Map() }))).toBe(
      30,
    );
  },
);

test("fresh Codex activity in older dates survives warm and cold readers while expired bodies stay pruned", async () => {
  const home = await fixture(),
    id = "11111111-1111-4111-8111-111111111111";
  const day = new Date(now - 8 * 86400000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "/");
  const path = await write(home, `.codex/sessions/${day}/active.jsonl`, [
    { type: "session_meta", payload: { id } },
    { type: "turn_context", payload: { model: "m" } },
    {
      type: "event_msg",
      timestamp: new Date(now - 1).toISOString(),
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 10, output_tokens: 0 },
          last_token_usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    },
  ]);
  const cache: CollectorCache = { files: new Map(), sessions: new Map() };
  const read = (retained = cache, bound = false) =>
    collectHarnessUsage(
      {
        now,
        codex_prefixes: [id.slice(0, 29)],
        files: bound ? [{ harness: "codex", path }] : [],
      },
      createUsageProjection,
      { fs, home, env: {}, join, hash: usageDigest },
      retained,
    );
  for (const result of [
    await read(cache, true),
    await read(),
    await read({ files: new Map(), sessions: new Map() }),
  ]) {
    expect(result.rows[0]?.tokens.input).toBe(10);
    expect(result.title_matches).toEqual([]);
    expect(
      result.sources.find((source) => source.harness === "codex")?.state,
    ).toBe("available");
  }
});

test.each(["file", "parent", "json", "compressed"])(
  "verified handles refuse admission-to-open %s replacement",
  async (kind) => {
    const home = await fixture(),
      outside = await fixture();
    const gemini = kind === "json",
      compressed = kind === "compressed";
    const name = gemini
      ? "session-example.json"
      : compressed
        ? "session.jsonl.zst"
        : "session.jsonl";
    const directory = gemini
      ? ".gemini/tmp/example/chats"
      : compressed
        ? ".codex/sessions/synthetic"
        : ".claude/projects/synthetic";
    const path = join(home, directory, name),
      target = join(outside, name);
    await fs.mkdir(join(path, ".."), { recursive: true });
    const content = (input: number) =>
      gemini
        ? JSON.stringify({
            sessionId: "synthetic-session",
            messages: [
              {
                id: "response-a",
                type: "gemini",
                model: "m",
                timestamp: new Date(now - 1).toISOString(),
                tokens: { input, output: 0 },
              },
            ],
          })
        : compressed
          ? Bun.zstdCompressSync(
              [
                { type: "session_meta", payload: { id: "synthetic-session" } },
                { type: "turn_context", payload: { model: "m" } },
                {
                  type: "event_msg",
                  timestamp: new Date(now - 1).toISOString(),
                  payload: {
                    type: "token_count",
                    info: {
                      total_token_usage: {
                        input_tokens: input,
                        output_tokens: 0,
                      },
                      last_token_usage: {
                        input_tokens: input,
                        output_tokens: 0,
                      },
                    },
                  },
                },
              ]
                .map((record) => JSON.stringify(record))
                .join("\n") + "\n",
            )
          : JSON.stringify({
              ...assistant(),
              message: {
                ...assistant().message,
                usage: { input_tokens: input, output_tokens: 0 },
              },
            }) + "\n";
    await fs.writeFile(path, content(10));
    await fs.writeFile(target, content(90));
    const allowed = await collectHarnessUsage({ now }, createUsageProjection, {
      fs,
      home,
      env: {},
      join,
      hash: usageDigest,
      decompress: boundedUsageDecompress,
    });
    expect(allowed.rows[0]?.tokens.input).toBe(10);
    let switched = false,
      closed = 0;
    const files = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        if (args[0] === path && !switched) {
          switched = true;
          if (kind === "parent") {
            await fs.rm(join(path, ".."), { recursive: true });
            await fs.symlink(outside, join(path, ".."));
          } else {
            await fs.unlink(path);
            await fs.symlink(target, path);
          }
        }
        const handle = await fs.open(...args);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "close")
              return async () => {
                closed++;
                await target.close();
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const result = await collectHarnessUsage({ now }, createUsageProjection, {
      fs: files,
      home,
      env: {},
      join,
      hash: usageDigest,
      decompress: boundedUsageDecompress,
    });
    expect(switched).toBe(true);
    expect(result.rows).toEqual([]);
    expect(
      result.sources.find(
        (source) =>
          source.harness ===
          (gemini ? "gemini" : compressed ? "codex" : "claude"),
      )?.state,
    ).toBe("partial");
    if (kind === "parent") expect(closed).toBeGreaterThan(0);
  },
);
