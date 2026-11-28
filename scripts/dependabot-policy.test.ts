import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPrBodyEvent, checkPrBodyText } from "./check-pr-body";
import { scanPrivacyText } from "./check-privacy";
import { selectValidation } from "./validation-scope";
import { webBrowserSuites } from "./world-browser-suites";

const bot = { login: "dependabot[bot]", type: "Bot" };
const support = ["support", "github.com"].join("@");
const noreply = ["49699333+dependabot[bot]", "users.noreply.github.com"].join(
  "@",
);
const personal = ["operator", "mail-provider.com"].join("@");

test("only GitHub's bot sender and bot PR author waive impact lines", () => {
  const root = mkdtempSync(join(tmpdir(), "dependabot-policy-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "synthetic fixture");
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
    writeFileSync(join(root, "openspec/specs/example/spec.md"), "# Example\n");
    writeFileSync(
      join(root, "openspec/specs/example/notes.md"),
      "**Code:**\n\n- `scripts/`\n",
    );
    writeFileSync(join(root, "bun.lock"), "{}\n");
    const base = commit();
    writeFileSync(join(root, "bun.lock"), '{"lockfileVersion": 1}\n');
    const head = commit();
    const eventFile = join(root, ".git", "event.json");
    const pull = {
      base: { sha: base },
      head: { sha: head },
      title: "dependabot[bot] update",
      body: "Bumps example-package. Authored by dependabot[bot].",
    };
    const check = (
      sender: { login?: string; type?: string } = bot,
      user: { login?: string; type?: string } = bot,
      changes = {},
    ) => {
      writeFileSync(
        eventFile,
        JSON.stringify({ sender, pull_request: { ...pull, user, ...changes } }),
      );
      return checkPrBodyEvent(eventFile, root);
    };
    const identities = [bot.login, "example", undefined].flatMap((login) =>
      [bot.type, "User", undefined].map((type) => ({ login, type })),
    );
    for (const sender of identities)
      for (const author of identities) {
        const problems = check(sender, author);
        if (
          sender.login === bot.login &&
          sender.type === bot.type &&
          author.login === bot.login &&
          author.type === bot.type
        )
          expect(problems).toEqual([]);
        else
          expect(problems).toEqual([
            expect.stringContaining("Spec impact:"),
            expect.stringContaining("Verification impact:"),
          ]);
      }
    writeFileSync(
      eventFile,
      JSON.stringify({ pull_request: { ...pull, user: bot } }),
    );
    expect(checkPrBodyEvent(eventFile, root)).toHaveLength(2);
    writeFileSync(
      eventFile,
      JSON.stringify({ sender: bot, pull_request: pull }),
    );
    expect(checkPrBodyEvent(eventFile, root)).toHaveLength(2);
    expect(checkPrBodyText(pull.body, root, base, head)).toHaveLength(2);
    for (const field of ["body", "title"])
      expect(check(bot, bot, { [field]: personal })).toContainEqual(
        expect.stringContaining("privacy/email"),
      );
    // Bot identity waives only the impact prose, never other policy checks.
    mkdirSync(join(root, "server/src"), { recursive: true });
    writeFileSync(join(root, "server/src/unowned.ts"), "export {};\n");
    writeFileSync(
      join(root, "openspec/specs/example/spec.md"),
      "# Changed contract\n",
    );
    expect(check(bot, bot, { head: { sha: commit() } })).toEqual([
      expect.stringContaining("Put contract edits in openspec/changes/"),
      expect.stringContaining(
        "Source files without a capability notes.md Code path",
      ),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Dependabot metadata accepts exact public identities and still scans every value", () => {
  for (const address of [support, noreply]) {
    const signoff = `Signed-off-by: dependabot[bot] <${address}>`;
    expect(scanPrivacyText(signoff, "commit message", true)).toEqual([]);
    for (const dependabot of [false, true])
      expect(
        scanPrivacyText(
          `[${address}](mailto:${address})`,
          "PR body",
          dependabot,
        ),
      ).toEqual([]);
    for (const value of [
      personal,
      ["", "home", "operator", "report.md"].join("/"),
      ["HERDR_WORLD_PASSWORD", "fixture-private-value"].join("="),
    ])
      expect(
        scanPrivacyText(`${signoff} ${value}`, "PR body", true).length,
      ).toBeGreaterThan(0);
  }
  for (const address of [
    ["support", "sub.github.com"].join("@"),
    ["support", "github.com.evil.org"].join("@"),
    ["49699333+dependabot[bot]", "mail-provider.com"].join("@"),
    ["49699333+dependabot[bot]", "users.noreply.github.com.evil.org"].join("@"),
    ["another-bot[bot]", "users.noreply.github.com"].join("@"),
  ])
    expect(scanPrivacyText(address, "PR body", true)).toContainEqual(
      expect.objectContaining({ rule: "email" }),
    );
  const human = ["12345+example", "users.noreply.github.com"].join("@");
  expect(scanPrivacyText(human, "PR body")).toEqual([]);
});

test("verified bot events scan commit messages, PR metadata and dependency licence additions", () => {
  const root = mkdtempSync(join(tmpdir(), "dependabot-privacy-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    git("commit", "--allow-empty", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git(
      "commit",
      "--allow-empty",
      "-qm",
      `Bump dependency\n\nSigned-off-by: dependabot[bot] <${support}>\nCo-authored-by: dependabot[bot] <${noreply}>`,
    );
    const event = join(root, ".git", "event.json");
    const run = (body = "", title = "Bump dependency") => {
      writeFileSync(
        event,
        JSON.stringify({
          sender: bot,
          pull_request: {
            user: bot,
            base: { sha: base },
            head: { sha: git("rev-parse", "HEAD") },
            title,
            body,
          },
        }),
      );
      return spawnSync(
        process.execPath,
        [join(import.meta.dir, "check-privacy.ts"), "--event", event],
        { cwd: root, encoding: "utf8" },
      );
    };
    expect(run().status).toBe(0);
    for (const result of [run(personal), run("", personal)]) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("privacy/email");
      expect(result.stderr).not.toContain(personal);
    }
    writeFileSync(
      join(root, "DEPENDENCY_LICENSES.md"),
      `Copyright <${personal}>\n${support}\n`,
    );
    git("add", ".");
    git(
      "commit",
      "-qm",
      `Dependency notices\n\nCo-authored-by: Other <${["other", "users.noreply.github.com"].join("@")}>`,
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"commit message"');
    expect(result.stderr).toContain('"DEPENDENCY_LICENSES.md"');
    expect(result.stderr).not.toContain(personal);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dependency files retain the full normal validation selection", () => {
  const selection = selectValidation(
    {
      files: new Set([
        "bun.lock",
        "scripts/example.test.ts",
        ...webBrowserSuites,
      ]),
      gone: new Set(),
      deps: new Map(),
    },
    ["bun.lock"],
    () => false,
  );
  expect(selection.full).toBe(true);
  expect(selection.unit).toContain("scripts/example.test.ts");
  expect(selection.world.length).toBeGreaterThan(0);
  expect(selection.web.length).toBeGreaterThan(0);
  expect(selection.verification).toBe(true);
});
