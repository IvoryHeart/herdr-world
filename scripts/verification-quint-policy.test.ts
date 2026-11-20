import { expect, test } from "bun:test";
import { assertQuintBackend } from "./verification-quint-policy";

test("verification cannot reach the Rust evaluator ZIP installer", () => {
  expect(() =>
    assertQuintBackend(["run", "synthetic.qnt", "--backend", "typescript"]),
  ).not.toThrow();
  expect(() =>
    assertQuintBackend(["verify", "synthetic.qnt", "--backend", "tlc"]),
  ).not.toThrow();
  expect(() =>
    assertQuintBackend(["typecheck", "synthetic.qnt"]),
  ).not.toThrow();
  for (const args of [
    ["run"],
    ["run", "--backend", "rust"],
    ["run", "--backend=rust"],
    ["run", "--backend", "typescript", "--backend", "rust"],
    ["verify"],
    ["verify", "--backend", "apalache"],
  ])
    expect(() => assertQuintBackend(args)).toThrow(
      "automatic evaluator installation is refused",
    );
});
