import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const surfaces = "openspec/specs/world-surfaces";
const capabilities = readdirSync(join(root, surfaces), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `${surfaces}/${entry.name}`);
const contracts = [surfaces, ...capabilities, "openspec/specs/world-memory"];

test("active surface deltas target their current nested capability", () => {
  for (const path of new Bun.Glob(
    "openspec/changes/*/specs/world-surfaces/**/spec.md",
  ).scanSync({ cwd: root })) {
    const relative = path.split("/specs/")[1]!;
    const current = join(root, "openspec/specs", relative);
    expect(relative, path).not.toBe("world-surfaces/spec.md");
    expect(existsSync(current), path).toBe(true);
    const delta = readFileSync(join(root, path), "utf8");
    const modified = delta
      .split("## MODIFIED Requirements")[1]
      ?.split(/^## /m)[0];
    for (const match of (modified ?? "").matchAll(/^### Requirement: (.+)$/gm))
      expect(readFileSync(current, "utf8"), path).toContain(match[0]);
    for (const requirement of delta.split(/^### Requirement: /m).slice(1)) {
      const body = requirement
        .split("\n")
        .slice(1)
        .join("\n")
        .split(/^#### /m)[0]!
        .trim();
      expect(body.length, path).toBeLessThanOrEqual(500);
    }
  }
});

test("feature contracts stay discoverable, concise and accompanied by source notes", () => {
  expect(capabilities.length).toBeGreaterThanOrEqual(21);
  const parent = readFileSync(join(root, surfaces, "spec.md"), "utf8");
  expect(
    [...parent.matchAll(/^### Requirement:/gm)].length,
  ).toBeLessThanOrEqual(12);
  for (const capability of contracts) {
    const spec = readFileSync(join(root, capability, "spec.md"), "utf8");
    const requirements = spec.split(/^### Requirement: /m).slice(1);
    expect(requirements.length, capability).toBeGreaterThan(0);
    for (const requirement of requirements) {
      const [title, ...lines] = requirement.split("\n");
      const body = lines
        .join("\n")
        .split(/^#### /m)[0]!
        .trim();
      expect(body.length, `${capability}: ${title}`).toBeLessThanOrEqual(500);
      expect(body, `${capability}: ${title}`).toMatch(/\b(?:SHALL|MUST)\b/);
      expect(requirement).toMatch(/^#### Scenario:/m);
    }
    const notes = readFileSync(join(root, capability, "notes.md"), "utf8");
    // Keep discovery short; the migrated user reference follows it separately.
    const navigation = notes.split("\n## Usage reference\n")[0]!;
    expect(navigation.trimEnd().split("\n").length, capability).toBeLessThan(
      60,
    );
    for (const section of ["Surfaces", "Code", "Tests", "Pitfalls"])
      expect(navigation).toContain(`**${section}:**`);
    for (const match of navigation.matchAll(
      /`((?:server|web|shared|scripts)\/[^`]+)`/g,
    ))
      expect(existsSync(join(root, match[1]!)), match[1]).toBe(true);
  }
});

test("current feature references resolve after moves, including acceptance anchors", () => {
  const oldAnchor = ["world-surfaces", "spec.md#"].join("/");
  for (const pattern of [
    "docs/**/*.md",
    "openspec/**/*.md",
    "verification/**/*.md",
  ]) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root })) {
      const text = readFileSync(join(root, path), "utf8");
      expect(text, path).not.toContain(oldAnchor);
      for (const match of text.matchAll(
        /\]\(([^)\s]+world-surfaces\/[^)\s]*#[^)\s]+)\)/g,
      )) {
        const [file, anchor] = match[1]!.split("#");
        if (file!.includes("://")) continue;
        const target = resolve(dirname(join(root, path)), file!);
        expect(existsSync(target), `${path}: ${file}`).toBe(true);
        const targetText = readFileSync(target, "utf8");
        const anchors = [...targetText.matchAll(/^#{1,6} (.+)$/gm)].map(
          (heading) =>
            heading[1]!
              .toLowerCase()
              .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
              .replace(/\s/g, "-"),
        );
        anchors.push(
          ...[...targetText.matchAll(/<a id="([^"]+)"/g)].map((m) => m[1]!),
        );
        expect(anchors, `${path}: ${match[1]}`).toContain(anchor!);
      }
    }
  }
});
