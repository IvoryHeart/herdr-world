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
