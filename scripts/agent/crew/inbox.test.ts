import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realDeps, type Deps } from "./deps";
import {
  browserCommand,
  inboxCommand,
  inboxTab,
  itemLine,
  nudgeItems,
  openItem,
} from "./inbox";
import { listItems, openOwnerStore, putItem } from "./owner-items";

const root = mkdtempSync(join(tmpdir(), "inbox-cli-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture() {
  const calls: string[][] = [];
  const output: string[] = [];
  let refuse = "";
  let tabs = 0;
  const deps: Deps = {
    ...realDeps,
    out: (text) => output.push(text),
    run: (argv) => {
      calls.push(argv);
      if (argv.includes(refuse))
        return { code: 1, stdout: "", stderr: "unavailable" };
      if (argv[1] === "tab" && argv[2] === "create")
        return {
          code: 0,
          stdout: JSON.stringify({
            result: {
              tab: { tab_id: `test:t${++tabs}` },
              root_pane: { pane_id: "test:p1" },
            },
          }),
          stderr: "",
        };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return {
    deps,
    calls,
    output,
    refuse: (value: string) => {
      refuse = value;
    },
  };
}

test("dispatcher uses the same list, deduplicates and explicitly resolves stuck work", async () => {
  const dir = join(root, "dispatch");
  const { deps, calls, output } = fixture();
  const add = [
    "add",
    "--key",
    "item:8:stuck",
    "--reason",
    "No PR after an hour",
    "--pr",
    "8",
    "--seat",
    "test-seat",
  ];
  await inboxCommand([...add], dir, deps);
  await inboxCommand([...add], dir, deps);
  await inboxCommand(["--json"], dir, deps);
  const items = JSON.parse(output.at(-1)!);
  expect(items).toHaveLength(1);
  expect(items[0].source).toBe("dispatch");
  expect(items[0].target).toEqual({ kind: "seat", value: "test-seat" });
  expect(calls.filter((argv) => argv[1] === "notification")).toHaveLength(1);
  await inboxCommand(["open", String(items[0].id)], dir, deps);
  expect(calls.at(-1)).toEqual(["herdr", "agent", "focus", "test-seat"]);
  await inboxCommand(["resolve", "--key", "item:8:stuck"], dir, deps);
  await inboxCommand(["--json"], dir, deps);
  expect(JSON.parse(output.at(-1)!)).toEqual([]);
});

test("dispatcher dismissal persists across repeats, and recurs only after resolution", async () => {
  const dir = join(root, "dismiss");
  const { deps, calls, output } = fixture();
  const add = [
    "add",
    "--key",
    "item:9:question",
    "--reason",
    "Choose a design",
    "--url",
    "https://example.com/issues/9",
  ];
  await inboxCommand([...add], dir, deps);
  await inboxCommand(["--json"], dir, deps);
  const id = JSON.parse(output.at(-1)!)[0].id;
  await inboxCommand(["dismiss", String(id)], dir, deps);
  await inboxCommand([...add], dir, deps);
  await inboxCommand(["--json"], dir, deps);
  expect(JSON.parse(output.at(-1)!)).toEqual([]);
  expect(calls.filter((argv) => argv[1] === "notification")).toHaveLength(1);
  await inboxCommand(["resolve", "--key", "item:9:question"], dir, deps);
  await inboxCommand([...add], dir, deps);
  expect(calls.filter((argv) => argv[1] === "notification")).toHaveLength(2);
});

test("the live tab is created in the background, reused and replaced if closed", () => {
  const { deps, calls, refuse } = fixture();
  const db = openOwnerStore(":memory:");
  expect(inboxTab(db, root, deps)).toBe("test:t1");
  expect(calls.find((argv) => argv[2] === "create")).toContain("--no-focus");
  expect(calls.find((argv) => argv[1] === "pane")!.at(-1)).toContain(
    "inbox watch",
  );
  expect(inboxTab(db, root, deps)).toBe("test:t1");
  expect(calls.filter((argv) => argv[2] === "create")).toHaveLength(1);
  refuse("get");
  expect(inboxTab(db, root, deps)).toBe("test:t2");
  refuse("");
  expect(inboxTab(db, root, deps, true)).toBe("test:t2");
  expect(calls.at(-1)).toEqual(["herdr", "tab", "focus", "test:t2"]);
  db.close();
});

test("a failed tab launch is cleaned up; a failed nudge keeps the durable item", () => {
  const { deps, calls, refuse } = fixture();
  const db = openOwnerStore(":memory:");
  putItem(
    db,
    {
      source: "crew",
      key: "ready:7",
      reason: "READY #7",
      pr: 7,
      target: { kind: "url", value: "https://example.com/pull/7" },
    },
    1,
  );
  refuse("run");
  expect(inboxTab(db, root, deps)).toBeNull();
  expect(calls.at(-1)).toEqual(["herdr", "tab", "close", "test:t1"]);
  refuse("notification");
  nudgeItems(db, root, deps, 2);
  expect(listItems(db)[0]!.notifiedAt).toBeNull();
  refuse("");
  nudgeItems(db, root, deps, 3);
  expect(listItems(db)[0]!.notifiedAt).toBe(3);
  expect(calls.filter((argv) => argv[1] === "notification").at(-1)).toContain(
    "done",
  );
  db.close();
});

test("each target opens with one explicit action and reports failures", () => {
  const { deps, calls, refuse } = fixture();
  openItem({ kind: "url", value: "https://example.com/pull/7" }, deps);
  openItem({ kind: "seat", value: "test-seat" }, deps);
  openItem({ kind: "tab", value: "test:t1" }, deps);
  expect(calls).toEqual([
    browserCommand("https://example.com/pull/7"),
    ["herdr", "agent", "focus", "test-seat"],
    ["herdr", "tab", "focus", "test:t1"],
  ]);
  refuse("focus");
  expect(() => openItem({ kind: "seat", value: "test-seat" }, deps)).toThrow(
    "unavailable",
  );
  openItem(
    {
      kind: "tab",
      value: "test:t1",
      fallbackUrl: "https://example.com/pull/7",
    },
    deps,
  );
  expect(calls.at(-1)).toEqual(browserCommand("https://example.com/pull/7"));
});

test("opens HTTPS links using the platform browser without a shell", () => {
  const url = "https://example.com/pull/7";
  expect(browserCommand(url, "linux")).toEqual(["xdg-open", url]);
  expect(browserCommand(url, "darwin")).toEqual(["open", url]);
  expect(browserCommand(url, "win32")).toEqual([
    "rundll32.exe",
    "url.dll,FileProtocolHandler",
    url,
  ]);
});

describe("input boundaries", () => {
  test("requires one action target and a valid PR", async () => {
    const { deps } = fixture();
    await expect(
      inboxCommand(["add", "--key", "x", "--reason", "question"], root, deps),
    ).rejects.toThrow("exactly one");
    await expect(
      inboxCommand(
        [
          "add",
          "--key",
          "x",
          "--reason",
          "question",
          "--seat",
          "test",
          "--pr",
          "NaN",
        ],
        root,
        deps,
      ),
    ).rejects.toThrow("positive number");
  });
  test("renders one line without terminal escape injection", () => {
    expect(
      itemLine({
        id: 1,
        source: "dispatch",
        key: "x",
        reason: "hello\n\x1b[2J",
        target: { kind: "seat", value: "test" },
        createdAt: 0,
        dismissedAt: null,
        resolvedAt: null,
        notifiedAt: null,
      }),
    ).toBe("1 hello  [2J");
  });
});
