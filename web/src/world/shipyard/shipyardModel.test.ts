import { describe, expect, test } from "bun:test";
import {
  FIXTURE_REPO,
  shipyardFixtureCatalog,
  shipyardFixtureSnapshot,
  type ShipyardFixtureMode,
} from "./shipyardFixture";
import {
  runningCount,
  shipyardAge,
  shipyardSignText,
  shipyardView,
} from "./shipyardModel";
import type { ShipyardState } from "./shipyardStore";

const NOW = Date.UTC(2026, 10, 20, 12);

function state(mode: ShipyardFixtureMode): ShipyardState {
  const catalog = shipyardFixtureCatalog(mode, NOW);
  const repo = catalog.repositories[0] ?? null;
  return {
    catalog,
    repo,
    snapshot: repo ? shipyardFixtureSnapshot(mode, NOW, repo) : null,
    error: null,
  };
}

function open(mode: ShipyardFixtureMode) {
  const view = shipyardView(state(mode));
  if (view.status !== "open") throw new Error(`not open: ${view.status}`);
  return view;
}

describe("shipyard view", () => {
  test("loading until the service answers, unreachable when it fails", () => {
    const empty = { catalog: null, repo: null, snapshot: null, error: null };
    expect(shipyardView(empty).status).toBe("loading");
    const failed = shipyardView({ ...empty, error: "offline" });
    expect(failed).toEqual({ status: "unreachable", detail: "offline" });
    expect(shipyardSignText(failed)).toBe("Closed · World did not answer");
  });

  test("a fresh read: ships newest first, the baseline and where it runs", () => {
    const view = open("ready");
    expect(view.repo).toBe(FIXTURE_REPO);
    expect(view.stale).toBe(false);
    expect(view.main.beacon).toBe("pass");
    expect(view.ships.map((ship) => ship.release.tag)).toEqual([
      "v1.5.0-rc.1",
      "v1.4.0",
      "v1.3.2",
      "v1.3.1",
      "v1.3.0",
    ]);
    const baseline = view.ships.filter((ship) => ship.baseline);
    expect(baseline.map((ship) => ship.release.tag)).toEqual(["v1.4.0"]);
    expect(baseline[0]!.running.map((instance) => instance.port)).toEqual([
      19190,
    ]);
    expect(view.cargo.count).toBe("4 waiting");
    expect(view.cargo.since).toBe("since v1.4.0");
    expect(view.cargo.note).toBeNull();
    expect(shipyardSignText(view)).toBe(
      "v1.5.0-rc.1 · 4 waiting · main passing",
    );
  });

  test("failing checks light the beacon red", () => {
    const view = open("failing");
    expect(view.main.beacon).toBe("fail");
    expect(shipyardSignText(view)).toEndWith("main failing");
  });

  test("stale: everything is old, health included", () => {
    const view = open("stale");
    expect(view.stale).toBe(true);
    expect(view.main.beacon).toBe("unknown");
    expect(view.main.words).toBe("main: last seen checks are old");
    expect(shipyardSignText(view)).toStartWith("Out of date · ");
  });

  test("a shortened comparison never reads as complete", () => {
    const view = open("limited");
    expect(view.cargo.count).toBe("6+ waiting");
    expect(view.cargo.note).not.toBeNull();
  });

  test("diverged or unreadable waiting changes are unknown, not none", () => {
    const base = state("ready");
    const snapshot = base.snapshot!;
    for (const waitingState of ["diverged", "unavailable"] as const) {
      const view = shipyardView({
        ...base,
        snapshot: {
          ...snapshot,
          data: {
            ...snapshot.data!,
            waiting: {
              ...snapshot.data!.waiting,
              state: waitingState,
              pullRequests: [],
              commits: [],
            },
          },
        },
      });
      if (view.status !== "open") throw new Error(view.status);
      expect(view.cargo.count).toBe("unknown");
      expect(view.cargo.note).toBeTruthy();
    }
  });

  test("GitHub off or no repository: how to go on, and Worlds still show", () => {
    const off = shipyardView(state("off"));
    expect(off.status).toBe("off");
    expect(shipyardSignText(off)).toBe("Closed · GitHub source is off");
    const none = shipyardView(state("empty"));
    expect(none.status).toBe("no_repo");
    expect(shipyardSignText(none)).toBe("Choose a repository");
  });

  test("running Worlds in words", () => {
    const view = open("ready");
    expect(runningCount(view.running)).toBe("2 running, 1 stopped reporting");
  });

  test("ages in words", () => {
    expect(shipyardAge(null, NOW)).toBe("never");
    expect(shipyardAge(NOW - 30_000, NOW)).toBe("just now");
  });
});
