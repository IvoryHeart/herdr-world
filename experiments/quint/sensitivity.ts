import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadTrace, type Model, type ReplayDomain } from "./traces";
import { sha256 } from "../../scripts/verification-setup";

type Request = {
  model: Model;
  files: string[];
  mode: "positive" | "mutation" | "counterexample";
  allowed: readonly string[];
  mutant?: string;
  domain?: ReplayDomain;
  reverseRegistration?: boolean;
  spaceOrder?: number[];
};
type ReplayResult = {
  witnesses: Record<string, number>;
  trace: string;
  observation: string;
  steps: number;
};
type Harness = {
  root: string;
  output: string;
  artifacts: string;
  command(
    label: string,
    args: string[],
    expectedViolation?: boolean,
  ): Promise<string>;
  replayWorker(label: string, request: Request): Promise<ReplayResult>;
  mutation(name: Model): Promise<string>;
  cases: readonly {
    name: Model;
    witnesses: readonly string[];
    mismatches: readonly string[];
  }[];
};

export async function runSensitivity(h: Harness) {
  const results: unknown[] = [];
  const variants: {
    name: Model;
    replacements: [string, string][];
    domain: ReplayDomain;
  }[] = [
    {
      name: "runtime-leases",
      replacements: [["GENERATION_BOUND = 4", "GENERATION_BOUND = 6"]],
      domain: { generationBound: 6 },
    },
    {
      name: "runtime-control",
      replacements: [["GENERATION_BOUND = 6", "GENERATION_BOUND = 8"]],
      domain: { generationBound: 8 },
    },
    {
      name: "browser-refresh",
      replacements: [
        ["EPOCH_BOUND = 3", "EPOCH_BOUND = 5"],
        ["REQUEST_BOUND = 6", "REQUEST_BOUND = 10"],
      ],
      domain: { epochBound: 5, requestBound: 10 },
    },
    {
      name: "browser-preparation",
      replacements: [
        ["EPOCH_BOUND = 3", "EPOCH_BOUND = 4"],
        ["REQUEST_BOUND = 3", "REQUEST_BOUND = 4"],
      ],
      domain: { epochBound: 4, requestBound: 4 },
    },
  ];
  for (const variant of variants.filter((variant) =>
    h.cases.some((item) => item.name === variant.name),
  )) {
    const item = h.cases.find((item) => item.name === variant.name)!;
    const traceCount = variant.name === "browser-preparation" ? 1000 : 100;
    let source = await readFile(
      resolve(h.root, `experiments/quint/${variant.name}.qnt`),
      "utf8",
    );
    for (const [before, after] of variant.replacements) {
      assert.equal(
        source.split(before).length,
        2,
        "sensitivity bound target changed",
      );
      source = source.replace(before, after);
    }
    const model = `${h.artifacts}/sensitivity-${variant.name}.qnt`;
    await writeFile(resolve(h.root, model), source);
    const main = variant.name.replaceAll("-", "_");
    const verified = await h.command(`sensitivity-${variant.name}-verify`, [
      "verify",
      model,
      "--main",
      main,
      "--backend",
      "tlc",
      "--invariant",
      "safety",
      "--verbosity",
      "3",
    ]);
    assert.match(verified, /No violation found/);
    for (const seed of [42, 73, 103]) {
      const label = `sensitivity-${variant.name}-seed${seed}`;
      const sampled = await h.command(label, [
        "run",
        model,
        "--main",
        main,
        "--backend",
        "typescript",
        "--seed",
        String(seed),
        "--max-samples",
        "1000",
        "--max-steps",
        "40",
        "--n-traces",
        String(traceCount),
        "--invariant",
        "safety",
        "--verbosity",
        "1",
        "--out-itf",
        `${h.artifacts}/${label}_{seq}.itf.json`,
        "--witnesses",
        ...item.witnesses,
      ]);
      for (const witness of item.witnesses) {
        const count = sampled.match(
          new RegExp(`${witness} was witnessed in (\\d+) trace`),
        );
        assert(
          count && Number(count[1]) > 0,
          `missing larger-bound witness ${witness}`,
        );
      }
      const files = (await readdir(h.output))
        .filter((file) => new RegExp(`^${label}_\\d+\\.itf\\.json$`).test(file))
        .sort()
        .map((file) => resolve(h.output, file));
      assert.equal(files.length, traceCount);
      const replay = await h.replayWorker(`${label}-replay`, {
        model: item.name,
        files,
        mode: "positive",
        allowed: item.mismatches,
        domain: variant.domain,
        reverseRegistration: item.name === "runtime-leases",
      });
      for (const witness of item.witnesses)
        assert(
          replay.witnesses[witness]! > 0,
          `missing larger-bound replay witness ${witness}`,
        );
      const mutant = await h.mutation(item.name);
      const killed = await h.replayWorker(`${label}-mutation`, {
        model: item.name,
        files,
        mode: "mutation",
        allowed: item.mismatches,
        domain: variant.domain,
        reverseRegistration: item.name === "runtime-leases",
        mutant,
      });
      const result = {
        name: item.name,
        technique: "larger-bound",
        domain: variant.domain,
        model,
        modelSha256: sha256(source),
        seed,
        samples: 1000,
        maxSteps: 40,
        traces: traceCount,
        reverseRegistration: item.name === "runtime-leases",
        replayWitnesses: replay.witnesses,
        killingObservation: killed.observation,
        killingTrace: killed.trace,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  if (!h.cases.some((item) => item.name === "space-admission")) return results;
  const source = await readFile(
    resolve(h.root, "experiments/quint/space-admission.qnt"),
    "utf8",
  );
  const orders = [
    [0, 1, 2, 5, 3, 4],
    [3, 4, 0, 1, 2, 5],
    [3, 4, 5, 0, 1, 2],
    [5, 0, 1, 2, 3, 4],
    [5, 3, 4, 0, 1, 2],
  ];
  const item = h.cases.find((item) => item.name === "space-admission")!;
  assert.equal(source.split("ORDER = List(0, 1, 2, 3, 4, 5)").length, 2);
  for (const [index, order] of orders.entries()) {
    const label = `sensitivity-space-order${index}`;
    const transformed = source.replace(
      "ORDER = List(0, 1, 2, 3, 4, 5)",
      `ORDER = List(${order.join(", ")})`,
    );
    const model = `${h.artifacts}/${label}.qnt`;
    await writeFile(resolve(h.root, model), transformed);
    const verified = await h.command(`${label}-verify`, [
      "verify",
      model,
      "--main",
      "space_admission",
      "--backend",
      "tlc",
      "--invariant",
      "safety",
      "--init",
      "allConfigurations",
      "--step",
      "hold",
      "--verbosity",
      "3",
    ]);
    assert.match(verified, /No violation found/);
    const path = `${h.artifacts}/${label}.itf.json`;
    await h.command(`${label}-enumerate`, [
      "run",
      model,
      "--main",
      "space_admission",
      "--backend",
      "typescript",
      "--step",
      "enumerate",
      "--max-samples",
      "1",
      "--max-steps",
      "5103",
      "--n-traces",
      "1",
      "--invariant",
      "safety",
      "--verbosity",
      "1",
      "--out-itf",
      path,
    ]);
    const states = await loadTrace(resolve(h.root, path), "space-admission");
    assert.equal(states.length - 1, 5103);
    const keys = states
      .slice(1)
      .map((state) =>
        JSON.stringify([
          [...state.present].sort(),
          [...state.relevant].sort(),
          state.bound,
        ]),
      );
    assert.equal(new Set(keys).size, 5103);
    const request: Request = {
      model: "space-admission",
      files: [resolve(h.root, path)],
      mode: "positive",
      allowed: item.mismatches,
      spaceOrder: order,
    };
    const replay = await h.replayWorker(`${label}-replay`, request);
    for (const witness of item.witnesses)
      assert(replay.witnesses[witness]! > 0);
    const killed = await h.replayWorker(`${label}-mutation`, {
      ...request,
      mode: "mutation",
      mutant: await h.mutation("space-admission"),
    });
    const result = {
      name: "space-admission",
      technique: "host-order",
      order,
      configurations: 5103,
      model,
      modelSha256: sha256(transformed),
      replayWitnesses: replay.witnesses,
      killingObservation: killed.observation,
      killingTrace: killed.trace,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  return results;
}
