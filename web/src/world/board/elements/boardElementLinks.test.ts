import { describe, expect, test } from "bun:test";
import type { ApartmentResident } from "../../../../../shared/apartments";
import type { BoardElement } from "../../../../../shared/boardElements";
import {
  MEMORY_FIXTURE_TARGET,
  memoryFixtureClient,
} from "../../memory/memoryFixture";
import { fixtureHost, fixtureWorld } from "../boardFixture";
import {
  libraryMemoryChoices,
  libraryPlace,
  libraryRequestFor,
  RESIDENT_CHOICES,
  residentChoices,
  residentForLog,
  residentLabel,
} from "./boardElementLinks";

const resident = (
  id: string,
  connection_id: string,
  rest: Partial<ApartmentResident> = {},
) =>
  ({
    id,
    connection_id,
    name: "ada",
    harness: "claude",
    cwd: "/work/web-app",
    session_id: null,
    moved_out_at: 1,
    ...rest,
  }) as ApartmentResident;

describe("Board memory from the Library", () => {
  test("lists the Library's readable memories, the chosen project first", async () => {
    const catalog = await memoryFixtureClient().list(MEMORY_FIXTURE_TARGET);
    const choices = libraryMemoryChoices(catalog, "w1");
    expect(choices.length).toBeGreaterThan(0);
    // Only memories the Library can read now.
    const readable = new Set(
      catalog.entries
        .filter(
          (entry) =>
            entry.state === "available" &&
            catalog.sources.find((s) => s.id === entry.source_id)?.state ===
              "available",
        )
        .map((entry) => `${entry.source_id}\u0000${entry.path}`),
    );
    for (const choice of choices)
      expect(readable.has(`${choice.sourceId}\u0000${choice.path}`)).toBe(true);
    // The chosen project's shelf leads; user-wide files come last.
    const firstOther = choices.findIndex((c) => c.workspaceId !== "w1");
    expect(choices.slice(0, Math.max(firstOther, 0)).length).toBeGreaterThan(0);
    const user = choices.filter((c) => c.workspaceId === null);
    expect(user.every((c) => c.group === "Every project")).toBe(true);
    expect(choices[choices.length - 1]?.workspaceId ?? null).toBeNull();
    // Labels tell two harnesses' files of one name apart.
    expect(new Set(choices.map((c) => `${c.group}/${c.label}`)).size).toBe(
      choices.length,
    );
    // The value carries what world.memory.read takes.
    const [sourceId, path] = JSON.parse(choices[0]!.value) as string[];
    expect([sourceId, path]).toEqual([choices[0]!.sourceId, choices[0]!.path]);
  });

  test("opens the Library on the memory's host and project", () => {
    const element = {
      id: "memory-1",
      kind: "memory",
      title: "Build notes",
      x: 0,
      y: 0,
      rev: 1,
      source: {
        connection_id: "studio",
        workspace_id: "w1",
        memory_source_id: "src-1",
        path: "build-notes.md",
      },
    } satisfies BoardElement;
    expect(libraryRequestFor(element)).toEqual({
      connectionId: "studio",
      workspaceId: "w1",
    });
    expect(
      libraryRequestFor({
        ...element,
        kind: "link",
        source: { url: "https://example.com/" },
      }),
    ).toBeNull();
  });

  test("reads only on the Library's live host, at its generation", () => {
    const world = fixtureWorld([
      fixtureHost("studio", [{ label: "web-app", tabs: [] }]),
    ]);
    const source = { connection_id: "studio", workspace_id: "w1" };
    expect(
      libraryPlace(
        world,
        [
          {
            connection_id: "studio",
            connection_generation: 7,
            label: "Studio",
          },
        ],
        source,
      ),
    ).toEqual({
      hostLabel: "Studio",
      workspaceLabel: "Library · web-app",
      generation: 7,
    });
    // Not a host the Library reads now: offline, never another host.
    expect(
      libraryPlace(
        world,
        [{ connection_id: "other", connection_generation: 3, label: "Other" }],
        { connection_id: "studio" },
      ),
    ).toEqual({
      hostLabel: "studio",
      workspaceLabel: "Library",
      generation: null,
    });
  });
});

describe("Board logs and Apartments", () => {
  const residents = [
    resident("r-1", "studio", { session_id: "sess-a" }),
    resident("r-2", "studio", { name: "grace", harness: "codex" }),
    resident("r-3", "build-box", { session_id: "sess-b" }),
  ];
  const log = { connection_id: "studio" };

  test("finds the saved resident, else the one whose session it names", () => {
    expect(residentForLog({ ...log, apartment_id: "r-2" }, residents)?.id).toBe(
      "r-2",
    );
    expect(residentForLog({ ...log, agent_ref: "sess-a" }, residents)?.id).toBe(
      "r-1",
    );
    expect(residentForLog({ ...log, agent_ref: "r-2" }, residents)?.id).toBe(
      "r-2",
    );
    // A saved resident that moved out is not replaced by a guess.
    expect(
      residentForLog(
        { ...log, apartment_id: "gone", agent_ref: "sess-a" },
        residents,
      ),
    ).toBeNull();
    expect(residentForLog({ ...log, agent_ref: "ada" }, residents)).toBeNull();
  });

  test("never links a log to another host's resident", () => {
    expect(
      residentForLog({ ...log, agent_ref: "sess-b" }, residents),
    ).toBeNull();
    expect(
      residentForLog({ ...log, apartment_id: "r-3" }, residents),
    ).toBeNull();
  });

  test("offers the newest residents on the host, and the saved one", () => {
    const many = Array.from({ length: RESIDENT_CHOICES + 5 }, (_, i) =>
      resident(`r-${i}`, "studio", { moved_out_at: i }),
    );
    const shown = residentChoices(many, "studio", "r-0");
    expect(shown).toHaveLength(RESIDENT_CHOICES + 1);
    expect(shown[0]!.id).toBe(`r-${RESIDENT_CHOICES + 4}`);
    expect(shown[shown.length - 1]!.id).toBe("r-0");
    expect(residentChoices(many, "build-box")).toEqual([]);
    expect(residentLabel(residents[1]!)).toBe("grace · codex · web-app");
  });
});
