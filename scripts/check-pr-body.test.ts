import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessContractImpacts,
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
    "verification/coverage/example.json",
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
  const spec = "openspec/changes/example/specs/world-surfaces/town/spec.md";
  const body = `Spec impact: world-surfaces/town\nVerification impact: ${owner}\nChangelog: none — Only synthetic regression fixtures change.\n`;
  const event = join(root, "event.json");
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "openspec/specs/world-surfaces/town"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "openspec/specs/world-surfaces/town/spec.md"),
      "# Town\n",
    );
    writeFileSync(
      join(root, "openspec/specs/world-surfaces/town/notes.md"),
      "**Code:**\n\n- `server/src/owned/`\n",
    );
    mkdirSync(join(root, "verification/coverage"), { recursive: true });
    writeFileSync(join(root, "verification/coverage/_meta.json"), "{}");
    writeFileSync(
      join(root, "verification/coverage/example.json"),
      JSON.stringify({ id: "example", owner: "server/src/owned/" }),
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

test("push policy judges a branch that merged a newer main against main's current tip", () => {
  const root = mkdtempSync(join(tmpdir(), "push-policy-base-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = (path: string, text: string, message: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
    git("add", path);
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  const body =
    noImpacts + "Changelog: none — Only synthetic policy fixtures change.\n";
  const currentSpec = "openspec/specs/world-surfaces/town/spec.md";
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    commit(
      "openspec/specs/world-surfaces/town/notes.md",
      "**Code:**\n\n- `scripts/`\n",
      "notes",
    );
    const recorded = commit(currentSpec, "# Town\n", "base");
    git("switch", "-qc", "feature");
    commit("scripts/example.ts", "export {};\n", "feature");
    git("switch", "-q", "main");
    // Main's own archive-style edit of a current spec, outside this PR.
    const tip = commit(currentSpec, "# Town\n\nSynced.\n", "main sync");
    git("update-ref", "refs/remotes/origin/main", tip);
    git("switch", "-q", "feature");
    git("merge", "-q", "--no-edit", "main");

    // The PR's recorded base is stale: main's spec edit counts as the PR's.
    expect(checkPrBodyText(body, root, recorded)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Put contract edits in openspec/changes/"),
      ]),
    );
    const policy = pushPolicyContext(
      undefined,
      () => ({ body, baseRefOid: recorded, baseRefName: "main" }),
      root,
    );
    expect(policy.base).toBe(tip);
    expect(checkPrBodyText(policy.body, root, policy.base)).toEqual([]);

    // A rewritten stacked parent keeps the recorded immutable base.
    git("update-ref", "refs/remotes/origin/parent", recorded);
    git("switch", "-qc", "parent", recorded);
    const rewritten = commit("docs/parent.md", "rewritten\n", "rewrite");
    git("update-ref", "refs/remotes/origin/parent", rewritten);
    const stackedBase = git("rev-parse", "main");
    expect(
      pushPolicyContext(
        undefined,
        () => ({ body, baseRefOid: stackedBase, baseRefName: "parent" }),
        root,
      ).base,
    ).toBe(stackedBase);
    // An unknown base branch or a stale local ref also keeps it.
    for (const baseRefName of ["missing", "main"])
      expect(
        pushPolicyContext(
          undefined,
          () => ({ body, baseRefOid: tip, baseRefName }),
          root,
        ).base,
      ).toBe(tip);
    git("update-ref", "refs/remotes/origin/main", recorded);
    expect(
      pushPolicyContext(
        undefined,
        () => ({ body, baseRefOid: tip, baseRefName: "main" }),
        root,
      ).base,
    ).toBe(tip);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
test("draft descriptions enforce source coverage and contract impact without fragments", () => {
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
    expect(invalid.stderr).toContain("web/src/world/example.ts");
    expect(invalid.stderr).not.toContain("Add a valid changes/");
    expect(invalid.stderr).toContain("Spec impact:");
    expect(invalid.stderr).toContain("Verification impact:");
    mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
    writeFileSync(join(root, "openspec/specs/example/spec.md"), "# Example\n");
    writeFileSync(
      join(root, "openspec/specs/example/notes.md"),
      "**Code:**\n\n- `web/src/world/`\n",
    );
    const reason = noImpacts;
    expect(
      run(
        reason +
          "Changelog: none — Only synthetic regression coverage changes.\n",
      ).status,
    ).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleted source owners are optional while deleted current specs still require deltas", () => {
  const root = mkdtempSync(join(tmpdir(), "pr-deleted-owner-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const body =
    "Changelog: none — Remove a synthetic retired fixture.\nSpec impact: openspec/specs/example/notes.md — Remove retired source ownership.\nVerification impact: none — No ordering or authority behavior changes.\n";
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
    mkdirSync(join(root, "server/src"), { recursive: true });
    writeFileSync(join(root, "openspec/specs/example/spec.md"), "# Example\n");
    writeFileSync(
      join(root, "openspec/specs/example/notes.md"),
      "**Code:**\n\n- `server/src/retired.ts`\n",
    );
    writeFileSync(
      join(root, "server/src/retired.ts"),
      "export const retired = true;\n",
    );
    git("add", ".");
    git("commit", "-qm", "Baseline");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("rm", "server/src/retired.ts");
    writeFileSync(join(root, "openspec/specs/example/notes.md"), "**Code:**\n");
    git("add", ".");
    git("commit", "-qm", "Remove source and owner");
    expect(checkPrBodyText(body, root)).toEqual([]);
    git(
      "rm",
      "openspec/specs/example/spec.md",
      "openspec/specs/example/notes.md",
    );
    git("commit", "-qm", "Delete current spec");
    expect(checkPrBodyText(body, root)).toContainEqual(
      expect.stringContaining(
        "Put contract edits in openspec/changes/<slug>/specs/",
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
