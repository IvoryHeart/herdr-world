import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  opendirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { SHIPYARD_LIMITS } from "../../../shared/shipyard";
import { assertSafeDataPath } from "../config/data-paths";
import { isLoopbackAddress } from "../workspace/file-manager";
import { readJsonBody } from "../http/json-body";
import type { Scheduler } from "../service/ports";
import type { LedgerAsk } from "./world-ledger";

/**
 * Owner questions across World instances (#1152).
 *
 * The World an agent's CLI reached records the question: that **home** World
 * is its only authority. Its one serialized ledger refuses a second answer, so
 * one answer closes the question exactly once, and the answer goes back to
 * the asker only through the home's own captured connection and generation.
 * The runtime cannot hold the record instead: Herdr and herdr-core labels are
 * last-writer-wins and metadata values are cut at 80 characters.
 *
 * Other Worlds attached to the same runtime find the home through the local
 * instance registry they share (Shipyard's, `HERDR_WORLD_INSTANCE_REGISTRY_DIR`):
 * each report carries an `asks` block with the World's name, a per-run peer
 * token and the fingerprints of the runtimes it connects to. A sibling that
 * shares a runtime reads the home's open questions for those runtimes over
 * loopback, and forwards the owner's answer or dismissal to the home. Nothing
 * else crosses: no connection IDs, panes, attachments or deliveries.
 *
 * An alert whose question this World cannot read (no shared registry, home
 * down, or an older home) becomes an alert-only entry: "asked in <World>",
 * with a link when the registry knows its address.
 */

export const ASK_PEER_PATH = "/api/world/ask-peers";
export const ASK_PEER_LIMITS = {
  peers: 8,
  runtimes: 16,
  asks: 60,
  alerts: 20,
  name: 60,
  timeoutMs: 2_000,
  pollMs: 5_000,
  /** A failed read keeps the last good list this long, so items do not flicker. */
  graceMs: 15_000,
} as const;

/** The `asks` block a World adds to its registry report. */
export type AskPeerBlock = {
  name: string;
  token: string;
  runtimes: string[];
  /** Listens on every interface, so pages may link to it by their own host. */
  any: boolean;
};

/** Where an ask lives when it is not this World's own. */
export type AskHome = {
  name: string;
  /** A loopback link, or null when the registry does not know the World. */
  url: string | null;
  port?: number;
  tls?: boolean;
  any?: boolean;
};

/** A question as a sibling World shows it: nothing that names home places. */
export type PeerAsk = {
  id: string;
  at: number;
  actor: { label: string; verified: boolean; name?: string; agent?: string };
  question: string;
  options: string[];
  owner_only: boolean;
  home: AskHome;
  /** Only the alert reached this World; answer it in its home. */
  alert_only?: true;
};

type Peer = {
  id: string;
  port: number;
  tls: boolean;
  ipv6: boolean;
  asks: AskPeerBlock;
};

const NAME_TEXT = /^[^\u0000-\u001f\u007f-\u009f]{1,60}$/u;
const TOKEN = /^[A-Za-z0-9_-]{32,100}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;

function peerBlock(value: unknown): AskPeerBlock | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.name !== "string" ||
    !NAME_TEXT.test(row.name) ||
    typeof row.token !== "string" ||
    !TOKEN.test(row.token) ||
    !Array.isArray(row.runtimes) ||
    row.runtimes.length > ASK_PEER_LIMITS.runtimes ||
    !row.runtimes.every(
      (entry) => typeof entry === "string" && FINGERPRINT.test(entry),
    ) ||
    typeof row.any !== "boolean"
  )
    return null;
  return {
    name: row.name,
    token: row.token,
    runtimes: row.runtimes as string[],
    any: row.any,
  };
}

/**
 * Fresh loopback reports in the shared registry with an `asks` block, this
 * World's own excluded. Same bounds as Shipyard's reader: 64 entries, 4 KiB
 * each, no symlinks; anything else is skipped.
 */
export function readAskPeers(
  directory: string,
  selfId: string,
  now: number,
): Peer[] {
  const peers: Peer[] = [];
  let dir: ReturnType<typeof opendirSync>;
  try {
    assertSafeDataPath(join(directory, "registry-check"));
    dir = opendirSync(directory);
  } catch {
    return peers;
  }
  try {
    for (let count = 0; count < SHIPYARD_LIMITS.instances; count++) {
      const file = dir.readSync();
      if (!file) break;
      if (!file.isFile() || !/^[a-f0-9]{24}\.json$/u.test(file.name)) continue;
      let fd: number | undefined;
      try {
        fd = openSync(
          join(directory, file.name),
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 4096) continue;
        const row = JSON.parse(readFileSync(fd, "utf8")) as Record<
          string,
          unknown
        >;
        const asks = peerBlock(row.asks);
        if (
          !asks ||
          row.id === selfId ||
          file.name !== `${String(row.id)}.json` ||
          row.loopback !== true ||
          !Number.isInteger(row.port) ||
          (row.port as number) < 1 ||
          (row.port as number) > 65535 ||
          !Number.isSafeInteger(row.expiresAt) ||
          (row.expiresAt as number) <= now
        )
          continue;
        peers.push({
          id: row.id as string,
          port: row.port as number,
          tls: row.tls === true,
          ipv6: row.ipv6 === true,
          asks,
        });
      } catch {
        // Unreadable or partly written: the next poll reads it again.
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
  } finally {
    dir.closeSync();
  }
  return peers.sort((a, b) => a.id.localeCompare(b.id));
}

const homeOf = (peer: Peer): AskHome => ({
  name: peer.asks.name,
  url: `${peer.tls ? "https" : "http"}://${peer.ipv6 ? "[::1]" : "127.0.0.1"}:${peer.port}/`,
  port: peer.port,
  tls: peer.tls,
  any: peer.asks.any,
});

/** A sibling's ID for a home ask: `peer~<instance>~<ask>`. */
export const peerAskId = (instance: string, id: string) =>
  `peer~${instance}~${id}`;
const parsePeerId = (id: string) => {
  const match = /^peer~([a-f0-9]{24})~(.{1,200})$/su.exec(id);
  return match ? { instance: match[1]!, id: match[2]! } : null;
};
const ALERT_PREFIX = "alert~";

/**
 * Herdr's notification decoder keeps at most this many characters of a body
 * (`MAX_TEXT_CHARS` in bridge/semantic-notification.ts); World keeps the whole
 * alert body within it so the routing suffix always arrives.
 */
export const ASK_ALERT_BODY_MAX = 400;

/**
 * The owner alert World sends for a question: title `<agent> asks`, body
 * `<question> (<id>, asked in <World>)`. Older Worlds wrote `(<id>)` only.
 * A long question is shortened, never the suffix: other Worlds read the ID
 * and home from it.
 */
export function askAlertBody(question: string, id: string, home: string) {
  // Sliced as the registry report slices it, so the names still match.
  const suffix = ` (${id}, asked in ${home.slice(0, ASK_PEER_LIMITS.name)})`;
  const room = ASK_ALERT_BODY_MAX - suffix.length;
  let text = question;
  if (question.length > room) {
    text = question.slice(0, Math.max(0, room - 1));
    // Never leave half of a surrogate pair.
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  return `${text}${suffix}`;
}

/** A shortened alert question still names the same question. */
export function sameAlertQuestion(alerted: string, question: string) {
  const full = question.trim();
  return alerted.endsWith("…")
    ? full.startsWith(alerted.slice(0, -1))
    : alerted === full;
}

export function parseAskAlert(
  title: string | undefined,
  body: string | undefined,
): { asker: string; question: string; id: string; home: string | null } | null {
  if (!title?.endsWith(" asks") || !body) return null;
  // The question is greedy, so the last ` (q-…` starts the suffix; a World
  // name may hold parentheses ("release (stable)").
  const match =
    /^([\s\S]*) \((q[-a-z0-9]{1,40})(?:, asked in ([^\n]{1,60}?))?\)\s*$/u.exec(
      body,
    );
  if (!match || !match[1]!.trim()) return null;
  return {
    asker: title.slice(0, -" asks".length).trim() || "An agent",
    question: match[1]!.trim(),
    id: match[2]!,
    home: match[3]?.trim() || null,
  };
}

type Reply = { ok: boolean; error?: string; result?: unknown };

/** The sibling side: read shared homes, forward owner closes, keep alert-only entries. */
export function createAskPeers(deps: {
  /** The shared instance registry folder. */
  directory: string;
  /** This World's registry ID, so its own report is skipped. */
  selfId: string;
  now(): number;
  scheduler: Scheduler;
  /** Fingerprints of the runtimes this World connects to. */
  runtimes(): string[];
  /**
   * Runtime fingerprints captured with this World's open questions: a
   * question stays findable on the runtime it was asked on after a saved
   * connection is edited to target another.
   */
  held?(): string[];
  /** The `asks` block changed (a question on a new runtime): report it now. */
  reportChanged?(): void;
  /** This World's name as alerts and siblings show it. */
  name(): string;
  /** Listens on every interface. */
  any: boolean;
  /** A question this World holds itself. */
  isLocal(id: string, question: string): boolean;
  /** The merged list changed: pages should fetch questions again. */
  changed(): void;
  fetch?: typeof fetch;
  log?(message: string): void;
}) {
  const send = deps.fetch ?? fetch;
  const token = randomBytes(32).toString("base64url");
  let homes = new Map<string, { at: number; home: AskHome; asks: PeerAsk[] }>();
  const alerts = new Map<string, PeerAsk>();
  let shown = "[]";
  let reported = "";
  let inflight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let timer: { cancel(): void } | null = null;
  let running = false;

  const own = () =>
    [...new Set(deps.runtimes())]
      .filter((entry) => FINGERPRINT.test(entry))
      .slice(0, ASK_PEER_LIMITS.runtimes);
  const shared = () => {
    const mine = new Set(own());
    return readAskPeers(deps.directory, deps.selfId, deps.now())
      .filter((peer) => peer.asks.runtimes.some((entry) => mine.has(entry)))
      .slice(0, ASK_PEER_LIMITS.peers);
  };

  async function call(peer: Peer, body: Record<string, unknown>) {
    const response = await send(
      `${peer.tls ? "https" : "http"}://${peer.ipv6 ? "[::1]" : "127.0.0.1"}:${peer.port}${ASK_PEER_PATH}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${peer.asks.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body, runtimes: own() }),
        // Loopback only; a local World's certificate is often self-signed.
        tls: { rejectUnauthorized: false },
        redirect: "error",
        signal: AbortSignal.timeout(ASK_PEER_LIMITS.timeoutMs),
      } as RequestInit,
    );
    let reply: Reply | null = null;
    try {
      reply = (await response.json()) as Reply;
    } catch {
      // Not a World that knows this route.
    }
    if (!reply || typeof reply.ok !== "boolean")
      throw new Error(`${peer.asks.name} answered ${response.status}`);
    return reply;
  }

  /**
   * The runtimes of this World's open questions first, then the ones it
   * connects to now: a question stays findable on the runtime it was asked on.
   */
  const report = (): AskPeerBlock => ({
    name: deps.name().slice(0, ASK_PEER_LIMITS.name),
    token,
    runtimes: [...new Set([...(deps.held?.() ?? []), ...own()])]
      .filter((entry) => FINGERPRINT.test(entry))
      .slice(0, ASK_PEER_LIMITS.runtimes),
    any: deps.any,
  });

  const merged = (): PeerAsk[] => [
    ...[...homes.values()].flatMap((entry) => entry.asks),
    ...alerts.values(),
  ];
  function publishIfChanged() {
    const next = JSON.stringify(merged());
    if (next === shown) return;
    shown = next;
    deps.changed();
  }

  async function poll() {
    const now = deps.now();
    const peers = shared();
    const next = new Map<
      string,
      { at: number; home: AskHome; asks: PeerAsk[] }
    >();
    await Promise.all(
      peers.map(async (peer) => {
        const home = homeOf(peer);
        try {
          const reply = await call(peer, { command: "list" });
          const asks = Array.isArray(
            (reply.result as { asks?: unknown } | undefined)?.asks,
          )
            ? ((reply.result as { asks: unknown[] }).asks
                .slice(0, ASK_PEER_LIMITS.asks)
                .flatMap((value) => {
                  const ask = peerAsk(value, peer.id, home);
                  return ask ? [ask] : [];
                }) as PeerAsk[])
            : null;
          if (!reply.ok || !asks) throw new Error(reply.error ?? "no list");
          next.set(peer.id, { at: now, home, asks });
        } catch {
          // Down, restarting or older: keep the last list a little while,
          // then the home's questions leave this World's list.
          const last = homes.get(peer.id);
          if (last && now - last.at < ASK_PEER_LIMITS.graceMs)
            next.set(peer.id, last);
        }
      }),
    );
    homes = next;
    if (reported && JSON.stringify(report()) !== reported)
      deps.reportChanged?.();
    // An alert whose question now shows from its home needs no entry.
    for (const [key, alert] of alerts) {
      const id = key.slice(ALERT_PREFIX.length);
      if (
        [...homes.values()].some((entry) =>
          entry.asks.some((ask) => parsePeerId(ask.id)?.id === id),
        )
      )
        alerts.delete(key);
      else if (alert.home.url === null) {
        // The registry may know that World now.
        const peer = peers.find((entry) => entry.asks.name === alert.home.name);
        if (peer) alerts.set(key, { ...alert, home: homeOf(peer) });
      }
    }
    publishIfChanged();
  }

  /** One read at a time; a call during a read waits for a fresh one after it. */
  function refresh(): Promise<void> {
    if (inflight)
      return (queued ??= inflight.then(() => {
        queued = null;
        return refresh();
      }));
    inflight = poll()
      .catch((error) => deps.log?.(`Sibling questions: ${String(error)}`))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function schedule() {
    if (!running) return;
    timer = deps.scheduler.schedule(() => {
      void refresh().finally(schedule);
    }, ASK_PEER_LIMITS.pollMs);
  }

  function peerFor(id: string) {
    const ref = parsePeerId(id);
    if (!ref) return null;
    const peer = shared().find((entry) => entry.id === ref.instance);
    if (!peer)
      throw new Error(
        `${homes.get(ref.instance)?.home.name ?? "The World that holds this question"} is not running; answer it there when it is back`,
      );
    return { peer, id: ref.id };
  }

  async function forward(
    id: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    if (id.startsWith(ALERT_PREFIX)) return false;
    const target = peerFor(id);
    if (!target) return false;
    let reply: Reply;
    try {
      reply = await call(target.peer, { ...body, id: target.id });
    } catch (error) {
      throw new Error(
        `Could not reach ${target.peer.asks.name}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    await refresh();
    if (!reply.ok)
      throw new Error(reply.error ?? "the question was not closed");
    return true;
  }

  return {
    /** Whether an ID is one this module answers for. */
    owns: (id: string) =>
      id.startsWith(ALERT_PREFIX) || Boolean(parsePeerId(id)),
    /** The `asks` block for this World's registry report. */
    report: () => {
      const block = report();
      reported = JSON.stringify(block);
      return block;
    },
    /** Whether a request carries this World's peer token. */
    authorized(header: string | null) {
      const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
      const expected = Buffer.from(token);
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    },
    list: merged,
    refresh,
    answer: (id: string, answer: string) =>
      forward(id, { command: "answer", answer }),
    dismiss(id: string, allFromAsker: boolean): Promise<boolean> {
      if (alerts.delete(id)) {
        publishIfChanged();
        return Promise.resolve(true);
      }
      if (id.startsWith(ALERT_PREFIX))
        return Promise.reject(new Error("That alert is already closed"));
      return forward(id, { command: "dismiss", all_from_asker: allFromAsker });
    },
    refuseAlertAnswer(id: string) {
      if (id.startsWith(ALERT_PREFIX))
        throw new Error(
          `Answer this question in ${alerts.get(id)?.home.name ?? "the World that asked it"}`,
        );
    },
    /** An owner alert reached this World through Herdr. */
    async observeAlert(title: string | undefined, body: string | undefined) {
      const alert = parseAskAlert(title, body);
      if (!alert || deps.isLocal(alert.id, alert.question)) return;
      await refresh();
      const key = `${ALERT_PREFIX}${alert.id}`;
      if (
        alerts.has(key) ||
        merged().some(
          (ask) =>
            parsePeerId(ask.id)?.id === alert.id &&
            sameAlertQuestion(alert.question, ask.question),
        )
      )
        return;
      const peer = alert.home
        ? readAskPeers(deps.directory, deps.selfId, deps.now()).find(
            (entry) => entry.asks.name === alert.home,
          )
        : undefined;
      alerts.set(key, {
        id: key,
        at: deps.now(),
        actor: { label: alert.asker, verified: false, name: alert.asker },
        question: alert.question,
        options: [],
        owner_only: true,
        home: peer
          ? homeOf(peer)
          : { name: alert.home ?? "another World", url: null },
        alert_only: true,
      });
      // Oldest out first; alert-only entries are not durable.
      while (alerts.size > ASK_PEER_LIMITS.alerts)
        alerts.delete(alerts.keys().next().value!);
      publishIfChanged();
    },
    start() {
      if (running) return;
      running = true;
      void refresh().finally(schedule);
    },
    stop() {
      running = false;
      timer?.cancel();
      timer = null;
    },
  };
}

export type AskPeers = ReturnType<typeof createAskPeers>;

function peerAsk(
  value: unknown,
  instance: string,
  home: AskHome,
): PeerAsk | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const actor = row.actor as Record<string, unknown> | undefined;
  if (
    typeof row.id !== "string" ||
    row.id.length > 200 ||
    !Number.isFinite(row.at) ||
    typeof row.question !== "string" ||
    !actor ||
    typeof actor.label !== "string"
  )
    return null;
  return {
    id: peerAskId(instance, row.id),
    at: row.at as number,
    actor: {
      label: actor.label,
      verified: actor.verified === true,
      ...(typeof actor.name === "string" ? { name: actor.name } : {}),
      ...(typeof actor.agent === "string" ? { agent: actor.agent } : {}),
    },
    question: row.question,
    options: Array.isArray(row.options)
      ? row.options.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    owner_only: row.owner_only === true,
    home,
  };
}

/** What a home shares of one open ask: its words and who asked, no places. */
export function sharedAsk(ask: LedgerAsk) {
  return {
    id: ask.id,
    at: ask.at,
    actor: {
      label: ask.actor.label,
      verified: ask.actor.verified,
      ...(ask.actor.name ? { name: ask.actor.name } : {}),
      ...(ask.actor.agent ? { agent: ask.actor.agent } : {}),
    },
    question: ask.question,
    options: ask.options,
    owner_only: ask.owner_only,
  };
}

/**
 * POST /api/world/ask-peers on the home: a sibling's read of the open questions
 * for the runtimes they share, and the owner's answer or dismissal it forwards.
 * Loopback only, never from a browser, and only with this run's peer token.
 */
export async function handleAskPeerRequest(
  req: Request,
  ip: string | undefined,
  deps: {
    authorized(header: string | null): boolean;
    /** Open asks with the runtime fingerprints each belongs to. */
    open(): { ask: LedgerAsk; runtimes: readonly string[] }[];
    answer(id: string, answer: string): Promise<void>;
    dismiss(id: string, allFromAsker: boolean): Promise<void>;
  },
): Promise<Response> {
  if (req.method !== "POST")
    return new Response("method not allowed", { status: 405 });
  if (!ip || !isLoopbackAddress(ip) || req.headers.get("origin") !== null)
    return Response.json(
      { ok: false, error: "local World instances only" },
      { status: 403 },
    );
  if (!deps.authorized(req.headers.get("authorization")))
    return Response.json(
      { ok: false, error: "wrong World peer token" },
      { status: 401 },
    );
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req, 64 * 1024)) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, error: "the request must be JSON" },
      { status: 400 },
    );
  }
  const runtimes = new Set(
    Array.isArray(body?.runtimes)
      ? body.runtimes
          .slice(0, ASK_PEER_LIMITS.runtimes)
          .filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const visible = deps
    .open()
    .filter((entry) => entry.runtimes.some((key) => runtimes.has(key)))
    .map((entry) => entry.ask);
  if (body.command === "list")
    return Response.json({
      ok: true,
      result: { asks: visible.slice(0, ASK_PEER_LIMITS.asks).map(sharedAsk) },
    });
  if (body.command !== "answer" && body.command !== "dismiss")
    return Response.json(
      { ok: false, error: "unknown command" },
      { status: 400 },
    );
  const id = typeof body.id === "string" ? body.id : "";
  // Only a question the sibling may see; an already-closed one says so.
  if (!visible.some((ask) => ask.id === id))
    return Response.json(
      { ok: false, error: "This question is already closed or not shared" },
      { status: 404 },
    );
  try {
    if (body.command === "answer") {
      const answer = typeof body.answer === "string" ? body.answer.trim() : "";
      if (!answer || answer.length > 4000)
        return Response.json(
          { ok: false, error: "an answer needs text" },
          { status: 400 },
        );
      await deps.answer(id, answer);
    } else await deps.dismiss(id, body.all_from_asker === true);
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}
