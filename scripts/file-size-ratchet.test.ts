import { expect, test } from "bun:test";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSizes,
  LIMIT,
  parseExceptions,
  ratcheted,
  slack,
} from "./file-size-ratchet";

const current = {
  limits: { "web/src/store.ts": 5742 },
  unratcheted: { "web/src/world/BoardView.tsx": "until split B" },
};

test("files stay at the limit unless listed, and listed files cannot grow", () => {
  expect(checkSizes({ "web/src/new.ts": LIMIT }, current, current)).toEqual([]);
  expect(
    checkSizes({ "web/src/new.ts": LIMIT + 1 }, current, current)[0],
  ).toContain("stay at 1000");
  expect(
    checkSizes({ "web/src/store.ts": 5743 }, current, current)[0],
  ).toContain("may not grow past 5742");
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 9000 }, current, current),
  ).toEqual([]);
});

test("growth already in the base is not this change's to answer for", () => {
  // main grew App.tsx after its entry was recorded; a PR that leaves it alone passes.
  const recorded = { limits: { "web/src/App.tsx": 5161 }, unratcheted: {} };
  expect(
    checkSizes({ "web/src/App.tsx": 5164 }, recorded, recorded, {
      "web/src/App.tsx": 5164,
    }),
  ).toEqual([]);
  // Growing it further still fails.
  expect(
    checkSizes({ "web/src/App.tsx": 5170 }, recorded, recorded, {
      "web/src/App.tsx": 5164,
    })[0],
  ).toContain("may not grow past 5164");
});

test("the exception list only shrinks", () => {
  const raised = { ...current, limits: { "web/src/store.ts": 6000 } };
  expect(checkSizes({}, raised, current)[0]).toContain(
    "raised from 5742 to 6000",
  );
  const added = {
    ...current,
    limits: { ...current.limits, "web/src/App.tsx": 5200 },
  };
  expect(checkSizes({}, added, current)[0]).toContain("new exception");
  const unratcheted = {
    ...current,
    unratcheted: { ...current.unratcheted, "web/src/App.tsx": "no" },
  };
  expect(checkSizes({}, unratcheted, current)[0]).toContain(
    "newly unratcheted",
  );
  // Lowering or removing entries is fine.
  expect(checkSizes({}, { limits: {}, unratcheted: {} }, current)).toEqual([]);
});

test("a shrunk file is pointed out so its entry can follow", () => {
  expect(slack({ "web/src/store.ts": 3000 }, current)).toEqual([
    "web/src/store.ts is 3000 lines now; lower its exception from 5742",
  ]);
  expect(slack({ "web/src/store.ts": 900 }, current)[0]).toContain(
    "remove its exception",
  );
});

test("tests, fixtures and generated files are outside the ratchet", () => {
  expect(ratcheted("web/src/store.ts")).toBe(true);
  expect(ratcheted("web/src/styles/app.css")).toBe(true);
  for (const path of [
    "web/src/store.test.ts",
    "web/src/paneJump.browser.tsx",
    "web/src/world/testing/x.ts",
    "server/src/public-files.gen.ts",
    "README.md",
  ])
    expect(ratcheted(path)).toBe(false);
});

test("a malformed policy fails instead of disabling the ratchet", () => {
  const parse = (value: unknown) => () =>
    parseExceptions(JSON.stringify(value), "policy");
  expect(parse({ limits: { "a.ts": "unlimited" }, unratcheted: {} })).toThrow(
    "integer ceiling",
  );
  expect(parse({ limits: { "a.ts": 5000.5 }, unratcheted: {} })).toThrow(
    "integer ceiling",
  );
  expect(parse({ limits: { "a.ts": 900 }, unratcheted: {} })).toThrow(
    "above 1000",
  );
  expect(parse({ limits: {}, unratcheted: { "a.ts": "" } })).toThrow("reason");
  expect(parse({ limits: {} })).toThrow("expected");
  expect(parse({ limits: {}, unratcheted: {}, extra: 1 })).toThrow("expected");
  expect(parseExceptions(JSON.stringify(current), "policy")).toEqual(current);
});

test("the unratcheted files each name the split that ends their exemption", async () => {
  const policy = parseExceptions(
    await Bun.file(
      new URL("./file-size-exceptions.json", import.meta.url),
    ).text(),
    "policy",
  );
  for (const reason of Object.values(policy.unratcheted))
    expect(reason).toMatch(/^Until split [A-Z]\b.*removes this entry/);
});

test("a split ends a deferred exemption by freezing the file at its new size", () => {
  const before = {
    limits: {},
    unratcheted: {
      "web/src/world/BoardView.tsx":
        "Until split B: split B removes this entry",
    },
  };
  const after = {
    limits: { "web/src/world/BoardView.tsx": 1800 },
    unratcheted: {},
  };
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 1800 }, after, before),
  ).toEqual([]);
  // The ceiling must be the post-split size, not a cushion.
  const loose = {
    limits: { "web/src/world/BoardView.tsx": 2500 },
    unratcheted: {},
  };
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 1800 }, loose, before)[0],
  ).toContain("record its current size 1800");
  // Once frozen, it cannot grow.
  expect(
    checkSizes({ "web/src/world/BoardView.tsx": 1801 }, after, after)[0],
  ).toContain("may not grow past 1800");
  // A file that was never unratcheted still cannot become an exception.
  expect(
    checkSizes(
      { "web/src/App.tsx": 1800 },
      { limits: { "web/src/App.tsx": 1800 }, unratcheted: {} },
      before,
    )[0],
  ).toContain("new exception");
});

function withRatchetRepo(
  check: (repo: {
    root: string;
    git: (...args: string[]) => string;
    policy: (limit: number) => void;
    run: (...args: string[]) => SpawnSyncReturns<string>;
  }) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "size-base-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "scripts"));
    copyFileSync(
      new URL("./file-size-ratchet.ts", import.meta.url),
      join(root, "scripts/file-size-ratchet.ts"),
    );
    const policy = (limit: number) =>
      writeFileSync(
        join(root, "scripts/file-size-exceptions.json"),
        JSON.stringify({ limits: { "app.ts": limit }, unratcheted: {} }),
      );
    writeFileSync(join(root, "app.ts"), "// synthetic\n".repeat(1050));
    policy(1100);
    git("add", ".");
    git("commit", "-qm", "base");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["scripts/file-size-ratchet.ts", ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, HERDR_WORLD_RATCHET_TARGET: "" },
      });
    check({ root, git, policy, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a branch behind main passes locally and in the actual CI merge tree", () => {
  withRatchetRepo(({ root, git, policy, run }) => {
    git("branch", "topic");
    policy(1050);
    writeFileSync(join(root, "app.ts"), "// synthetic\n".repeat(1025));
    git("commit", "-qam", "lower ceiling and source size");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "topic");
    writeFileSync(join(root, "unrelated.md"), "unrelated\n");
    git("add", ".");
    git("commit", "-qm", "unrelated change");
    expect(run().status).toBe(0);
    const topic = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "--no-edit", topic);
    expect(
      git("rev-list", "--parents", "-n", "1", "HEAD").split(" "),
    ).toHaveLength(3);
    expect(run().status).toBe(0);
  });
});

test("a branch that restores a lowered ceiling fails in the proposed merge", () => {
  withRatchetRepo(({ git, policy, run }) => {
    policy(1050);
    git("commit", "-qam", "lower ceiling");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-qb", "topic");
    policy(1100);
    git("commit", "-qam", "restore ceiling");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("raised from 1050 to 1100");
  });
});

test("a stale stacked base is checked against main, including CI's actual merge commit", () => {
  withRatchetRepo(({ root, git, policy, run }) => {
    git("checkout", "-qb", "stack");
    writeFileSync(join(root, "stack.md"), "stack base\n");
    git("add", ".");
    git("commit", "-qm", "stack base");
    git("branch", "topic");
    git("checkout", "-q", "main");
    policy(1050);
    git("commit", "-qam", "lower ceiling");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "topic");
    writeFileSync(join(root, "topic.md"), "topic\n");
    git("add", ".");
    git("commit", "-qm", "topic change");
    git("checkout", "-q", "stack");
    writeFileSync(join(root, "base.md"), "base advance\n");
    git("add", ".");
    git("commit", "-qm", "stack advance");
    git("checkout", "-q", "topic");
    expect(run("origin/main", "stack").status).toBe(1);
    // Reproduce refs/pull/N/merge: the first parent is the stale stack, not main.
    const topic = git("rev-parse", "HEAD");
    git("checkout", "-q", "stack");
    git("merge", "-q", "--no-ff", "--no-edit", topic);
    expect(
      git("rev-list", "--parents", "-n", "1", "HEAD").split(" "),
    ).toHaveLength(3);
    const ci = run("origin/main", "stack");
    expect(ci.status).toBe(1);
    expect(ci.stderr).toContain("raised from 1050 to 1100");
  });
});

test("tracked working edits and staged new sources are checked without changing HEAD or the index", () => {
  withRatchetRepo(({ root, git, run }) => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    const head = git("rev-parse", "HEAD");
    writeFileSync(join(root, "new.ts"), "// new\n".repeat(1001));
    git("add", "new.ts");
    const index = git("write-tree");
    const staged = run();
    expect(staged.status).toBe(1);
    expect(staged.stderr).toContain("new.ts has 1001 lines");
    expect(git("write-tree")).toBe(index);
    expect(git("rev-parse", "HEAD")).toBe(head);
    git("reset", "-q", "HEAD", "new.ts");
    // Untracked files are outside the ratchet, just as before this change.
    writeFileSync(join(root, "app.ts"), "// growth\n".repeat(1101));
    const unstaged = run();
    expect(unstaged.status).toBe(1);
    expect(unstaged.stderr).toContain("app.ts has 1101 lines");
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });
});

test("a conflict in the proposed merge blocks the ratchet", () => {
  withRatchetRepo(({ git, policy, run }) => {
    git("branch", "topic");
    policy(1050);
    git("commit", "-qam", "lower ceiling");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "topic");
    policy(1150);
    git("commit", "-qam", "conflicting ceiling");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("resolve merge conflicts");
  });
});
