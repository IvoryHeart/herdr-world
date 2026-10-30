import type { Database } from "bun:sqlite";

export type Round = {
  pr: number;
  round: number;
  head: string;
  tab: string | null;
};

/** A PR head's open round, numbering a new one after the PR's last. */
export function roundFor(
  db: Database,
  pr: number,
  head: string,
  now: number,
  fresh = false,
) {
  const found = db
    .query<Round, [number, string]>(
      `SELECT pr, round, head, tab FROM round
       WHERE pr = ? AND head = ? AND closed_at IS NULL`,
    )
    .get(pr, head);
  if (found && !fresh) return found;
  const last = db
    .query<{ round: number | null }, [number]>(
      "SELECT MAX(round) AS round FROM round WHERE pr = ?",
    )
    .get(pr);
  const round = (last?.round ?? 0) + 1;
  db.query(
    "INSERT INTO round (pr, round, head, created_at) VALUES (?, ?, ?, ?)",
  ).run(pr, round, head, now);
  return { pr, round, head, tab: null };
}

export function setRoundTab(
  db: Database,
  pr: number,
  round: number,
  tab: string,
) {
  db.query("UPDATE round SET tab = ? WHERE pr = ? AND round = ?").run(
    tab,
    pr,
    round,
  );
}

export function openRounds(db: Database) {
  return db
    .query<Round, []>(
      "SELECT pr, round, head, tab FROM round WHERE closed_at IS NULL ORDER BY pr, round",
    )
    .all();
}

export function closeRound(
  db: Database,
  pr: number,
  round: number,
  now: number,
) {
  db.query("UPDATE round SET closed_at = ? WHERE pr = ? AND round = ?").run(
    now,
    pr,
    round,
  );
}
