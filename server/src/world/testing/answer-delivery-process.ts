import { Database } from "bun:sqlite";
import { writeSync } from "node:fs";
import { join } from "node:path";
import { productionAnswerFixture } from "./answer-delivery-fixture";
const [root, phase] = process.argv.slice(2);
if (!root || !phase) throw new Error("answer fixture requires root and phase");
const stopAt = (name: string): never => {
  writeSync(1, `${name}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("Crash guard resumed");
};
const fixture: Awaited<ReturnType<typeof productionAnswerFixture>> =
  await productionAnswerFixture(root, {
    generation: phase === "recover" ? 2 : 1,
    paneRead: async () => {
      if (phase === "after-claim" && (await fixture?.entry())?.claimed)
        stopAt(phase);
    },
    prompt: async (text) => {
      if (phase === "before-effect") stopAt(phase);
      const receiver = new Database(join(root, "receiver.sqlite"));
      try {
        receiver.exec(
          "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS received(seq INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL)",
        );
        receiver.query("INSERT INTO received(body) VALUES(?)").run(text);
      } finally {
        receiver.close();
      }
      if (phase === "after-effect") stopAt(phase);
    },
  });
try {
  await fixture.seed();
  if (phase === "before-claim") stopAt(phase);
  fixture.time(3_000_000);
  await fixture.dispatcher.wake();
  const entry = await fixture.entry();
  if (phase === "after-receipt") stopAt(phase);
  writeSync(
    1,
    JSON.stringify({
      state: entry?.state,
      attempt: entry?.attempt,
      answer: fixture.storage.ledger.ask("q-native")?.answer?.text,
    }) + "\n",
  );
} finally {
  await fixture.stop();
}
