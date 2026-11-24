import { afterEach, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const scripts = new Map<string, string>();
beforeAll(async () => {
  for (const name of ["changelog-fragments", "prepare-release"]) {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, `${name}.ts`)],
      target: "bun",
      // Shared CI helpers discover paths relative to their own source files.
      // Keep those imports in the real checkout while isolating release writes.
      plugins: [
        {
          name: "shared-ci-helpers",
          setup(build) {
            build.onResolve(
              { filter: /^\.\/(check-knowledge-map|ci-reuse-full-check)$/ },
              (args) => ({
                path: join(import.meta.dir, `${args.path}.ts`),
                external: true,
              }),
            );
          },
        },
      ],
    });
    if (!result.success) throw new Error(result.logs.join("\n"));
    scripts.set(name, await result.outputs[0].text());
  }
});
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "changelog-cli-"));
  roots.push(parent);
  const root = join(parent, "repo");
  for (const dir of ["scripts", "changes", "web", "server", "docs/releases"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  const write = (path: string, text: string) =>
    writeFileSync(join(root, path), text);
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
  for (const [name, source] of scripts) write(`scripts/${name}.js`, source);
  for (const path of [
    "package.json",
    "web/package.json",
    "server/package.json",
  ]) {
    write(path, '{\n  "version": "0.0.0"\n}\n');
  }
  write("herdr-plugin.toml", 'version = "0.1.0"\n');
  write(
    "CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n",
  );
  write(
    "changes/fix.md",
    "### Fixed\n\n- A short fix.\n\n<!-- detail -->\n\nA full explanation.\n",
  );
  write(
    "docs/releases/v0.2.0.md",
    "# Herdr World 0.2.0\n\nReviewed publication notes.\n",
  );
  git("init", "-q", "-b", "release-test");
  git("config", "user.name", "Example Agent");
  git("config", "user.email", "agent@example.invalid");
  git("config", "core.hooksPath", join(parent, "no-hooks"));
  git("init", "--bare", "-q", join(parent, "origin.git"));
  git("remote", "add", "origin", join(parent, "origin.git"));
  const commit = () => {
    git("add", "--all");
    git("commit", "-qm", "Synthetic release inputs");
  };
  commit();
  const run = (name: string, ...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [join(root, `scripts/${name}.js`), ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: "" },
        timeout: 10_000,
      },
    );
    if (result.error) throw result.error;
    return result;
  };
  return { root, write, read, commit, run };
}

test("check CLI rejects an overlong summary with actionable file and line context", () => {
  const f = fixture();
  f.write("changes/fix.md", `### Fixed\n\n- ${"x".repeat(281)}\n`);
  const result = f.run("changelog-fragments", "check");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "changes/fix.md: line 3: summary is 281 characters; maximum is 280",
  );
  expect(result.stderr).toContain("<!-- detail -->");
});

test("assembly CLI previews both outputs without modifying release inputs", () => {
  const f = fixture();
  const before = f.read("CHANGELOG.md");
  const result = f.run("changelog-fragments", "assemble", "0.2.0", "--dry-run");
  expect(result.status).toBe(0);
  const [summary, detail] = result.stdout.split(
    "--- docs/changelog/v0.2.0.md ---",
  );
  expect(summary).toContain("[Full changelog](docs/changelog/v0.2.0.md)");
  expect(summary).not.toContain("A full explanation.");
  expect(detail).toContain("A full explanation.");
  expect(f.read("CHANGELOG.md")).toBe(before);
  expect(existsSync(join(f.root, "docs/changelog"))).toBe(false);
  expect(existsSync(join(f.root, "changes/fix.md"))).toBe(true);
});

test("stable release preparation produces linked summaries and the full changelog", () => {
  const f = fixture();
  const result = f.run("prepare-release", "0.2.0");
  expect(result.status).toBe(0);
  const summary = f.read("CHANGELOG.md");
  expect(summary).toMatch(/## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}/);
  expect(summary).toContain("[Full changelog](docs/changelog/v0.2.0.md)");
  expect(summary).not.toContain("A full explanation.");
  expect(f.read("docs/changelog/v0.2.0.md")).toContain("A full explanation.");
  expect(existsSync(join(f.root, "changes/fix.md"))).toBe(false);
  expect(f.read("docs/releases/v0.2.0.md")).toContain(
    "Reviewed publication notes.",
  );
});

test("RC preparation preserves fragments and does not create a full changelog", () => {
  const f = fixture();
  const before = f.read("CHANGELOG.md");
  const result = f.run("prepare-release", "0.2.0-rc.1");
  expect(result.status).toBe(0);
  expect(f.read("CHANGELOG.md")).toBe(before);
  expect(existsSync(join(f.root, "changes/fix.md"))).toBe(true);
  expect(existsSync(join(f.root, "docs/changelog"))).toBe(false);
});

test("stable preparation preserves a full changelog already assembled for that version", () => {
  const f = fixture();
  expect(f.run("changelog-fragments", "assemble", "0.2.0").status).toBe(0);
  const detail = f.read("docs/changelog/v0.2.0.md");
  f.commit();
  expect(f.run("prepare-release", "0.2.0").status).toBe(0);
  expect(f.read("docs/changelog/v0.2.0.md")).toBe(detail);
  expect(f.read("CHANGELOG.md")).toContain(
    "[Full changelog](docs/changelog/v0.2.0.md)",
  );
});

test("an existing full changelog fails preparation before any release writes", () => {
  const f = fixture();
  mkdirSync(join(f.root, "docs/changelog"));
  f.write("docs/changelog/v0.2.0.md", "Reviewed full changelog.\n");
  f.commit();
  const manifest = f.read("herdr-plugin.toml");
  const changelog = f.read("CHANGELOG.md");
  const result = f.run("prepare-release", "0.2.0");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("already exists");
  expect(f.read("herdr-plugin.toml")).toBe(manifest);
  expect(f.read("CHANGELOG.md")).toBe(changelog);
  expect(f.read("docs/changelog/v0.2.0.md")).toBe("Reviewed full changelog.\n");
  expect(existsSync(join(f.root, "changes/fix.md"))).toBe(true);
});

test("bad summaries fail stable preparation before changing release files", () => {
  const f = fixture();
  f.write("changes/fix.md", `### Fixed\n\n- ${"x".repeat(281)}\n`);
  f.commit();
  const manifest = f.read("herdr-plugin.toml");
  const changelog = f.read("CHANGELOG.md");
  const result = f.run("prepare-release", "0.2.0");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("maximum is 280");
  expect(f.read("herdr-plugin.toml")).toBe(manifest);
  expect(f.read("CHANGELOG.md")).toBe(changelog);
  expect(existsSync(join(f.root, "docs/changelog"))).toBe(false);
});

test("Prepare Release stages generated full changelogs only when present", () => {
  const workflow = readFileSync(
    join(import.meta.dir, "../.github/workflows/prepare-release.yml"),
    "utf8",
  );
  expect(workflow).toContain("if [ -d docs/changelog ]; then");
  expect(workflow).toContain("git add -A docs/changelog/");
});
