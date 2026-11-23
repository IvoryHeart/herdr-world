import { describe, expect, test } from "bun:test";
import { BOARD_ELEMENT_TYPES } from "../../../../../shared/boardElements";
import { BOARD_HELP } from "../board.help";
import { fixtureHost, fixtureWorld } from "../boardFixture";
import {
  ARRIVING_KINDS,
  BOARD_KIND_PRESENTATION,
  classifyLink,
  DEFAULT_TITLES,
  PLACED_KINDS,
} from "./boardElementKinds";
import {
  artefactPlace,
  projectChoices,
  readProblem,
  sourcePlace,
  transcriptTurns,
} from "./boardElementRead";

const space = (label: string) => ({
  label,
  tabs: [{ label: "main", panes: [["working"]] as never }],
});
const world = fixtureWorld([
  fixtureHost("studio", [space("web-app"), space("docs-site")]),
  fixtureHost("build-box", [space("nightly")], { stale: true }),
]);

describe("Board kinds", () => {
  test("every registered kind is shown once, placed or arriving", () => {
    const shown = [...PLACED_KINDS, ...ARRIVING_KINDS].map(
      (entry) => entry.kind,
    );
    expect(shown.sort()).toEqual(
      BOARD_ELEMENT_TYPES.map((entry) => entry.kind).sort(),
    );
    expect(Object.keys(BOARD_KIND_PRESENTATION).sort()).toEqual(shown.sort());
  });
  test("Board places notes and elements; the rest arrive from World", () => {
    expect(PLACED_KINDS.map((entry) => entry.kind)).toEqual([
      "note",
      "memory",
      "log",
      "document",
      "link",
    ]);
  });
  test("Board names kinds plainly; Town's metaphors stay in Town", () => {
    const town = /apartment|library|shipyard|resident|town/i;
    const add = BOARD_HELP.find((entry) => entry.id === "board.add")!;
    const words = [
      ...Object.values(BOARD_KIND_PRESENTATION).flatMap((kind) => [
        kind.label,
        kind.blurb,
      ]),
      ...Object.values(DEFAULT_TITLES),
      add.title,
      add.summary,
      ...add.steps,
    ];
    expect(words.filter((word) => town.test(word))).toEqual([]);
  });
});

describe("links", () => {
  test("GitHub pull requests and issues are named by their ref", () => {
    expect(
      classifyLink("https://github.com/example-org/web-app/pull/42"),
    ).toEqual({
      kind: "pull_request",
      site: "github.com",
      ref: "example-org/web-app#42",
    });
    expect(
      classifyLink("https://github.com/example-org/web-app/issues/7/"),
    ).toMatchObject({ kind: "issue", ref: "example-org/web-app#7" });
  });
  test("anything else is a plain address on its site", () => {
    expect(classifyLink("https://docs.example.com/guide")).toEqual({
      kind: "url",
      site: "docs.example.com",
    });
    expect(
      classifyLink("https://github.com/example-org/web-app/pull/42/files"),
    ).toMatchObject({ kind: "url" });
    // As the service classifies: only github.com itself.
    expect(
      classifyLink("https://www.github.com/example-org/web-app/pull/42").kind,
    ).toBe("url");
    expect(classifyLink("not a url").kind).toBe("url");
  });
});

describe("where a project element reads from", () => {
  test("a live host names its generation", () => {
    expect(
      sourcePlace(world, { connection_id: "studio", workspace_id: "w2" }),
    ).toEqual({
      hostLabel: "studio",
      workspaceLabel: "docs-site",
      generation: 1,
    });
  });
  test("an offline or unknown host has no generation to read with", () => {
    expect(
      sourcePlace(world, { connection_id: "build-box", workspace_id: "w1" })
        .generation,
    ).toBeNull();
    expect(
      sourcePlace(world, { connection_id: "gone", workspace_id: "w9" }),
    ).toEqual({ hostLabel: "gone", workspaceLabel: "w9", generation: null });
  });
  test("new elements choose only live hosts' projects", () => {
    expect(projectChoices(world).map((choice) => choice.label)).toEqual([
      "web-app · studio",
      "docs-site · studio",
    ]);
  });
  test("a stale read names the host, not another connection", () => {
    expect(readProblem("changed_or_unavailable", "studio")).toContain(
      "studio reconnected",
    );
  });
});

describe("an artefact on Board", () => {
  const ORIGINAL = "a".repeat(64);
  const REPLACEMENT = "b".repeat(64);
  // World's leaf in pane w1:p1 runs the session with this fingerprint.
  const running = (fingerprint: string) => ({
    ...world,
    hosts: world.hosts.map((host) => ({
      ...host,
      spaces: host.spaces.map((space) => ({
        ...space,
        children: space.children.map((leaf) =>
          leaf.id === "leaf:studio:w1:p1"
            ? {
                ...leaf,
                pane: { ...leaf.pane, agent: "codex" },
                agentSessionFingerprint: fingerprint,
              }
            : leaf,
        ),
      })),
    })),
  });
  const made = (fields: Record<string, string>) =>
    ({
      connection_id: "studio",
      workspace_id: "w2",
      pane_id: "w1:p1",
      agent: "codex",
      session: ORIGINAL,
      artefact_kind: "report",
      file: "/work/example/report.md",
      ...fields,
    }) as never;
  test("names its live maker from World and opens through it", () => {
    const place = artefactPlace(running(ORIGINAL), made({}));
    expect(place.maker).toBe("main 1");
    expect(place.viewerId).toBe("leaf:studio:w1:p1");
    // The room is the one it was made in, not where the maker is now.
    expect(place.workspaceLabel).toBe("docs-site");
  });
  test("a gone or replaced maker shows its harness; Files opens through its room", () => {
    const gone = artefactPlace(running(ORIGINAL), made({ pane_id: "w1:p9" }));
    expect(gone.maker).toBe("Codex");
    expect(gone.viewerId).toBe("leaf:studio:w2:p1");
    // Another Codex session in the same pane did not make it.
    const replaced = artefactPlace(running(REPLACEMENT), made({}));
    expect(replaced.maker).toBe("Codex");
    // Without session evidence no live agent is credited.
    const unknown = artefactPlace(running(ORIGINAL), made({ session: "" }));
    expect(unknown.maker).toBe("Codex");
  });
  test("an offline connection is never swapped for another one", () => {
    const place = artefactPlace(
      world,
      made({ connection_id: "build-box", workspace_id: "w1" }),
    );
    expect(place.generation).toBeNull();
    expect(place.viewerId).toBeNull();
  });
});

describe("saved transcripts", () => {
  test("JSON lines become turns; tool calls in a row fold into one", () => {
    const text = [
      { role: "user", content: "Check the build." },
      {
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash" }],
        },
      },
      {
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "It passes." }],
        },
      },
      { payload: { role: "system", content: "Session resumed." } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");
    expect(transcriptTurns(text)).toEqual([
      { who: "you", text: "Check the build." },
      { who: "tool", text: "Bash, Read" },
      { who: "agent", text: "It passes." },
      { who: "note", text: "Session resumed." },
    ]);
  });
  test("plain text stays plain; a line cut by the read limit is left out", () => {
    expect(transcriptTurns("Build started\nBuild passed")).toBeNull();
    expect(
      transcriptTurns(
        `${JSON.stringify({ role: "user", content: "Hi" })}\n{"role":"assis`,
        true,
      ),
    ).toEqual([{ who: "you", text: "Hi" }]);
  });
  test("structured records that are not chat stay visible as their text", () => {
    const record = JSON.stringify({ level: "info", message: "Build passed" });
    expect(transcriptTurns(record)).toEqual([{ who: "note", text: record }]);
    const mixed = [
      JSON.stringify({ role: "user", content: "Run it." }),
      JSON.stringify({ level: "warn", message: "Slow disk" }),
      JSON.stringify({ role: "assistant", content: "Done." }),
    ].join("\n");
    expect(transcriptTurns(mixed)).toEqual([
      { who: "you", text: "Run it." },
      {
        who: "note",
        text: JSON.stringify({ level: "warn", message: "Slow disk" }),
      },
      { who: "agent", text: "Done." },
    ]);
  });
  test("a broken line that the read limit did not cut stays as text", () => {
    expect(
      transcriptTurns(
        `${JSON.stringify({ role: "user", content: "Hi" })}\n{"role":"assis`,
      ),
    ).toEqual([
      { who: "you", text: "Hi" },
      { who: "note", text: '{"role":"assis' },
    ]);
  });
  test("a log whose records show nothing falls back to its text", () => {
    expect(
      transcriptTurns(JSON.stringify({ role: "assistant", content: "" })),
    ).toBeNull();
  });
});
