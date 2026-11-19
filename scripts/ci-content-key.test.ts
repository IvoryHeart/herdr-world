import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { contentInputs, contentKey } from "./ci-content-key";

test("unresolved and deleted graph dependencies fail closed", () => {
  const graph = {
    files: new Set(["root.ts"]),
    gone: new Set<string>(),
    deps: new Map([["root.ts", new Set(["missing.ts"])]]),
  };
  expect(() => contentInputs(graph, ["root.ts"])).toThrow();
  expect(() => contentInputs(graph, ["other.ts"])).toThrow();
  graph.deps.set("root.ts", new Set());
  graph.gone.add("root.ts");
  expect(() => contentInputs(graph, ["root.ts"])).toThrow();
});

test("model, adapter, replayed source, tools, seeds, new imports and inventory additions invalidate reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-key-"));
  const files = {
    "package.json": "{}",
    "bun.lock": "locked",
    "quint/run.ts": 'import "./adapter";',
    "quint/adapter.ts": 'import { source } from "../server/source";',
    "quint/model.qnt": "model",
    "tools/quint/seeds.json": "[73]",
    "server/source.ts": "export const source = 1;",
    "web/unrelated.ts": "export {};",
  };
  const write = async (path: string, text: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  try {
    git("init", "-q");
    for (const [path, text] of Object.entries(files)) await write(path, text);
    git("add", ".");
    const key = () => contentKey(root, "models", "1/3", "bun/node/java pinned");
    const original = await key();
    expect(original.inputs.map((input) => input.path)).toContain(
      "server/source.ts",
    );
    expect(original.inputs.map((input) => input.path)).not.toContain(
      "web/unrelated.ts",
    );
    for (const path of [
      "quint/run.ts",
      "quint/adapter.ts",
      "quint/model.qnt",
      "server/source.ts",
      "tools/quint/seeds.json",
      "bun.lock",
    ]) {
      await write(path, files[path as keyof typeof files] + "\n");
      expect((await key()).hash).not.toBe(original.hash);
      await write(path, files[path as keyof typeof files]);
    }
    expect((await contentKey(root, "models", "1/3", "new java")).hash).not.toBe(
      original.hash,
    );
    expect(
      (await contentKey(root, "models", "2/3", "bun/node/java pinned")).hash,
    ).not.toBe(original.hash);
    await write("web/unrelated.ts", "export const unrelated = 2;");
    expect((await key()).hash).toBe(original.hash);
    await write("quint/adapter.ts", 'import "../web/unrelated";');
    expect((await key()).hash).not.toBe(original.hash);
    await write("quint/adapter.ts", files["quint/adapter.ts"]);
    await write("quint/new.qnt", "new model");
    git("add", ".");
    expect((await key()).hash).not.toBe(original.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer keys include production entries, worker and assets but exclude unrelated docs and test edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "installer-key-"));
  const files = {
    "package.json": "{}",
    "server/src/index.ts": "export {};",
    "server/src/storage/world-worker.ts": "export {};",
    "web/src/main.tsx": 'import "./view";',
    "web/src/view.tsx": "export {};",
    "web/public/icon.svg": "<svg/>",
    "docs/readme.md": "docs",
    "server/src/example.test.ts": "test",
  };
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    }
    execFileSync("git", ["add", "."], { cwd: root });
    const key = () =>
      contentKey(root, "installer", "native-package", "bun 1.4.4");
    const original = await key();
    for (const path of Object.keys(files)) {
      await writeFile(
        join(root, path),
        files[path as keyof typeof files] + "\n",
      );
      expect((await key()).hash === original.hash).toBe(
        path.startsWith("docs/") || path.endsWith(".test.ts"),
      );
      await writeFile(join(root, path), files[path as keyof typeof files]);
    }
    await writeFile(join(root, "web/src/view.tsx"), 'import "./unresolved";');
    const conservative = await key();
    await writeFile(join(root, "docs/readme.md"), "potential unknown input");
    expect((await key()).hash).not.toBe(conservative.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
