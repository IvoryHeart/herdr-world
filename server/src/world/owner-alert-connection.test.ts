import { expect, test } from "bun:test";
import { ownerAlertConnection } from "./owner-alert-connection";

const profiles = new Map<string, object>([
  ["remote", { id: "remote", type: "ssh" }],
  ["studio", { id: "studio", type: "local" }],
  ["core-local", { id: "core-local", type: "local", runtime: "herdr-core" }],
]);

test("a Herdr default host alerts the owner, wherever it runs", () => {
  const herdr = [{ id: "remote" }, { id: "studio" }];
  expect(ownerAlertConnection(herdr, "remote", profiles)).toBe("remote");
  expect(ownerAlertConnection(herdr, "studio", profiles)).toBe("studio");
});

test("a herdr-core default host alerts through this computer's Herdr connection (#1156)", () => {
  // The Herdr connection manager reports the external core default as its own.
  expect(
    ownerAlertConnection(
      [{ id: "remote" }, { id: "studio" }],
      "core-local",
      profiles,
    ),
  ).toBe("studio");
});

test("with no Herdr connection on this computer, nothing can alert the owner", () => {
  expect(ownerAlertConnection([{ id: "remote" }], "core-local", profiles)).toBe(
    null,
  );
  expect(ownerAlertConnection([], "core-local", profiles)).toBe(null);
  // A connection without a saved profile is not assumed local.
  expect(ownerAlertConnection([{ id: "unknown" }], null, profiles)).toBe(null);
});
