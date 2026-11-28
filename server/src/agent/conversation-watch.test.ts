import { expect, test } from "bun:test";
import { createConversationWatcher } from "./conversation-watch";

function setup() {
  let key = "a";
  let path: string | null = "/work/demo/session.jsonl";
  const notified: string[] = [];
  const files = new Map<string, () => void>();
  let checks = 0;
  let seen = 0;
  let wake: (() => void) | null = null;
  const watcher = createConversationWatcher({
    identity: async () => {
      checks++;
      wake?.();
      return { key, paths: path ? [path] : [] };
    },
    notify: (paneId, owners) => notified.push(`${paneId}:${owners.size}`),
    watchFile: (file, onChange) => {
      files.set(file, onChange);
      return () => files.delete(file);
    },
    debounceMs: 1,
  });
  // Waits for the next identity check the watcher makes, then lets its
  // continuation (watching files, notifying) run.
  const flushTasks = async () => {
    while (checks <= seen)
      await new Promise<void>((resolve) => (wake = resolve));
    seen = checks;
    wake = null;
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    watcher,
    notified,
    files,
    flushTasks,
    setKey: (value: string) => (key = value),
    setPath: (value: string | null) => (path = value),
  };
}

test("a watched pane notifies its owners only when its identity changes", async () => {
  const { watcher, notified, flushTasks, setKey } = setup();
  const browser = {};
  watcher.watch(browser, "w1:p1");
  await flushTasks();
  expect(notified).toEqual([]);
  watcher.herdrEvent();
  await flushTasks();
  expect(notified).toEqual([]);
  setKey("b");
  watcher.herdrEvent();
  await flushTasks();
  expect(notified).toEqual(["w1:p1:1"]);
});

test("a local transcript change notifies without a Herdr event", async () => {
  const { watcher, notified, files, flushTasks, setKey, setPath } = setup();
  watcher.watch({}, "w1:p1");
  await flushTasks();
  expect([...files.keys()]).toEqual(["/work/demo/session.jsonl"]);
  setKey("appended");
  files.get("/work/demo/session.jsonl")!();
  await flushTasks();
  expect(notified).toEqual(["w1:p1:1"]);
  // A new thread moves the watch to its transcript.
  setPath("/work/demo/next.jsonl");
  setKey("next");
  watcher.herdrEvent();
  await flushTasks();
  expect([...files.keys()]).toEqual(["/work/demo/next.jsonl"]);
});

test("the last owner leaving stops the watch", async () => {
  const { watcher, files, flushTasks } = setup();
  const first = {};
  const second = {};
  watcher.watch(first, "w1:p1");
  watcher.watch(second, "w1:p1");
  await flushTasks();
  watcher.unwatch(first, "w1:p1");
  expect(watcher.watchedPanes()).toEqual(["w1:p1"]);
  watcher.unwatch(second);
  expect(watcher.watchedPanes()).toEqual([]);
  expect(files.size).toBe(0);
});
