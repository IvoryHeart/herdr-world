import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppLock } from "./dependency-security";
import {
  canonicalPackageIdsFromLock,
  generateDependencyArtifacts,
} from "./dependency-notices";

test("derives a platform-independent package set from the lockfile", () => {
  const lock = `{
    "workspaces": { "": { "dependencies": { "portable": "1", "native": "1" } } },
    "packages": {
      "portable": ["portable@1.0.0", "", {}],
      "native": ["native@1.0.0", "", { "os": "linux", "cpu": "x64" }],
      "workspace": ["workspace@workspace:web"]
    }
  }`;

  expect(canonicalPackageIdsFromLock(lock)).toEqual(["portable@1.0.0"]);
});

const platformLock = () =>
  Bun.file(
    new URL("./fixtures/dependency-maintenance/bun.lock", import.meta.url),
  ).text();
const portableIds = [
  "@fixture/consumer@1.0.0",
  "app@1.0.0",
  "portable-optional@1.0.0",
  "shared@1.0.0",
  "shared@2.0.0",
  "tool-leaf@1.0.0",
  "tool@1.0.0",
].sort((a, b) => a.localeCompare(b));

test("platform-only transitive packages are excluded while shared, optional, nested and dev packages remain required", async () => {
  const lock = await platformLock();
  expect(canonicalPackageIdsFromLock(lock)).toEqual(portableIds);
  // A second portable path must retain a package even if a platform branch
  // reaches it first; the platform branch also contains a dependency cycle.
  const shared = Bun.JSONC.parse(lock) as AppLock;
  shared.workspaces.server!.dependencies!["@fixture/support"] = "2";
  expect(canonicalPackageIdsFromLock(JSON.stringify(shared))).toEqual(
    [...portableIds, "@fixture/support@2.0.0-beta.2", "leaf@1.0.0"].sort(
      (a, b) => a.localeCompare(b),
    ),
  );
});

test("notice generation accepts a portable install but rejects each missing or mismatched portable payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "dependency-notices-"));
  try {
    await writeFile(join(root, "bun.lock"), await platformLock());
    const manifests: string[] = [];
    for (const [index, id] of portableIds.entries()) {
      const at = id.lastIndexOf("@");
      const name = id.slice(0, at);
      const directory = join(
        root,
        "node_modules/.bun",
        String(index),
        "node_modules",
        name,
      );
      await mkdir(directory, { recursive: true });
      const manifest = join(directory, "package.json");
      manifests.push(manifest);
      await writeFile(
        manifest,
        JSON.stringify({ name, version: id.slice(at + 1), license: "MIT" }),
      );
      await writeFile(
        join(directory, "LICENSE"),
        `Fixture licence for ${id}\n`,
      );
    }
    const artifacts = await generateDependencyArtifacts(root);
    expect(artifacts.notices).toContain("| portable-optional | 1.0.0 | MIT |");
    expect(artifacts.notices).not.toContain("@fixture/support");
    expect(artifacts.licenses).toContain("Fixture licence for shared@2.0.0");
    for (const [index, manifest] of manifests.entries()) {
      const original = await Bun.file(manifest).text();
      await rm(manifest);
      await expect(generateDependencyArtifacts(root)).rejects.toThrow(
        `missing: ${portableIds[index]}`,
      );
      await writeFile(manifest, original);
    }
    const manifest = manifests[0]!;
    const stale = await Bun.file(manifest).json();
    await writeFile(manifest, JSON.stringify({ ...stale, version: "9.0.0" }));
    await expect(generateDependencyArtifacts(root)).rejects.toThrow(
      `missing: ${portableIds[0]}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("includes exact bundled dependency licence and copyright texts", async () => {
  const generated = await generateDependencyArtifacts();

  expect(generated.notices).toContain("| codemirror | 6.0.2 | MIT |");
  expect(generated.notices).toContain("| lucide-react | 1.69.0 | ISC |");
  expect(generated.notices).not.toContain("@biomejs/cli-linux-x64");
  expect(generated.licenses).toContain(
    "Copyright (C) 2018-2021 by Marijn Haverbeke",
  );
  expect(generated.licenses).toContain(
    "Copyright (c) 2026 Lucide Icons and Contributors",
  );
  expect(generated.licenses).toContain("Copyright (c) 2013-present Cole Bemis");
  expect(generated.licenses).toContain(
    "Copyright (c) 2010-2016 Rasmus Andersson",
  );
  expect(generated.licenses).toContain(
    "`lru_map@0.4.1` — `README.md#MIT license`",
  );
});
