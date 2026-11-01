import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { acquireAllCheckSlots } from "../check-lock";
import { shapes } from "./fixture";
import { syntheticSources } from "./source";
import { startService, snapshotCounts } from "./service";
import { observationCase } from "./observation";
import { browserCase, devices } from "./browser";
import { distribution, processSample } from "./support";
import { HerdrClient } from "../../server/src/bridge/herdr-client";
import { largeBoardSaves } from "./persistence";

const args = process.argv.slice(2);
const value = (name: string, fallback: string) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=") ?? fallback;
const thin = args.includes("--thin"),
  out = resolve(value("out", `.agents/scale/${thin ? "thin" : "matrix"}`));
const boardOnly = args.includes("--board-only");
if (thin && boardOnly)
  throw new Error(
    "Use --board-only without --thin for the declared save-size row",
  );
const rounds = Number(value("rounds", thin ? "1" : "3")),
  seconds = Number(value("seconds", "2"));
if (
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 20 ||
  !Number.isInteger(seconds) ||
  seconds < 1 ||
  seconds > 60
)
  throw new Error("rounds must be 1..20; seconds must be 1..60");
if (process.env.CI)
  throw new Error("On-demand scale harness is intentionally disabled in CI");
if (existsSync(out) && readdirSync(out).length)
  throw new Error(
    "Scale output already contains evidence; choose a fresh --out directory",
  );
mkdirSync(out, { recursive: true, mode: 0o700 });
const release = await acquireAllCheckSlots({
  lane: "on-demand synthetic scale harness",
});
const requestedShape = value("shape", thin ? "recorded-current" : "all");
const selected = shapes.filter(
  (s) => requestedShape === "all" || s.id === requestedShape,
);
if (!selected.length) {
  release();
  throw new Error("Unknown shape");
}
const rows: any[] = [];
const save = (row: any) => {
  rows.push(row);
  writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 2));
  console.log(
    JSON.stringify({
      shape: row.shape?.id,
      round: row.round,
      view: row.browser?.view,
      device: row.browser?.device?.id,
      kind: row.kind,
    }),
  );
};
try {
  if (args.includes("--build")) {
    for (const [command, cwd] of [
      [["bun", "x", "vite", "build", "--sourcemap"], "web"],
      [["bun", "run", "build:server"], "."],
    ] as const) {
      const buildLog = Bun.file(
        join(out, `build-${cwd === "web" ? "web" : "service"}.log`),
      );
      const child = Bun.spawn([...command], {
        cwd: resolve(cwd),
        env: { ...process.env, HERDR_WORLD_BUILD_DEVTOOLS: "0" },
        stdout: buildLog,
        stderr: buildLog,
      });
      if ((await child.exited) !== 0)
        throw new Error("Scale production build failed; see build log");
    }
  }
  const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"])
    .stdout.toString()
    .trim();
  const chrome =
    process.env.CHROME_BIN ??
    Bun.which("google-chrome") ??
    Bun.which("chromium");
  const chromeVersion = chrome
    ? Bun.spawnSync([chrome, "--version"]).stdout.toString().trim()
    : "unavailable";
  const harnessHashes = Object.fromEntries(
    readdirSync("scripts/scale")
      .filter((p) => p.endsWith(".ts"))
      .map((p) => [p, hash(join("scripts/scale", p))]),
  );
  const resourceUnits =
    process.platform === "linux"
      ? {
          ticksPerSecond: Number(
            Bun.spawnSync(["getconf", "CLK_TCK"]).stdout.toString(),
          ),
          pageBytes: Number(
            Bun.spawnSync(["getconf", "PAGESIZE"]).stdout.toString(),
          ),
        }
      : null;
  writeFileSync(
    join(out, "identity.json"),
    JSON.stringify(
      {
        revision,
        binarySha256: hash("server/herdr-world"),
        lockSha256: hash("bun.lock"),
        bun: Bun.version,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        chromeVersion,
        harnessHashes,
        resourceUnits,
        plan: {
          thin,
          boardOnly,
          rounds,
          warmups: thin ? 0 : 1,
          seconds,
          shapes: selected,
          devices: thin ? [devices[1]] : devices,
          profileControl:
            "all timed rounds unprofiled; extra diagnostic process per cell",
          boardSizes: thin ? [] : [100, 500],
          boardRefusal: 1000,
          townInteraction:
            "raw1440, bounded24 desks; Fit via native ALL then one ArrowRight; no expansion",
          seed: "deterministic count-only fixtures",
          rendering: "SwiftShader; DPR 1; no native mobile/GPU claim",
        },
      },
      null,
      2,
    ),
  );
  for (const shape of boardOnly ? [] : selected) {
    save({ kind: "observation", shape, result: await observationCase(shape) });
    if (shape.id === "dense-repair") {
      const scratch = mkdtempSync(join(tmpdir(), "hws-native-boundary-")),
        source = await syntheticSources(shape, scratch);
      const client = new HerdrClient(source.profiles[0]!.control_socket_path);
      try {
        let refusal: string | null = null;
        try {
          await client.call("pane.list");
        } catch (error) {
          refusal = String(error);
        }
        if (!refusal?.includes("too large"))
          throw new Error(
            `Expected native NDJSON admission refusal, received ${refusal}`,
          );
        save({
          kind: "native-boundary",
          shape,
          refusal,
          limitBytes: 1048576,
          rawReplyBytes: source.methods["pane.list"]?.bytes,
          boundary:
            "actual source-executed HerdrClient against isolated NDJSON socket; no compiled service/browser dense claim",
          browser:
            "not measured: raw repair fixture exceeds native admission; mounted-fixture budgets require a separate Town step 8 request",
        });
      } finally {
        client.close();
        await source.close();
        rmSync(scratch, { recursive: true, force: true });
      }
      continue;
    }
    // Independent fresh service/Chrome processes; a discarded process warmup precedes fixed measured rounds.
    for (let round = thin ? 0 : -1; round < rounds; round++) {
      const scratch = mkdtempSync(join(tmpdir(), "hws-"));
      const source = await syntheticSources(shape, scratch);
      let service: Awaited<ReturnType<typeof startService>> | undefined;
      try {
        service = await startService(
          source,
          scratch,
          join(out, `${shape.id}-${round}-service.log`),
        );
        const calls = [];
        for (let i = 0; i < 6; i++) {
          if (i === 3) await service.invalidation(() => source.emit(0));
          const began = performance.now(),
            snapshot = await service.snapshot();
          if (snapshot.connections.length !== shape.sources)
            throw new Error("Synthetic source count differs from plan");
          calls.push({
            kind: i === 0 ? "initial" : i === 3 ? "invalidated" : "cache",
            ms: performance.now() - began,
            counts: snapshotCounts(snapshot),
          });
        }
        const doc = await service.call("world.board.get");
        if (doc.notes.length)
          throw new Error("Private fresh Board was not empty");
        await service.call("world.board.patch", {
          ops: Array.from({ length: 100 }, (_, i) => ({
            op: "note.put",
            note: {
              id: `scale-note-${i}`,
              text: `Synthetic saved note ${i}`,
              color: "yellow",
              x: i * 20,
              y: 20,
            },
          })),
        });
        const writes = [];
        for (let i = 0; i < 11; i++) {
          const current = await service.call("world.board.get"),
            note = current.notes[0],
            began = performance.now();
          await service.call("world.board.patch", {
            ops: [
              {
                op: "note.put",
                rev: note.rev,
                note: { ...note, text: `Synthetic edit ${i}` },
              },
            ],
          });
          writes.push({ warmup: i === 0, ms: performance.now() - began });
        }
        const expected = JSON.stringify(
          (await service.call("world.board.get")).notes,
        );
        const before = processSample(service.child.pid);
        await new Promise((r) => setTimeout(r, seconds * 1000));
        const after = processSample(service.child.pid);
        const metrics = {
          listenerMs: service.listenerMs,
          connectionReadyMs: service.connectionReadyMs,
          calls,
          writes,
          writeMs: distribution(
            writes.filter((w) => !w.warmup).map((w) => w.ms),
          ),
          idleBefore: before,
          idleAfter: after,
          idleCpuMs:
            before && after && resourceUnits
              ? ((after.ticks - before.ticks) * 1000) /
                resourceUnits.ticksPerSecond
              : null,
          rssMiB:
            after && resourceUnits
              ? (after.rssPages * resourceUnits.pageBytes) / 1048576
              : null,
          hostLoad:
            process.platform === "linux"
              ? readFileSync("/proc/loadavg", "utf8")
                  .split(" ")
                  .slice(0, 3)
                  .map(Number)
              : null,
          accounting:
            "Linux ticks/pages raw; convert using this machine's getconf CLK_TCK/PAGESIZE; includes worker threads",
        };
        await service.stop();
        service = undefined;
        service = await startService(
          source,
          scratch,
          join(out, `${shape.id}-${round}-restart.log`),
        );
        if (
          JSON.stringify((await service.call("world.board.get")).notes) !==
          expected
        )
          throw new Error("Private durable notes differ after restart");
        save({
          kind: "service",
          shape,
          round,
          warmup: round < 0,
          metrics,
          restart: {
            listenerMs: service.listenerMs,
            connectionReadyMs: service.connectionReadyMs,
            notesVerified: 100,
          },
          syntheticMethodCosts: structuredClone(source.methods),
        });
        const deviceOrder = thin
          ? [devices[1]!]
          : round % 2
            ? [...devices].reverse()
            : devices;
        const viewOrder = round % 2 ? ["board", "town"] : ["town", "board"];
        for (const device of deviceOrder)
          for (const view of viewOrder) {
            const browser = await browserCase(
              service,
              source,
              view,
              device,
              join(out, `${shape.id}-${round}-${view}-${device.id}`),
              false,
              seconds,
            );
            save({ kind: "browser", shape, round, warmup: round < 0, browser });
          }
        if (shape.id === "room-1440")
          for (const device of deviceOrder)
            save({
              kind: "town-interaction",
              shape,
              round,
              warmup: round < 0,
              browser: await browserCase(
                service,
                source,
                "town",
                device,
                join(out, `${shape.id}-${round}-fit-pan-${device.id}`),
                false,
                seconds,
                true,
              ),
            });
      } finally {
        await service?.stop();
        await source.close();
        rmSync(scratch, { recursive: true, force: true });
      }
    }
    if (!thin && !args.includes("--no-profile")) {
      const scratch = mkdtempSync(join(tmpdir(), "hws-profile-")),
        source = await syntheticSources(shape, scratch);
      let service: Awaited<ReturnType<typeof startService>> | undefined;
      try {
        service = await startService(
          source,
          scratch,
          join(out, `${shape.id}-profile-seed.log`),
        );
        await service.call("world.board.patch", {
          ops: Array.from({ length: 100 }, (_, i) => ({
            op: "note.put",
            note: {
              id: `scale-note-${i}`,
              text: `Synthetic saved note ${i}`,
              color: "yellow",
              x: i * 20,
              y: 20,
            },
          })),
        });
        for (let i = 0; i < 11; i++) {
          const doc = await service.call("world.board.get"),
            note = doc.notes[0];
          await service.call("world.board.patch", {
            ops: [
              {
                op: "note.put",
                rev: note.rev,
                note: { ...note, text: `Synthetic edit ${i}` },
              },
            ],
          });
        }
        await service.stop();
        service = await startService(
          source,
          scratch,
          join(out, `${shape.id}-profile-service.log`),
        );
        for (const device of devices)
          for (const view of ["town", "board"])
            save({
              kind: "diagnostic",
              shape,
              browser: await browserCase(
                service,
                source,
                view,
                device,
                join(out, `${shape.id}-profile-${view}-${device.id}`),
                true,
                seconds,
              ),
            });
        if (shape.id === "room-1440")
          for (const device of devices)
            save({
              kind: "town-interaction-diagnostic",
              shape,
              browser: await browserCase(
                service,
                source,
                "town",
                device,
                join(out, `${shape.id}-profile-fit-pan-${device.id}`),
                true,
                seconds,
                true,
              ),
            });
      } finally {
        await service?.stop();
        await source.close();
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  }
  if (!thin && (boardOnly || selected.some((s) => s.id === "recorded-current")))
    await largeBoardSaves(out, rounds, save);
  writeFileSync(
    join(out, "complete.json"),
    JSON.stringify({ complete: true, rows: rows.length }),
  );
} catch (error) {
  writeFileSync(
    join(out, "failure.json"),
    JSON.stringify({ error: String(error), completedRows: rows.length }),
  );
  throw error;
} finally {
  release();
}
