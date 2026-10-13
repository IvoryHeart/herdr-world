import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  retainVerificationDiagnostics,
  sanitizeDiagnostic,
} from "./verification-diagnostics";

test("failed-run exports are bounded, sanitized, selected and exclude code/cache/links", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "synthetic-diagnostics-"));
  const run = resolve(root, "run");
  const label = "synthetic-replay";
  await mkdir(run);
  try {
    await writeFile(
      resolve(run, "run.failure.json"),
      JSON.stringify({
        label,
        reason: `Failed at ${root}/private/example; token=synthetic-token`,
      }),
    );
    await writeFile(
      resolve(run, "commands.json"),
      JSON.stringify(
        Array.from({ length: 100 }, () => ({
          code: 1,
          args: [`${root}/source`],
        })),
      ),
    );
    await writeFile(
      resolve(run, `${label}.log`),
      "synthetic failure\n".repeat(100_000),
    );
    await writeFile(
      resolve(run, `${label}-result.json.failure.json`),
      JSON.stringify({
        trace: "synthetic.itf.json",
        observation: "synthetic.owner",
      }),
    );
    await writeFile(
      resolve(run, "synthetic.itf.json"),
      '{"states":[{"owner":"synthetic"}]}',
    );
    await writeFile(resolve(run, "unrelated.itf.json"), "excluded");
    await writeFile(resolve(run, "mutant.mjs"), "excluded");
    await symlink(
      resolve(run, "mutant.mjs"),
      resolve(run, `${label}-checker.log`),
    );
    const exported = await retainVerificationDiagnostics(run, root, label);
    const names = await readdir(exported);
    expect(names).toContain("synthetic.itf.json");
    expect(names).not.toContain("unrelated.itf.json");
    expect(names).not.toContain("mutant.mjs");
    expect(names).not.toContain(`${label}-checker.log`);
    const index = JSON.parse(
      await readFile(resolve(exported, "index.json"), "utf8"),
    );
    expect(index.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(
      Buffer.byteLength(
        await readFile(resolve(exported, `${label}.log`), "utf8"),
      ),
    ).toBeLessThanOrEqual(64 * 1024);
    expect(
      JSON.parse(await readFile(resolve(exported, "commands.json"), "utf8")),
    ).toHaveLength(10);
    const failure = await readFile(
      resolve(exported, "run.failure.json"),
      "utf8",
    );
    expect(JSON.parse(failure).reason).toContain("<redacted>");
    expect(
      sanitizeDiagnostic("Authorization: Bearer synthetic-credential", root),
    ).not.toContain("synthetic-credential");
    expect(failure).not.toContain(root);
    expect(failure).not.toContain("synthetic-token");
    expect(
      sanitizeDiagnostic("failure in /synthetic/home/private/file", root),
    ).not.toContain("/synthetic/home");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
