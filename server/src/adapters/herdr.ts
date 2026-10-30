import { Type } from "typebox";
import type { AdapterDefinition, AdapterPage, AdapterRow } from "./types";

export type HerdrObservationContext = {
  call(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown>;
  /** Supplied by the runtime owner; must change on replacement/restart. */
  epoch(): string;
  watch?(invalidate: () => void): () => void;
};

const id = Type.String({ minLength: 1, maxLength: 512 });
const label = Type.Optional(Type.String());
const kinds = {
  workspace: {
    payload: Type.Object({ workspace_id: id, label }),
    keyField: "workspace_id",
    continuityFields: [],
    terminal: false,
  },
  tab: {
    payload: Type.Object({
      tab_id: id,
      workspace_id: Type.Optional(id),
      label,
    }),
    keyField: "tab_id",
    continuityFields: [],
    terminal: false,
  },
  pane: {
    payload: Type.Object({
      pane_id: id,
      terminal_id: Type.Optional(Type.String()),
      workspace_id: Type.Optional(id),
      tab_id: Type.Optional(id),
      label,
      agent_status: Type.Optional(Type.String()),
    }),
    keyField: "pane_id",
    continuityFields: ["terminal_id"],
    terminal: true,
  },
  agent: {
    payload: Type.Object({
      pane_id: id,
      terminal_id: Type.Optional(Type.String()),
      label,
      agent: Type.Optional(Type.String()),
      state_change_seq: Type.Optional(Type.Number()),
    }),
    keyField: "pane_id",
    continuityFields: ["terminal_id"],
    terminal: true,
  },
};
const lists = ["workspace", "tab", "pane", "agent"] as const;
const nativeKeys = ["workspaces", "tabs", "panes", "agents"] as const;

/** Exactly today's snapshot reads: concurrent; only agent.list is optional. */
export async function readHerdrSnapshot(
  client: Pick<HerdrObservationContext, "call">,
): Promise<readonly [unknown, unknown, unknown, unknown]> {
  const results = await Promise.allSettled(
    lists.map((kind) => client.call(kind + ".list", {}, 5_000)),
  );
  const [workspace, tabs, panes, agents] = results;
  if (workspace.status === "rejected") throw workspace.reason;
  if (tabs.status === "rejected") throw tabs.reason;
  if (panes.status === "rejected") throw panes.reason;
  return [
    workspace.value,
    tabs.value,
    panes.value,
    agents.status === "fulfilled" ? agents.value : null,
  ];
}

export const herdrAdapter: AdapterDefinition<HerdrObservationContext> = {
  descriptor: {
    kind: "herdr",
    capabilities: {
      completeListings: true,
      events: true,
      getById: false,
      sourceRevisions: false,
    },
    kinds,
    // This observation port offers read-only native lists. Actor policy and the
    // legacy mutation dispatch migration belong to task 7.1, not this registry.
    verbs: Object.fromEntries(
      lists.map((kind, i) => [
        kind + ".list",
        {
          input: Type.Object({}, { additionalProperties: false }),
          output: Type.Object({
            [nativeKeys[i]]: Type.Array(Type.Unknown(), { maxItems: 10752 }),
          }),
          recovery: "read-only" as const,
        },
      ]),
    ),
    configuration: Type.Object({}, { additionalProperties: false }),
    limits: {
      concurrency: 4,
      requestsPerPage: 4,
      pageSize: 10752,
      pages: 1,
      requestsPerSecond: 64,
      entities: 10752,
      bytes: 4 * 1024 * 1024,
    },
  },
  open(context) {
    return {
      async list({ cursor }): Promise<AdapterPage> {
        if (cursor !== undefined)
          throw new Error("Herdr lists are not paginated");
        const epoch = context.epoch();
        const raw = await readHerdrSnapshot(context);
        if (epoch !== context.epoch())
          throw new Error("Herdr reset during listing");
        const rows: AdapterRow[] = [];
        let complete = true;
        for (const [index, value] of raw.entries()) {
          const records = (value as Record<string, unknown> | null)?.[
            nativeKeys[index]
          ];
          if (!Array.isArray(records)) {
            if (index < 3) throw new Error("invalid Herdr listing");
            complete = false;
            continue;
          }
          for (const payload of records) {
            if (
              !payload ||
              typeof payload !== "object" ||
              Array.isArray(payload)
            )
              throw new Error("invalid Herdr row");
            rows.push({ kind: lists[index], payload });
          }
        }
        return { epoch, complete, rows };
      },
      dispatch: (verb, input) => context.call(verb, input, 5_000),
      watch: context.watch,
    };
  },
};
