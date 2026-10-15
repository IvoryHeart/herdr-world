export const ledgerPath = "upstream/dispositions.json";
export type Disposition = {
  commit: string;
  title: string;
  status: "adopted" | "adapted" | "deferred" | "divergent";
  reason: string;
  evidence: string[];
  followUp: string | null;
  revisitWhen: string | null;
  reviewedFor: string;
};
export type Ledger = { schema: 1; source: string; changes: Disposition[] };
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const outstanding = (entry: Disposition) =>
  entry.status === "deferred" || entry.status === "divergent";

/** Validate data only; never execute candidate code to establish parity. */
export function validateLedger(value: unknown): Ledger {
  const ledger = value as Ledger;
  if (
    !ledger ||
    ledger.schema !== 1 ||
    !sha(ledger.source) ||
    !Array.isArray(ledger.changes)
  )
    throw new Error("Invalid upstream disposition ledger");
  const commits = new Set<string>();
  for (const entry of ledger.changes) {
    if (
      !entry ||
      !sha(entry.commit) ||
      commits.has(entry.commit) ||
      !text(entry.title) ||
      !text(entry.reason) ||
      !sha(entry.reviewedFor) ||
      !["adopted", "adapted", "deferred", "divergent"].includes(entry.status) ||
      !Array.isArray(entry.evidence) ||
      !entry.evidence.length ||
      !entry.evidence.every(text) ||
      !(entry.followUp === null || text(entry.followUp)) ||
      !(entry.revisitWhen === null || text(entry.revisitWhen)) ||
      (outstanding(entry) &&
        (!text(entry.followUp) ||
          !/^(?:docs\/upstream-follow-ups\.md#[a-z0-9-]+|https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9][0-9]*)$/.test(
            entry.followUp,
          ) ||
          !text(entry.revisitWhen)))
    )
      throw new Error("Invalid, duplicate or untraceable upstream disposition");
    commits.add(entry.commit);
  }
  return ledger;
}

/** Return whether independent agent approval must remain a comment. */
export function validateTransition(
  before: Ledger,
  after: Ledger,
  base: string,
  target: string,
  commits: string[],
): boolean {
  if (before.source !== base || after.source !== target)
    throw new Error("Disposition source does not match frozen synchronization");
  const previous = new Map(
    before.changes.map((entry) => [entry.commit, entry]),
  );
  const incoming = new Set(commits);
  const current = new Map(after.changes.map((entry) => [entry.commit, entry]));
  let human = false;
  const policy = (entry: Disposition) =>
    JSON.stringify([
      entry.commit,
      entry.title,
      entry.status,
      entry.reason,
      entry.evidence,
      entry.followUp,
      entry.revisitWhen,
    ]);
  for (const entry of before.changes) {
    const next = current.get(entry.commit);
    if (!next) throw new Error("Historical upstream disposition was removed");
    if (outstanding(entry)) {
      if (next.reviewedFor !== target)
        throw new Error(
          "Outstanding upstream decision was not reconsidered for this target",
        );
      if (policy(entry) !== policy(next)) human = true;
    } else if (policy(entry) !== policy(next)) human = true;
  }
  for (const entry of after.changes) {
    if (!previous.has(entry.commit)) {
      if (!incoming.has(entry.commit) || entry.reviewedFor !== target)
        throw new Error("Unexpected or stale upstream disposition");
      if (outstanding(entry)) human = true;
    }
  }
  for (const commit of incoming)
    if (!current.has(commit))
      throw new Error("Upstream commit lacks a disposition");
  return human;
}
