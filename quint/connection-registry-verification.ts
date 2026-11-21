import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { replayRegistry, replayRegistryMatrix } from "./connection-registry";
import type { ConnectionProfileService } from "../server/src/connections/profile-service";

type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
  mutate(): Promise<string>;
};

export async function runRegistryVerification(h: Harness) {
  const model = "quint/connection-registry.qnt";
  const source = await readFile(resolve(h.root, model), "utf8");
  await h.command("connection-registry-types", ["typecheck", model]);
  const verify = async (label: string, path: string, broken = false) => {
    const log = await h.command(
      label,
      [
        "verify",
        path,
        "--main",
        "connection_registry",
        "--backend",
        "tlc",
        "--invariant",
        "safety",
        "--verbosity",
        "3",
      ],
      broken,
    );
    if (!broken)
      assert.match(
        log,
        /No violation found/,
        "registry exploration did not complete",
      );
  };
  await verify("connection-registry-verification", model);
  const larger = `${h.artifacts}/registry-larger.qnt`;
  await writeFile(
    resolve(h.root, larger),
    source.replace('Set("alpha", "beta")', 'Set("alpha", "beta", "spare")'),
  );
  await verify("connection-registry-larger", larger);
  const mutant = `${h.artifacts}/registry-broken.qnt`;
  assert(source.includes("BROKEN = false"));
  await writeFile(
    resolve(h.root, mutant),
    source.replace("BROKEN = false", "BROKEN = true"),
  );
  await verify("connection-registry-model-control", mutant, true);
  const replay = await replayRegistryMatrix();
  const implementation = (await import(await h.mutate())) as {
    ConnectionProfileService: typeof ConnectionProfileService;
  };
  await assert.rejects(
    () =>
      replayRegistry(
        {
          kind: 0,
          cliFirst: true,
          early: true,
          failFirst: false,
          failSecond: false,
        },
        implementation.ConnectionProfileService,
      ),
    /registry\.overlap/,
  );
  return {
    name: "connection-registry",
    ...replay,
    controls: ["eager-snapshot-model", "unserialized-production-writer"],
    sampling: "exhaustive finite configurations; no seed-dependent omissions",
    sensitivity:
      "additional retained profile; both caller orders in every matrix",
  };
}
