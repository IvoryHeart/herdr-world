import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crewPass } from "./crew";
import { openCrewStore, openLock } from "./crew/store";
import { config, confirm, input, NOW, SHA } from "./gate/cases";
import { evaluate, type GateInput } from "./gate/predicate";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup(readyAsk?: unknown) {
  const root = mkdtempSync(join(tmpdir(), "crew-ready-asks-"));
  const configPath = join(root, "config.json");
  const gateConfig = { ...config, reviewers: { default: ["rev2"] } };
  writeFileSync(
    configPath,
    JSON.stringify({ ...gateConfig, crew: { readyAsk } }),
  );
  const crew = openCrewStore(":memory:");
  const lock = openLock(":memory:");
  cleanups.push(() => {
    crew.close();
    lock.close();
    rmSync(root, { recursive: true, force: true });
  });
  const calls: string[][] = [];
  const output: string[] = [];
  const pass = (value: GateInput, dryRun = false) =>
    crewPass({
      judge: () => ({
        verdicts: [evaluate(value, gateConfig, NOW)],
        inputs: [value],
      }),
      crew,
      lock,
      configPath,
      dir: root,
      prs: [7],
      dryRun,
      now: NOW,
      worker: ["bun", "crew.ts"],
      deps: {
        run: (argv) => {
          calls.push(argv);
          return {
            code: 0,
            stdout:
              argv[0] === "herdr"
                ? '{"result":{"agents":[]}}'
                : '{"ok":true,"result":{"id":"q-synthetic"}}',
            stderr: "",
          };
        },
        spawn: () => {
          throw new Error("Unexpected reviewer launch");
        },
        closeTab: () => true,
        openTab: () => null,
        usage: () => null,
        alive: () => false,
        kill: () => {},
        out: (line) => output.push(line),
      },
    });
  const asks = () =>
    calls.filter(
      (argv) =>
        argv[0] === "herdr-world" &&
        argv[1] === "ask" &&
        !["get", "withdraw"].includes(argv[2]!),
    );
  return { pass, calls, output, asks };
}

const ready = () =>
  input({ head: SHA.reviewed, posts: [confirm("rev2", SHA.reviewed)] });

test.each([undefined, false])(
  "READY owner asks default on and can be disabled without removing the mark: %s",
  (readyAsk) => {
    const f = setup(readyAsk);
    f.pass(ready());
    f.pass(ready());
    expect(f.asks()).toHaveLength(readyAsk === false ? 0 : 1);
    expect(
      f.calls.filter(
        (argv) =>
          argv.includes("context=crew/merge-ready") &&
          argv.includes("state=success"),
      ),
    ).toHaveLength(1);
  },
);

test("disabling READY asks preserves real judgement escalation", () => {
  const f = setup(false);
  const value = input({
    head: SHA.reviewed,
    posts: [
      confirm("rev2", SHA.reviewed),
      { reviewer: null, commit: SHA.reviewed, result: "0/1 resolved, 1 new" },
    ],
  });
  f.pass(value);
  f.pass(value);
  expect(f.asks()).toHaveLength(1);
  expect(f.asks()[0]![2]).toContain("NEEDS-OWNER");
  expect(
    f.calls.filter(
      (argv) =>
        argv.includes("context=crew/needs-owner") &&
        argv.includes("state=pending"),
    ),
  ).toHaveLength(1);
});

test("dry run omits READY asks while retaining the mechanical mark", () => {
  const f = setup(false);
  expect(f.pass(ready(), true)).toEqual([]);
  expect(
    f.output.some((line) => line.includes("crew/merge-ready success")),
  ).toBe(true);
  expect(f.calls.some((argv) => argv[0] === "herdr-world")).toBe(false);
});

test("a nonboolean READY-ask setting is rejected before acting", () => {
  const f = setup("false");
  expect(() => f.pass(ready())).toThrow("crew.readyAsk must be a boolean");
  expect(f.calls).toEqual([]);
});
