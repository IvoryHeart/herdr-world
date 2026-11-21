import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinReader, BinWriter } from "../bridge/bincode";
import { readSemanticNotification } from "../bridge/semantic-notification";
import {
  ASK_ALERT_BODY_MAX,
  ASK_PEER_LIMITS,
  askAlertBody,
  createAskPeers,
  handleAskPeerRequest,
  parseAskAlert,
  readAskPeers,
  sameAlertQuestion,
} from "./ask-peers";
import type { LedgerAsk } from "./world-ledger";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fresh = (prefix: string) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

const RUNTIME = "a".repeat(64);
const OTHER_RUNTIME = "b".repeat(64);
const SELF = "0".repeat(24);
const HOME = "1".repeat(24);
const TOKEN = "t".repeat(43);

function report(
  directory: string,
  id: string,
  fields: Record<string, unknown> = {},
  asks: Record<string, unknown> | null = {},
) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${id}.json`),
    JSON.stringify({
      id,
      port: 19_100,
      loopback: true,
      ipv6: false,
      tls: false,
      expiresAt: 20_000,
      ...fields,
      ...(asks
        ? {
            asks: {
              name: "Herdr World · release",
              token: TOKEN,
              runtimes: [RUNTIME],
              any: false,
              ...asks,
            },
          }
        : {}),
    }),
  );
}

test("the alert names the World that holds the question, and older alerts still parse", () => {
  const body = askAlertBody("Ship it?", "q-abc123", "Herdr World · release");
  expect(body).toBe("Ship it? (q-abc123, asked in Herdr World · release)");
  expect(parseAskAlert("crew-7 asks", body)).toEqual({
    asker: "crew-7",
    question: "Ship it?",
    id: "q-abc123",
    home: "Herdr World · release",
  });
  // An older World wrote only the ID.
  expect(parseAskAlert("crew-7 asks", "Ship it? (q12)")).toEqual({
    asker: "crew-7",
    question: "Ship it?",
    id: "q12",
    home: null,
  });
  // Not an owner question: other custom alerts and malformed bodies.
  expect(parseAskAlert("Build finished", "All green (q-1)")).toBeNull();
  expect(parseAskAlert("crew-7 asks", "no id here")).toBeNull();
  expect(parseAskAlert("crew-7 asks", " (q-1)")).toBeNull();
  expect(parseAskAlert(undefined, undefined)).toBeNull();
});

/** An owner alert as Herdr delivers it, through World's production decoder. */
function delivered(title: string, body: string) {
  const w = new BinWriter();
  w.variant(3); // custom
  w.string(title);
  w.option(body, (value) => w.string(value));
  w.option(null, () => {}); // sound
  for (let field = 0; field < 4; field++) w.option(null, () => {});
  w.option(null, () => {}); // position
  return readSemanticNotification(new BinReader(w.toBuffer()));
}

test("a long question keeps the alert's ID and home within Herdr's body limit", () => {
  const home = "Herdr World · release";
  for (const question of [
    "x".repeat(401),
    `${"Ship it? ".repeat(80)}`,
    `${"y".repeat(330)}😀${"z".repeat(100)}`,
  ]) {
    const body = askAlertBody(question, "q-abc123", home);
    expect(body.length).toBeLessThanOrEqual(ASK_ALERT_BODY_MAX);
    const alert = delivered("crew-7 asks", body);
    expect(alert.body).toBe(body);
    const parsed = parseAskAlert(alert.title, alert.body ?? undefined);
    expect(parsed).toMatchObject({ id: "q-abc123", home });
    expect(parsed!.question.endsWith("…")).toBe(true);
    // No half of a surrogate pair is left behind.
    expect(parsed!.question).not.toMatch(/[\uD800-\uDBFF]…$/u);
    // The shortened question still names the full one, here and at home.
    expect(sameAlertQuestion(parsed!.question, question)).toBe(true);
    expect(sameAlertQuestion(parsed!.question, "Something else?")).toBe(false);
  }
  // A question that fits is sent whole.
  const fits = "q".repeat(300);
  expect(
    parseAskAlert("crew-7 asks", askAlertBody(fits, "q-1", home)),
  ).toMatchObject({
    question: fits,
  });
});

test("every World name Settings accepts survives the alert", () => {
  for (const home of [
    "Herdr World · release (stable)",
    "Herdr World · (a) (b)",
    "Herdr World · ((",
    "Herdr World · ))",
    `Herdr World · ${"n".repeat(32)}`,
  ]) {
    const parsed = parseAskAlert(
      "crew-7 asks",
      askAlertBody("Ship it (now)?", "q-9", home),
    );
    expect(parsed).toEqual({
      asker: "crew-7",
      question: "Ship it (now)?",
      id: "q-9",
      home,
    });
  }
});

test("only fresh loopback reports with a valid asks block count as peers", () => {
  const directory = join(fresh("ask-peers-registry-"), "instances");
  report(directory, HOME);
  report(directory, SELF);
  report(directory, "2".repeat(24), { expiresAt: 5_000 });
  report(directory, "3".repeat(24), { loopback: false });
  report(directory, "4".repeat(24), {}, null);
  report(directory, "5".repeat(24), {}, { token: "short" });
  report(directory, "6".repeat(24), {}, { runtimes: ["not-a-hash"] });
  report(directory, "7".repeat(24), { id: "8".repeat(24) });
  writeFileSync(join(directory, "notes.json"), "{}");
  expect(readAskPeers(directory, SELF, 10_000).map((peer) => peer.id)).toEqual([
    HOME,
  ]);
  expect(readAskPeers(join(directory, "missing"), SELF, 10_000)).toEqual([]);
});

const ask = (id: string, fields: Partial<LedgerAsk> = {}): LedgerAsk => ({
  id,
  at: 1_000,
  actor: {
    label: "claude in w1:p2",
    verified: true,
    connection_id: "studio",
    pane_id: "w1:p2",
    terminal_id: "t-9",
    agent_session_id: "session-1",
    name: "crew-7",
  },
  question: "Ship it?",
  options: ["Yes", "No"],
  owner_only: true,
  ...fields,
});

function peerRequest(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
) {
  return new Request("http://127.0.0.1/api/world/ask-peers", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("a home shares only open questions on a shared runtime, without places", async () => {
  const closed: string[] = [];
  const deps = {
    authorized: (header: string | null) => header === `Bearer ${TOKEN}`,
    open: () => [
      { ask: ask("q-1"), runtimes: [RUNTIME] },
      {
        ask: ask("q-2", { question: "Elsewhere?" }),
        runtimes: [OTHER_RUNTIME],
      },
    ],
    answer: async (id: string, answer: string) => {
      if (closed.includes(id)) throw new Error("already answered");
      closed.push(id);
      expect(answer).toBe("Yes");
    },
    dismiss: async () => {},
  };
  const list = await handleAskPeerRequest(
    peerRequest({ command: "list", runtimes: [RUNTIME] }),
    "127.0.0.1",
    deps,
  );
  const listed = (await list.json()) as { result: { asks: unknown[] } };
  expect(listed.result.asks).toEqual([
    {
      id: "q-1",
      at: 1_000,
      actor: { label: "claude in w1:p2", verified: true, name: "crew-7" },
      question: "Ship it?",
      options: ["Yes", "No"],
      owner_only: true,
    },
  ]);
  // Connection, pane, terminal and session IDs never leave the home.
  expect(JSON.stringify(listed)).not.toContain("studio");
  expect(JSON.stringify(listed)).not.toContain("session-1");

  // A question on a runtime the sibling does not share cannot be closed.
  const hidden = await handleAskPeerRequest(
    peerRequest({
      command: "answer",
      id: "q-2",
      answer: "Yes",
      runtimes: [RUNTIME],
    }),
    "127.0.0.1",
    deps,
  );
  expect(hidden.status).toBe(404);

  const first = await handleAskPeerRequest(
    peerRequest({
      command: "answer",
      id: "q-1",
      answer: "Yes",
      runtimes: [RUNTIME],
    }),
    "127.0.0.1",
    deps,
  );
  expect(await first.json()).toEqual({ ok: true });
  const second = await handleAskPeerRequest(
    peerRequest({
      command: "answer",
      id: "q-1",
      answer: "Yes",
      runtimes: [RUNTIME],
    }),
    "127.0.0.1",
    deps,
  );
  expect(second.status).toBe(409);
  expect(closed).toEqual(["q-1"]);
});

test("the peer route refuses browsers, other hosts and wrong tokens", async () => {
  const deps = {
    authorized: (header: string | null) => header === `Bearer ${TOKEN}`,
    open: () => [{ ask: ask("q-1"), runtimes: [RUNTIME] }],
    answer: async () => {
      throw new Error("must not answer");
    },
    dismiss: async () => {
      throw new Error("must not dismiss");
    },
  };
  const body = { command: "list", runtimes: [RUNTIME] };
  expect(
    (await handleAskPeerRequest(peerRequest(body), "192.0.2.10", deps)).status,
  ).toBe(403);
  expect(
    (
      await handleAskPeerRequest(
        peerRequest(body, {
          authorization: `Bearer ${TOKEN}`,
          origin: "http://127.0.0.1:19100",
        }),
        "127.0.0.1",
        deps,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleAskPeerRequest(
        peerRequest(body, { authorization: "Bearer wrong" }),
        "127.0.0.1",
        deps,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await handleAskPeerRequest(
        new Request("http://127.0.0.1/api/world/ask-peers"),
        "127.0.0.1",
        deps,
      )
    ).status,
  ).toBe(405);
});

function sibling(
  directory: string,
  reply: (body: Record<string, unknown>) => unknown,
) {
  const calls: Record<string, unknown>[] = [];
  let changes = 0;
  const peers = createAskPeers({
    directory,
    selfId: SELF,
    now: () => 10_000,
    scheduler: { schedule: () => ({ cancel() {} }) },
    runtimes: () => [RUNTIME],
    name: () => "Herdr World · main",
    any: false,
    isLocal: (id, question) => id === "q-local" && question === "Mine?",
    changed: () => changes++,
    fetch: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(body);
      return Response.json(reply(body));
    }) as unknown as typeof fetch,
  });
  return { peers, calls, changes: () => changes };
}

test("a sibling lists home questions and forwards the owner's answer to the home", async () => {
  const directory = join(fresh("ask-peers-sibling-"), "instances");
  report(directory, HOME);
  let open = true;
  const { peers, calls, changes } = sibling(directory, (body) =>
    body.command === "list"
      ? {
          ok: true,
          result: {
            asks: open
              ? [
                  {
                    id: "q-1",
                    at: 1_000,
                    actor: { label: "claude in w1:p2", verified: true },
                    question: "Ship it?",
                    options: ["Yes"],
                    owner_only: true,
                  },
                ]
              : [],
          },
        }
      : ((open = false), { ok: true }),
  );
  await peers.refresh();
  const [listed] = peers.list();
  expect(listed).toMatchObject({
    id: `peer~${HOME}~q-1`,
    question: "Ship it?",
    home: {
      name: "Herdr World · release",
      url: "http://127.0.0.1:19100/",
      port: 19_100,
    },
  });
  expect(changes()).toBe(1);
  expect(peers.owns(listed!.id)).toBe(true);
  expect(peers.owns("q-1")).toBe(false);
  await peers.answer(listed!.id, "Yes");
  expect(calls.at(-2)).toEqual({
    command: "answer",
    answer: "Yes",
    id: "q-1",
    runtimes: [RUNTIME],
  });
  // Answered at home: the sibling's list follows at once.
  expect(peers.list()).toEqual([]);
  expect(peers.report()).toEqual({
    name: "Herdr World · main",
    token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    runtimes: [RUNTIME],
    any: false,
  });
  expect(peers.authorized(`Bearer ${peers.report().token}`)).toBe(true);
  expect(peers.authorized(`Bearer ${TOKEN}`)).toBe(false);
  expect(peers.authorized(null)).toBe(false);
});

test("a home on another runtime, or no longer reporting, is not asked", async () => {
  const directory = join(fresh("ask-peers-filter-"), "instances");
  report(directory, HOME, {}, { runtimes: [OTHER_RUNTIME] });
  const { peers, calls } = sibling(directory, () => ({
    ok: true,
    result: { asks: [] },
  }));
  await peers.refresh();
  expect(calls).toEqual([]);
  await expect(peers.answer(`peer~${HOME}~q-1`, "Yes")).rejects.toThrow(
    /not running/,
  );
});

test("an alert this World cannot resolve becomes an asked-in entry until hidden", async () => {
  const directory = join(fresh("ask-peers-alerts-"), "instances");
  report(directory, HOME);
  const { peers } = sibling(directory, () => ({
    ok: true,
    result: { asks: [] },
  }));
  // Its own question needs no entry.
  await peers.observeAlert(
    "crew-7 asks",
    "Mine? (q-local, asked in Herdr World · main)",
  );
  expect(peers.list()).toEqual([]);
  await peers.observeAlert(
    "crew-7 asks",
    askAlertBody("Ship it?", "q-9", "Herdr World · release"),
  );
  await peers.observeAlert("crew-8 asks", "Old? (q12)");
  const [linked, unknown] = peers.list();
  expect(linked).toMatchObject({
    id: "alert~q-9",
    alert_only: true,
    question: "Ship it?",
    actor: { label: "crew-7", verified: false },
    home: { name: "Herdr World · release", url: "http://127.0.0.1:19100/" },
  });
  expect(unknown).toMatchObject({
    id: "alert~q12",
    alert_only: true,
    home: { name: "another World", url: null },
  });
  expect(() => peers.refuseAlertAnswer("alert~q-9")).toThrow(
    "Answer this question in Herdr World · release",
  );
  expect(await peers.dismiss("alert~q-9", false)).toBe(true);
  expect(peers.list().map((entry) => entry.id)).toEqual(["alert~q12"]);
  await expect(peers.dismiss("alert~q-9", false)).rejects.toThrow(
    "already closed",
  );
});

test("an alert from a World whose name has parentheses links to it", async () => {
  const directory = join(fresh("ask-peers-parens-"), "instances");
  report(directory, HOME, {}, { name: "Herdr World · release (stable)" });
  const { peers } = sibling(directory, () => ({
    ok: true,
    result: { asks: [] },
  }));
  await peers.observeAlert(
    "crew-7 asks",
    askAlertBody("Ship it?", "q-9", "Herdr World · release (stable)"),
  );
  expect(peers.list()).toMatchObject([
    {
      id: "alert~q-9",
      alert_only: true,
      home: {
        name: "Herdr World · release (stable)",
        url: "http://127.0.0.1:19100/",
      },
    },
  ]);
});

test("an alert entry gives way when its home shares the question", async () => {
  const directory = join(fresh("ask-peers-supersede-"), "instances");
  report(directory, HOME);
  let shared = false;
  const { peers } = sibling(directory, () => ({
    ok: true,
    result: {
      asks: shared
        ? [
            {
              id: "q-9",
              at: 1_000,
              actor: { label: "crew-7", verified: true },
              question: "Ship it?",
              options: [],
              owner_only: true,
            },
          ]
        : [],
    },
  }));
  await peers.observeAlert(
    "crew-7 asks",
    "Ship it? (q-9, asked in Herdr World · release)",
  );
  expect(peers.list().map((entry) => entry.id)).toEqual(["alert~q-9"]);
  shared = true;
  await peers.refresh();
  expect(peers.list().map((entry) => entry.id)).toEqual([`peer~${HOME}~q-9`]);
});

test("alert-only entries are bounded", async () => {
  const directory = join(fresh("ask-peers-bound-"), "instances");
  const { peers } = sibling(directory, () => ({
    ok: true,
    result: { asks: [] },
  }));
  for (let index = 0; index < ASK_PEER_LIMITS.alerts + 5; index++)
    await peers.observeAlert("crew asks", `Q${index}? (q-${index})`);
  const ids = peers.list().map((entry) => entry.id);
  expect(ids).toHaveLength(ASK_PEER_LIMITS.alerts);
  expect(ids[0]).toBe("alert~q-5");
});

test("a World reports its open questions' runtimes and renews the report when they change", async () => {
  const directory = join(fresh("ask-peers-held-"), "instances");
  let held: string[] = [];
  let renewed = 0;
  const peers = createAskPeers({
    directory,
    selfId: SELF,
    now: () => 10_000,
    scheduler: { schedule: () => ({ cancel() {} }) },
    runtimes: () => [RUNTIME],
    held: () => held,
    reportChanged: () => renewed++,
    name: () => "Herdr World · main",
    any: false,
    isLocal: () => false,
    changed: () => {},
    fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch,
  });
  expect(peers.report().runtimes).toEqual([RUNTIME]);
  await peers.refresh();
  expect(renewed).toBe(0);
  // A question asked on a runtime this World no longer connects to.
  held = [OTHER_RUNTIME, RUNTIME, "not-a-fingerprint"];
  await peers.refresh();
  expect(renewed).toBe(1);
  expect(peers.report().runtimes).toEqual([OTHER_RUNTIME, RUNTIME]);
  await peers.refresh();
  expect(renewed).toBe(1);
});
