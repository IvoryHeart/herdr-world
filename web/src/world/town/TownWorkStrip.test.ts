import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BridgeControlMsg } from "../../api";
import { WorldStatusesStore, type WorkStatus } from "../worldStatuses";
import { TownWorkStrip } from "./TownWorkStrip";

const MIN = 60_000;
const row = (fields: Partial<WorkStatus> & Pick<WorkStatus, "key">) =>
  ({
    id: `s-${fields.key}`,
    line: `Line ${fields.key}`,
    state: "working",
    group: "Crew",
    at: 0,
    updated_at: 0,
    stale_at: 60 * MIN,
    actor: { label: "Synthetic program", verified: false },
    ...fields,
  }) as WorkStatus;

const render = (rows: WorkStatus[], now: number) =>
  renderToStaticMarkup(createElement(TownWorkStrip, { rows, now }));

test("no rows, no strip", () => {
  expect(render([], 0)).toBe("");
  // A row a day past stale is gone, as the service drops it.
  expect(render([row({ key: "old" })], 60 * MIN + 24 * 60 * MIN)).toBe("");
});

test("rows show grouped with their mark, line, phase, progress, age and link", () => {
  const html = render(
    [
      row({
        key: "crew-42",
        phase: "review",
        progress: 40,
        url: "https://example.invalid/42",
      }),
      row({ key: "nightly", state: "failed", group: "CI" }),
      row({ key: "crew-43", state: "blocked", needs_you: true }),
    ],
    5 * MIN,
  );
  expect(html).toContain("Work <span>3</span>");
  // Groups in first-reported order; Crew's rows together.
  expect(html.indexOf("<h4>Crew</h4>")).toBeLessThan(
    html.indexOf("<h4>CI</h4>"),
  );
  expect(html.indexOf("crew-43")).toBeLessThan(html.indexOf("<h4>CI</h4>"));
  expect(html).toContain("crew-42 · review · 40% · updated 5 m ago");
  expect(html).toContain(
    '<a href="https://example.invalid/42" target="_blank" rel="noopener noreferrer">Line crew-42</a>',
  );
  expect(html).toContain('data-mark="offline" title="Failed"');
  expect(html).toContain('data-mark="needs" title="Blocked"');
  expect(html).toContain("Line crew-43 · needs you");
});

test("a row past its ttl says it is stale and when it last changed", () => {
  const html = render([row({ key: "crew-42", stale_at: 2 * MIN })], 7 * MIN);
  expect(html).toContain("data-stale");
  expect(html).toContain("crew-42 · stale · last update 7 m ago");
});

test("the store fetches rows only for a status change notice, and again on reconnect", async () => {
  let control: (msg: BridgeControlMsg) => void = () => {};
  let status: (value: "connected" | "disconnected") => void = () => {};
  let revision = 1;
  const calls: string[] = [];
  const store = new WorldStatusesStore({
    call: async (method) => {
      calls.push(method);
      return { revision, statuses: [row({ key: `r${revision}` })] };
    },
    onControl: (callback) => {
      control = callback;
      return () => {};
    },
    onStatus: (callback) => {
      status = callback as typeof status;
      return () => {};
    },
  });
  store.start();
  await store.refresh();
  expect(store.get().map((entry) => entry.key)).toEqual(["r1"]);
  const before = calls.length;
  revision = 2;
  control({ type: "world_ledger_changed", revision: 2, asks: true });
  await Promise.resolve();
  expect(calls.length).toBe(before);
  control({ type: "world_ledger_changed", revision: 2, statuses: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.get().map((entry) => entry.key)).toEqual(["r2"]);
  // A restarted service counts from the start again.
  revision = 1;
  status("connected");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.get().map((entry) => entry.key)).toEqual(["r1"]);
  store.stop();
});
