import { Type } from "typebox";
import type { AdapterDefinition, AdapterPage, AdapterRow } from "../types";

/** Test composition only. No import from any production entrypoint. */
export class SyntheticSource {
  private rows: AdapterRow[];
  epoch = "seeded-0";
  complete = true;
  revision = 0;
  requests = 0;
  dispatches = 0;
  listeners = new Set<() => void>();
  beforeRead: (() => Promise<void>) | undefined;
  transform: (page: AdapterPage) => AdapterPage = (page) => page;

  constructor(seed: number) {
    this.rows = [
      this.row("Opaque/" + (seed >>> 0).toString(36) + ":A"),
      this.row("opaque/" + (seed >>> 0).toString(36) + ":A"),
    ];
  }

  row(id: string, evidence = "birth-0"): AdapterRow {
    return {
      kind: "item",
      payload: { id, birth: evidence, label: "Example", status: "ready" },
    };
  }

  set(
    rows: AdapterRow[],
    options: { complete?: boolean; epoch?: string } = {},
  ) {
    this.rows = structuredClone(rows);
    this.complete = options.complete ?? true;
    this.epoch = options.epoch ?? this.epoch;
    this.revision++;
  }

  // Event order is intentionally unrelated to listing revisions or payloads.
  emit(_event: { type: string; id?: string } = { type: "changed" }) {
    void _event;
    for (const invalidate of this.listeners) invalidate();
  }

  async list({
    cursor,
    limit,
  }: {
    cursor?: string;
    limit: number;
  }): Promise<AdapterPage> {
    this.requests++;
    await this.beforeRead?.();
    const start = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error("bad synthetic cursor");
    const size = Math.min(limit, 2);
    return this.transform({
      epoch: this.epoch,
      revision: String(this.revision),
      complete: this.complete,
      rows: structuredClone(this.rows.slice(start, start + size)),
      ...(start + size < this.rows.length
        ? { cursor: String(start + size) }
        : {}),
    });
  }
}

export const syntheticAdapter: AdapterDefinition<SyntheticSource> = {
  descriptor: {
    kind: "synthetic-test-only",
    capabilities: {
      completeListings: true,
      events: true,
      getById: false,
      sourceRevisions: true,
    },
    kinds: {
      item: {
        payload: Type.Object({
          id: Type.String({ minLength: 1, maxLength: 512 }),
          birth: Type.String(),
          label: Type.String(),
          status: Type.String(),
        }),
        keyField: "id",
        continuityFields: ["birth"],
        terminal: false,
      },
    },
    verbs: {
      inspect: {
        input: Type.Object({}, { additionalProperties: false }),
        output: Type.Object({ ok: Type.Boolean() }),
        recovery: "read-only",
      },
    },
    configuration: Type.Object({}, { additionalProperties: false }),
    limits: {
      concurrency: 1,
      requestsPerPage: 1,
      pageSize: 2,
      pages: 8,
      requestsPerSecond: 64,
      entities: 16,
      bytes: 8192,
    },
  },
  open(source) {
    return {
      list: (request) => source.list(request),
      dispatch: async () => {
        source.dispatches++;
        return { ok: true };
      },
      watch(invalidate) {
        source.listeners.add(invalidate);
        return () => {
          source.listeners.delete(invalidate);
        };
      },
    };
  },
};
