import { herdrAdapter } from "../herdr";
import type { AdapterDefinition, AdapterPage, AdapterRow } from "../types";
import type { ConformanceFixture } from "./conformance";
import { SyntheticSource, syntheticAdapter } from "./synthetic";

function hold(next: (before: () => Promise<void>) => void) {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  next(() => promise);
  return release;
}

export function syntheticFixture(): ConformanceFixture {
  const source = new SyntheticSource(42);
  return {
    definition: syntheticAdapter as AdapterDefinition<unknown>,
    context: source,
    kind: "item",
    row: source.row.bind(source),
    set: source.set.bind(source),
    emit: () => source.emit(),
    calls: () => source.requests + source.dispatches,
    watches: () => source.listeners.size,
    hold: () =>
      hold((before) => {
        source.beforeRead = before;
      }),
    corrupt: (transform) => {
      source.transform = transform;
    },
  };
}

export function herdrFixture(): ConformanceFixture {
  let rows: AdapterRow[] = [];
  let epoch = "runtime-1";
  let complete = true;
  let calls = 0;
  let before = async () => {};
  let transform = (page: AdapterPage) => page;
  const listeners = new Set<() => void>();
  const context = {
    epoch: () => epoch,
    async call(method: string) {
      calls++;
      await before();
      if (!complete && method === "agent.list")
        throw new Error("optional catalogue unavailable");
      const kind = method.split(".")[0];
      const keys: Record<string, string> = {
        workspace: "workspaces",
        tab: "tabs",
        pane: "panes",
        agent: "agents",
      };
      return {
        [keys[kind]]: rows
          .filter((row) => row.kind === kind)
          .map((row) => row.payload),
      };
    },
    watch(invalidate: () => void) {
      listeners.add(invalidate);
      return () => {
        listeners.delete(invalidate);
      };
    },
  };
  return {
    // Malformed provider pages are fault injection after native translation.
    definition: {
      ...herdrAdapter,
      open() {
        const source = herdrAdapter.open(context);
        return {
          ...source,
          list: async (request) => transform(await source.list(request)),
        };
      },
    } as AdapterDefinition<unknown>,
    context,
    kind: "pane",
    row: (id, evidence = "terminal-1") => ({
      kind: "pane",
      payload: { pane_id: id, terminal_id: evidence, label: "Example" },
    }),
    set(next, options = {}) {
      // Unknown kinds cannot come from the fixed native Herdr list endpoints;
      // inject forward protocol data at the adapter boundary for this case.
      const unknown = next.filter(
        (row) => !["workspace", "tab", "pane", "agent"].includes(row.kind),
      );
      transform = (page) => ({ ...page, rows: [...page.rows, ...unknown] });
      rows = next;
      epoch = options.epoch ?? epoch;
      complete = options.complete ?? true;
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
    calls: () => calls,
    watches: () => listeners.size,
    hold: () =>
      hold((value) => {
        before = value;
      }),
    corrupt: (value) => {
      transform = value;
    },
  };
}
