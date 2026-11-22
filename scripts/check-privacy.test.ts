import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privacyRules, scanPrivacyRange } from "./check-privacy";

// Assemble disallowed fixtures so these regressions obey the publication rule.
const ip = (...parts: number[]) => parts.join(".");
const secret = Array.from({ length: 64 }, (_, i) => (i % 16).toString(16)).join(
  "",
);
const home = ["", "home", "operator", "report.md"].join("/");
const email = ["operator", "mail-provider.com"].join("@");
const tailnet = ["desktop", "private-tailnet", "ts", "net"].join(".");
const login = `https://world.example/login?token=${secret}`;

for (const address of [
  ip(10, 0, 0, 0),
  ip(10, 255, 255, 255),
  ip(172, 16, 0, 0),
  ip(172, 31, 255, 255),
  ip(192, 168, 0, 0),
  ip(192, 168, 255, 255),
  ip(100, 64, 0, 0),
  ip(100, 127, 255, 255),
]) {
  test(`rejects private address case ${address.split(".")[0]}`, () => {
    expect(privacyRules(`url=http://${address}:1234/`)).toContain("private-ip");
  });
}

test("rejects tailnet IPv6, tailnet hosts, home paths and personal email", () => {
  const v6 = ["fd7a", "115c", "a1e0", "", "1234"].join(":");
  for (const value of [
    v6,
    v6.toUpperCase(),
    ["fd7a", "115c", "a1e0", "1", "2", "3", "4", "5"].join(":"),
  ])
    expect(privacyRules(value)).toContain("tailnet-ipv6");
  expect(privacyRules(`https://${tailnet}/`)).toContain("tailnet-host");
  expect(privacyRules(home)).toContain("home-path");
  expect(privacyRules(home.slice(0, home.lastIndexOf("/")))).toContain(
    "home-path",
  );
  expect(
    privacyRules(["", "Users", "Example Operator", "report.md"].join("/")),
  ).toContain("home-path");
  expect(privacyRules(`host_${ip(10, 1, 2, 3)}_preview`)).toContain(
    "private-ip",
  );
  expect(
    privacyRules(["", "Users", "operator", "report.md"].join("/")),
  ).toContain("home-path");
  expect(privacyRules(email)).toContain("email");
  expect(privacyRules(["person", "example.com.evil.org"].join("@"))).toContain(
    "email",
  );
});

test("rejects login tokens, literal passwords and session signing state", () => {
  expect(privacyRules(login)).toContain("login-token");
  expect(
    privacyRules(`https://world.example/?a=1&amp;token=${secret}`),
  ).toContain("login-token");
  for (const value of ["hunter2", secret, "short"]) {
    expect(privacyRules(`HERDR_WORLD_PASSWORD=${value}`)).toContain(
      "world-password",
    );
    expect(privacyRules(`HERDR_WORLD_PASSWORD='${value}'`)).toContain(
      "world-password",
    );
  }
  for (const key of [
    "SESSION_SECRET",
    "sessionSecret",
    "session_secret",
    "session-secret",
    "secret",
  ]) {
    expect(privacyRules(`"${key}": "${secret}"`)).toContain("session-secret");
  }
});

test("dependency versions are not emails, but numeric email labels remain covered", () => {
  expect(
    privacyRules('"react-dom@19.3.1": "patches/react-dom@19.3.1.patch"'),
  ).toEqual([]);
  expect(privacyRules('"@scope/pkg@1.2.3-beta.4.patch"')).toEqual([]);
  expect(
    privacyRules(["operator", "19.mail-provider.com"].join("@")),
  ).toContain("email");
});

test("only reserved domains, public/documentation addresses and explicit placeholders pass", () => {
  for (const value of [
    "192.0.2.1",
    "198.51.100.2",
    "203.0.113.3",
    "2001:db8::1",
    "127.0.0.1",
    "172.15.255.255",
    "172.32.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "11.0.0.1",
    "someone@example.com",
    "someone@sub.example.org",
    "person@example.net",
    "person@example",
    "person@fixture.invalid",
    "person@fixture.test",
    "person@localhost",
    "/home/<user>/report.md",
    "/Users/<username>/report.md",
    "/home/example/report.md",
    "?token=<token>",
    "?token=${token}",
    "?token=" + "a".repeat(64),
    "HERDR_WORLD_PASSWORD=<password>",
    "HERDR_WORLD_PASSWORD=${PASSWORD}",
    "HERDR_WORLD_PASSWORD=example",
    'sessionSecret: "a".repeat(64)',
    '"secret": "' + "b".repeat(64) + '"',
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "sessionSecret: args.sessionSecret",
    "sessionSecret: config.sessionSecret",
    "const SESSION_SECRET = anotherSessionSecretVariable;",
  ])
    expect(privacyRules(value)).toEqual([]);
  // A placeholder elsewhere in the line cannot authorize the actual value.
  expect(privacyRules(`example ${login}`)).toContain("login-token");
  expect(privacyRules(`example ${email}`)).toContain("email");
});

function repository(
  run: (fixture: {
    root: string;
    git: (...args: string[]) => string;
    commit: (content: string, path?: string) => string;
    base: string;
  }) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "privacy-check-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (content: string, path = "report.md") => {
    writeFileSync(join(root, path), content);
    git("add", "--", path);
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    const base = commit(`Existing legacy context ${home}\n`);
    git("update-ref", "refs/remotes/origin/main", base);
    run({ root, git, commit, base });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const script = join(import.meta.dir, "check-privacy.ts");
function cli(root: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
}

test("scans added lines in every commit, including leaks removed before HEAD", () =>
  repository(({ root, base, commit }) => {
    const clean = commit(`Existing legacy context ${home}\nSafe addition\n`);
    expect(scanPrivacyRange(root, base, clean)).toEqual([]);
    commit(`Existing legacy context ${home}\n${login}\n`);
    const removed = commit(`Existing legacy context ${home}\nSafe addition\n`);
    const findings = scanPrivacyRange(root, base, removed);
    expect(findings).toContainEqual(
      expect.objectContaining({
        file: "report.md",
        line: 2,
        rule: "login-token",
      }),
    );
    const result = cli(root, ["--range", base, removed]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("report.md");
    expect(result.stderr).toContain(":2:");
    expect(result.stderr).not.toContain(secret);
    expect(result.stderr).not.toContain(home);
  }));

test("literal Git pathspec characters cannot hide added content", () =>
  repository(({ root, base, commit }) => {
    const path = ":(exclude)report.md";
    const head = commit(`${login}\n`, path);
    expect(scanPrivacyRange(root, base, head)).toContainEqual(
      expect.objectContaining({ file: path, line: 1, rule: "login-token" }),
    );
  }));

test("push and PR events scan exact commits; new branches and force pushes stay covered", () =>
  repository(({ root, git, base, commit }) => {
    const bad = commit(`${email}\n`);
    const event = join(root, "event.json");
    for (const payload of [
      { before: base, after: bad },
      { before: "0".repeat(40), after: bad },
      { pull_request: { base: { sha: base }, head: { sha: bad } } },
    ]) {
      writeFileSync(event, JSON.stringify(payload));
      expect(cli(root, ["--event", event]).status).toBe(1);
    }
    git("checkout", "-q", "--detach", base);
    const clean = commit("Safe rewrite\n");
    expect(scanPrivacyRange(root, bad, clean)).toEqual([]);
    expect(scanPrivacyRange(root, clean, bad)).not.toEqual([]);
    writeFileSync(
      event,
      JSON.stringify({ before: "f".repeat(40), after: bad }),
    );
    const missing = cli(root, ["--event", event]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("privacy/email");
    expect(missing.stderr).not.toContain(root);
    writeFileSync(
      event,
      JSON.stringify({ before: "f".repeat(40), after: clean }),
    );
    expect(cli(root, ["--event", event]).status).toBe(0);
    writeFileSync(event, JSON.stringify({ before: bad, after: clean }));
    expect(cli(root, ["--event", event]).status).toBe(0);
    writeFileSync(
      event,
      JSON.stringify({ before: base, after: "f".repeat(40) }),
    );
    expect(cli(root, ["--event", event]).status).toBe(1);
  }));

test("checkout refspec after a force push need not contain the previous head", () =>
  repository(({ root, git, base, commit }) => {
    const previous = commit("Old branch\n");
    const remote = join(root, "remote.git");
    git("init", "--bare", "-q", remote);
    git(
      "push",
      "-q",
      remote,
      `${base}:refs/heads/main`,
      `${previous}:refs/heads/topic`,
    );
    git("checkout", "-q", "--detach", base);
    const clean = commit("Clean rewrite\n");
    git("push", "-q", "--force", remote, `${clean}:refs/heads/topic`);
    const checkout = join(root, "checkout");
    mkdirSync(checkout);
    const fetchedGit = (...args: string[]) => git("-C", checkout, ...args);
    fetchedGit("init", "-q");
    fetchedGit("remote", "add", "origin", remote);
    fetchedGit(
      "fetch",
      "-q",
      "origin",
      "+refs/heads/*:refs/remotes/origin/*",
      "+refs/tags/*:refs/tags/*",
    );
    expect(() => fetchedGit("cat-file", "-e", previous)).toThrow();
    const event = join(root, "event.json");
    writeFileSync(event, JSON.stringify({ before: previous, after: clean }));
    expect(cli(checkout, ["--event", event]).status).toBe(0);
    const bad = commit(`${login}\n`);
    git("push", "-q", "--force", remote, `${bad}:refs/heads/topic`);
    fetchedGit("fetch", "-q", "origin", "+refs/heads/*:refs/remotes/origin/*");
    writeFileSync(event, JSON.stringify({ before: previous, after: bad }));
    const result = cli(checkout, ["--event", event]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("privacy/login-token");
  }));

test("branch pushes and PRs do not reattribute main additions to a merge", () =>
  repository(({ root, git, base, commit }) => {
    const upstream = commit(`${email}\n`, "upstream.md");
    git("update-ref", "refs/remotes/origin/main", upstream);
    git("checkout", "-q", "-b", "topic", base);
    const prior = commit("Branch change\n", "branch.md");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "merge",
      "-q",
      "--no-ff",
      "--no-edit",
      upstream,
    );
    const head = git("rev-parse", "HEAD");
    expect(scanPrivacyRange(root, upstream, head)).toEqual([]);
    const event = join(root, "event.json");
    for (const before of [prior, upstream, "f".repeat(40)]) {
      writeFileSync(event, JSON.stringify({ before, after: head }));
      expect(cli(root, ["--event", event]).status).toBe(0);
    }
    commit(`${login}\n`, "branch-secret.md");
    writeFileSync(
      event,
      JSON.stringify({ before: prior, after: git("rev-parse", "HEAD") }),
    );
    expect(cli(root, ["--event", event]).stderr).toContain(
      "privacy/login-token",
    );
    const refs = join(root, "refs");
    writeFileSync(refs, `refs/heads/topic ${head} refs/heads/topic ${prior}\n`);
    expect(cli(root, ["--pre-push", refs]).status).toBe(0);
  }));

test("binary additions and updates do not produce text findings", () =>
  repository(({ root, git, base, commit }) => {
    const saveBinary = () => {
      writeFileSync(
        join(root, "golden.png"),
        Buffer.from(`\x89PNG\0${email}\n${login}\n`),
      );
      git("add", "golden.png");
      git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "binary fixture");
    };
    saveBinary();
    const binaryBase = git("rev-parse", "HEAD");
    expect(scanPrivacyRange(root, base, binaryBase)).toEqual([]);
    writeFileSync(join(root, "golden.png"), Buffer.from("\x89PNG\0safe\n"));
    git("add", "golden.png");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "binary update");
    saveBinary();
    expect(scanPrivacyRange(root, binaryBase, "HEAD")).toEqual([]);
    const head = commit(`${email}\n`, "text.png");
    expect(scanPrivacyRange(root, binaryBase, head)).toContainEqual(
      expect.objectContaining({ file: "text.png", rule: "email" }),
    );
  }));

test("published dependency attribution is reusable only in the root generated licence artifact", () =>
  repository(({ root, git, commit }) => {
    const baseline = commit(
      `- \`package@1.0.0\` — Author <${email}>\n`,
      "DEPENDENCY_LICENSES.md",
    );
    git("update-ref", "refs/remotes/origin/main", baseline);
    const updated = commit(
      `- \`package@2.0.0\` — Author <${email}>\n`,
      "DEPENDENCY_LICENSES.md",
    );
    expect(scanPrivacyRange(root, baseline, updated)).toEqual([]);
    const outside = commit(`${email}\n`, "report.md");
    expect(scanPrivacyRange(root, updated, outside)).toContainEqual(
      expect.objectContaining({ file: "report.md", rule: "email" }),
    );
    const unknown = ["new-person", "mail-provider.com"].join("@");
    const bad = commit(
      `Author <${email}>\nAuthor <${unknown}>\n${login}\n${home}\n`,
      "DEPENDENCY_LICENSES.md",
    );
    const findings = scanPrivacyRange(root, outside, bad);
    for (const rule of ["email", "login-token", "home-path"])
      expect(findings).toContainEqual(
        expect.objectContaining({ file: "DEPENDENCY_LICENSES.md", rule }),
      );
    const actual = readFileSync(
      join(import.meta.dir, "../DEPENDENCY_LICENSES.md"),
      "utf8",
    );
    const trusted = commit(actual, "DEPENDENCY_LICENSES.md");
    git("update-ref", "refs/remotes/origin/main", trusted);
    const refreshed = commit(
      actual
        .split("\n")
        .map((line) => (line ? ` ${line}` : line))
        .join("\n"),
      "DEPENDENCY_LICENSES.md",
    );
    expect(scanPrivacyRange(root, trusted, refreshed)).toEqual([]);
  }));

test("main pushes cannot approve newly added attribution addresses", () =>
  repository(({ root, git, commit }) => {
    const before = commit(`Author <${email}>\n`, "DEPENDENCY_LICENSES.md");
    const unknown = ["new-person", "mail-provider.com"].join("@");
    const after = commit(
      `Author <${email}>\nNew author <${unknown}>\n`,
      "DEPENDENCY_LICENSES.md",
    );
    git("update-ref", "refs/remotes/origin/main", after);
    const event = join(root, "event.json");
    writeFileSync(event, JSON.stringify({ before, after }));
    const result = cli(root, ["--event", event]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '"DEPENDENCY_LICENSES.md":2: privacy/email',
    );
    expect(result.stderr).not.toContain(unknown);
  }));

test("pre-push scans every actual ref and ignores branch deletions", () =>
  repository(({ root, git, base, commit }) => {
    const bad = commit(`${login}\n`);
    git("checkout", "-q", "--detach", base);
    const clean = commit("Safe\n");
    const refs = join(root, "refs");
    const row = (head: string, prior: string) =>
      `refs/heads/example ${head} refs/heads/example ${prior}\n`;
    writeFileSync(refs, row(clean, base) + row(bad, "0".repeat(40)));
    expect(cli(root, ["--pre-push", refs]).status).toBe(1);
    writeFileSync(refs, row("0".repeat(40), bad));
    expect(cli(root, ["--pre-push", refs]).status).toBe(0);
    writeFileSync(refs, row(clean, "f".repeat(40)));
    expect(cli(root, ["--pre-push", refs]).status).toBe(0);
    writeFileSync(refs, row(bad, "f".repeat(40)));
    expect(cli(root, ["--pre-push", refs]).stderr).toContain(
      "privacy/login-token",
    );
    writeFileSync(refs, "invalid input");
    expect(cli(root, ["--pre-push", refs]).status).toBe(1);
  }));

test("renames, unusual filenames, root commits and session-secret files have no bypass", () =>
  repository(({ root, git, base, commit }) => {
    const path = 'report with spaces\nand "quotes".md';
    const bad = commit(`${login}\n`, path);
    expect(scanPrivacyRange(root, base, bad)).toContainEqual(
      expect.objectContaining({ file: path, line: 1 }),
    );
    git("checkout", "-q", "--detach", base);
    git("mv", "report.md", "renamed.md");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "rename");
    expect(scanPrivacyRange(root, base, "HEAD")).toContainEqual(
      expect.objectContaining({ file: "renamed.md", rule: "home-path" }),
    );
    expect(scanPrivacyRange(root, null, base)).not.toEqual([]);
    mkdirSync(join(root, "nested"));
    commit(
      `{"version":1,"secret":"${secret}"}\n`,
      "nested/session-secret.json",
    );
    expect(scanPrivacyRange(root, base, "HEAD")).toContainEqual(
      expect.objectContaining({ rule: "session-secret" }),
    );
  }));

test("diagnostics redact private filenames and never echo any matched content", () =>
  repository(({ root, base, commit }) => {
    const path = tailnet + ".md";
    const head = commit(`${login} ${email} ${home}\n`, path);
    const result = cli(root, ["--range", base, head]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[redacted-path]");
    for (const value of [secret, email, home, tailnet]) {
      expect(result.stderr).not.toContain(value);
      expect(result.stdout).not.toContain(value);
    }
  }));

test("merged side-branch history and merge resolutions are scanned", () =>
  repository(({ root, git, base, commit }) => {
    git("checkout", "-q", "-b", "side");
    commit(`${login}\n`, "side.md");
    commit("Removed in side branch\n", "side.md");
    git("checkout", "-q", "main");
    commit("Main change\n", "main.md");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "merge",
      "-q",
      "--no-ff",
      "--no-edit",
      "side",
    );
    expect(scanPrivacyRange(root, base, "HEAD")).toContainEqual(
      expect.objectContaining({ file: "side.md", rule: "login-token" }),
    );
    writeFileSync(join(root, "resolution.md"), `${email}\n`);
    git("add", "resolution.md");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-q",
      "--amend",
      "--no-edit",
    );
    expect(scanPrivacyRange(root, base, "HEAD")).toContainEqual(
      expect.objectContaining({ file: "resolution.md", rule: "email" }),
    );
  }));

test("missing main scans all history and default CLI checks the unpublished branch", () =>
  repository(({ root, git, commit }) => {
    commit(`${login}\n`);
    expect(cli(root, []).status).toBe(1);
    git("update-ref", "-d", "refs/remotes/origin/main");
    const result = cli(root, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("privacy/home-path");
    expect(result.stderr).not.toContain(home);
  }));
