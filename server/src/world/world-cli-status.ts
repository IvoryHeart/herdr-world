import { notFound, refused, usage } from "./world-cli-errors";
import type { WorldCliDeps } from "./world-cli";
import { placeAsker } from "./world-cli-asks";
import {
  askClosed,
  LEDGER_LIMITS,
  STATUS_STATES,
  type CliActor,
  type LedgerDocument,
  type LedgerStatus,
  type StatusState,
} from "./world-ledger";

/**
 * `herdr-world status`: any program (an agent, a crew, a CI script, a cron)
 * reports how a piece of work is going, without an LLM. One row per (caller,
 * key), changed in place. A row interrupts nobody: only `--needs-you` raises
 * one owner-only Needs you question, kept while the flag holds and withdrawn
 * when the flag or the row goes. Rows turn stale `ttl` after their last
 * update and drop off a day after that.
 */

export const STATUS_LIMITS = {
  key: 120,
  line: 300,
  phase: 80,
  group: 80,
  url: 2000,
  /** Default and maximum time without an update before a row is stale. */
  ttlDefaultMs: 60 * 60_000,
  ttlMaxMs: 24 * 60 * 60_000,
  /** A stale row drops off this long after it turned stale. */
  dropAfterStaleMs: 24 * 60 * 60_000,
};

/**
 * Whose key space a row is in: a verified caller's own terminal, or one
 * space all unverified callers share (a program outside Herdr proves
 * nothing about who it is, as with `result`).
 */
export function statusOwner(actor: CliActor): string {
  return actor.verified && actor.connection_id
    ? `${actor.connection_id}\u0000${actor.terminal_id ?? actor.pane_id ?? ""}`
    : "unverified";
}

export const statusStaleAt = (row: LedgerStatus) => row.updated_at + row.ttl_ms;
export const statusDropAt = (row: LedgerStatus) =>
  statusStaleAt(row) + STATUS_LIMITS.dropAfterStaleMs;

/** The rows still shown at `now`, each with whether it is stale. */
export function visibleStatuses(rows: readonly LedgerStatus[], now: number) {
  return rows
    .filter((row) => now < statusDropAt(row))
    .map((row) => ({
      ...row,
      stale: now >= statusStaleAt(row),
      stale_at: statusStaleAt(row),
    }));
}

const text = (value: unknown, what: string, max: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    usage(`${what} must be text of at most ${max} characters`);
  return (value as string).trim();
};
const optional = (value: unknown, what: string, max: number) =>
  value === undefined ? undefined : text(value, what, max);

function statusUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const raw = text(value, "--url", STATUS_LIMITS.url);
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    // Refused below.
  }
  // Only web links: World renders this as a link the owner may click.
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:"))
    usage("--url must be an http or https address");
  return url!.href;
}

/**
 * Withdraw a row's open question; true when one was withdrawn. An answered
 * or dismissed one stays as the owner closed it.
 */
function withdrawLinked(
  document: LedgerDocument,
  row: LedgerStatus,
  at: number,
): boolean {
  const ask = row.ask_id
    ? document.asks.find((entry) => entry.id === row.ask_id)
    : undefined;
  if (!ask || askClosed(ask)) return false;
  ask.withdrawn = { at };
  return true;
}

/** Drop rows a day past stale, withdrawing their questions. */
function prune(document: LedgerDocument, now: number): boolean {
  let withdrew = false;
  document.statuses = document.statuses.filter((row) => {
    if (now < statusDropAt(row)) return true;
    withdrew = withdrawLinked(document, row, now) || withdrew;
    return false;
  });
  return withdrew;
}

export async function handleWorldStatus(
  deps: WorldCliDeps,
  command: string,
  params: Record<string, unknown>,
  actor: CliActor,
  now: () => number,
): Promise<unknown> {
  const owner = statusOwner(actor);
  if (command === "status ls")
    return visibleStatuses(deps.ledger.get().statuses, now());
  const key = text(params.key, "the status key", STATUS_LIMITS.key);
  if (command === "status clear") {
    let removed: LedgerStatus | undefined;
    let withdrew = false;
    const revision = await deps.ledger.update((document) => {
      withdrew = prune(document, now());
      removed = document.statuses.find(
        (row) => row.owner === owner && row.key === key,
      );
      if (!removed) return;
      withdrew = withdrawLinked(document, removed, now()) || withdrew;
      document.statuses = document.statuses.filter((row) => row !== removed);
    });
    deps.publishLedger(revision, withdrew, true);
    if (!removed) return notFound(`no status ${key} from this caller`);
    return { id: removed.id, key, cleared: true, withdrew };
  }

  const line = text(params.line, "the status line", STATUS_LIMITS.line);
  const state = (params.state ?? "working") as StatusState;
  if (!STATUS_STATES.includes(state))
    usage(`--state: one of ${STATUS_STATES.join(", ")}`);
  const phase = optional(params.phase, "--phase", STATUS_LIMITS.phase);
  const progress = params.progress;
  if (
    progress !== undefined &&
    (!Number.isInteger(progress) ||
      (progress as number) < 0 ||
      (progress as number) > 100)
  )
    usage("--progress takes a whole number from 0 to 100");
  const url = statusUrl(params.url);
  const ttlMs =
    params.ttl_s === undefined
      ? STATUS_LIMITS.ttlDefaultMs
      : Number.isInteger(params.ttl_s) &&
          (params.ttl_s as number) >= 1 &&
          (params.ttl_s as number) * 1000 <= STATUS_LIMITS.ttlMaxMs
        ? (params.ttl_s as number) * 1000
        : usage(
            "--ttl takes a duration from 1s to 24h, such as 90s, 10m or 2h",
          );
  const needsYou = params.needs_you === true;
  const placed = await placeAsker(deps.hosts(), actor);
  const group =
    optional(params.group, "--group", STATUS_LIMITS.group) ??
    (placed.name ?? placed.agent ?? "Other").slice(0, STATUS_LIMITS.group);

  const known = deps.ledger
    .get()
    .statuses.find((row) => row.owner === owner && row.key === key);
  const id = known?.id ?? (await deps.ledger.nextId("s"));
  // A question is prepared whenever one may be needed; it is recorded only
  // when the row has no live one, inside the serialized update below.
  const askId = needsYou ? await deps.ledger.nextId("q") : undefined;
  const recipient = needsYou
    ? await deps.captureRecipient?.(placed)
    : undefined;
  const notificationConnection =
    placed.connection_id && !deps.core?.()?.has(placed.connection_id)
      ? placed.connection_id
      : deps.defaultConnectionId();
  const bucket = (entry: CliActor) =>
    entry.verified
      ? `${entry.connection_id}\u0000${entry.pane_id}`
      : "unverified";
  let raised = false;
  let withdrew = false;
  let saved: LedgerStatus | undefined;
  const revision = await deps.ledger.update(
    (document) => {
      raised = false;
      const at = now();
      withdrew = prune(document, at);
      const index = document.statuses.findIndex(
        (row) => row.owner === owner && row.key === key,
      );
      const previous = index < 0 ? undefined : document.statuses[index]!;
      if (!previous && document.statuses.length >= LEDGER_LIMITS.statuses)
        refused(
          `World keeps at most ${LEDGER_LIMITS.statuses} status rows; clear some with \`herdr-world status clear KEY\``,
        );
      const linked = previous?.ask_id
        ? document.asks.find((ask) => ask.id === previous.ask_id)
        : undefined;
      let liveAsk = linked && !linked.withdrawn ? linked.id : undefined;
      if (needsYou && !liveAsk) {
        const open = document.asks.filter((ask) => !askClosed(ask));
        if (open.length >= LEDGER_LIMITS.asks)
          refused("too many open questions; wait for answers");
        if (
          open.filter((ask) => bucket(ask.actor) === bucket(actor)).length >=
          LEDGER_LIMITS.asksPerActor
        )
          refused(
            `you have ${LEDGER_LIMITS.asksPerActor} open questions; wait for answers`,
          );
        document.asks.push({
          id: askId!,
          at,
          actor: placed,
          ...(recipient ? { recipient } : {}),
          question: phase ? `${line} (${phase})` : line,
          options: [],
          owner_only: true,
        });
        liveAsk = askId;
        raised = true;
      }
      if (!needsYou && previous && withdrawLinked(document, previous, at)) {
        withdrew = true;
        liveAsk = undefined;
      }
      if (!needsYou) liveAsk = undefined;
      saved = {
        id: previous?.id ?? id,
        at: previous?.at ?? at,
        updated_at: at,
        actor: placed,
        owner,
        key,
        line,
        state,
        group,
        ...(phase !== undefined ? { phase } : {}),
        ...(progress !== undefined ? { progress: progress as number } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(needsYou ? { needs_you: true } : {}),
        ...(liveAsk ? { ask_id: liveAsk } : {}),
        ttl_ms: ttlMs,
      };
      if (previous) document.statuses[index] = saved;
      else document.statuses.push(saved);
    },
    () =>
      raised
        ? [
            {
              kind: "ask.created",
              record_id: askId!,
              recovery: "repeatable",
              target: notificationConnection
                ? { connection_id: notificationConnection }
                : null,
            },
          ]
        : [],
  );
  deps.publishLedger(revision, raised || withdrew, true);
  return { ...saved!, raised };
}
