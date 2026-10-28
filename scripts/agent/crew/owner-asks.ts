import type { Database } from "bun:sqlite";
import type { Deps } from "./deps";
import { digest, type Action } from "./plan";
import { actionsIn, getAction, setAction, type StoredAction } from "./store";

type Receipt = {
  ask?: string;
  closed?: boolean;
  rearm?: boolean;
  retired?: boolean;
};
function receipt(detail: string | null): Receipt | null {
  try {
    const value = JSON.parse(detail ?? "null") as Receipt | null;
    return value &&
      typeof value === "object" &&
      ((typeof value.ask === "string" && value.ask.length > 0) ||
        value.rearm === true ||
        value.retired === true)
      ? value
      : null;
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
  const save = (
    entry: StoredAction,
    state: "pending" | "sent" | "superseded",
    value: Receipt,
    attempted = false,
  ) => setAction(crew, entry.key, state, now, JSON.stringify(value), attempted);
  const create = (entry: StoredAction, prior: Receipt | null) => {
    // Persist uncertainty before dispatch: either a retry or cleanup must use
    // the key if World records the ask but its reply never reaches this process.
    save(entry, "pending", { ...prior, rearm: true, retired: false }, true);
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
      say(`#${entry.pr} couldn't record its owner ask; retrying next pass`);
      return;
    }
    const id = asked.result.id;
    save(entry, "sent", { ask: id, closed: Boolean(asked.result.answer) });
    if (asked.result.answer && !(prior?.ask === id && prior.closed))
      answered(entry, id, asked.result.answer.text);
    say(`#${entry.pr} asked owner (${id}): ${entry.text}`);
  };
  for (const entry of actionsIn(crew, ["pending", "sent", "superseded"])) {
    if (entry.target !== "owner" || (prs.length && !prs.includes(entry.pr)))
      continue;
    const known = receipt(entry.detail);
    if (!holds(crew, entry, keys)) {
      if (known?.retired) continue;
      const selector =
        known?.ask && !known.rearm
          ? [known.ask]
          : ["--key", `crew:${entry.key}`];
      const withdrawn = reply(
        deps.run(["herdr-world", "ask", "withdraw", ...selector, "--json"]),
      );
      if (withdrawn?.code === "refused") {
        save(entry, "superseded", { ...known, retired: true, rearm: false });
        say(
          `#${entry.pr} could not withdraw ${known?.ask ?? "its keyed ask"}; ${known?.closed ? "its answer was already read" : "left for the owner to answer"}`,
        );
        continue;
      }
      if (!withdrawn?.ok && withdrawn?.code !== "not_found") continue;
      const id = withdrawn?.result?.id ?? known?.ask;
      const answer = withdrawn?.result?.answer;
      const alreadyRead = known?.ask === id && known?.closed;
      save(entry, "superseded", {
        ask: id,
        retired: true,
        closed: Boolean(answer) || Boolean(alreadyRead),
      });
      if (answer && id && !alreadyRead) answered(entry, id, answer.text);
      say(`#${entry.pr} withdrew owner cause: ${entry.text}`);
      continue;
    }
    if (known?.ask && !known.rearm && !known.retired) {
      if (known.closed) continue;
      const answer = reply(
        deps.run(["herdr-world", "ask", "get", known.ask, "--json"]),
      );
      if (answer?.result?.withdrawn || answer?.code === "not_found") {
        const next = {
          ...known,
          rearm: true,
          closed: Boolean(answer?.result?.answer),
        };
        save(entry, "pending", next);
        if (answer?.result?.answer)
          answered(entry, known.ask, answer.result.answer.text);
        create(entry, next);
      } else if (answer?.result?.answer) {
        save(entry, "sent", { ...known, closed: true });
        answered(entry, known.ask, answer.result.answer.text);
      }
      continue;
    }
    create(entry, known);
  }
}
