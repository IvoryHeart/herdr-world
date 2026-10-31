import { expect, test } from "bun:test";
import { commandEvidence } from "./evidence";
import { registeredVerb } from "./registry";

test("memory acceptance cannot become stored or observed without a receipt", () => {
  const evidence = commandEvidence(registeredVerb("cli", "result")!);
  expect(evidence.get()).toEqual({ stage: "accepted" });
  expect(() => evidence.record({ stage: "stored", receipt: "" })).toThrow(
    "durable receipt",
  );
  expect(() => evidence.record({ stage: "observed", observation: "" })).toThrow(
    "observation",
  );
  evidence.record({ stage: "stored", receipt: "world-ledger:42" });
  expect(evidence.get()).toEqual({
    stage: "stored",
    receipt: "world-ledger:42",
  });
  evidence.record({
    stage: "observed",
    observation: "world:example-incarnation:42",
  });
  expect(evidence.get()).toEqual({
    stage: "observed",
    observation: "world:example-incarnation:42",
  });
});

test("sent and uncertain evidence retain the exact owning runtime", () => {
  const evidence = commandEvidence(registeredVerb("rpc", "pane.send_text")!);
  expect(() =>
    evidence.record({
      stage: "sent",
      connection_id: "",
      connection_generation: 1,
    }),
  ).toThrow("owning runtime");
  expect(() =>
    evidence.record({
      stage: "sent",
      connection_id: "example",
      connection_generation: -1,
    }),
  ).toThrow("owning runtime");
  evidence.record({
    stage: "sent",
    connection_id: "example",
    connection_generation: 4,
  });
  expect(evidence.get()).toEqual({
    stage: "sent",
    connection_id: "example",
    connection_generation: 4,
  });
  evidence.record({
    stage: "uncertain",
    connection_id: "example",
    connection_generation: 4,
    reason: "acknowledgement lost",
  });
  expect(evidence.get()).toEqual({
    stage: "uncertain",
    connection_id: "example",
    connection_generation: 4,
    reason: "acknowledgement lost",
  });
});
