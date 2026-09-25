const MAX_WATCHES = 128;
const MAX_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 100;

export type WorldWatchRecord = {
  connection_id: string;
  connection_generation: number;
  terminal_id: string;
  label: string;
};

export type WorldWatchlist = {
  revision: number;
  records: readonly WorldWatchRecord[];
};

export class WorldWatchlistRegistry {
  private revision = 0;
  private records = new Map<string, WorldWatchRecord>();

  list(): WorldWatchlist {
    return { revision: this.revision, records: [...this.records.values()] };
  }

  pin(record: WorldWatchRecord): { changed: boolean; revision: number } {
    const normalized = normalize(record);
    const key = watchKey(normalized);
    if (this.records.has(key))
      return { changed: false, revision: this.revision };
    if (this.records.size >= MAX_WATCHES) {
      throw new Error(`World watchlist is full (${MAX_WATCHES} records)`);
    }
    this.records.set(key, normalized);
    this.revision += 1;
    return { changed: true, revision: this.revision };
  }

  unpin(
    identity: Pick<
      WorldWatchRecord,
      "connection_id" | "connection_generation" | "terminal_id"
    >,
  ): { changed: boolean; revision: number } {
    const key = watchKey(normalize({ ...identity, label: "Watch" }));
    if (!this.records.delete(key))
      return { changed: false, revision: this.revision };
    this.revision += 1;
    return { changed: true, revision: this.revision };
  }

  retireConnectionGeneration(
    connectionId: string,
    generation: number,
  ): { changed: boolean; revision: number } {
    let changed = false;
    for (const [key, record] of this.records) {
      if (
        record.connection_id === connectionId &&
        record.connection_generation !== generation
      ) {
        this.records.delete(key);
        changed = true;
      }
    }
    if (changed) this.revision += 1;
    return { changed, revision: this.revision };
  }
}

export function watchKey(
  record: Pick<
    WorldWatchRecord,
    "connection_id" | "connection_generation" | "terminal_id"
  >,
) {
  return JSON.stringify([
    record.connection_id,
    record.connection_generation,
    record.terminal_id,
  ]);
}

function normalize(record: WorldWatchRecord): WorldWatchRecord {
  if (
    !validId(record.connection_id) ||
    !validId(record.terminal_id) ||
    !Number.isSafeInteger(record.connection_generation) ||
    record.connection_generation < 0
  ) {
    throw new Error("invalid World watch identity");
  }
  const label =
    typeof record.label === "string"
      ? [...record.label.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim()]
          .slice(0, MAX_LABEL_LENGTH)
          .join("")
      : "";
  return { ...record, label: label || "Watch" };
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}
