import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = mkdtempSync(join(tmpdir(), "terminal-mark-controls-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const workerUrl = pathToFileURL(
  resolve(import.meta.dir, "../storage/world-worker.ts"),
).href;
const consumers = resolve(import.meta.dir, "persistent-terminal-marks.test.ts");
const storage = resolve(import.meta.dir, "../storage/terminal-marks.test.ts");
const cases = [
  { name: "positive service consumers", entry: consumers },
  { name: "positive SQLite consumers", entry: storage },
  {
    name: "reattached capture projection",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /const removed = draft\.removeCommittedCapture\(row\.id\);/,
    replacement: "const removed = []; draft.unpin(identity, true);",
    assertion:
      "old watch ID removes the same watch reattached in generation 2 from both clients",
  },
  {
    name: "conditional Undo",
    entry: consumers,
    file: "desk-state.ts",
    match: /if\s*\(!reviewed && existing\?\.reviewed_stop !== stop\) return;/,
    replacement: "",
    assertion:
      "two browser clients share real RPC changes and exact Undo over SQLite",
  },
  {
    name: "ambiguous source",
    entry: consumers,
    file: "binding-resolution.ts",
    match: /return \(\s*new Set\(entities\.map/,
    replacement: "return false && (new Set(entities.map",
    assertion: "ambiguous session never attaches or deletes a saved record",
  },
  {
    name: "session lifetime",
    entry: consumers,
    file: "binding-resolution.ts",
    match: /"sessionEnd" in policy &&\s*policy\.sessionEnd/,
    replacement: "false",
    assertion:
      "a positive session replacement ends Desk and seen, while a watch follows its terminal move",
  },
  {
    name: "retired publication",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /ensureCurrent\(\);\s*const committed = new Map/,
    replacement: "const committed = new Map",
    assertion:
      "a storage acknowledgement arriving after retirement never publishes its old projection",
  },
  {
    name: "record persistence",
    entry: storage,
    file: "terminal-marks.ts",
    match: /db\s*\.query\(\s*"INSERT INTO terminal_marks/,
    replacement: 'if (false) db.query("INSERT INTO terminal_marks',
    assertion:
      "all 24 independent-family/refusal orders preserve only complete accepted record/binding pairs",
  },
  {
    name: "native admission",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /guard\.valid &&=/,
    replacement: "guard.valid ||=",
    assertion: "native admission refuses a replaced then restored session",
  },
  {
    name: "revision fence",
    entry: storage,
    file: "terminal-marks.ts",
    match: /revision !== existing\.revision/,
    replacement: "false",
    assertion: "SQLite revision fences reject stale edits and deletes",
  },
  {
    name: "cross-connection publication",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /const published = \{[\s\S]*?\};/,
    replacement: "const published = draft;",
    assertion:
      "publication preserves another connection's disconnect and monotonic notices",
  },
  {
    name: "unknown ownership admission",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /guard\.valid &&=/,
    replacement: "guard.valid ||=",
    assertion:
      "pending unknown Desk RPC refuses replacement followed by the original ownership",
  },
  {
    name: "completion ownership admission",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /guard\.valid &&=/,
    replacement: "guard.valid ||=",
    assertion:
      "pending completion RPC refuses replacement followed by the original ownership",
  },
  {
    name: "unavailable saved removal",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /if \(!capture\) return;/,
    replacement:
      "if (!this.options.registries.watchlist.list().records.some(record => record.connection_id === identity.connection_id && record.connection_generation === identity.connection_generation && record.terminal_id === identity.terminal_id)) return; if (!capture) return;",
    assertion:
      "exact Unpin removes a disconnected saved capture and it cannot return after reconnect or restart",
  },
  {
    name: "exact watch identity",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match:
      /const capture =\s*identity\.watch_id \?\? this\.watchCaptures\.get\(watchKey\(identity\)\);/,
    replacement:
      'const capture = this.options.storage.list().find(row => row.kind === "watchlist" && row.binding.instance === identity.connection_id && row.binding.evidence.terminals[0] === identity.terminal_id)?.id;',
    assertion:
      "an older watch capture cannot remove its replacement in generation 1",
  },
];
for (const [index, control] of cases.entries())
  test(`compiled terminal-mark control: ${control.name}`, async () => {
    let replaced = false;
    const output = join(root, `${index}.test.js`);
    const built = await Bun.build({
      entrypoints: [control.entry],
      target: "bun",
      outdir: root,
      naming: `${index}.test.js`,
      plugins: [
        {
          name: "terminal-mark-control",
          setup(build) {
            build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
              if (args.path.includes("node_modules")) return;
              let contents = readFileSync(args.path, "utf8");
              if (args.path.endsWith("/world-client.ts"))
                contents = contents.replace(
                  "new Worker(workerUrl)",
                  `new Worker(new URL(${JSON.stringify(workerUrl)}))`,
                );
              if (
                control.file &&
                control.match &&
                control.replacement !== undefined &&
                args.path.endsWith(`/${control.file}`)
              ) {
                if (!control.match.test(contents))
                  throw new Error(`mutation site missing: ${control.name}`);
                contents = contents.replace(control.match, control.replacement);
                replaced = true;
              }
              return {
                contents,
                loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
              };
            });
          },
        },
      ],
    });
    if (!built.success) throw new Error(built.logs.map(String).join("\n"));
    const command = [
      process.execPath,
      "test",
      output,
      ...(control.assertion ? ["--test-name-pattern", control.assertion] : []),
    ];
    const child = Bun.spawn(command, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 30_000);
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);
    const log = stdout + stderr;
    if (!control.assertion) {
      if (code !== 0) throw new Error(log);
    } else {
      expect(replaced).toBe(true);
      expect(code).toBe(1);
      expect(log).toContain(`(fail) ${control.assertion}`);
      expect(log).toContain("expect(received)");
      expect(log).not.toContain("Unhandled error");
    }
  }, 60_000);
