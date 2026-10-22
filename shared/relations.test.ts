import { describe, expect, test } from "bun:test";
import {
  joinGroup,
  leaveGroups,
  observedSpawnClaims,
  relationsOf,
  relationTeams,
  spawnClaimsToRecord,
  spawnParents,
  terminalKey,
  type RelationObservation,
  type SpawnClaim,
} from "./relations";

const ref = (terminal_id: string, connection_id = "studio") => ({
  connection_id,
  terminal_id,
});
const pane = (pane_id: string, terminal_id: string, tokens?: unknown) => ({
  pane_id,
  terminal_id,
  ...(tokens ? { tokens } : {}),
});
const host = (
  panes: RelationObservation["panes"],
  overrides: Partial<RelationObservation> = {},
): RelationObservation => ({
  connection_id: "studio",
  generation: 3,
  current: true,
  panes,
  ...overrides,
});
const claim = (child: string, parent: string, generation = 3): SpawnClaim => ({
  child: ref(child),
  parent: ref(parent),
  source: "herdr:spawned_by",
  generation,
  observed_at: 1_000,
});
const none = { spawns: [], groups: [] };

describe("spawn evidence", () => {
  test("a live token is current evidence held by Herdr", () => {
    const observations = [
      host([
        pane("w1:p1", "term_parent"),
        pane("w1:p2", "term_child", { spawned_by: "w1:p1" }),
      ]),
    ];
    const [relation] = relationsOf(none, observations);
    expect(relation).toMatchObject({
      a: ref("term_parent"),
      b: ref("term_child"),
      strength: 1,
      evidence: [{ kind: "spawned", sor: "herdr", current: true }],
    });
  });

  test("the parent's terminal wins over a pane ID its move made stale", () => {
    // The parent moved: its pane ID changed, its terminal did not.
    const observations = [
      host([
        pane("w2:p9", "term_parent"),
        pane("w1:p1", "term_other"),
        pane("w1:p2", "term_child", {
          spawned_by: "w1:p1",
          spawned_by_terminal: "term_parent",
        }),
      ]),
    ];
    expect(relationsOf(none, observations)[0]?.a).toEqual(ref("term_parent"));
  });

  test("a pane cannot spawn itself, and an unknown parent is ignored", () => {
    const observations = [
      host([
        pane("w1:p1", "term_a", { spawned_by: "w1:p1" }),
        pane("w1:p2", "term_b", { spawned_by: "w9:p9" }),
      ]),
    ];
    expect(relationsOf(none, observations)).toEqual([]);
  });

  test("after Herdr drops the token, World's saved claim holds the relation", () => {
    const observations = [
      host([pane("w1:p1", "term_parent"), pane("w1:p2", "term_child")]),
    ];
    const [relation] = relationsOf(
      { spawns: [claim("term_child", "term_parent")], groups: [] },
      observations,
    );
    expect(relation?.evidence).toEqual([
      {
        kind: "spawned",
        sor: "world",
        source: "herdr:spawned_by",
        observed_at: 1_000,
        current: true,
      },
    ]);
  });

  test("a saved claim and its live token are one piece of evidence", () => {
    const observations = [
      host([
        pane("w1:p1", "term_parent"),
        pane("w1:p2", "term_child", { spawned_by: "w1:p1" }),
      ]),
    ];
    const relations = relationsOf(
      { spawns: [claim("term_child", "term_parent")], groups: [] },
      observations,
    );
    expect(relations).toHaveLength(1);
    expect(relations[0]?.evidence).toMatchObject([{ sor: "herdr" }]);
  });

  test("a live token naming another parent supersedes the saved claim", () => {
    const observations = [
      host([
        pane("w1:p1", "term_old"),
        pane("w1:p3", "term_new"),
        pane("w1:p2", "term_child", { spawned_by: "w1:p3" }),
      ]),
    ];
    const relations = relationsOf(
      { spawns: [claim("term_child", "term_old")], groups: [] },
      observations,
    );
    expect(relations.map((relation) => relation.a)).toEqual([ref("term_new")]);
  });

  test("stale evidence is kept and shown stale, never dropped", () => {
    const saved = { spawns: [claim("term_child", "term_parent")], groups: [] };
    // Cached topology of a failed host is not current.
    const cached = relationsOf(saved, [
      host([pane("w1:p1", "term_parent"), pane("w1:p2", "term_child")], {
        current: false,
      }),
    ]);
    expect(cached[0]).toMatchObject({
      strength: 0,
      evidence: [{ current: false }],
    });
    // A Herdr restart: new terminals, the old ones are gone.
    const restarted = relationsOf(saved, [host([pane("w1:p1", "term_fresh")])]);
    expect(restarted[0]).toMatchObject({
      strength: 0,
      evidence: [{ sor: "world", current: false }],
    });
  });

  test("a relation never crosses connections through a pane ID", () => {
    const observations = [
      host([pane("w1:p1", "term_parent")], { connection_id: "laptop" }),
      host([pane("w1:p2", "term_child", { spawned_by: "w1:p1" })]),
    ];
    expect(relationsOf(none, observations)).toEqual([]);
  });
});

describe("recording claims", () => {
  const observations = [
    host([
      pane("w1:p1", "term_parent"),
      pane("w1:p2", "term_child", { spawned_by: "w1:p1" }),
    ]),
  ];

  test("only live snapshots of the current runtime are recorded", () => {
    expect(observedSpawnClaims(observations, 5)).toEqual([
      { ...claim("term_child", "term_parent"), observed_at: 5 },
    ]);
    expect(
      observedSpawnClaims([{ ...observations[0]!, current: false }], 5),
    ).toEqual([]);
  });

  test("an unchanged claim is not rewritten; a new parent or runtime is", () => {
    const seen = observedSpawnClaims(observations, 5);
    expect(
      spawnClaimsToRecord([claim("term_child", "term_parent")], seen),
    ).toEqual([]);
    expect(
      spawnClaimsToRecord([claim("term_child", "term_other")], seen),
    ).toHaveLength(1);
    expect(
      spawnClaimsToRecord([claim("term_child", "term_parent", 2)], seen),
    ).toHaveLength(1);
  });
});

describe("manual groups", () => {
  test("joining starts a group led by the target, then extends it", () => {
    let groups = joinGroup([], [ref("b")], [ref("a")], "g1", 7);
    expect(groups).toEqual([
      { id: "g1", members: [ref("a"), ref("b")], created_at: 7 },
    ]);
    groups = joinGroup(groups, [ref("c")], [ref("b")], "g2", 8);
    expect(groups).toEqual([
      { id: "g1", members: [ref("a"), ref("b"), ref("c")], created_at: 7 },
    ]);
  });

  test("a terminal is in one group at a time, and a group of one goes", () => {
    let groups = joinGroup([], [ref("b")], [ref("a")], "g1", 1);
    groups = joinGroup(groups, [ref("d")], [ref("c")], "g2", 2);
    groups = joinGroup(groups, [ref("b")], [ref("c")], "g3", 3);
    expect(groups).toEqual([
      { id: "g2", members: [ref("c"), ref("d"), ref("b")], created_at: 2 },
    ]);
    expect(leaveGroups(groups, [ref("c"), ref("d")])).toEqual([]);
  });

  test("a group relates its members to its first, current while both are seen", () => {
    const groups = joinGroup([], [ref("b"), ref("c")], [ref("a")], "g1", 1);
    const relations = relationsOf({ spawns: [], groups }, [
      host([pane("w1:p1", "a"), pane("w1:p2", "b")]),
    ]);
    expect(
      relations.map((relation) => [
        relation.a.terminal_id,
        relation.b.terminal_id,
        relation.strength,
      ]),
    ).toEqual([
      ["a", "b", 1],
      ["a", "c", 0],
    ]);
    expect(relations[0]?.evidence).toMatchObject([
      { kind: "manual", sor: "world", source: "g1" },
    ]);
  });

  test("a grouped spawn has two pieces of evidence", () => {
    const groups = joinGroup([], [ref("b")], [ref("a")], "g1", 1);
    const [relation] = relationsOf({ spawns: [claim("b", "a")], groups }, [
      host([pane("w1:p1", "a"), pane("w1:p2", "b")]),
    ]);
    expect(relation?.strength).toBe(2);
    expect(relation?.evidence.map((entry) => entry.kind)).toEqual([
      "spawned",
      "manual",
    ]);
  });
});

test("teams join every related terminal; parents come from spawns only", () => {
  const groups = joinGroup([], [ref("c")], [ref("b")], "g1", 1);
  const relations = relationsOf({ spawns: [claim("b", "a")], groups }, [
    host([pane("p1", "a"), pane("p2", "b"), pane("p3", "c")]),
  ]);
  const teams = relationTeams(relations);
  expect(new Set(teams.values()).size).toBe(1);
  expect(teams.size).toBe(3);
  const parents = spawnParents(relations);
  expect(parents.get(terminalKey(ref("b")))).toEqual(ref("a"));
  expect(parents.has(terminalKey(ref("c")))).toBe(false);
});
