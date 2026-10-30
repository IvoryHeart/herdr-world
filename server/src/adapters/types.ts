import type { TObject, TSchema } from "typebox";

/** Data only: safe to serialize to clients. Configuration contains no secrets. */
export type AdapterDescriptor = {
  kind: string;
  capabilities: {
    completeListings: boolean;
    events: boolean;
    getById: boolean;
    sourceRevisions: boolean;
  };
  kinds: Record<
    string,
    {
      payload: TObject;
      keyField: string;
      continuityFields: readonly string[];
      terminal: boolean;
    }
  >;
  verbs: Record<
    string,
    {
      input: TSchema;
      output: TSchema;
      recovery: "read-only" | "idempotent" | "repeatable" | "non-repeatable";
    }
  >;
  configuration: TSchema;
  limits: {
    concurrency: number;
    requestsPerPage: number;
    pageSize: number;
    pages: number;
    requestsPerSecond: number;
    entities: number;
    bytes: number;
  };
};

export type AdapterRow = { kind: string; payload: Record<string, unknown> };
export type AdapterPage = {
  /** Source incarnation, independent of the owner's retirement fence. */
  epoch: string;
  rows: AdapterRow[];
  /** True only if the whole listing, across all pages, is authoritative. */
  complete: boolean;
  cursor?: string;
  revision?: string;
};

export type AdapterSource = {
  list(request: { cursor?: string; limit: number }): Promise<AdapterPage>;
  dispatch(verb: string, input: Record<string, unknown>): Promise<unknown>;
  /** Events invalidate; their payloads never become observations. */
  watch?(invalidate: () => void): () => void;
};

export type AdapterDefinition<Context> = {
  descriptor: AdapterDescriptor;
  open(context: Context): AdapterSource;
};

export type AdapterOwner = {
  instanceId: string;
  isCurrent(): boolean;
  monotonic(): number;
};

export type AdapterEntity = {
  /** Tuple encoding preserves case and separators without delimiter aliases. */
  key: string;
  kind: string;
  nativeId: string;
  epoch: string;
  lifetime: number;
  evidence: string | null;
  payload: Record<string, unknown>;
};

export type AdapterCapture = Pick<
  AdapterEntity,
  "key" | "epoch" | "evidence" | "lifetime"
>;
