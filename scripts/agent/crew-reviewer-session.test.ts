import { afterEach, expect, test } from "bun:test";
import {
  cleanups,
  cleanupDeliveries,
  setup,
} from "./crew-round-delivery-fixture";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NOW, SHA } from "./gate/cases";
import { QUIET_MS } from "./crew/round-policy";
import { startReviewers } from "./crew/reviewer-delivery";
import {
  reviewerSessionAdmission,
  reviewerSessionOwner,
} from "./crew/reviewer-session";
import {
  actionsIn,
  addAction,
  addRun,
  finishRun,
  getRun,
  setAction,
  setRunSession,
  setRunPid,
  setRunPane,
  setMeta,
} from "./crew/store";
import { SETTINGS_DEFAULTS, type Action } from "./crew/plan";

afterEach(cleanupDeliveries);
const settings = {
  ...SETTINGS_DEFAULTS,
  convergingReviews: true,
  maxRuns: 1,
  roster: { rev2: { model: "gpt-6.1-sol" } },
  reviewerSessions: { "7": { rev2: "saved-reviewer" } },
};
const action: Action = {
  key: "7:fixed:confirm:rev2:round-2",
  pr: 7,
  head: SHA.fixed,
  kind: "confirm",
  target: "rev2",
  text: "confirm fix delta",
  since: SHA.reviewed,
};
const owners = (session = "saved-reviewer") =>
  JSON.stringify({
    result: {
      agents: [
        {
          name: "original-reviewer",
          tab_id: "tab-original",
          pane_id: "pane-original",
          agent_status: "done",
          agent_session: { agent: "codex", kind: "id", value: session },
        },
      ],
    },
  });
const result = (stdout: string, code = 0) => ({ code, stdout, stderr: "" });
const processes = (name = "codex") =>
  JSON.stringify({
    result: {
      process_info: {
        foreground_processes: [{ name, argv: [name] }],
      },
    },
  });
const locked = (argv: string[]) =>
  result(argv.includes("process-info") ? processes() : owners());

test("normal tracked completion between planning and delivery waits without creating a handoff", () => {
  const f = setup({
    settings: {
      convergingReviews: true,
      readyAsk: false,
      reviewJudgmentSeat: "steward",
      reviewerSessions: settings.reviewerSessions,
    },
  });
  const old = {
    ...action,
    key: "previous-review",
    head: SHA.reviewed,
    kind: "review" as const,
    since: undefined,
  };
  addAction(f.crew, old, NOW - 120_000);
  const id = addRun(
    f.crew,
    {
      actionKey: old.key,
      reviewer: "rev2",
      pr: 7,
      head: SHA.reviewed,
      round: 1,
      log: "stdout",
    },
    NOW - 120_000,
  );
  setRunPid(f.crew, id, 9001);
  setRunPane(f.crew, id, "pane-original", "tab-original");
  setRunSession(f.crew, id, "codex", "gpt-6.1-sol", "saved-reviewer");
  setAction(f.crew, old.key, "running", NOW - 120_000);
  setMeta(
    f.crew,
    "review-observation:7",
    JSON.stringify({ head: SHA.reviewed, at: NOW }),
  );
  f.comment(`[builder]\nrev2:101:1 fixed in ${SHA.reviewed}`, NOW + 1);
  const run = f.deps.run;
  let alive = true;
  f.deps.run = (argv) =>
    argv.join(" ") === "herdr agent list"
      ? result(alive ? owners() : '{"result":{"agents":[]}}')
      : argv.includes("process-info")
        ? result(
            JSON.stringify({
              result: {
                process_info: {
                  foreground_processes: [
                    {
                      name: "bun",
                      pid: 9001,
                      argv: [
                        "bun",
                        "/synthetic/crew.ts",
                        "review",
                        "--run",
                        String(id),
                      ],
                    },
                    {
                      name: "codex",
                      pid: 9002,
                      argv: ["codex", "resume", "saved-reviewer"],
                    },
                  ],
                },
              },
            }),
          )
        : run(argv);
  f.pass(SHA.reviewed, NOW + QUIET_MS + 2);
  expect(getRun(f.crew, id)?.exitCode).toBe(0);
  expect(f.spawned).toHaveLength(0);
  expect(
    actionsIn(f.crew, ["pending", "sent"]).some((a) =>
      a.key.includes("session-owner"),
    ),
  ).toBe(false);
  alive = false;
  f.pass(SHA.reviewed, NOW + QUIET_MS + 3);
  expect(f.spawned).toHaveLength(1);
  expect(f.spawned[0]).toContain("--since");
});

test("idle exact session owner blocks; same alias with another session does not", () => {
  expect(reviewerSessionOwner(locked, "codex", "saved-reviewer")).toContain(
    "original-reviewer in tab-original",
  );
  expect(
    reviewerSessionOwner(
      () => result(owners("another")),
      "codex",
      "saved-reviewer",
    ),
  ).toBeNull();
});

test.each([
  "",
  "{}",
  '{"result":{"agents":null}}',
  '{"result":{"agents":[null]}}',
])(
  "unreadable ownership is held without assuming the session is free: %s",
  (value) => {
    expect(
      reviewerSessionOwner(() => result(value), "codex", "saved-reviewer"),
    ).toContain("unreadable");
  },
);

test("known session owner never allocates a run or consumes the slot", () => {
  const f = setup();
  const dir = mkdtempSync(join(tmpdir(), "crew-session-owner-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const run = f.deps.run;
  f.deps.run = (argv) =>
    argv.includes("process-info")
      ? result(processes())
      : argv.join(" ") === "herdr agent list"
        ? result(owners())
        : run(argv);
  addAction(f.crew, action, NOW);
  const recorded: Action[] = [];
  startReviewers(
    f.crew,
    { now: NOW, dir, deps: f.deps, worker: ["bun", "crew.ts"] },
    settings,
    actionsIn(f.crew, ["pending"]),
    new Map(),
    () => {},
    (entry) => recorded.push(entry),
  );
  expect(f.spawned).toHaveLength(0);
  expect(getRun(f.crew, 1)).toBeNull();
  expect(recorded[0]?.key).toBe(action.key + "|session-owner");
  addAction(
    f.crew,
    {
      ...action,
      pr: 8,
      key: "8:head:review:rev2",
      kind: "review",
      since: undefined,
    },
    NOW,
  );
  startReviewers(
    f.crew,
    { now: NOW, dir, deps: f.deps, worker: ["bun", "crew.ts"] },
    settings,
    actionsIn(f.crew, ["pending"]),
    new Map(),
    () => {},
    (entry) => recorded.push(entry),
  );
  expect(f.spawned).toHaveLength(1);
  expect(getRun(f.crew, 1)?.pr).toBe(8);
});

test("handoff stays held after owner closes until explicit rearm; old timeout is preserved", () => {
  const f = setup();
  const held = reviewerSessionAdmission(f.crew, settings, action, locked)!;
  addAction(f.crew, held, NOW);
  expect(
    reviewerSessionAdmission(f.crew, settings, action, () =>
      result('{"result":{"agents":[]}}'),
    )?.text,
  ).toContain("explicit operator rearm");
  setAction(
    f.crew,
    held.key,
    "superseded",
    NOW + 1,
    "operator-authorized handoff",
  );
  expect(
    reviewerSessionAdmission(f.crew, settings, action, () =>
      result('{"result":{"agents":[]}}'),
    ),
  ).toBeNull();
  addAction(f.crew, action, NOW);
  const id = addRun(
    f.crew,
    {
      actionKey: action.key,
      reviewer: "rev2",
      pr: 7,
      head: SHA.fixed,
      log: "stdout",
    },
    NOW,
  );
  finishRun(f.crew, id, -124, null, NOW + 1);
  setAction(f.crew, action.key, "failed", NOW + 1, "run timed out");
  expect(
    reviewerSessionAdmission(f.crew, settings, action, () => result(owners())),
  ).toBeNull();
  expect(getRun(f.crew, id)?.exitCode).toBe(-124);
});

test("completed tab metadata does not claim an exited harness still owns the session", () => {
  expect(
    reviewerSessionOwner(
      (argv) =>
        result(argv.includes("process-info") ? processes("bash") : owners()),
      "codex",
      "saved-reviewer",
    ),
  ).toBeNull();
  expect(
    reviewerSessionOwner(
      (argv) => result(argv.includes("process-info") ? "{}" : owners()),
      "codex",
      "saved-reviewer",
    ),
  ).toContain("unreadable");
});

test("active same-reviewer crew work waits normally without manufacturing a handoff", () => {
  const f = setup();
  const id = addRun(
    f.crew,
    {
      actionKey: "current",
      reviewer: "rev2",
      pr: 7,
      head: SHA.reviewed,
      log: "stdout",
    },
    NOW,
  );
  setRunSession(f.crew, id, "codex", "gpt-6.1-sol", "saved-reviewer");
  expect(
    reviewerSessionAdmission(f.crew, settings, action, () => {
      throw new Error("no external handoff while own review is running");
    }),
  ).toBeNull();
});

test("real pass routes session handoff to steward without an owner ask or resume", () => {
  const f = setup({
    settings: {
      convergingReviews: true,
      reviewerSessions: settings.reviewerSessions,
      readyAsk: false,
      reviewJudgmentSeat: "steward",
    },
  });
  const run = f.deps.run;
  let occupied = true;
  f.deps.run = (argv) =>
    argv.includes("process-info")
      ? result(processes())
      : argv.join(" ") === "herdr agent list"
        ? result(
            JSON.stringify({
              result: {
                agents: [
                  ...(occupied ? JSON.parse(owners()).result.agents : []),
                  { name: "steward", agent_status: "done" },
                ],
              },
            }),
          )
        : run(argv);
  f.comment(`[builder]\nrev2:101:1 fixed in ${SHA.fixed}`, NOW + 1);
  f.pass(SHA.fixed, NOW);
  const planned = f.pass(SHA.fixed, NOW + QUIET_MS + 2);
  expect(
    planned.some(
      (entry) => entry.kind === "judgment" && entry.target === "steward",
    ),
  ).toBe(true);
  expect(f.spawned).toHaveLength(0);
  expect(
    f.calls.some((argv) =>
      argv.join(" ").startsWith("herdr agent prompt steward "),
    ),
  ).toBe(true);
  expect(f.calls.some((argv) => argv[0] === "herdr-world")).toBe(false);
  expect(
    actionsIn(f.crew, ["pending"]).filter((entry) => entry.target === "github"),
  ).toHaveLength(0);
  occupied = false;
  f.pass(SHA.fixed, NOW + QUIET_MS + 3);
  expect(f.spawned).toHaveLength(0);
});
