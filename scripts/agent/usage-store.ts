import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  attribute,
  clipEstimates,
  type Row,
  type Window,
} from "./usage-attribution";
import type { Seat, UsageEvent, UsageGap } from "./usage-records";
import { reconcileEvents } from "./usage-reconcile";

export type Assignment = {
  pr: number;
  seat: string;
  session: string;
  role: Window["role"];
  from: string;
  until: string;
};
type RegisteredSeat = Seat & { claimedPrs?: number[] };

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
    return this.values<RegisteredSeat>("usage_sessions");
  }
  private rememberSeat(seat: Seat, claimedPrs: number[] = []) {
    const key = `${seat.family}:${seat.session}`;
    const prior = this.db
      .query("SELECT payload FROM usage_sessions WHERE key = ?")
      .get(key) as { payload: string } | null;
    const previous: RegisteredSeat | undefined = prior
      ? JSON.parse(prior.payload)
      : undefined;
    const known = [
      ...new Set([
        ...(previous?.claimedPrs ?? []),
        ...((seat as RegisteredSeat).claimedPrs ?? []),
        ...claimedPrs,
      ]),
    ];
    this.db
      .query("INSERT OR REPLACE INTO usage_sessions VALUES (?, ?)")
      .run(key, JSON.stringify({ ...previous, ...seat, claimedPrs: known }));
  }
  assignments() {
    return this.values<Assignment>("usage_assignments");
  }
  rows() {
    return this.values<Row>("usage_rows");
  }
  windows(pr: number) {
    return this.values<Window>("usage_windows").filter((w) => w.pr === pr);
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
      this.rememberSeat(seat);
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
    pr: number | null,
    sessions: {
      seat: Seat;
      events: UsageEvent[];
      gaps?: UsageGap[];
      claimedPrs?: number[];
    }[],
    windows: Window[],
    missing: number,
    validReviews?: Set<string>,
  ) {
    this.db
      .transaction(() => {
        const established = clipEstimates(
          this.values<Window>("usage_windows"),
          sessions,
        );
        const retained = established
          .filter((w) => w.pr === pr)
          .filter(
            (w) =>
              w.source !== "review" ||
              !validReviews ||
              validReviews.has(JSON.stringify([w.seat, w.until])),
          );
        for (const { seat, events, claimedPrs } of sessions) {
          const key = `${seat.family}:${seat.session}`;
          this.rememberSeat(seat, claimedPrs);
          const previous = (
            this.db
              .query("SELECT payload FROM usage_events WHERE session_key = ?")
              .all(key) as { payload: string }[]
          ).map((r) => JSON.parse(r.payload) as UsageEvent);
          const reconciled = reconcileEvents([...previous, ...events]);
          this.db
            .query("DELETE FROM usage_events WHERE session_key = ?")
            .run(key);
          for (const merged of reconciled) {
            const id = JSON.stringify([seat.family, seat.session, merged.id]);
            this.db
              .query("INSERT OR REPLACE INTO usage_events VALUES (?, ?, ?)")
              .run(id, key, JSON.stringify(merged));
          }
        }
        this.db.exec("DELETE FROM usage_windows");
        const mergedWindows = new Map(
          [
            ...established.filter((w) => w.pr !== pr),
            ...retained,
            ...clipEstimates(windows, sessions),
          ].map((w) => [
            JSON.stringify([w.pr, w.session, w.seat, w.role, w.from, w.source]),
            w,
          ]),
        );
        for (const window of mergedWindows.values())
          this.db
            .query("INSERT INTO usage_windows VALUES (?, ?)")
            .run(window.pr, JSON.stringify(window));
        const rows = attribute(
          this.values<UsageEvent>("usage_events"),
          this.values<Window>("usage_windows"),
        );
        this.db.exec("DELETE FROM usage_rows");
        for (const row of rows)
          this.db
            .query("INSERT INTO usage_rows VALUES (?)")
            .run(JSON.stringify(row));
        if (pr !== null)
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
