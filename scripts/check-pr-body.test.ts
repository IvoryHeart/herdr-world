import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessContractImpacts,
  assessHelpImpact,
  checkPrBodyEvent,
  checkPrBodyText,
} from "./check-pr-body";
import { pushPolicyBody, pushPolicyContext } from "./check-push-policy";

const noImpacts =
  "Spec impact: none — Contributor tooling leaves product contracts unchanged.\n" +
  "Verification impact: none — No ordering or ownership contracts change.\n";

test("non-documentation PRs need both plain impact answers and reasons for none", () => {
  const paths = ["web/src/example.ts"];
  expect(assessContractImpacts(paths, "")).toEqual([
    expect.stringContaining("Spec impact:"),
    expect.stringContaining("Verification impact:"),
  ]);
  expect(assessContractImpacts(paths, noImpacts)).toEqual([]);
  for (const answer of [
    "",
    "none",
    "none —",
    "none — <reason>",
    "<updated path>",
  ]) {
    expect(
      assessContractImpacts(
        paths,
        `Spec impact: ${answer}\n${noImpacts.split("\n")[1]}`,
      ),
    ).toEqual([expect.stringContaining("Spec impact:")]);
    expect(
      assessContractImpacts(
        paths,
        `${noImpacts.split("\n")[0]}\nVerification impact: ${answer}`,
      ),
    ).toEqual([expect.stringContaining("Verification impact:")]);
  }
  for (const body of [
    noImpacts
      .replaceAll("impact:", "impact:**")
      .replaceAll(/^(Spec|Verification)/gm, "**$1"),
    `\`\`\`text\n${noImpacts}\`\`\``,
    `<!--\n${noImpacts}-->`,
    noImpacts + "Spec impact: none — A duplicate answer is ambiguous.\n",
  ]) {
    expect(assessContractImpacts(paths, body).length).toBeGreaterThan(0);
  }
  expect(
    assessContractImpacts(paths, noImpacts.replaceAll(/^/gm, "- ")),
  ).toEqual([]);
});

test("spec claims agree with changed current specs or OpenSpec changes", () => {
  for (const path of [
    "openspec/specs/example/spec.md",
    "openspec/changes/example-change/tasks.md",
  ]) {
    expect(assessContractImpacts([path], noImpacts)).toEqual([
      expect.stringContaining("Spec impact:"),
    ]);
    expect(
      assessContractImpacts(
        [path],
        noImpacts.replace(/^Spec impact:.*$/m, `Spec impact: ${path}`),
      ),
    ).toEqual([]);
  }
  expect(
    assessContractImpacts(
      ["openspec/changes/example-change/tasks.md"],
      noImpacts.replace(/^Spec impact:.*$/m, "Spec impact: example-change"),
    ),
  ).toEqual([]);
  expect(
    assessContractImpacts(
      ["openspec/specs/example/spec.md"],
      noImpacts.replace(
        /^Spec impact:.*$/m,
        "Spec impact: openspec/specs/example",
      ),
    ),
  ).toEqual([]);
  for (const paths of [
    ["web/src/example.ts"],
    ["openspec/specs/other/spec.md"],
  ]) {
    expect(
      assessContractImpacts(
        paths,
        noImpacts.replace(
          /^Spec impact:.*$/m,
          "Spec impact: openspec/specs/example/spec.md",
        ),
      ),
    ).toEqual([expect.stringContaining("Spec impact:")]);
  }
});

test("spec claims use complete nested capability ids without matching siblings", () => {
  for (const root of [
    "openspec/specs",
    "openspec/changes/example-change/specs",
  ]) {
    for (const id of ["world-surfaces/town", "world-surfaces/town/lighting"]) {
      const path = `${root}/${id}/spec.md`;
      const body = (claim: string) =>
        noImpacts.replace(/^Spec impact:.*$/m, `Spec impact: ${claim}`);
      for (const claim of [id, path, `${root}/${id}`]) {
        expect(assessContractImpacts([path], body(claim))).toEqual([]);
      }
      for (const claim of ["world-surfaces", "town", "world-surfaces/board"]) {
        expect(assessContractImpacts([path], body(claim))).toEqual([
          expect.stringContaining("Spec impact:"),
        ]);
      }
    }
  }
});

test("verification claims account for models, inventory owners and changed named checks", () => {
  const owns = (path: string) =>
    path === "server/src/owner.ts" || path.startsWith("server/src/owned/");
  for (const path of [
    "quint/example.qnt",
    "verification/coverage.json",
    "verification/contracts/example.md",
    "server/src/owner.ts",
    "server/src/owned/nested/consumer.ts",
  ]) {
    expect(assessContractImpacts([path], noImpacts, owns)).toEqual([
      expect.stringContaining("Verification impact:"),
    ]);
    expect(
      assessContractImpacts(
        [path],
        noImpacts.replace(
          /^Verification impact:.*$/m,
          `Verification impact: ${path}`,
        ),
        owns,
      ),
    ).toEqual([]);
  }
  const body = noImpacts.replace(
    /^Verification impact:.*$/m,
    "Verification impact: web/src/example.test.ts — Exhaustive admission matrix.",
  );
  expect(assessContractImpacts(["web/src/example.test.ts"], body)).toEqual([]);
  expect(assessContractImpacts(["web/src/other.test.ts"], body)).toEqual([
    expect.stringContaining("Verification impact:"),
  ]);
  expect(assessContractImpacts(["web/src/example.ts"], body)).toEqual([
    expect.stringContaining("Verification impact:"),
  ]);
  for (const check of [
    "web/src/example.browser.tsx",
    ".github/workflows/example.yml",
  ]) {
    expect(
      assessContractImpacts(
        [check],
        noImpacts.replace(
          /^Verification impact:.*$/m,
          `Verification impact: ${check}`,
        ),
      ),
    ).toEqual([]);
  }
});

test("ordinary documentation and empty diffs keep their exemption", () => {
  expect(assessContractImpacts(["README.md", "docs/example.md"], "")).toEqual(
    [],
  );
  expect(assessContractImpacts([], "")).toEqual([]);
  expect(
    assessContractImpacts(["server/src/owned/contract.md"], "", () => true),
  ).toHaveLength(2);
});

test("CI and pre-push share inventory owners and use the immutable PR head", () => {
  const root = mkdtempSync(join(tmpdir(), "pr-impact-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const owner = "server/src/owned/example.ts";
  const spec = "openspec/specs/world-surfaces/town/spec.md";
  const body = `Spec impact: world-surfaces/town\nVerification impact: ${owner}\nChangelog: none — Only synthetic regression fixtures change.\n`;
  const event = join(root, "event.json");
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "verification"));
    writeFileSync(
      join(root, "verification/coverage.json"),
      JSON.stringify({ areas: [{ owner: "server/src/owned/" }] }),
    );
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    const base = git("rev-parse", "HEAD");
    for (const path of [owner, spec]) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), "synthetic fixture\n");
    }
    git("add", ".");
    git("commit", "-qm", "contract fixtures");
    const head = git("rev-parse", "HEAD");
    expect(
      checkPrBodyText(
        noImpacts +
          "Changelog: none — Only synthetic regression fixtures change.\n",
        root,
      ),
    ).toEqual([
      expect.stringContaining("Spec impact:"),
      expect.stringContaining("Verification impact:"),
    ]);
    expect(checkPrBodyText(body, root)).toEqual([]);
    const description = join(root, "body.md");
    writeFileSync(description, body);
    expect(
      spawnSync(process.execPath, [cli, description], {
        cwd: root,
      }).status,
    ).toBe(0);
    // The checkout can contain merge-only changes that are outside this PR.
    writeFileSync(
      join(root, "README.md"),
      "synthetic merge-only documentation\n",
    );
    git("add", "README.md");
    git("commit", "-qm", "checkout-only change");
    const docsHead = git("rev-parse", "HEAD");
    mkdirSync(join(root, "quint"));
    writeFileSync(
      join(root, "quint/checkout-only.qnt"),
      "synthetic checkout-only model\n",
    );
    git("add", "quint");
    git("commit", "-qm", "another checkout-only change");
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: { base: { sha: base }, head: { sha: head }, body },
      }),
    );
    expect(checkPrBodyEvent(event, root)).toEqual([]);
    const result = spawnSync(process.execPath, [cli, "--event", event], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PR description policy passed");
    // An event whose PR is docs-only must not accidentally inspect checkout HEAD.
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          base: { sha: head },
          head: { sha: docsHead },
          body: "",
        },
      }),
    );
    expect(checkPrBodyEvent(event, root)).toEqual([]);
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: { base: { sha: "main" }, head: { sha: head }, body },
      }),
    );
    expect(() => checkPrBodyEvent(event, root)).toThrow("base or head");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("push policy uses the PR's immutable stacked base and fails closed on invalid identity", () => {
  expect(
    pushPolicyContext(undefined, () => ({
      body: "Stacked PR",
      baseRefOid: "a".repeat(40),
    })),
  ).toEqual({ body: "Stacked PR", base: "a".repeat(40) });
  expect(
    pushPolicyContext(undefined, () => {
      throw new Error("First push");
    }),
  ).toEqual({ body: "", base: "origin/main" });
  expect(() =>
    pushPolicyContext(undefined, () => ({
      body: "",
      baseRefOid: "feature/example",
    })),
  ).toThrow("immutable base");
});

test("push policy reads the intended description or existing PR, and never invents an exemption", () => {
  expect(pushPolicyBody(undefined, () => "Existing PR")).toBe("Existing PR");
  expect(
    pushPolicyBody(undefined, () => {
      throw new Error("No PR yet");
    }),
  ).toBe("");
  expect(() =>
    pushPolicyBody("/missing/synthetic-pr-body", () => "fallback"),
  ).toThrow();
});

const cli = fileURLToPath(new URL("./check-pr-body.ts", import.meta.url));
test("draft descriptions enforce the same knowledge-map and changelog rules before PR creation", () => {
  const root = mkdtempSync(join(tmpdir(), "pr-body-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    writeFileSync(join(root, "README.md"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(root, "web/src/world"), { recursive: true });
    writeFileSync(
      join(root, "web/src/world/example.ts"),
      "export const value = 1;\n",
    );
    git("add", ".");
    git("commit", "-qm", "change");
    const body = join(root, "body.md");
    const run = (text: string) => {
      writeFileSync(body, text);
      return spawnSync(process.execPath, [cli, body], {
        cwd: root,
        encoding: "utf8",
      });
    };
    const invalid = run("Knowledge map impact: unchanged\nChangelog: none\n");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Knowledge map impact:");
    expect(invalid.stderr).toContain("Changelog:");
    expect(invalid.stderr).toContain("Spec impact:");
    expect(invalid.stderr).toContain("Verification impact:");
    const reason =
      "Knowledge map impact: unchanged — Existing ownership and entry points remain accurate.\n" +
      noImpacts;
    expect(
      run(
        reason +
          "Changelog: none — Only synthetic regression coverage changes.\n",
      ).status,
    ).toBe(0);
    mkdirSync(join(root, "changes"));
    writeFileSync(
      join(root, "changes/example.md"),
      "### Fixed\n\n- Keep synthetic behavior consistent.\n",
    );
    git("add", "changes");
    git("commit", "-qm", "fragment");
    expect(run(reason).status).toBe(0);
    writeFileSync(join(root, "changes/example.md"), "invalid fragment");
    expect(run(reason).status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an added feature ships a help declaration or says why it needs none", () => {
  const added = "### Added\n\n- A synthetic feature.\n";
  const fixed = "### Fixed\n\n- A synthetic fix.\n";
  const paths = ["changes/synthetic.md", "web/src/example.tsx"];
  const read = (text: string) => (path: string) =>
    path === "changes/synthetic.md" ? text : undefined;
  expect(assessHelpImpact(paths, read(added), "")).toEqual([
    expect.stringContaining("changes/synthetic.md adds something"),
  ]);
  expect(assessHelpImpact(paths, read(fixed), "")).toEqual([]);
  expect(
    assessHelpImpact(
      [...paths, "web/src/world/example.help.ts"],
      read(added),
      "",
    ),
  ).toEqual([]);
  expect(
    assessHelpImpact(
      paths,
      read(added),
      "Help: none — The setting has no control on screen.",
    ),
  ).toEqual([]);
  for (const answer of ["Help: none", "Help: none — <reason>", "Help: yes"])
    expect(assessHelpImpact(paths, read(added), answer)).toHaveLength(1);
});
