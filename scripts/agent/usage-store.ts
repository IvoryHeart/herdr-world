import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { attribute, type Row, type Window } from "./usage-attribution";
import type { Seat, UsageEvent } from "./usage-records";

export type Assignment = {
  pr: number;
  seat: string;
  session: string;
  role: Window["role"];
  from: string;
  until?: string;
};

/** Own tables only: coordlab's gate database and schema remain independent. */
export class UsageStore {
  private db: Database;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_sessions (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_events (key TEXT PRIMARY KEY, session_key TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_assignments (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_windows (pr INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_status (pr INTEGER PRIMARY KEY, missing INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_rows (payload TEXT NOT NULL);
    `);
  }
  private values<T>(table: string): T[] {
    return (
      this.db.query(`SELECT payload FROM ${table}`).all() as {
        payload: string;
      }[]
    ).map((r) => JSON.parse(r.payload) as T);
  }
  sessions() {
    return this.values<Seat>("usage_sessions");
  }
  assignments() {
    return this.values<Assignment>("usage_assignments");
  }
  rows() {
    return this.values<Row>("usage_rows");
  }
  missing(pr: number) {
    return (
      (
        this.db
          .query("SELECT missing FROM usage_status WHERE pr = ?")
          .get(pr) as { missing: number } | null
      )?.missing ?? 0
    );
  }
  async publish<T>(action: () => Promise<T>): Promise<T> {
    // Keep the writer lock through the remote read/create so two local invocations
    // cannot both observe an absent marked comment and create duplicates.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  assign(assignment: Assignment, seat: Seat) {
    this.db.transaction(() => {
      this.db
        .query("INSERT OR REPLACE INTO usage_sessions VALUES (?, ?)")
        .run(`${seat.family}:${seat.session}`, JSON.stringify(seat));
      this.db
        .query("INSERT OR REPLACE INTO usage_assignments VALUES (?, ?)")
        .run(
          JSON.stringify([
            assignment.pr,
            assignment.session,
            assignment.role,
            assignment.from,
          ]),
          JSON.stringify(assignment),
        );
    })();
  }
  refresh(
    pr: number,
    sessions: { seat: Seat; events: UsageEvent[] }[],
    windows: Window[],
    missing: number,
  ) {
    this.db
      .transaction(() => {
        const retained = this.values<Window>("usage_windows").filter(
          (w) =>
            w.pr === pr &&
            w.source !== "assignment" &&
            !sessions.some((s) => s.seat.session === w.session),
        );
        for (const { seat, events } of sessions) {
          const key = `${seat.family}:${seat.session}`;
          this.db
            .query("INSERT OR REPLACE INTO usage_sessions VALUES (?, ?)")
            .run(key, JSON.stringify(seat));
          // Upsert rather than delete: a live/truncated/moved log must not erase measured usage.
          for (const event of events) {
            const id = JSON.stringify([seat.family, seat.session, event.id]);
            const previous = this.db
              .query("SELECT payload FROM usage_events WHERE key = ?")
              .get(id) as { payload: string } | null;
            const merged = { ...event };
            if (previous) {
              const prior = JSON.parse(previous.payload) as UsageEvent;
              for (const field of [
                "input",
                "cacheRead",
                "cacheWrite",
                "output",
              ] as const)
                merged[field] = Math.max(prior[field], event[field]);
              merged.at = prior.at < event.at ? prior.at : event.at;
            }
            this.db
              .query("INSERT OR REPLACE INTO usage_events VALUES (?, ?, ?)")
              .run(id, key, JSON.stringify(merged));
          }
        }
        this.db.query("DELETE FROM usage_windows WHERE pr = ?").run(pr);
        for (const window of [...windows, ...retained])
          this.db
            .query("INSERT INTO usage_windows VALUES (?, ?)")
            .run(pr, JSON.stringify(window));
        const rows = attribute(
          this.values<UsageEvent>("usage_events"),
          this.values<Window>("usage_windows"),
        );
        this.db.exec("DELETE FROM usage_rows");
        for (const row of rows)
          this.db
            .query("INSERT INTO usage_rows VALUES (?)")
            .run(JSON.stringify(row));
        this.db
          .query("INSERT OR REPLACE INTO usage_status VALUES (?, ?)")
          .run(pr, missing);
      })
      .immediate();
  }
  close() {
    this.db.close();
  }
}
