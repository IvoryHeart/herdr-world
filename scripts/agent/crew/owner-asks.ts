import type { Database } from "bun:sqlite";
import type { Deps } from "./deps";
import { digest, type Action } from "./plan";
import { actionsIn, getAction, setAction, type StoredAction } from "./store";

type Receipt = { ask: string; closed?: boolean };
function receipt(detail: string | null): Receipt | null {
  try {
    const value = JSON.parse(detail ?? "null") as Receipt | null;
    return value && typeof value.ask === "string" ? value : null;
  } catch {
    return null;
  }
}
function reply(result: ReturnType<Deps["run"]>) {
  try {
    const value = JSON.parse(result.stdout) as {
      ok: boolean;
      code?: string;
      result?: { id?: string; answer?: { text: string }; withdrawn?: unknown };
    };
    return typeof value.ok === "boolean" && !(result.code !== 0 && value.ok)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Only these causes still need the owner, even after their ask has been sent. */
function holds(crew: Database, entry: StoredAction, keys: Set<string>) {
  const [base, suffix] = entry.key.split("|");
  if (!keys.has(base!)) return false;
  if (!suffix) return true;
  const parent = getAction(crew, base!);
  if (suffix === "overdue") return parent?.state === "running";
  if (suffix === "stuck")
    return parent?.state === "done" || parent?.state === "failed";
  const cause = parent?.detail ?? "";
  if (suffix === "unreachable")
    return parent?.state === "pending" && parent.attempts >= 3;
  return (
    parent?.state === "pending" &&
    (suffix === `waits-${digest(cause)}` ||
      (suffix === "waits" &&
        ["no live seat", "never prompted", "blocked"].includes(cause)))
  );
}

/** Uses the existing World ask ledger, from the watcher's own verified pane. */
export function reconcileOwnerAsks(
  crew: Database,
  planned: Action[],
  context: { prs: number[]; now: number; deps: Deps },
  say: (text: string) => void,
) {
  const { prs, now, deps } = context;
  const keys = new Set(planned.map((entry) => entry.key));
  const answered = (entry: StoredAction, id: string, text: string) => {
    const line = `#${entry.pr} owner answered ${id}: ${text}`;
    say(line);
    deps.out(line);
  };
  for (const entry of actionsIn(crew, ["pending", "sent", "superseded"])) {
    if (entry.target !== "owner" || (prs.length && !prs.includes(entry.pr)))
      continue;
    const known = receipt(entry.detail);
    if (!holds(crew, entry, keys)) {
      if (known) {
        const withdrawn = reply(
          deps.run(["herdr-world", "ask", "withdraw", known.ask, "--json"]),
        );
        if (!withdrawn?.ok && withdrawn?.code !== "not_found") continue;
        if (withdrawn?.result?.answer && !known.closed) {
          setAction(crew, entry.key, "superseded", now);
          answered(entry, known.ask, withdrawn.result.answer.text);
        }
      }
      if (entry.state !== "superseded" || known) {
        setAction(crew, entry.key, "superseded", now);
        say(`#${entry.pr} withdrew owner cause: ${entry.text}`);
      }
      continue;
    }
    if (known) {
      if (known.closed) continue;
      const answer = reply(
        deps.run(["herdr-world", "ask", "get", known.ask, "--json"]),
      );
      if (
        answer?.result?.answer ||
        answer?.result?.withdrawn ||
        answer?.code === "not_found"
      ) {
        setAction(
          crew,
          entry.key,
          "sent",
          now,
          JSON.stringify({ ...known, closed: true }),
        );
        if (answer?.result?.answer) {
          answered(entry, known.ask, answer.result.answer.text);
        }
      }
      continue;
    }
    const asked = reply(
      deps.run([
        "herdr-world",
        "ask",
        entry.text,
        "--key",
        `crew:${entry.key}`,
        "--owner-only",
        "--json",
      ]),
    );
    if (!asked?.ok || !asked.result?.id) {
      if (entry.state !== "pending")
        setAction(crew, entry.key, "pending", now, "World ask unavailable");
      say(`#${entry.pr} couldn't record its owner ask; retrying next pass`);
      continue;
    }
    setAction(
      crew,
      entry.key,
      "sent",
      now,
      JSON.stringify({ ask: asked.result.id }),
      true,
    );
    say(`#${entry.pr} asked owner (${asked.result.id}): ${entry.text}`);
  }
}
