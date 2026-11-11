import { expect, test } from "bun:test";
import { FloatShellInput, MAX_FLOAT_INPUT_BYTES } from "./floatShellInput";

function shell(options: { failAt?: number } = {}) {
  const calls: Uint8Array[] = [];
  const errors: unknown[] = [];
  let open = true;
  let attempts = 0;
  const input = new FloatShellInput(
    async (bytes) => {
      // A call takes a turn, so typing meanwhile queues behind it.
      await Promise.resolve();
      if (attempts++ === options.failAt) throw new Error("refused");
      calls.push(bytes);
    },
    () => open,
    (error) => errors.push(error),
  );
  const sent = () => Buffer.concat(calls.map((bytes) => Buffer.from(bytes)));
  return {
    input,
    calls,
    errors,
    sent,
    close: () => {
      open = false;
    },
  };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

test("a paste larger than one call is sent whole, in order, in bounded calls", async () => {
  const s = shell();
  // xterm hands a 60 KiB paste over as one onData event.
  const paste = new Uint8Array(60 * 1024).map((_, i) => i % 251);
  await s.input.push(paste);
  await settle();
  expect(s.calls.map((c) => c.byteLength)).toEqual([
    MAX_FLOAT_INPUT_BYTES,
    paste.byteLength - MAX_FLOAT_INPUT_BYTES,
  ]);
  expect(s.sent().equals(Buffer.from(paste))).toBe(true);
  expect(s.errors).toEqual([]);
});

test("keys typed during a call join the next one, after the paste's remainder", async () => {
  const s = shell();
  const paste = new Uint8Array(MAX_FLOAT_INPUT_BYTES + 10).fill(0x61);
  const first = s.input.push(paste);
  void s.input.push(new TextEncoder().encode("\r"));
  void s.input.push(new TextEncoder().encode("ls\r"));
  await first;
  await settle();
  expect(s.calls.map((c) => c.byteLength)).toEqual([
    MAX_FLOAT_INPUT_BYTES,
    10 + 1 + 3,
  ]);
  expect(s.sent().subarray(-4).toString()).toBe("\rls\r");
});

test("a refused call stops the rest and says so; nothing is replayed", async () => {
  const s = shell({ failAt: 1 });
  await s.input.push(new Uint8Array(3 * MAX_FLOAT_INPUT_BYTES).fill(1));
  await settle();
  expect(s.calls.map((c) => c.byteLength)).toEqual([MAX_FLOAT_INPUT_BYTES]);
  expect(s.errors).toHaveLength(1);
  await s.input.push(new TextEncoder().encode("x"));
  await settle();
  expect(s.calls[s.calls.length - 1]?.byteLength).toBe(1);
});

test("a closed stream sends nothing more, and cleared keys are never sent", async () => {
  const s = shell();
  s.close();
  await s.input.push(new TextEncoder().encode("lost"));
  s.input.clear();
  await settle();
  expect(s.calls).toEqual([]);
});
