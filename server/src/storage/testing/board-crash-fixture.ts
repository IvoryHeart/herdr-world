import { planBoardPatch } from "../../world/board-plan";
import { writeSync } from "node:fs";
import { join } from "node:path";
import { openWorldWriter } from "../world-writer";
import { openWorldLedger } from "../world-storage";
import { systemClock, systemScheduler } from "../../service/ports";
import type { BoardOp } from "../../world/board-store";

const [root, phase] = process.argv.slice(2);
if (!root || !phase) throw new Error("Board fixture requires root/phase");
const paths = {
  database: join(root, "world.sqlite"),
  ledger: join(root, "ledger.json"),
  board: join(root, "board.json"),
};
const target = {
  connection_id: "studio",
  kind: "pane" as const,
  native_id: "pane-a",
  witness: ["terminal-a"],
};
const ops: BoardOp[] = [
  {
    op: "note.put",
    note: {
      id: "note-a",
      text: "Synthetic committed note",
      color: "yellow",
      x: 1,
      y: 2,
    },
  },
  {
    op: "string.put",
    string: {
      id: "string-a",
      from: { note: "note-a" },
      to: { anchor: target },
    },
  },
  { op: "appearance.set", target, fields: { avatar: "builder" } },
  { op: "interest.set", key: "studio:terminal:terminal-a", interest: "muted" },
];
function stopAt(stage: string) {
  writeSync(1, `${stage}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("crash guard resumed");
}
if (phase.startsWith("import-")) {
  openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      path: paths.board,
      fault: (stage) => {
        if (`import-${stage}` === phase) stopAt(phase);
      },
    },
  );
} else if (phase.startsWith("worker-")) {
  const store = await openWorldLedger(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  if (phase === "worker-ack") {
    await store.board.patch(ops);
    stopAt(phase);
  } else {
    const writes = Array.from({ length: 33 }, (_, i) =>
      store.board.patch(
        planBoardPatch([i], (doc) => [
          {
            op: "note.put",
            note: {
              id: "note-a",
              text: `Synthetic ${i}`,
              color: "yellow",
              x: 1,
              y: 2,
            },
            rev: doc.notes[0]?.rev,
          },
        ]),
      ),
    );
    const closing = store.close();
    await Promise.all(writes);
    await closing;
    writeSync(1, `${phase}\n`);
  }
} else {
  const writer = openWorldWriter(
    paths.database,
    paths.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { path: paths.board },
  );
  writer.batch(
    [{ ticket: 1, request: { type: "board", operation: { ops } } }],
    1000,
    (stage) => {
      if (stage === phase) stopAt(phase);
    },
  );
  writer.close();
}
