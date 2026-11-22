import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { featuresIn } from "./FeatureHosts";

const Host = () => null;
const slot = "dialogs";

test("the dialogs slot mounts Apartments, then the Memory Library", () => {
  expect(featuresIn(slot).map(({ id }) => id)).toEqual([
    "apartments",
    "memory",
  ]);
});

test("a slot orders by order then id, ignores modules without a Host and refuses a duplicate id", () => {
  const probe = { mount: () => null };
  expect(
    featuresIn(slot, [
      { id: "b", slot, order: 1, Host },
      probe,
      { id: "a", slot, order: 1, Host },
      { id: "c", slot, order: 0, Host },
    ]).map(({ id }) => id),
  ).toEqual(["c", "a", "b"]);
  expect(() =>
    featuresIn(slot, [
      { id: "a", slot, order: 1, Host },
      { id: "a", slot, order: 2, Host },
    ]),
  ).toThrow("Duplicate web feature: a");
});

test("the control plane imports no per-feature host for a mounted feature", () => {
  const source = readFileSync(
    join(import.meta.dir, "../world/WorldControlPlane.tsx"),
    "utf8",
  );
  expect(source).toMatch(/<FeatureHosts\s+slot="dialogs"/);
  for (const name of ["ApartmentsHost", "MemoryLibraryHost"])
    expect(source).not.toContain(name);
});
