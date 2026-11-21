import { expect, test } from "bun:test";
import type { ProfilesDocument, TerminalTarget } from "../agentProfiles";
import {
  DEFAULT_OFFICE_PREFERENCES,
  OFFICE_PREFERENCES_KEY,
  writeOfficePreferences,
} from "../officePreferences";
import type { WorldObject, WorldLeafObject } from "../worldObject";
import { migrateLegacyTownMaster } from "./legacyTownMaster";

const document = (holder: ProfilesDocument["town_master"] = null) =>
  ({ town_master: holder }) as ProfilesDocument;
const leaf = (id: string, extra = {}) =>
  ({
    id,
    kind: "agent",
    connectionId: "alpha",
    generation: 7,
    terminalId: `terminal-${id}`,
    pane: { pane_id: `pane-${id}` },
    agentName: "lead",
    label: "Lead",
    stale: false,
    actionable: true,
    ...extra,
  }) as WorldLeafObject;
const world = (...leaves: WorldLeafObject[]): Pick<WorldObject, "leaves"> => ({
  leaves,
});
function storage(value: unknown = { townMaster: "lead", townCalm: true }) {
  let raw = JSON.stringify(value);
  let refused = false;
  return {
    getItem: () => raw,
    setItem(key: string, value: string) {
      expect(key).toBe(OFFICE_PREFERENCES_KEY);
      if (refused) throw new Error("storage refused");
      raw = value;
    },
    value: () => JSON.parse(raw),
    refuse: () => {
      refused = true;
    },
  };
}

test("an explicit legacy name imports its qualified current agent once, preserving other preferences", async () => {
  const saved = storage({ townMaster: " LEAD ", townCalm: true });
  const calls: TerminalTarget[] = [];
  const assign = async (target: TerminalTarget) => {
    expect(saved.value()).not.toHaveProperty("townMaster");
    calls.push(target);
  };
  await migrateLegacyTownMaster(saved, world(leaf("a")), document(), assign);
  await migrateLegacyTownMaster(saved, world(leaf("a")), document(), assign);
  expect(calls).toEqual([
    {
      connection_id: "alpha",
      connection_generation: 7,
      terminal_id: "terminal-a",
      pane_id: "pane-a",
    },
  ]);
  expect(saved.value()).toEqual({ townCalm: true });
});

test.each([
  "unloaded",
  "missing",
  "stale",
  "unactionable",
  "duplicate",
  "shell",
])(
  "%s observations wait without consuming or guessing a role",
  async (mode) => {
    const saved = storage();
    const leaves =
      mode === "missing"
        ? []
        : mode === "duplicate"
          ? [leaf("a"), leaf("b", { connectionId: "beta" })]
          : [
              leaf(
                "a",
                mode === "stale"
                  ? { stale: true }
                  : mode === "unactionable"
                    ? { actionable: false }
                    : mode === "shell"
                      ? { kind: "terminal" }
                      : {},
              ),
            ];
    let calls = 0;
    const assign = async () => {
      calls++;
    };
    await migrateLegacyTownMaster(
      saved,
      world(...leaves),
      mode === "unloaded" ? null : document(),
      assign,
    );
    expect(calls).toBe(0);
    expect(saved.value().townMaster).toBe("lead");
    await migrateLegacyTownMaster(
      saved,
      world(leaf("ready")),
      document(),
      assign,
    );
    expect(calls).toBe(1);
  },
);

test.each([null, "", "  ", 42, "x".repeat(65)])(
  "invalid legacy value %j is forgotten without defaulting",
  async (townMaster) => {
    const saved = storage({ townMaster });
    let calls = 0;
    await migrateLegacyTownMaster(
      saved,
      world(leaf("a")),
      document(),
      async () => {
        calls++;
      },
    );
    expect(calls).toBe(0);
    expect(saved.value()).not.toHaveProperty("townMaster");
  },
);

test("a synced holder wins; no explicit legacy preference never guesses firstmate", async () => {
  for (const saved of [storage(), storage({ townCalm: true })]) {
    let calls = 0;
    await migrateLegacyTownMaster(
      saved,
      world(leaf("a")),
      document({ connection_id: "beta", terminal_id: "other" }),
      async () => {
        calls++;
      },
    );
    expect(calls).toBe(0);
    expect(saved.value()).not.toHaveProperty("townMaster");
  }
  let calls = 0;
  await migrateLegacyTownMaster(
    storage({}),
    world(leaf("a", { agentName: "firstmate" })),
    document(),
    async () => {
      calls++;
    },
  );
  expect(calls).toBe(0);
});

test("native name takes priority over a label; a unique label also migrates", async () => {
  for (const native of [true, false]) {
    const targets: TerminalTarget[] = [];
    const leaves = [leaf("label", { agentName: null, agentLabel: "Lead" })];
    if (native) leaves.push(leaf("native"));
    await migrateLegacyTownMaster(
      storage(),
      world(...leaves),
      document(),
      async (target) => {
        targets.push(target);
      },
    );
    expect(targets[0]?.terminal_id).toBe(
      native ? "terminal-native" : "terminal-label",
    );
  }
});

test("a pending migration survives edits to other preferences; refused consumption never sends", async () => {
  const saved = storage();
  writeOfficePreferences(saved, {
    ...DEFAULT_OFFICE_PREFERENCES,
    townCalm: false,
  });
  expect(saved.value().townMaster).toBe("lead");
  saved.refuse();
  let calls = 0;
  await migrateLegacyTownMaster(
    saved,
    world(leaf("a")),
    document(),
    async () => {
      calls++;
    },
  );
  expect(calls).toBe(0);
  expect(saved.value().townMaster).toBe("lead");
});

test.each([
  "concurrent holder",
  "failure before write",
  "lost reply after write",
])(
  "%s never replays the migration or restores the retired preference",
  async (failure) => {
    const saved = storage();
    let calls = 0;
    const assign = async () => {
      calls++;
      throw new Error(failure);
    };
    await expect(
      migrateLegacyTownMaster(saved, world(leaf("a")), document(), assign),
    ).rejects.toThrow(failure);
    await migrateLegacyTownMaster(saved, world(leaf("a")), document(), assign);
    expect(calls).toBe(1);
    expect(saved.value()).not.toHaveProperty("townMaster");
  },
);
