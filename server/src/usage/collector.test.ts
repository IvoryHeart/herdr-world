import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessUsage } from "./collector";
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
  expect(found.rows).toHaveLength(1);
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
  const result = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env: {},
    join,
    hash: usageDigest,
    decompress: boundedUsageDecompress,
  });
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
  const bound = await write(home, "bound/session.jsonl", [
    { ...assistant("bound-response"), sessionId: "bound-session" },
  ]);
  const result = await collectHarnessUsage(
    { now, files: [{ harness: "claude", path: bound }] },
    createUsageProjection,
    { fs, home, env: {}, join, hash: usageDigest },
  );
  expect(result.truncated).toBe(true);
  expect(result.rows.length).toBeLessThanOrEqual(64);
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
