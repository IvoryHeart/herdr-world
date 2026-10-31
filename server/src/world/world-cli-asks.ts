import { CliError } from "./world-cli-errors";
import type { CliHost, WorldCliDeps } from "./world-cli";
import { paneActor } from "./world-cli-actor";
export { askSessionFingerprint } from "./world-cli-actor";
import {
  askClosed,
  LEDGER_LIMITS,
  type CliActor,
  type LedgerStore,
} from "./world-ledger";

export const ASK_WAIT_MAX_MS = 20_000;
const usage = (message: string): never => {
  throw new CliError("usage", message);
};
const refused = (message: string): never => {
  throw new CliError("refused", message);
};
const notFound = (message: string): never => {
  throw new CliError("not_found", message);
};
const text = (
  value: unknown,
  what: string,
  max = LEDGER_LIMITS.text,
): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    usage(`${what} must be text of at most ${max} characters`);
  return (value as string).trim();
};

/** A cause key and withdrawal belong to the verified asking occupant. */
function sameAsker(left: CliActor, right: CliActor) {
  return (
    left.verified &&
    right.verified &&
    left.connection_id === right.connection_id &&
    (left.connection_generation === right.connection_generation ||
      Boolean(
        left.agent_session_fingerprint && right.agent_session_fingerprint,
      )) &&
    left.pane_id === right.pane_id &&
    left.terminal_id === right.terminal_id &&
    left.agent_session_fingerprint === right.agent_session_fingerprint &&
    left.agent_session_id === right.agent_session_id
  );
}

/**
 * The asker as World shows it: a verified caller as identified, and an
 * unverified caller's claimed pane where exactly one local Herdr has it,
 * still marked unverified. Either way, Herdr's name for the agent there.
 */
async function placeAsker(
  hosts: readonly CliHost[],
  actor: CliActor,
): Promise<CliActor> {
  const paneId = actor.pane_id;
  if (!paneId) return actor;
  let host = hosts.find(
    (entry) =>
      entry.connection_id === actor.connection_id &&
      entry.generation === actor.connection_generation,
  );
  let placed = actor;
  if (!actor.verified) {
    const found: { host: CliHost; actor: CliActor }[] = [];
    for (const entry of hosts) {
      if (!entry.local) continue;
      const pane = await paneActor(entry, paneId);
      if (pane.state === "unknown") return actor;
      if (pane.state === "present")
        found.push({ host: entry, actor: pane.actor });
    }
    if (found.length !== 1) return actor;
    host = found[0]!.host;
    placed = { ...found[0]!.actor, label: actor.label, verified: false };
  }
  if (!host || !placed.agent) return placed;
  const agent = (
    (await host.call("agent.get", { target: paneId }).catch(() => null)) as {
      agent?: { name?: unknown };
    } | null
  )?.agent;
  return typeof agent?.name === "string" && agent.name.trim()
    ? { ...placed, name: agent.name.trim().slice(0, 100) }
    : placed;
}

/** Wait `ms`, or less when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function handleWorldAsk(
  deps: WorldCliDeps,
  command: string,
  params: Record<string, unknown>,
  actor: CliActor,
  now: () => number,
): Promise<unknown> {
  switch (command) {
    case "ask withdraw": {
      let ask;
      if (params.key !== undefined) {
        if (params.id !== undefined)
          usage("use either a question ID or a cause key");
        const key = text(params.key, "the cause key", 512);
        if (!actor.verified)
          refused("cause keys require a verified asking pane");
        const retained = deps.ledger
          .get()
          .asks.filter(
            (entry) => entry.key === key && sameAsker(entry.actor, actor),
          )
          .reverse();
        ask = retained.find((entry) => !entry.withdrawn) ?? retained[0];
        if (!ask)
          return notFound(
            "no retained question for this asking occupant and cause key",
          );
      } else {
        const id = text(params.id, "the question ID");
        ask = deps.ledger.ask(id);
        if (!ask) return notFound(`no question ${id}`);
      }
      const id = ask.id;
      if (!sameAsker(ask.actor, actor))
        refused("only the verified asker can withdraw its question");
      if (ask.withdrawn) return ask;
      deps.publishLedger(
        await deps.ledger.update((document) => {
          document.asks.find((entry) => entry.id === id)!.withdrawn = {
            at: now(),
          };
        }),
        true,
      );
      return deps.ledger.ask(id);
    }
    case "ask": {
      const question = text(params.question, "the question");
      const key =
        params.key === undefined
          ? undefined
          : text(params.key, "the cause key", 512);
      if (key && !actor.verified)
        refused("cause keys require a verified asking pane");
      const options = Array.isArray(params.options)
        ? params.options.map((option) =>
            text(option, "an option", LEDGER_LIMITS.option),
          )
        : [];
      if (options.length > LEDGER_LIMITS.options)
        usage(`at most ${LEDGER_LIMITS.options} options`);
      // Identity lookup may wait. Recheck keys/allowances inside the serialized
      // ledger mutation, so concurrent requests cannot bypass admission.
      const asker = await placeAsker(deps.hosts(), actor);
      const notificationConnection =
        asker.connection_id ?? deps.defaultConnectionId();
      if (key) {
        const known = deps.ledger
          .get()
          .asks.find(
            (ask) =>
              ask.key === key && !ask.withdrawn && sameAsker(ask.actor, actor),
          );
        if (known) return known;
      }
      const open = deps.ledger.openAsks().asks;
      if (open.length >= LEDGER_LIMITS.asks)
        refused("too many open questions; wait for answers");
      // Verified panes each have their own allowance; unverified callers,
      // whatever they claim, share one.
      const bucket = (entry: CliActor) =>
        entry.verified
          ? `${entry.connection_id}\u0000${entry.pane_id}`
          : "unverified";
      if (
        open.filter((entry) => bucket(entry.actor) === bucket(actor)).length >=
        LEDGER_LIMITS.asksPerActor
      )
        refused(
          `you have ${LEDGER_LIMITS.asksPerActor} open questions; wait for answers`,
        );
      const recipient = await deps.captureRecipient?.(asker);
      let id = await deps.ledger.nextId("q");
      let created = true;
      deps.publishLedger(
        await deps.ledger.update(
          (document) => {
            if (key) {
              const retained = document.asks.find(
                (ask) =>
                  ask.key === key &&
                  !ask.withdrawn &&
                  sameAsker(ask.actor, actor),
              );
              if (retained) {
                id = retained.id;
                created = false;
                return;
              }
            }
            const pending = document.asks.filter((ask) => !askClosed(ask));
            if (pending.length >= LEDGER_LIMITS.asks)
              refused("too many open questions; wait for answers");
            if (
              pending.filter((ask) => bucket(ask.actor) === bucket(actor))
                .length >= LEDGER_LIMITS.asksPerActor
            )
              refused(
                `you have ${LEDGER_LIMITS.asksPerActor} open questions; wait for answers`,
              );
            document.asks.push({
              id,
              at: now(),
              actor: asker,
              ...(recipient ? { recipient } : {}),
              question,
              ...(key ? { key } : {}),
              options,
              owner_only: params.owner_only === true,
            });
          },
          () =>
            created
              ? [
                  {
                    kind: "ask.created",
                    record_id: id,
                    recovery: "repeatable",
                    target: notificationConnection
                      ? { connection_id: notificationConnection }
                      : null,
                  },
                ]
              : [],
        ),
        true,
      );
      // The service dispatches the atomically enqueued attention entry.
      return { id, created };
    }
    case "ask get": {
      const id = text(params.id, "the question ID");
      const wait = Math.min(
        ASK_WAIT_MAX_MS,
        Math.max(0, Number(params.wait_ms) || 0),
      );
      const until = now() + wait;
      let ask = deps.ledger.ask(id);
      // Hold the call a while (the CLI's --wait asks again), not forever,
      // and not past the service's stop.
      while (ask && !askClosed(ask) && now() < until && !deps.signal?.aborted) {
        await pause(500, deps.signal);
        ask = deps.ledger.ask(id);
      }
      return ask ?? notFound(`no question ${id}`);
    }
    case "ask acknowledge": {
      if (!deps.acknowledgeAnswer)
        refused("Answer acknowledgement is unavailable");
      if (!Number.isSafeInteger(params.attempt) || Number(params.attempt) < 0)
        usage("an acknowledgement needs the observed attempt");
      return deps.acknowledgeAnswer!(
        text(params.id, "the question ID"),
        text(params.occurrence, "the answer occurrence"),
        params.attempt as number,
        actor,
      );
    }
    case "ask answer": {
      const id = text(params.id, "the question ID");
      const answer = text(params.answer, "the answer");
      const ask = deps.ledger.ask(id);
      if (!ask) notFound(`no question ${id}`);
      if (ask!.withdrawn) refused(`${id} was withdrawn`);
      if (ask!.dismissed) refused(`${id} was dismissed by the owner`);
      if (ask!.owner_only) refused("only the owner answers this, in World");
      // An answer from an agent must come from a pane World has placed,
      // and never from the agent that asked.
      if (!actor.verified)
        refused("only the owner or a verified agent answers questions");
      if (
        ask!.actor.connection_id === actor.connection_id &&
        ask!.actor.pane_id === actor.pane_id
      )
        refused("an agent cannot answer its own question");
      if (ask!.answer) refused(`${id} is already answered`);
      deps.publishLedger(
        await (deps.recordAnswer
          ? deps.recordAnswer(id, answer, actor)
          : answerAsk(deps.ledger, id, answer, actor.label, now())),
        true,
      );
      return deps.ledger.ask(id);
    }
  }
}

/** Record an answer; returns the ledger revision. Used by the CLI and by World. */
export function answerAsk(
  ledger: LedgerStore,
  id: string,
  answer: string,
  by: string,
  at: number,
) {
  return ledger.update((document) => {
    const ask = document.asks.find((entry) => entry.id === id);
    if (!ask) throw new CliError("not_found", `no question ${id}`);
    if (ask.withdrawn) throw new CliError("refused", `${id} was withdrawn`);
    if (ask.dismissed)
      throw new CliError("refused", `${id} was dismissed by the owner`);
    if (ask.answer) throw new CliError("refused", `${id} is already answered`);
    ask.answer = { text: answer, at, by };
  });
}

/**
 * The owner closes an open question without answering it; returns the
 * ledger revision. The asker's `--wait` ends with `dismissed`, and a keyed
 * cause stays closed, as an answered one does, until the asker withdraws it.
 */
export function dismissAsk(
  ledger: LedgerStore,
  id: string,
  by: string,
  at: number,
) {
  return ledger.update((document) => {
    const ask = document.asks.find((entry) => entry.id === id);
    if (!ask) throw new CliError("not_found", `no question ${id}`);
    if (ask.withdrawn) throw new CliError("refused", `${id} was withdrawn`);
    if (ask.answer) throw new CliError("refused", `${id} is already answered`);
    ask.dismissed ??= { at, by };
  });
}
