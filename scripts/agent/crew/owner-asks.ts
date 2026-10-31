import type { Database } from "bun:sqlite";
import type { Deps } from "./deps";
import { digest, type Action } from "./plan";
import { actionsIn, getAction, setAction, type StoredAction } from "./store";
import { timeoutHolds } from "./run-lifecycle";
import { reportOwnerDecision } from "./round-policy";

type Receipt = {
  ask?: string;
  closed?: boolean;
  rearm?: boolean;
  withdrawing?: boolean;
  retired?: boolean;
  /**
   * A failed ask: its error, reported once, and what the World CLI looked
   * like then (`failureInputs`). It is asked again only when those change.
   */
  failed?: { reason: string; inputs: string };
};

/**
 * What a failed ask depended on, read without asking: the CLI's version and
 * World's answer to `whoami`, including whether it verified this pane (keyed
 * asks need that). `whoami` records nothing and alerts no one.
 */
function failureInputs(deps: Deps) {
  const version = deps.run(["herdr-world", "--version"]);
  const world = deps.run(["herdr-world", "whoami", "--json"]);
  const answer = reply(world);
  return [
    `${version.code} ${version.stdout.trim()}`,
    answer?.ok
      ? `ok ${answer.actor?.verified === true ? "verified" : "unverified"} ${answer.actor?.label ?? ""}`
      : `${world.code} ${answer?.code ?? ""} ${answer?.error ?? (world.stderr || world.stdout).trim().slice(0, 200)}`,
  ].join(" | ");
}
function receipt(detail: string | null): Receipt | null {
  try {
    const value = JSON.parse(detail ?? "null") as Receipt | null;
    return value &&
      typeof value === "object" &&
      ((typeof value.ask === "string" && value.ask.length > 0) ||
        typeof value.failed === "object" ||
        value.rearm === true ||
        value.withdrawing === true ||
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
      error?: string;
      actor?: { label?: string; verified?: boolean };
      result?: {
        id?: string;
        answer?: { text: string };
        withdrawn?: unknown;
        dismissed?: unknown;
      };
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
  if (suffix === "timeout") return timeoutHolds(crew, entry);
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
  context: { prs: number[]; now: number; deps: Deps; escalate?: string },
  say: (text: string) => void,
) {
  const { prs, now, deps } = context;
  // Tell the configured seat once about an ask that reached no one.
  const escalate = (entry: StoredAction, text: string) => {
    if (!context.escalate) return;
    const sent = deps.run([
      "herdr",
      "agent",
      "prompt",
      context.escalate,
      `crew: ${text} (#${entry.pr}: ${entry.text.split("\n")[0]!.slice(0, 160)})`,
    ]);
    if (sent.code !== 0)
      say(
        `#${entry.pr} couldn't tell ${context.escalate}: ${(sent.stderr || sent.stdout).trim().slice(0, 200)}`,
      );
  };
  let inputs: string | undefined;
  const currentInputs = () => (inputs ??= failureInputs(deps));
  const keys = new Set(planned.map((entry) => entry.key));
  const answered = (entry: StoredAction, id: string, text: string) => {
    reportOwnerDecision(crew, entry, text);
    const line = `#${entry.pr} owner answered ${id}: ${text}`;
    say(line);
    deps.out(line);
  };
  const save = (
    entry: StoredAction,
    state: "pending" | "sent" | "superseded" | "failed",
    value: Receipt,
    attempted = false,
  ) => setAction(crew, entry.key, state, now, JSON.stringify(value), attempted);
  const create = (entry: StoredAction, prior: Receipt | null) => {
    // Persist uncertainty before dispatch: either a retry or cleanup must use
    // the key if World records the ask but its reply never reaches this process.
    save(
      entry,
      "pending",
      { ...prior, rearm: true, retired: false, withdrawing: false },
      true,
    );
    const run = deps.run([
      "herdr-world",
      "ask",
      entry.text,
      "--key",
      `crew:${entry.key}`,
      "--owner-only",
      "--json",
    ]);
    const asked = reply(run);
    if (!asked?.result?.id) {
      const reason =
        asked?.error ??
        `herdr-world exited ${run.code}: ${(run.stderr || run.stdout).trim().slice(0, 200)}`;
      // Held until the CLI or World changes; each distinct failure is said
      // and escalated once.
      if (prior?.failed?.reason !== reason) {
        say(`#${entry.pr} couldn't ask the owner: ${reason}`);
        escalate(entry, `owner ask failed: ${reason}`);
      }
      inputs = undefined;
      save(entry, "failed", {
        ...prior,
        rearm: true,
        retired: false,
        withdrawing: false,
        failed: { reason, inputs: currentInputs() },
      });
      return;
    }
    // Recorded, but no one was alerted (exit 6): the question waits in World.
    if (asked.code === "not_delivered") {
      const line = `owner ask ${asked.result.id} reached no one: ${asked.error}`;
      say(`#${entry.pr} ${line}`);
      escalate(entry, line);
    }
    const id = asked.result.id;
    const dismissed = Boolean(asked.result.dismissed);
    save(entry, "sent", {
      ask: id,
      closed: Boolean(asked.result.answer) || dismissed,
    });
    if (asked.result.answer && !(prior?.ask === id && prior.closed))
      answered(entry, id, asked.result.answer.text);
    say(
      dismissed
        ? `#${entry.pr} owner dismissed ${id}: ${entry.text}`
        : `#${entry.pr} asked owner (${id}): ${entry.text}`,
    );
  };
  for (const entry of actionsIn(crew, [
    "pending",
    "sent",
    "superseded",
    "failed",
  ])) {
    if (
      entry.target !== "owner" ||
      (prs.length &&
        !prs.includes(entry.pr) &&
        entry.key.split("|")[1] !== "timeout")
    )
      continue;
    const known = receipt(entry.detail);
    if (entry.state === "superseded" && !known) continue;
    const active = holds(crew, entry, keys);
    if (!active || known?.withdrawing) {
      if (known?.retired) continue;
      const knownId = known?.rearm ? undefined : known?.ask;
      const selector = knownId ? [knownId] : ["--key", `crew:${entry.key}`];
      // Settle an uncertain withdrawal before a recurrence, even if the old
      // answer was read already. Preserve its acknowledgement before dispatch.
      save(entry, "superseded", { ...known, withdrawing: true });
      const withdrawn = reply(
        deps.run(["herdr-world", "ask", "withdraw", ...selector, "--json"]),
      );
      if (withdrawn?.code === "refused") {
        save(entry, "superseded", {
          ...known,
          retired: true,
          rearm: false,
          withdrawing: false,
        });
        say(
          `#${entry.pr} could not withdraw ${knownId ?? "its keyed ask"}; ${knownId && known?.closed ? "its answer was already read" : "left for the owner to answer"}`,
        );
        continue;
      }
      if (!withdrawn?.ok && withdrawn?.code !== "not_found") continue;
      const id = withdrawn?.result?.id ?? known?.ask;
      const answer = withdrawn?.result?.answer;
      const alreadyRead = known?.ask === id && known?.closed;
      const retired: Receipt = {
        ask: id,
        retired: true,
        closed: Boolean(answer) || Boolean(alreadyRead),
      };
      save(entry, "superseded", retired);
      if (answer && id && !alreadyRead) answered(entry, id, answer.text);
      say(
        `#${entry.pr} ${withdrawn?.code === "not_found" ? "no recorded ask to withdraw for owner cause" : "withdrew owner cause"}: ${entry.text}`,
      );
      if (active) create(entry, retired);
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
      } else if (answer?.result?.dismissed) {
        // Closed without an answer: not asked again while the cause holds.
        save(entry, "sent", { ...known, closed: true });
        say(`#${entry.pr} owner dismissed ${known.ask}: ${entry.text}`);
      }
      continue;
    }
    if (known?.failed && known.failed.inputs === currentInputs()) continue;
    create(entry, known);
  }
}
