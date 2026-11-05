import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  legacyReviewFixture,
  legacyPane,
  legacySession,
} from "../storage/testing/legacy-review-fixture";
import { reviewStopFixture } from "./testing/review-stop-fixture";
import { LEGACY_REVIEW_TTL_MS } from "../storage/legacy-review-archive";
import { deskSessionFingerprint } from "./desk-observation";
import { isReviewedStop } from "../../../web/src/world/useReviewedWork";

const active: Awaited<ReturnType<typeof reviewStopFixture>>[] = [];
afterEach(async () => {
  for (const f of active.splice(0)) await f.close();
});
async function fixture(
  receipts: Parameters<typeof legacyReviewFixture>[0] = [{ index: 0 }],
  panes: Record<string, unknown>[] = [legacyPane()],
) {
  const old = legacyReviewFixture(receipts);
  const f = await reviewStopFixture({ root: old.root, panes, time: 2000 });
  active.push(f);
  return { f, old };
}
const record = (f: Awaited<ReturnType<typeof reviewStopFixture>>, index = 0) =>
  f.browsers[0]!.get().records.find(
    (record) => record.terminal_id === `terminal-${index}`,
  );

test("a fresh exact source/session/terminal/sequence resolves the original receipt into the canonical browser stop", async () => {
  const { f } = await fixture();
  await f.refresh();
  expect(record(f)).toBeUndefined();
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
  await f.observe();
  expect(record(f)?.reviewed_stop).toBe('stop:["stop-0",1000]');
  for (const browser of f.browsers)
    expect(isReviewedStop(f.leaf(), browser.get().records[0])).toBe(true);
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(0);
  await f.restart();
  await f.observe();
  expect(isReviewedStop(f.leaf(), record(f))).toBe(true);
  expect(f.failures).toEqual([]);
});

for (const kind of ["unknown", "missing sequence", "null to known"] as const)
  test(`legacy ${kind} never inherits a review, including plain World restart`, async () => {
    const known = kind === "missing sequence";
    const { f } = await fixture(
      [{ index: 1, known, ...(known ? { sequence: null } : {}) }],
      [legacyPane(1, known)],
    );
    await f.observe();
    expect(record(f, 1)?.reviewed_stop).toBeNull();
    if (kind === "null to known") f.setPanes([legacyPane(1)]);
    await f.restart();
    await f.observe();
    expect(record(f, 1)?.reviewed_stop).toBeNull();
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
    expect(f.failures).toEqual([]);
  });

for (const change of [
  "unknown owner",
  "replacement",
  "newer sequence",
  "lower sequence",
  "working",
  "blocked",
] as const)
  test(`fresh ${change} permanently disqualifies the receipt even if its old proof returns after restart`, async () => {
    const { f } = await fixture(
      [{ index: 1 }],
      [
        {
          ...legacyPane(1),
          ...(change === "unknown owner" ? { agent_session: null } : {}),
          ...(change === "replacement"
            ? { agent_session: legacyPane(2).agent_session }
            : {}),
          ...(change === "newer sequence" ? { state_change_seq: 5 } : {}),
          ...(change === "lower sequence" ? { state_change_seq: 3 } : {}),
          ...(["working", "blocked"].includes(change)
            ? { agent_status: change }
            : {}),
        },
      ],
    );
    await f.observe();
    expect(record(f, 1)?.reviewed_stop ?? null).toBeNull();
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
    await f.restart();
    f.setPanes([legacyPane(1)]);
    await f.observe();
    expect(record(f, 1)?.reviewed_stop).toBeNull();
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
  });

test("missing fresh native sequence defers resolution without inventing proof", async () => {
  const { f } = await fixture(
    [{ index: 1 }],
    [{ ...legacyPane(1), state_change_seq: undefined }],
  );
  await f.observe();
  expect(record(f, 1)?.reviewed_stop).toBeNull();
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
  f.setPanes([legacyPane(1)]);
  await f.observe();
  expect(isReviewedStop(f.leaf(), record(f, 1))).toBe(true);
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(0);
});

for (const duplicate of ["terminal", "session", "pane"] as const)
  test(`ambiguous ${duplicate} observations never resolve or prune archived receipts`, async () => {
    const other = {
      ...legacyPane(2),
      ...(duplicate === "terminal" ? { terminal_id: "terminal-1" } : {}),
      ...(duplicate === "pane" ? { pane_id: "pane-1" } : {}),
      ...(duplicate === "session"
        ? { agent_session: legacyPane(1).agent_session }
        : {}),
    };
    const { f } = await fixture([{ index: 1 }], [legacyPane(1), other]);
    await f.observe();
    expect(record(f, 1)).toBeUndefined();
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
    f.setPanes([legacyPane(1)]);
    await f.observe();
    expect(isReviewedStop(f.leaf(), record(f, 1))).toBe(true);
  });

test("only a fresh complete observation of the original connection proves a terminal gone", async () => {
  const { f } = await fixture([{ index: 1 }], []);
  await f.marks.observe("other-source", 1, [], 2001);
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
  await f.observe();
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(0);
  expect(
    f.storage.terminalMarks.list().some((row) => row.kind === "desk"),
  ).toBe(true);
});

test("a newer Desk review and an explicit Undo cannot be overwritten by an archived receipt", async () => {
  for (const undo of [false, true]) {
    const old = legacyReviewFixture();
    const db = new Database(old.paths.database);
    db.exec(
      `UPDATE terminal_marks SET body=json_set(body,'$.reviewed_stop','newer-stop') WHERE kind='desk'`,
    );
    db.close();
    const f = await reviewStopFixture({
      root: old.root,
      panes: [legacyPane()],
      time: 2000,
    });
    active.push(f);
    await f.refresh();
    if (undo) await f.review(0, false, "newer-stop");
    else await f.observe();
    await f.observe();
    expect(record(f)?.reviewed_stop).toBe(undo ? null : "newer-stop");
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
  }
});

test("archive expiry runs on the service scheduler even without a source observation", async () => {
  let callback: (() => void) | undefined;
  const delays: number[] = [];
  const old = legacyReviewFixture([{ index: 1, known: false }]);
  const f = await reviewStopFixture({
    root: old.root,
    panes: [],
    time: 2000,
    scheduler: {
      schedule(next, delay) {
        callback = next;
        delays.push(delay);
        return {
          cancel() {
            callback = undefined;
          },
        };
      },
    },
  });
  active.push(f);
  expect(delays).toEqual([60_000]);
  f.advance(LEGACY_REVIEW_TTL_MS);
  callback!();
  // A serialized barrier waits for the timer's admitted expiry commit.
  await f.marks.expire();
  expect(f.storage.terminalMarks.archiveStatus()).toEqual({
    count: 0,
    expires_at: null,
  });
  expect(f.storage.terminalMarks.list()).toHaveLength(2);
});

test("retirement during a review acknowledgement never publishes an old runtime's migrated review", async () => {
  const { f } = await fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    put = f.storage.terminalMarks.put;
  f.storage.terminalMarks.put = async (input) => {
    const saved = await put(input);
    entered.resolve();
    await release.promise;
    return saved;
  };
  const pending = f.observe();
  await entered.promise;
  f.retire();
  release.resolve();
  await pending;
  expect(f.registries.desk.list().records).toEqual([]);
  expect(f.browsers[0]!.get().records).toEqual([]);
});

test("archive proof disqualification survives a crash before the Desk checkpoint", async () => {
  const { f } = await fixture();
  await f.storage.terminalMarks.observeLegacy(
    "alpha",
    ["terminal-0"],
    [
      {
        terminal_id: "terminal-0",
        session: deskSessionFingerprint(legacySession())!,
        sequence: 5,
        status: "done",
        last_activity_at: 1000,
        activity_matches: true,
      },
    ],
    () => true,
  );
  await f.restart();
  await f.observe();
  expect(record(f)?.reviewed_stop).toBeNull();
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
});
