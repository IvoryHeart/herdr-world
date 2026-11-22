import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { features } from "./features";
import { feature_testing_probe } from "../server/src/features/index.gen";

test("discovery is sorted, order-insensitive, and rejects drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "features-"));
  try {
    for (const [directory, file] of [
      ["server/src/features", "register.ts"],
      ["web/src/features", "mount.tsx"],
    ]) {
      for (const name of ["zebra", "nested/alpha"])
        await Bun.write(join(root, directory, name, file), "export {};\n");
      await Bun.write(join(root, directory, "ignored.ts"), "export {};\n");
    }
    await features(root);
    const index = Bun.file(join(root, "server/src/features/index.gen.ts"));
    const lines = (await index.text()).trim().split("\n");
    expect(lines[1]).toContain("nested/alpha/register");
    expect(lines).toHaveLength(3);
    await Bun.write(index, lines.reverse().join("\n") + "\n");
    await features(root, true);
    await Bun.write(index, lines.slice(1).join("\n") + "\n");
    await expect(features(root, true)).rejects.toThrow("features:generate");
    await features(root);
    await Bun.write(
      join(root, "web/src/features/new/mount.tsx"),
      "export {};\n",
    );
    await expect(features(root, true)).rejects.toThrow("features:generate");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("committed index runs in Bun test, dev, and a binary without sources", async () => {
  expect(feature_testing_probe.register()).toBe("server-feature");
  console.info("PASS bun test: server-feature");
  const root = await mkdtemp(join(tmpdir(), "feature-compile-"));
  const source = join(root, "source");
  const bun = process.execPath;
  const command = (args: string[]) => {
    const result = Bun.spawnSync(args, { cwd: root });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString().trim();
  };
  try {
    // Production features can import service code and shared dependencies.
    for (const directory of ["server/src", "shared"])
      await cp(resolve(directory), join(source, directory), {
        recursive: true,
      });
    await symlink(
      resolve("node_modules"),
      join(source, "node_modules"),
      "junction",
    );
    await symlink(
      resolve("server/node_modules"),
      join(source, "server/node_modules"),
      "junction",
    );
    const entry = join(source, "probe.ts");
    await Bun.write(
      entry,
      'import { feature_testing_probe } from "./server/src/features/index.gen"; console.log(feature_testing_probe.register());',
    );
    expect(command([bun, "run", entry])).toBe("server-feature");
    console.info("PASS bun run: server-feature");
    const binary = join(
      root,
      process.platform === "win32" ? "probe.exe" : "probe",
    );
    const compile = [bun, "build", "--compile", "--minify", entry];
    command([...compile, "--outfile", binary]);
    await rm(source, { recursive: true });
    expect(command([binary])).toBe("server-feature");
    console.info("PASS compiled binary without sources: server-feature");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
