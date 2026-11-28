import { expect, test } from "bun:test";
import { prepareModelVerification } from "./model-verification";

test("space exhaustive checking starts before sampling and must finish successfully", async () => {
  let finish!: (log: string) => void;
  let args: string[] = [];
  const check = prepareModelVerification(
    "space-admission",
    async (_, input) => {
      args = input;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
    new AbortController(),
  );
  expect(args).toContain("allConfigurations");
  let complete = false;
  const result = check.finish().then(() => {
    complete = true;
  });
  expect(complete).toBe(false);
  finish("No violation found");
  await result;
  expect(complete).toBe(true);
});

test("concurrent failure aborts sampling and drains without unhandled rejection", async () => {
  const cancellation = new AbortController();
  const failure = new Error("synthetic checker failure");
  const check = prepareModelVerification(
    "space-admission",
    async () => {
      throw failure;
    },
    cancellation,
  );
  await check.drain;
  expect(cancellation.signal.reason).toBe(failure);
  await expect(check.finish()).rejects.toBe(failure);
});

test("other models wait for their sequential phase and keep the positive verdict assertion", async () => {
  let started = false;
  const check = prepareModelVerification(
    "observation-base",
    async () => {
      started = true;
      return "incomplete";
    },
    new AbortController(),
  );
  expect(started).toBe(false);
  await expect(check.finish()).rejects.toThrow(
    "verification did not report success",
  );
  expect(started).toBe(true);
});
