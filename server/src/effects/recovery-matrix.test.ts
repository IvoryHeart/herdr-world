import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EffectRecovery } from "../storage/world-protocol";
import { effectFixture, OWNER } from "./testing/fixture";

const root = mkdtempSync(join(tmpdir(), "effect-matrix-"));
const fixturePath = resolve(import.meta.dir, "testing/crash-fixture.ts");
const binary = join(root, process.platform === "win32" ? "crash.exe" : "crash");
beforeAll(async () => {
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      fixturePath,
      "--outfile",
      binary,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [code, errors] = await Promise.all([
    build.exited,
    new Response(build.stderr).text(),
  ]);
  if (code) throw new Error(errors);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function crash(
  compiled: boolean,
  recovery: EffectRecovery,
  phase: string,
) {
  const directory = mkdtempSync(join(root, "case-"));
  const child = Bun.spawn(
    [
      ...(compiled ? [binary] : [process.execPath, fixturePath]),
      directory,
      recovery,
      phase,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const reader = child.stdout.getReader();
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  let output = "";
  try {
    while (!output.includes("\n")) {
      const next = await reader.read();
      if (next.done)
        throw new Error(
          `Crash fixture ended before ${phase}: ${await new Response(child.stderr).text()}`,
        );
      output += new TextDecoder().decode(next.value);
    }
    expect(output.trim()).toBe(
      phase.startsWith("cancel-")
        ? "cancelled"
        : phase === "permanent"
          ? "completed"
          : phase,
    );
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    clearTimeout(timeout);
    reader.releaseLock();
  }
  return directory;
}
const restart = (
  directory: string,
  recovery: EffectRecovery,
  version = 1,
  seed = true,
) => {
  const fixture = effectFixture(directory, recovery, {
    incarnation: "effect-incarnation-two",
    version,
    seed,
  });
  fixture.advance(1_000_000);
  return fixture;
};

for (const compiled of [false, true]) {
  const label = compiled ? "compiled" : "source";
  for (const recovery of [
    "keyed",
    "reconcilable",
    "reattachable",
    "repeatable",
    "opaque",
  ] as const)
    test(`${label}: ${recovery} recovers a crash after the source effect`, async () => {
      const f = restart(
        await crash(compiled, recovery, "after-source"),
        recovery,
      );
      try {
        const entry = await f.runner.run(f.id);
        expect(entry?.state).toBe(
          recovery === "opaque" ? "uncertain" : "delivered",
        );
        expect(f.applied()).toHaveLength(recovery === "repeatable" ? 2 : 1);
        expect(Number(f.read("calls"))).toBe(
          ["keyed", "repeatable"].includes(recovery) ? 2 : 1,
        );
        expect(entry?.not_sent).toBe(false);
        if (recovery !== "opaque") expect(entry?.receipt).not.toBeNull();
        if (recovery === "reconcilable") expect(f.read("probes")).toBe("1");
        if (recovery === "reattachable") {
          expect(f.read("attaches")).toBe("1");
          expect(entry?.external_handle).toEqual({ run: "run-matrix-key" });
        }
        if (recovery === "opaque") {
          const closed = await f.store.transition({
            action: "decide",
            id: f.id,
            attempt: entry!.attempt,
            outcome: "close",
            actor: OWNER,
            reason:
              "Owner closed tracking without claiming the effect was undone",
          });
          expect(closed).toMatchObject({
            state: "cancelled",
            ever_dispatched: true,
            not_sent: false,
          });
          await f.runner.run(f.id);
          expect(f.read("calls")).toBe("1");
        }
      } finally {
        await f.close();
      }
    });

  test(`${label}: decisive reconciliation permits retry only when the effect did not happen`, async () => {
    const f = restart(
      await crash(compiled, "reconcilable", "dispatching"),
      "reconcilable",
    );
    try {
      expect((await f.runner.run(f.id))?.state).toBe("delivered");
      expect(f.read("probes")).toBe("1");
      expect(f.applied()).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test(`${label}: claimed but not dispatched releases the old fence and reclaims`, async () => {
    const f = restart(await crash(compiled, "opaque", "claimed"), "opaque");
    try {
      expect((await f.store.get(f.id))?.ever_dispatched).toBe(false);
      expect(
        await f.store.transition({
          action: "finish",
          id: f.id,
          fence: { service_incarnation: "effect-incarnation-one", attempt: 1 },
          state: "delivered",
          reason: "Stale writer",
        }),
      ).toBeNull();
      expect((await f.runner.run(f.id))?.state).toBe("delivered");
      expect(f.applied()).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test(`${label}: permanent refusal is retained and never automatically retried`, async () => {
    const f = restart(await crash(compiled, "keyed", "permanent"), "keyed");
    try {
      const entry = await f.runner.run(f.id);
      expect(entry?.state).toBe("refused");
      expect(entry?.evidence?.reason).toContain("permanent refusal");
      expect(f.read("calls")).toBe("1");
      expect(f.applied()).toHaveLength(0);
    } finally {
      await f.close();
    }
  });

  test(`${label}: unsupported operation version blocks until an explicit recorded migration`, async () => {
    const f = restart(await crash(compiled, "keyed", "claimed"), "keyed", 2);
    try {
      expect((await f.runner.run(f.id))?.state).toBe("needs-migration");
      expect(f.read("calls")).toBe("0");
      await f.store.transition({
        action: "migrate",
        id: f.id,
        from: 1,
        to: 2,
        actor: OWNER,
        reason: "Owner approved version two",
      });
      const entry = await f.runner.run(f.id);
      expect(entry?.state).toBe("delivered");
      expect(entry?.contract?.idempotency_key).toBe("matrix-key");
      expect(entry?.decisions.at(-1)?.action).toBe("migrate");
    } finally {
      await f.close();
    }
  });

  test(`${label}: completed migration keeps receipts and external handles without replay`, async () => {
    const f = restart(
      await crash(compiled, "reattachable", "receipt"),
      "reattachable",
      2,
    );
    try {
      const before = await f.store.get(f.id);
      await f.store.transition({
        action: "migrate",
        id: f.id,
        from: 1,
        to: 2,
        actor: OWNER,
        reason: "Retain the completed operation across upgrade",
      });
      const entry = await f.runner.run(f.id);
      expect(entry?.state).toBe("delivered");
      expect(entry?.receipt).toEqual(before?.receipt);
      expect(entry?.external_handle).toEqual(before?.external_handle);
      expect(f.read("calls")).toBe("1");
    } finally {
      await f.close();
    }
  });

  for (const after of [false, true])
    test(`${label}: cancellation ${after ? "after" : "before"} possible dispatch records the real outcome`, async () => {
      const f = restart(
        await crash(
          compiled,
          "reconcilable",
          after ? "cancel-after" : "cancel-before",
        ),
        "reconcilable",
      );
      try {
        const entry = await f.runner.run(f.id);
        expect(entry?.state).toBe(after ? "delivered" : "cancelled");
        expect(entry?.not_sent).toBe(!after);
        expect(f.applied()).toHaveLength(after ? 1 : 0);
        expect(f.read("calls")).toBe(after ? "1" : "0");
      } finally {
        await f.close();
      }
    });

  test(`${label}: current revocation blocks a recovered pre-dispatch claim`, async () => {
    const f = restart(await crash(compiled, "opaque", "claimed"), "opaque");
    try {
      f.set("authorized", "0");
      expect((await f.runner.run(f.id))?.state).toBe("refused");
      expect(f.applied()).toHaveLength(0);
    } finally {
      await f.close();
    }
  });

  test(`${label}: restart at the same generation waits offline, then resolves the captured binding`, async () => {
    const f = restart(await crash(compiled, "opaque", "claimed"), "opaque");
    try {
      f.set("binding", "unresolved");
      expect((await f.runner.run(f.id))?.state).toBe("pending");
      expect(f.applied()).toHaveLength(0);
      f.set("binding", "attached");
      f.advance(2_000_000);
      const entry = await f.runner.run(f.id);
      expect(entry?.state).toBe("delivered");
      expect(entry?.targets[0]?.fence).toEqual({
        connection_id: "example",
        generation: 1,
        service_incarnation: f.incarnation,
      });
    } finally {
      await f.close();
    }
  });

  for (const phase of ["before-commit", "after-commit"])
    test(`${label}: ${phase} crash keeps domain change and intent atomic`, async () => {
      const f = restart(
        await crash(compiled, "repeatable", phase),
        "repeatable",
        1,
        false,
      );
      try {
        const committed = phase === "after-commit";
        expect(f.writer.read().document.results).toHaveLength(
          committed ? 1 : 0,
        );
        expect(f.writer.read().attention).toHaveLength(committed ? 1 : 0);
      } finally {
        await f.close();
      }
    });
}
