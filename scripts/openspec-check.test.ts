import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = await Bun.file(join(root, "package.json")).json();

test("maintained requirements fit strict length validation", () => {
  for (const pattern of [
    "openspec/specs/**/spec.md",
    "openspec/changes/*/specs/**/spec.md",
  ]) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root })) {
      const text = readFileSync(join(root, path), "utf8");
      for (const block of text.split(/^### Requirement: /m).slice(1)) {
        const [title, ...lines] = block.split("\n");
        const body = lines
          .join("\n")
          .split(/^#### /m)[0]!
          .trim();
        expect(body.length, `${path}: ${title}`).toBeLessThanOrEqual(500);
      }
    }
  }
});

test("spec:check rejects long requirements and incomplete archives", () => {
  const directory = mkdtempSync(join(tmpdir(), "openspec-check-"));
  const spec =
    "# Fixture\n\n## Purpose\n\nExercise strict validation of maintained requirements and archived task completion.\n\n## Requirements\n\n";
  const requirement = (body: string) =>
    `### Requirement: Fixture\n\n${body}\n\n#### Scenario: Read\n- **WHEN** read\n- **THEN** it succeeds\n`;
  const check = () =>
    Bun.spawnSync([process.execPath, "run", "spec:check"], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${join(root, "node_modules/.bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        OPENSPEC_TELEMETRY: "0",
        NO_COLOR: "1",
      },
    });
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        scripts: { "spec:check": manifest.scripts["spec:check"] },
      }),
    );
    mkdirSync(join(directory, "openspec/specs/fixture"), { recursive: true });
    const specPath = join(directory, "openspec/specs/fixture/spec.md");
    writeFileSync(specPath, spec + requirement("The fixture SHALL succeed."));
    const valid = check();
    expect(
      valid.exitCode,
      valid.stdout.toString() + valid.stderr.toString(),
    ).toBe(0);
    writeFileSync(
      specPath,
      spec + requirement(`The fixture SHALL ${"x".repeat(501)}.`),
    );
    expect(check().exitCode).not.toBe(0);
    writeFileSync(specPath, spec + requirement("The fixture SHALL succeed."));
    const archive = join(
      directory,
      "openspec/changes/archive/2026-01-01-fixture",
    );
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "tasks.md"), "- [ ] Incomplete task\n");
    const incomplete = check();
    expect(incomplete.exitCode).not.toBe(0);
    expect(
      incomplete.stdout.toString() + incomplete.stderr.toString(),
    ).toContain("fixture");
    writeFileSync(join(archive, "tasks.md"), "- [x] Complete task\n");
    expect(check().exitCode).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
