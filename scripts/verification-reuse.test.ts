import { expect, test } from "bun:test";
import { verificationJobs } from "./ci-model-plan";
import manifest from "../package.json";
import {
  alwaysRun,
  gateReceipt,
  reusable,
  verificationGateKey,
} from "./verification-reuse";

const parts = (hashes: string[]) => async (_root: string, indices: number[]) =>
  indices.map((index) => ({ hash: hashes[index - 1] ?? `part-${index}` }));

test("the gate key covers every model part and changes with any one of them", async () => {
  const requested: number[][] = [];
  const base = await verificationGateKey("/repo", async (root, indices) => {
    requested.push(indices);
    return parts([])(root, indices);
  });
  expect(requested).toEqual([verificationJobs.map((_, index) => index + 1)]);
  expect(await verificationGateKey("/repo", parts([]))).toBe(base);
  for (const index of [0, verificationJobs.length - 1]) {
    const hashes = verificationJobs.map((_, part) => `part-${part + 1}`);
    hashes[index] = "edited";
    expect(await verificationGateKey("/repo", parts(hashes))).not.toBe(base);
  }
});

test("receipts are named by key under the verification cache", () => {
  expect(gateReceipt("abc", "/cache")).toBe("/cache/gate-receipts/abc.json");
});

test("a reused gate still runs every cheap step, and together they are the whole gate", () => {
  const gate = manifest.scripts["verification:gate"]
    .split("&&")
    .map((step) => step.trim().replace(/^bun run /, ""));
  expect<string[]>([...alwaysRun, ...reusable]).toEqual(gate);
  expect(alwaysRun).toContain("verification:typecheck");
  expect(alwaysRun).toContain("verification:notices:check");
  expect(reusable).toEqual([
    "verification:check",
    "verification:diagnostic-control",
  ]);
});
