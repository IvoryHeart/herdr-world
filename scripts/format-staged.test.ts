import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const script = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
).scripts["format:staged"] as string;

function withFixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "format-staged-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    copyFileSync(join(projectRoot, "biome.json"), join(root, "biome.json"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { "format:staged": script } }),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function formatStaged(root: string) {
  execFileSync("bun", ["run", "format:staged"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${join(projectRoot, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    },
  });
}

test("format:staged writes staged source only", () => {
  withFixture((root) => {
    const staged = join(root, "candidate.ts");
    const unstaged = join(root, "unrelated.ts");
    writeFileSync(staged, "const  answer=1\n");
    writeFileSync(unstaged, "const  other=2\n");
    execFileSync("git", ["add", "candidate.ts"], { cwd: root });

    formatStaged(root);

    expect(readFileSync(staged, "utf8")).toBe("const answer = 1;\n");
    expect(readFileSync(unstaged, "utf8")).toBe("const  other=2\n");
  });
});

test("format:staged succeeds without writes for a docs-only candidate", () => {
  withFixture((root) => {
    const guide = join(root, "guide.md");
    const unstaged = join(root, "unrelated.ts");
    writeFileSync(guide, "# Guide\n");
    writeFileSync(unstaged, "const  other=2\n");
    execFileSync("git", ["add", "guide.md"], { cwd: root });

    formatStaged(root);

    expect(readFileSync(guide, "utf8")).toBe("# Guide\n");
    expect(readFileSync(unstaged, "utf8")).toBe("const  other=2\n");
  });
});
