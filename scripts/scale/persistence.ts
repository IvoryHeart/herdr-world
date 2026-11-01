import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOARD_LIMITS } from "../../server/src/world/board-store";
import { syntheticSources } from "./source";
import { startService } from "./service";
import { processSample, distribution } from "./support";
import { shapes } from "./fixture";

export async function largeBoardSaves(
  out: string,
  rounds: number,
  save: (row: any) => void,
) {
  if (BOARD_LIMITS.notes !== 500)
    throw new Error(
      "Revisit the declared large-board size/refusal plan: production note limit changed",
    );
  for (let round = -1; round < rounds; round++)
    for (const noteCount of round % 2 ? [500, 100] : [100, 500]) {
      const scratch = mkdtempSync(join(tmpdir(), "hws-board-size-")),
        source = await syntheticSources(shapes[0]!, scratch);
      let service: Awaited<ReturnType<typeof startService>> | undefined;
      try {
        service = await startService(
          source,
          scratch,
          join(out, `board-${noteCount}-${round}.log`),
        );
        await service.snapshot();
        const note = (i: number) => ({
          id: `scale-note-${i}`,
          text: `Synthetic saved note ${i}`,
          color: "yellow",
          x: i * 20,
          y: 20,
        });
        const seedBegan = performance.now();
        await service.call("world.board.patch", {
          ops: Array.from({ length: noteCount }, (_, i) => ({
            op: "note.put",
            note: note(i),
          })),
        });
        const seedMs = performance.now() - seedBegan;
        const writes = [],
          phaseBefore = processSample(service.child.pid),
          phaseBegan = performance.now();
        for (let i = 0; i < 11; i++) {
          const document = await service.call("world.board.get"),
            current = document.notes[0];
          if (document.notes.length !== noteCount)
            throw new Error(
              "Large Board note count differs from declared state",
            );
          const before = processSample(service.child.pid),
            began = performance.now();
          await service.call("world.board.patch", {
            ops: [
              {
                op: "note.put",
                rev: current.rev,
                note: { ...current, text: `Synthetic edit ${i}` },
              },
            ],
          });
          const ms = performance.now() - began,
            after = processSample(service.child.pid);
          writes.push({
            warmup: i === 0,
            ms,
            before,
            after,
            cpuTicks: before && after ? after.ticks - before.ticks : null,
          });
        }
        const editBlockMs = performance.now() - phaseBegan,
          phaseAfter = processSample(service.child.pid);
        let refusal = null;
        if (noteCount === 500) {
          const before = JSON.stringify(await service.call("world.board.get"));
          try {
            await service.call("world.board.patch", {
              ops: Array.from({ length: 500 }, (_, i) => ({
                op: "note.put",
                note: note(500 + i),
              })),
            });
          } catch (error) {
            refusal = { attemptedNotes: 1000, error: String(error) };
          }
          if (!refusal)
            throw new Error(
              "Expected 1000-note state refusal at production limit",
            );
          if (JSON.stringify(await service.call("world.board.get")) !== before)
            throw new Error("Over-limit Board refusal changed committed state");
        }
        const expected = JSON.stringify(
          (await service.call("world.board.get")).notes,
        );
        await service.stop();
        service = await startService(
          source,
          scratch,
          join(out, `board-${noteCount}-${round}-restart.log`),
        );
        if (
          JSON.stringify((await service.call("world.board.get")).notes) !==
          expected
        )
          throw new Error("Large Board contents differ after restart");
        save({
          kind: "board-size",
          round,
          warmup: round < 0,
          noteCount,
          seedMs,
          writes,
          latencyMs: distribution(
            writes.filter((w) => !w.warmup).map((w) => w.ms),
          ),
          cpuTickWindows: distribution(
            writes
              .filter((w) => !w.warmup && w.cpuTicks !== null)
              .map((w) => w.cpuTicks!),
          ),
          editBlock: {
            ms: editBlockMs,
            before: phaseBefore,
            after: phaseAfter,
            includes: "eleven writes including one warmup and intervening gets",
          },
          refusal,
          restartVerified: true,
          boundary:
            "unprofiled compiled service; fresh process after one atomic seed, one edit warmup, ten dependent sequential saves; process CPU ticks include all threads",
        });
      } finally {
        await service?.stop();
        await source.close();
        rmSync(scratch, { recursive: true, force: true });
      }
    }
}
