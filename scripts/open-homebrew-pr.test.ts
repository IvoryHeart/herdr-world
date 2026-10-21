import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHomebrewFormula } from "./generate-homebrew-formula";

const transport = String.raw`
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const path = process.env.HOMEBREW_TEST_STATE!;
const state = JSON.parse(readFileSync(path, "utf8"));
appendFileSync(process.env.HOMEBREW_TEST_CALLS!, JSON.stringify(args) + "\n");
function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { env: process.env });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function save() { writeFileSync(path, JSON.stringify(state)); }
function head() { return git("--git-dir", state.remote, "rev-parse", "refs/heads/" + state.branch); }
if (args[0] === "auth") process.exit(0);
if (args[0] === "repo" && args[1] === "clone") {
  git("clone", "--quiet", state.remote, args[3]!); process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") {
  if (state.createDenied) throw new Error("synthetic PR permission denied");
  state.pull = true; save();
  console.log("https://github.com/IvoryHeart/homebrew-tap/pull/7"); process.exit(0);
}
if (args[0] === "pr" && args[1] === "merge") {
  if (state.mergeDenied) throw new Error("synthetic required review/check blocked merge");
  if (state.queued) process.exit(0);
  if (state.race) {
    git("checkout", state.branch);
    writeFileSync("unexpected.txt", "concurrent change\n");
    git("add", "unexpected.txt"); git("commit", "-qm", "Synthetic concurrent edit");
    git("push", "-q", "origin", state.branch);
  }
  const expected = args[args.indexOf("--match-head-commit") + 1];
  if (!args.includes("--match-head-commit") || head() !== expected)
    throw new Error("synthetic head changed before merge");
  git("checkout", "main");
  git("merge", "--no-ff", expected!, "-m", "Merge synthetic formula PR");
  git("push", "-q", "origin", "main");
  state.merged = true; state.mergeSha = git("rev-parse", "HEAD"); save(); process.exit(0);
}
if (args[0] === "api") {
  const endpoint = args[1]!;
  if (endpoint.includes("pulls?")) {
    // The search is advisory: safety decisions use the raw PR identity below.
    console.log(state.pull ? "7" : ""); process.exit(0);
  }
  if (endpoint.endsWith("/pulls/7")) {
    const query = args[args.indexOf("--jq") + 1] ?? "";
    if (query.includes("merge_commit_sha")) {
      console.log([state.merged === true, head(), state.mergeSha ?? ""].join("\t"));
    } else {
      console.log(["open", state.headRepo ?? "IvoryHeart/homebrew-tap",
        state.headRef ?? state.branch, state.baseRepo ?? "IvoryHeart/homebrew-tap",
        state.baseRef ?? "main", state.reportedHead ?? head(), state.changedFiles ?? 1].join("\t"));
    }
    process.exit(0);
  }
  if (endpoint.includes("/contents/")) {
    const ref = endpoint.split("?ref=")[1]!;
    const content = state.badMergedContent ? "unexpected formula" : git("--git-dir", state.remote, "show", ref + ":Formula/" + state.formula);
    console.log(Buffer.from(content + "\n").toString("base64")); process.exit(0);
  }
}
throw new Error("Unexpected synthetic gh request: " + JSON.stringify(args));
`;

function fixture(candidate = false) {
  const root = mkdtempSync(join(tmpdir(), "world-homebrew-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const stateFile = join(root, "state.json");
  const callsFile = join(root, "calls.jsonl");
  const formula = candidate ? "herdr-world-rc.rb" : "herdr-world.rb";
  const version = candidate ? "9.8.7-rc.1" : "9.8.7";
  const branch = "release/herdr-world-v" + version;
  const digests = Object.fromEntries(
    ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((p) => [
      p,
      "a".repeat(64),
    ]),
  );
  const content = renderHomebrewFormula(version, digests);
  const source = join(root, formula);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const env = {
    ...process.env,
    GH_TOKEN: "synthetic-homebrew-token",
    HOMEBREW_TEST_STATE: stateFile,
    HOMEBREW_TEST_CALLS: callsFile,
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Synthetic Release Bot",
    GIT_AUTHOR_EMAIL: "release@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic Release Bot",
    GIT_COMMITTER_EMAIL: "release@example.invalid",
    PATH: bin + ":" + process.env.PATH,
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, "");
  function git(cwd: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", ...args], { cwd, env });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  }
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, seed);
  mkdirSync(join(seed, "Formula"));
  writeFileSync(
    join(seed, "Formula", formula),
    renderHomebrewFormula(candidate ? "9.8.6-rc.1" : "9.8.6", digests),
  );
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "Synthetic baseline");
  git(seed, "push", "-q", "origin", "main");
  writeFileSync(source, content);
  writeFileSync(callsFile, "");
  const state: Record<string, unknown> = {
    remote,
    branch,
    formula,
    pull: false,
  };
  const fake = join(root, "github.ts");
  writeFileSync(fake, transport);
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fake)} "$@"\n`,
  );
  chmodSync(join(bin, "gh"), 0o700);
  return {
    state,
    content,
    root,
    remote,
    source,
    formula,
    git: (...args: string[]) => git(seed, ...args),
    existing(extra = false, mismatch = false, symlink = false) {
      git(seed, "checkout", "-b", branch);
      writeFileSync(
        join(seed, "Formula", formula),
        mismatch ? "different formula\n" : content,
      );
      if (symlink) {
        unlinkSync(join(seed, "Formula", formula));
        symlinkSync(source, join(seed, "Formula", formula));
      }
      if (extra)
        writeFileSync(join(seed, "unexpected.txt"), "unrelated change\n");
      git(seed, "add", ".");
      git(seed, "commit", "-qm", "Synthetic formula update");
      git(seed, "push", "-q", "origin", branch);
      state.pull = true;
    },
    run() {
      writeFileSync(stateFile, JSON.stringify(state));
      writeFileSync(callsFile, "");
      const result = Bun.spawnSync(
        ["bash", join(import.meta.dir, "open-homebrew-pr.sh"), version, source],
        { cwd: root, env },
      );
      Object.assign(state, JSON.parse(readFileSync(stateFile, "utf8")));
      const calls = readFileSync(callsFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s) as string[]);
      return { code: result.exitCode, error: result.stderr.toString(), calls };
    },
    main() {
      return (
        git(root, "--git-dir", remote, "show", "main:Formula/" + formula) + "\n"
      );
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test.each(["stable", "RC"])(
  "verified formula is opened, SHA-guarded merged, and idempotent (%s)",
  (channel) => {
    const f = fixture(channel === "RC");
    try {
      const result = f.run();
      expect(result.code, result.error).toBe(0);
      expect(f.main()).toBe(f.content);
      const merge = result.calls.find(
        (a) => a[0] === "pr" && a[1] === "merge",
      )!;
      expect(merge).toContain("--match-head-commit");
      expect(merge).not.toContain("--admin");
      expect(merge).not.toContain("--auto");
      const retry = f.run();
      expect(retry.code, retry.error).toBe(0);
      expect(retry.calls.some((a) => a[0] === "pr")).toBe(false);
    } finally {
      f.cleanup();
    }
  },
);

test("an existing matching PR is merged without creating a duplicate", () => {
  const f = fixture();
  try {
    f.existing();
    const result = f.run();
    expect(result.code, result.error).toBe(0);
    expect(f.main()).toBe(f.content);
    expect(result.calls.some((a) => a[0] === "pr" && a[1] === "create")).toBe(
      false,
    );
  } finally {
    f.cleanup();
  }
});

test.each([
  { headRepo: "example/fork" },
  { headRef: "unrelated" },
  { baseRepo: "example/fork" },
  { baseRef: "other" },
  { reportedHead: "f".repeat(40) },
  { changedFiles: 2 },
  { mergeDenied: true },
  { race: true },
  { queued: true },
])("unsafe or blocked Homebrew PR does not update main: %j", (change) => {
  const f = fixture();
  try {
    const baseline = f.main();
    f.existing();
    Object.assign(f.state, change);
    const result = f.run();
    expect(result.code).not.toBe(0);
    expect(f.main()).toBe(baseline);
    if (
      !("mergeDenied" in change) &&
      !("race" in change) &&
      !("queued" in change)
    )
      expect(result.calls.some((a) => a[0] === "pr" && a[1] === "merge")).toBe(
        false,
      );
  } finally {
    f.cleanup();
  }
});

test.each(["extra file", "different formula"])(
  "existing branch with %s cannot merge",
  (kind) => {
    const f = fixture();
    try {
      const baseline = f.main();
      f.existing(kind === "extra file", kind === "different formula");
      const result = f.run();
      expect(result.code).not.toBe(0);
      expect(f.main()).toBe(baseline);
      expect(result.calls.some((a) => a[0] === "pr")).toBe(false);
    } finally {
      f.cleanup();
    }
  },
);

test("a denied PR creation can retry the preserved branch after permission repair", () => {
  const f = fixture();
  try {
    const baseline = f.main();
    f.state.createDenied = true;
    expect(f.run().code).not.toBe(0);
    expect(f.main()).toBe(baseline);
    f.state.createDenied = false;
    const retry = f.run();
    expect(retry.code, retry.error).toBe(0);
    expect(f.main()).toBe(f.content);
  } finally {
    f.cleanup();
  }
});

test.skipIf(process.platform === "win32")(
  "a Formula symlink cannot enter automatic merge",
  () => {
    const f = fixture();
    try {
      const baseline = f.main();
      f.existing(false, false, true);
      const result = f.run();
      expect(result.code).not.toBe(0);
      expect(f.main()).toBe(baseline);
      expect(result.calls.some((a) => a[0] === "pr")).toBe(false);
    } finally {
      f.cleanup();
    }
  },
);

test("publication fails if the merge result does not contain the verified Formula", () => {
  const f = fixture();
  try {
    f.state.badMergedContent = true;
    const result = f.run();
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("Merged Homebrew Formula differs");
  } finally {
    f.cleanup();
  }
});

test.skipIf(process.platform === "win32")(
  "matching bytes through a main-branch symlink are not complete publication",
  () => {
    const f = fixture();
    try {
      f.git("rm", "Formula/" + f.formula);
      mkdirSync(join(f.root, "seed", "Formula"), { recursive: true });
      symlinkSync(f.source, join(f.root, "seed", "Formula", f.formula));
      f.git("add", ".");
      f.git("commit", "-qm", "Synthetic unexpected symlink");
      f.git("push", "-q", "origin", "main");
      const result = f.run();
      expect(result.code).not.toBe(0);
      expect(result.calls.some((a) => a[0] === "pr")).toBe(false);
    } finally {
      f.cleanup();
    }
  },
);
