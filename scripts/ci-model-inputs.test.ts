import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { modelInputs } from "./ci-model-inputs";
import { fingerprintInputs } from "./verification-evidence";

test("model keys follow only the selected model, its imported modules and real replay inputs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "model-input-closure-"));
  const files = {
    "quint/run.ts": 'import "./observation-base"; import "./ide-lifecycle";',
    "quint/observation-base.qnt": 'import common.* from "./common"',
    "quint/common.qnt": "shared module",
    "quint/observation-base.ts": 'import "../server/observation";',
    "quint/ide-lifecycle.qnt": "unrelated model",
    "quint/ide-lifecycle.ts": 'import "../server/ide";',
    "server/observation.ts": "export const source = 1;",
    "server/ide.ts": "export {};",
    ".github/workflows/unrelated.yml": "unrelated workflow",
    "tools/quint/tlc-ci.json": '{"workers":4}',
  };
  const write = async (path: string, text: string) => {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), text);
  };
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const [path, text] of Object.entries(files)) await write(path, text);
    const key = () =>
      fingerprintInputs(
        root,
        modelInputs(root, Object.keys(files), "observation-base"),
      );
    const original = await key();
    expect(original.map((input) => input.path)).toContain("quint/common.qnt");
    for (const [path, text] of Object.entries(files)) {
      await write(path, `${text}\n`);
      expect(JSON.stringify(await key()) !== JSON.stringify(original)).toBe(
        ![
          "quint/ide-lifecycle.qnt",
          "quint/ide-lifecycle.ts",
          "server/ide.ts",
          ".github/workflows/unrelated.yml",
        ].includes(path),
      );
      await write(path, text);
    }
    await write("server/observation.ts", 'import "./missing";');
    expect(() =>
      modelInputs(root, Object.keys(files), "observation-base"),
    ).toThrow("Unresolved cache dependency");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
