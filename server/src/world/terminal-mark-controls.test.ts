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
const stops = resolve(import.meta.dir, "review-stop-coverage.test.ts");
const repairs = resolve(import.meta.dir, "review-stop-review.test.ts");
const cases = [
  {
    name: "positive archive boundary consumers",
    entry: resolve(import.meta.dir, "legacy-review-boundaries.test.ts"),
  },
  {
    name: "archive savepoint deadline fence",
    entry: resolve(import.meta.dir, "legacy-review-boundaries.test.ts"),
    file: "legacy-review-archive.ts",
    match: /expireLegacyReviews\(db, at\);\s*const terminal/,
    replacement: "const terminal",
    assertion:
      "resolving Desk savepoint enforces original archive deadline at offset 0 after restart true",
  },
  {
    name: "archive actual World activity fence",
    entry: resolve(import.meta.dir, "legacy-review-boundaries.test.ts"),
    file: "desk-observation.ts",
    match: /activityMatchesWorld: activity === displayedActivity/,
    replacement: "activityMatchesWorld: true",
    assertion:
      "activity admission preserves the receipt until sparse session agrees with the actual World leaf",
  },
  {
    name: "positive browser review consumers",
    entry: resolve(
      import.meta.dir,
      "../../../web/src/world/useReviewedWork.test.ts",
    ),
  },
  {
    name: "anonymous browser review fence",
    entry: resolve(
      import.meta.dir,
      "../../../web/src/world/useReviewedWork.test.ts",
    ),
    file: "useDeskState.ts",
    match: /stop\?\.startsWith\("stop:\[null,"\)/,
    replacement: "false",
    assertion:
      "a report with only activity cannot claim review after a service stop appears",
  },
  {
    name: "positive archive consumers",
    entry: resolve(import.meta.dir, "legacy-review-resolution.test.ts"),
  },
  {
    name: "archive known-session fence",
    entry: resolve(import.meta.dir, "legacy-review-resolution.test.ts"),
    file: "legacy-review-archive.ts",
    match: /receipt\.binding\.evidence\.session !== proof\.session/,
    replacement: "false",
    assertion:
      "fresh unknown owner permanently disqualifies the receipt even if its old proof returns after restart",
  },
  {
    name: "archive unchanged-sequence fence",
    entry: resolve(import.meta.dir, "legacy-review-resolution.test.ts"),
    file: "legacy-review-archive.ts",
    match: /receipt\.body\.stateChangeSeq !== proof\.sequence/,
    replacement: "false",
    assertion:
      "archive proof disqualification survives a crash before the Desk checkpoint",
  },
  {
    name: "archive draining deadline",
    entry: resolve(import.meta.dir, "legacy-review-resolution.test.ts"),
    file: "legacy-review-archive.ts",
    match: /WHERE migrated_at<=\?/,
    replacement: "WHERE migrated_at<=? AND 0",
    assertion:
      "archive expiry runs on the service scheduler even without a source observation",
  },
  { name: "positive service consumers", entry: consumers },
  { name: "positive SQLite consumers", entry: storage },
  {
    name: "recovery re-entry protection",
    entry: repairs,
    file: "persistent-terminal-marks.ts",
    match: /this\.recoveringSources\.add\(connectionId\)/,
    replacement: "this.recoveringSources.delete(connectionId)",
    assertion:
      "re-entering recovery protects all 501 known current captures until fresh classification",
  },
  {
    name: "durable unknown replacement fence",
    entry: repairs,
    file: "persistent-terminal-marks.ts",
    match: /unknownOwners\.has\(terminal\)/,
    replacement: "false",
    assertion:
      "unknown ownership durably ends a preceding known review before World restart",
  },
  {
    name: "canonical capacity accounting",
    entry: repairs,
    file: "terminal-mark-budget.ts",
    match: /row\.binding\.state === "ended"\s*\? "ended"\s*: "unresolved"/,
    replacement: "row.binding.state",
    assertion:
      "a capacity-refused multi-stop observation changes no durable current row",
  },
  {
    name: "malformed native ingress refusal",
    entry: repairs,
    file: "terminal-mark-observation.ts",
    match: /validateEvent\(/,
    replacement: "void (",
    assertion:
      "malformed snapshot native identity refuses the complete observation without fatal callback or absence proof",
  },
  {
    name: "first observed stop coverage",
    entry: stops,
    file: "desk-state.ts",
    match: / \|\| !existing\?\.observed_stop_id/,
    replacement: "",
    assertion:
      "first observed done has a review identity without inventing a transition time",
  },
  {
    name: "unreviewed stop expiry",
    entry: stops,
    file: "desk-state.ts",
    match: /record\.observed_stop_id == null &&/,
    replacement: "",
    assertion:
      "aged stop survives SQLite expiry and restart (reviewed before expiry: false)",
  },
  {
    name: "unknown restart continuity",
    entry: stops,
    file: "persistent-terminal-marks.ts",
    match:
      /if\s*\(\s*!row\.binding\.evidence\.session &&\s*\(session !== undefined \|\| captured !== row\.id\)\s*\)\s*continue;/,
    replacement: "",
    assertion:
      "unknown-session restart must not fabricate continuity for a saved review",
  },
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
      "a positive session replacement ends Desk, while a watch follows its terminal move",
  },
  {
    name: "retired publication",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /ensureCurrent\(\);\s*const committedRows =/,
    replacement: "const committedRows =",
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
      "all 6 independent-family/refusal orders preserve only complete accepted record/binding pairs",
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
    name: "known Desk ownership admission",
    entry: consumers,
    file: "persistent-terminal-marks.ts",
    match: /guard\.valid &&=/,
    replacement: "guard.valid ||=",
    assertion:
      "pending known Desk RPC refuses replacement followed by the original ownership",
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
                  `new Worker(new URL(${JSON.stringify(control.file === "legacy-review-archive.ts" ? pathToFileURL(join(root, `${index}.worker.js`)).href : workerUrl)}))`,
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
    if (control.file === "legacy-review-archive.ts") {
      const worker = await Bun.build({
        entrypoints: [resolve(import.meta.dir, "../storage/world-worker.ts")],
        target: "bun",
        outdir: root,
        naming: `${index}.worker.js`,
        plugins: [
          {
            name: "archive-worker-control",
            setup(build) {
              build.onLoad(
                { filter: /legacy-review-archive\.ts$/ },
                (args) => ({
                  contents: readFileSync(args.path, "utf8").replace(
                    control.match!,
                    control.replacement!,
                  ),
                  loader: "ts",
                }),
              );
            },
          },
        ],
      });
      if (!worker.success) throw new Error(worker.logs.map(String).join("\n"));
    }
    const command = [
      process.execPath,
      "test",
      output,
      ...(control.assertion
        ? [
            "--test-name-pattern",
            control.assertion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ]
        : []),
    ];
    const child = Bun.spawn(command, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Positive bundles include 128 real serialized writes; this is a harness
    // deadline, not a latency assertion.
    const timeout = setTimeout(
      () => child.kill(),
      control.assertion ? 30_000 : 50_000,
    );
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
