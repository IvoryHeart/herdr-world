import { Value } from "typebox/value";
import type {
  AdapterCapture,
  AdapterDefinition,
  AdapterEntity,
  AdapterOwner,
  AdapterSource,
} from "./types";

/** Admission at the adapter boundary; this does not issue durable World IDs. */
export class AdapterSession<Context> {
  private source: AdapterSource | null = null;
  private unwatch: (() => void) | undefined;
  private retired = false;
  private inFlight: Promise<readonly AdapterEntity[]> | null = null;
  private active = 0;
  private requestTimes: number[] = [];
  private epoch: string | null = null;
  private nextLifetime = 0;
  private confirmed = false;
  private invalidation = 0;
  private rows = new Map<string, AdapterEntity>();
  private ended = new Set<string>();
  readonly ignored = { kinds: 0, fields: 0 };

  constructor(
    readonly definition: AdapterDefinition<Context>,
    private readonly context: Context,
    private readonly owner: AdapterOwner,
    private readonly enabled: boolean,
    private readonly onInvalidated: () => void = () => {},
    private readonly configuration: Record<string, unknown> = {},
  ) {}

  private current() {
    return !this.retired && this.owner.isCurrent();
  }

  private acquire() {
    if (!this.enabled || !this.current())
      throw new Error("adapter is disabled or retired");
    if (!this.source) {
      if (
        !Value.Check(
          this.definition.descriptor.configuration,
          this.configuration,
        )
      )
        throw new Error("invalid adapter configuration");
      this.source = this.definition.open(this.context);
      if (this.definition.descriptor.capabilities.events) {
        this.unwatch = this.source.watch?.(() => {
          if (this.current()) {
            this.confirmed = false;
            this.invalidation++;
            this.onInvalidated();
          }
        });
      }
    }
    return this.source;
  }

  private reserve(weight = 1) {
    const limits = this.definition.descriptor.limits;
    if (this.active + weight > limits.concurrency)
      throw new Error("adapter concurrency limit");
    const now = this.owner.monotonic();
    this.requestTimes = this.requestTimes.filter((time) => time > now - 1000);
    if (this.requestTimes.length + weight > limits.requestsPerSecond)
      throw new Error("adapter rate limit");
    for (let i = 0; i < weight; i++) this.requestTimes.push(now);
    this.active += weight;
  }

  refresh(): Promise<readonly AdapterEntity[]> {
    if (!this.enabled || !this.current()) return Promise.resolve([]);
    if (this.inFlight) return this.inFlight;
    this.confirmed = false;
    const work = this.read();
    this.inFlight = work;
    void work
      .finally(() => {
        if (this.inFlight === work) this.inFlight = null;
      })
      .catch(() => {});
    return work;
  }

  private async read(): Promise<readonly AdapterEntity[]> {
    const { descriptor } = this.definition;
    const source = this.acquire();
    const startedAt = this.invalidation;
    const acquired = new Map<string, AdapterEntity>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let epoch: string | undefined;
    let complete = descriptor.capabilities.completeListings;
    let bytes = 0;
    let count = 0;
    const revisions = new Set<string>();
    for (let pageNumber = 0; ; pageNumber++) {
      if (!this.current()) return [];
      if (pageNumber >= descriptor.limits.pages)
        throw new Error("adapter page limit");
      this.reserve(descriptor.limits.requestsPerPage);
      let page;
      try {
        page = await source.list({ cursor, limit: descriptor.limits.pageSize });
      } finally {
        this.active -= descriptor.limits.requestsPerPage;
      }
      if (!this.current()) return [];
      bytes += Buffer.byteLength(JSON.stringify(page));
      count += page.rows.length;
      if (bytes > descriptor.limits.bytes)
        throw new Error("adapter byte limit");
      if (count > descriptor.limits.entities)
        throw new Error("adapter entity limit");
      if (page.rows.length > descriptor.limits.pageSize)
        throw new Error("adapter page size limit");
      if (!page.epoch || (epoch !== undefined && page.epoch !== epoch))
        throw new Error("adapter reset during listing");
      if (descriptor.capabilities.sourceRevisions) {
        if (!page.revision) throw new Error("adapter missing revision");
        revisions.add(page.revision);
        if (revisions.size > 1)
          throw new Error("adapter revision changed during listing");
      }
      epoch = page.epoch;
      complete &&= page.complete;
      for (const row of page.rows) {
        const kind = Object.hasOwn(descriptor.kinds, row.kind)
          ? descriptor.kinds[row.kind]
          : undefined;
        if (!kind) {
          this.ignored.kinds++;
          complete = false;
          continue;
        }
        const properties = kind.payload.properties as Record<string, unknown>;
        const payload = Object.fromEntries(
          Object.entries(row.payload).filter(([field]) => {
            if (Object.hasOwn(properties, field)) return true;
            this.ignored.fields++;
            return false;
          }),
        );
        if (!Value.Check(kind.payload, payload))
          throw new Error("adapter invalid payload");
        const nativeId = payload[kind.keyField];
        if (typeof nativeId !== "string" || nativeId.length === 0)
          throw new Error("adapter invalid key");
        const evidence =
          kind.continuityFields.length > 0 &&
          kind.continuityFields.every(
            (field) =>
              typeof payload[field] === "string" && payload[field] !== "",
          )
            ? JSON.stringify(
                kind.continuityFields.map((field) => payload[field]),
              )
            : null;
        const key = JSON.stringify([this.owner.instanceId, row.kind, nativeId]);
        if (acquired.has(key)) throw new Error("adapter duplicate key");
        acquired.set(key, {
          key,
          nativeId,
          kind: row.kind,
          epoch,
          evidence,
          payload,
          lifetime: 0,
        });
      }
      cursor = page.cursor;
      if (cursor === undefined) break;
      if (!cursor || cursors.has(cursor))
        throw new Error("adapter repeated cursor");
      cursors.add(cursor);
    }
    if (!this.current()) return [];
    const nextRows = new Map(this.rows);
    const ended = new Set(this.ended);
    if (this.epoch !== null && this.epoch !== epoch) {
      for (const row of nextRows.values()) ended.add(this.lifetime(row));
      nextRows.clear();
    }
    for (const [key, row] of nextRows) {
      const next = acquired.get(key);
      if ((complete && !next) || (next && next.evidence !== row.evidence)) {
        ended.add(this.lifetime(row));
        nextRows.delete(key);
      }
    }
    for (const [key, row] of acquired) {
      row.lifetime = nextRows.get(key)?.lifetime ?? ++this.nextLifetime;
      nextRows.set(key, row);
    }
    if (nextRows.size > descriptor.limits.entities)
      throw new Error("adapter retained entity limit");
    if (
      Buffer.byteLength(JSON.stringify([...nextRows.values()])) >
      descriptor.limits.bytes
    )
      throw new Error("adapter retained byte limit");
    // Old captures become unconfirmed after the bounded tombstone horizon.
    while (ended.size > descriptor.limits.entities)
      ended.delete(ended.values().next().value!);
    this.epoch = epoch!;
    this.rows = nextRows;
    this.ended = ended;
    this.confirmed = startedAt === this.invalidation;
    return this.entities();
  }

  private lifetime(row: AdapterCapture) {
    return JSON.stringify([row.key, row.epoch, row.evidence, row.lifetime]);
  }

  entities(): readonly AdapterEntity[] {
    return this.current() ? [...this.rows.values()] : [];
  }

  /** Conservative evidence check for consumers; durable binding policy is separate. */
  resolve(capture: AdapterCapture): "attached" | "unconfirmed" | "ended" {
    if (!this.current()) return "unconfirmed";
    if (this.ended.has(this.lifetime(capture))) return "ended";
    if (!this.confirmed) return "unconfirmed";
    const row = this.rows.get(capture.key);
    return row &&
      row.lifetime === capture.lifetime &&
      row.epoch === capture.epoch &&
      row.evidence !== null &&
      row.evidence === capture.evidence
      ? "attached"
      : "unconfirmed";
  }

  claims(entity: AdapterCapture) {
    if (this.resolve(entity) !== "attached") return [];
    const row = this.rows.get(entity.key)!;
    return Object.entries(row.payload).map(([field, value]) => ({
      field,
      value,
      instanceId: this.owner.instanceId,
      epoch: row.epoch,
      evidence: row.evidence,
    }));
  }

  async dispatch(
    verb: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const verbs = this.definition.descriptor.verbs;
    const declaration = Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
    if (!declaration) throw new Error("undeclared adapter verb");
    if (!Value.Check(declaration.input, input))
      throw new Error("invalid adapter verb input");
    const source = this.acquire();
    this.reserve();
    try {
      const result = await source.dispatch(verb, input);
      if (!this.current()) throw new Error("adapter owner retired");
      if (
        Buffer.byteLength(JSON.stringify(result)) >
        this.definition.descriptor.limits.bytes
      )
        throw new Error("adapter byte limit");
      if (!Value.Check(declaration.output, result))
        throw new Error("invalid adapter verb output");
      return result;
    } finally {
      this.active--;
    }
  }

  retire() {
    if (this.retired) return;
    this.retired = true;
    this.unwatch?.();
    this.rows.clear();
    this.ended.clear();
  }
}
