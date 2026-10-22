import { expect, test } from "bun:test";
import { createConversationWatcher } from "./conversation-watch";

function setup() {
  let key = "a";
  let path: string | null = "/work/demo/session.jsonl";
  const notified: string[] = [];
  const files = new Map<string, () => void>();
  const watcher = createConversationWatcher({
    identity: async () => ({ key, path }),
    notify: (paneId, owners) => notified.push(`${paneId}:${owners.size}`),
    watchFile: (file, onChange) => {
      files.set(file, onChange);
      return () => files.delete(file);
    },
    debounceMs: 1,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return {
    watcher,
    notified,
    files,
    settle,
    setKey: (value: string) => (key = value),
    setPath: (value: string | null) => (path = value),
  };
}

test("a watched pane notifies its owners only when its identity changes", async () => {
  const { watcher, notified, settle, setKey } = setup();
  const browser = {};
  watcher.watch(browser, "w1:p1");
  await settle();
  expect(notified).toEqual([]);
  watcher.herdrEvent();
  await settle();
  expect(notified).toEqual([]);
  setKey("b");
  watcher.herdrEvent();
  await settle();
  expect(notified).toEqual(["w1:p1:1"]);
});

test("a local transcript change notifies without a Herdr event", async () => {
  const { watcher, notified, files, settle, setKey, setPath } = setup();
  watcher.watch({}, "w1:p1");
  await settle();
  expect([...files.keys()]).toEqual(["/work/demo/session.jsonl"]);
  setKey("appended");
  files.get("/work/demo/session.jsonl")!();
  await settle();
  expect(notified).toEqual(["w1:p1:1"]);
  // A new thread moves the watch to its transcript.
  setPath("/work/demo/next.jsonl");
  setKey("next");
  watcher.herdrEvent();
  await settle();
  expect([...files.keys()]).toEqual(["/work/demo/next.jsonl"]);
});

test("the last owner leaving stops the watch", async () => {
  const { watcher, files, settle } = setup();
  const first = {};
  const second = {};
  watcher.watch(first, "w1:p1");
  watcher.watch(second, "w1:p1");
  await settle();
  watcher.unwatch(first, "w1:p1");
  expect(watcher.watchedPanes()).toEqual(["w1:p1"]);
  watcher.unwatch(second);
  expect(watcher.watchedPanes()).toEqual([]);
  expect(files.size).toBe(0);
});
