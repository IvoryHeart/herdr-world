import { expect, test } from "bun:test";
import { Writable } from "node:stream";
import { writeCliOutput } from "./stdout";

test("stdout completes after the sink callback accepts the whole line", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let actual = "";
  let completed = false;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      actual += chunk.toString();
      entered.resolve();
      void release.promise.then(() => callback());
    },
  });
  const output = writeCliOutput("Stored answer", sink).then(() => {
    completed = true;
  });
  await entered.promise;
  expect(actual).toBe("Stored answer\n");
  expect(completed).toBe(false);
  release.resolve();
  await output;
  expect(completed).toBe(true);
  sink.destroy();
});
test("a broken output pipe rejects without an unhandled stream error", async () => {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("EPIPE fixture"));
    },
  });
  await expect(writeCliOutput("Stored answer", sink)).rejects.toThrow(
    "EPIPE fixture",
  );
});
