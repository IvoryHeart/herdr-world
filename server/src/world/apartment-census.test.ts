import { describe, expect, test } from "bun:test";
import {
  parseRemoteCensus,
  parseRemotePrefixes,
  remotePrefixesCommand,
  type CensusFile,
} from "../agent/session-census-files";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import { memoryApartmentsPort } from "../storage/apartments";
import {
  ApartmentCensus,
  CENSUS_INTERVAL_MS,
  CENSUS_QUIET_MS,
} from "./apartment-census";
import { WorldApartments } from "./apartments";

const NOW = Date.UTC(2026, 10, 20, 12);
const HOUR = 60 * 60 * 1000;
const iso = (at: number) => new Date(at).toISOString();
const id = (n: number) =>
  `0f0e0d0c-0000-4000-8000-${String(n).padStart(12, "0")}`;
const jsonl = (records: object[]) =>
  `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

const claude = (session: string, ask: string, at: number, extra = {}) =>
  jsonl([
    { type: "summary", summary: "Earlier work" },
    {
      type: "user",
      timestamp: iso(at),
      sessionId: session,
      cwd: "/srv/example/project-alpha",
      message: { role: "user", content: ask },
      ...extra,
    },
    {
      type: "assistant",
      timestamp: iso(at + 1000),
      sessionId: session,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      },
    },
  ]);
const codex = (
  session: string,
  ask: string,
  at: number,
  source: unknown = "cli",
) =>
  jsonl([
    {
      type: "session_meta",
      timestamp: iso(at),
      payload: {
        id: session,
        cwd: "/srv/example/project-beta",
        timestamp: iso(at),
        source,
        // Instructions come first; the census reads past them.
        base_instructions: { text: "x".repeat(150_000) },
      },
    },
    {
      type: "response_item",
      timestamp: iso(at + 1000),
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: ask }],
      },
    },
  ]);
const pi = (session: string, ask: string, at: number) =>
  jsonl([
    {
      type: "session",
      version: 3,
      id: session,
      timestamp: iso(at),
      cwd: "/srv/example/project-gamma",
    },
    {
      type: "message",
      id: "u1",
      timestamp: iso(at + 1000),
      message: { role: "user", content: [{ type: "text", text: ask }] },
    },
  ]);

type Disk = Map<
  string,
  { harness: CensusFile["harness"]; text: string; mtimeMs: number }
>;

/** A host whose harness histories are `disk`, counting what is read. */
function host(disk: Disk) {
  const reads: string[] = [];
  const files = {
    async listCensusFiles() {
      return [...disk].map(([path, file]) => ({
        harness: file.harness,
        path,
        mtimeMs: file.mtimeMs,
        size: file.text.length,
      }));
    },
    async readPrefixes(paths: readonly string[], limit: number) {
      const read = new Map<string, Uint8Array>();
      for (const path of paths) {
        reads.push(path);
        const file = disk.get(path);
        if (file)
          read.set(
            path,
            new TextEncoder().encode(file.text).subarray(0, limit),
          );
      }
      return read;
    },
    async readText() {
      throw new Error("the census reads prefixes only");
    },
  } as unknown as AgentSessionFileAccess;
  return { files, reads };
}

function world(disk: Disk) {
  let now = NOW;
  const port = memoryApartmentsPort([], () => now);
  const apartments = new WorldApartments({
    port,
    now: () => now,
    host: (connection) => ({
      label: `host ${connection}`,
      runtime: "herdr-core",
    }),
    publish: () => {},
  });
  const { files, reads } = host(disk);
  const census = new ApartmentCensus({
    files: (connection) => (connection === "local" ? files : null),
    host: (connection) => ({
      label: `host ${connection}`,
      runtime: "herdr-core",
    }),
    residents: () => port.list(),
    live: () => apartments.liveSessions(),
    found: (residents) => apartments.found(residents),
    now: () => now,
  });
  return {
    apartments,
    census,
    port,
    reads,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("Apartments hold every agent not running now", () => {
  test("agents in Claude, Codex and Pi histories move in asleep; helpers, running and empty ones do not", async () => {
    const old = NOW - 30 * 24 * HOUR;
    const disk: Disk = new Map([
      [
        "/home/example/.claude/projects/alpha/" + id(1) + ".jsonl",
        {
          harness: "claude",
          text: claude(id(1), "Fix   the\nsynthetic widget", old),
          mtimeMs: old + HOUR,
        },
      ],
      [
        "/home/example/.codex/sessions/2026/10/21/rollout-2026-10-21T09-00-00-" +
          id(2) +
          ".jsonl",
        {
          harness: "codex",
          text: codex(id(2), "Review the storage migration", old),
          mtimeMs: old + 2 * HOUR,
        },
      ],
      [
        "/home/example/.pi/agent/sessions/gamma/2026-10-21_pi-one.jsonl",
        {
          harness: "pi",
          text: pi("pi-one", "Sketch the onboarding copy", old),
          mtimeMs: old + 3 * HOUR,
        },
      ],
      // A Codex subagent is another agent's helper.
      [
        "/home/example/.codex/sessions/2026/10/21/rollout-2026-10-21T09-00-00-" +
          id(3) +
          ".jsonl",
        {
          harness: "codex",
          text: codex(id(3), "Helper", old, { subagent: "review" }),
          mtimeMs: old,
        },
      ],
      // Written a minute ago: it may still be running.
      [
        "/home/example/.claude/projects/alpha/" + id(4) + ".jsonl",
        {
          harness: "claude",
          text: claude(id(4), "Busy", NOW - HOUR),
          mtimeMs: NOW - 60_000,
        },
      ],
      // Running at a desk now.
      [
        "/home/example/.claude/projects/alpha/" + id(5) + ".jsonl",
        {
          harness: "claude",
          text: claude(id(5), "Running", old),
          mtimeMs: old,
        },
      ],
      // No conversation in it.
      [
        "/home/example/.claude/projects/alpha/" + id(6) + ".jsonl",
        {
          harness: "claude",
          text: jsonl([{ type: "summary", summary: "x" }]),
          mtimeMs: old,
        },
      ],
    ]);
    const { apartments, census, reads } = world(disk);
    apartments.fresh(
      "local",
      1,
      [
        {
          pane_id: "p1",
          terminal_id: "t1",
          agent: "claude",
          agent_session: { kind: "id", value: id(5) },
        },
      ],
      NOW,
      [],
    );
    census.request("local");
    await census.settled();
    const residents = apartments.list().residents;
    expect(residents.map((item) => item.session_id).sort()).toEqual(
      [id(1), id(2), "pi-one"].sort(),
    );
    expect(residents.find((item) => item.harness === "claude")).toMatchObject({
      name: "claude",
      cwd: "/srv/example/project-alpha",
      connection_id: "local",
      connection_label: "host local",
      runtime: "herdr-core",
      terminal_id: `session:${id(1)}`,
      first_seen_at: old,
      moved_out_at: old + HOUR,
      move_out: "found",
      summary: "Fix the synthetic widget",
      room: null,
      tab: null,
      links: [],
    });
    expect(residents.find((item) => item.harness === "codex")).toMatchObject({
      cwd: "/srv/example/project-beta",
      summary: "Review the storage migration",
    });
    expect(residents.find((item) => item.harness === "pi")).toMatchObject({
      cwd: "/srv/example/project-gamma",
      summary: "Sketch the onboarding copy",
    });
    // The recent file is not read at all.
    expect(reads.some((path) => path.includes(id(4)))).toBe(false);
  });

  test("a resident whose session runs again is hidden until it stops", async () => {
    const old = NOW - 24 * HOUR;
    const path = `/home/example/.claude/projects/alpha/${id(7)}.jsonl`;
    const disk: Disk = new Map([
      [
        path,
        {
          harness: "claude",
          text: claude(id(7), "Resume me", old),
          mtimeMs: old,
        },
      ],
    ]);
    const { apartments, census } = world(disk);
    census.request("local");
    await census.settled();
    expect(apartments.list().residents).toHaveLength(1);
    const before = apartments.list().revision;
    const running = {
      pane_id: "p1",
      terminal_id: "t1",
      agent: "claude",
      agent_session: { kind: "id", value: id(7) },
    };
    apartments.fresh("local", 1, [running], NOW, []);
    expect(apartments.list().residents).toEqual([]);
    expect(apartments.list().revision).toBeGreaterThan(before);
    apartments.complete("local", 1, []);
    await apartments.settled();
    // Its end was seen: it lives here again, ended, once.
    expect(apartments.list().residents).toMatchObject([
      { session_id: id(7), move_out: "ended" },
    ]);
  });

  test("a host is looked through again only when due; a transcript is read once and evictions stay", async () => {
    const old = NOW - 24 * HOUR;
    const path = `/home/example/.claude/projects/alpha/${id(8)}.jsonl`;
    const gone = `/home/example/.claude/projects/alpha/${id(9)}.jsonl`;
    const disk: Disk = new Map([
      [
        path,
        {
          harness: "claude",
          text: claude(id(8), "Keep me", old),
          mtimeMs: old,
        },
      ],
      [
        gone,
        {
          harness: "claude",
          text: claude(id(9), "Evict me", old),
          mtimeMs: old,
        },
      ],
    ]);
    const { apartments, census, reads, advance } = world(disk);
    census.request("local");
    await census.settled();
    expect(reads).toHaveLength(2);
    const evicted = apartments
      .list()
      .residents.find((item) => item.session_id === id(9))!;
    await apartments.evict([evicted.id]);
    // Not due yet.
    census.request("local");
    await census.settled();
    expect(reads).toHaveLength(2);
    // Resumed outside World since: the record follows its last write.
    disk.get(path)!.mtimeMs = old + 2 * HOUR;
    advance(CENSUS_INTERVAL_MS + CENSUS_QUIET_MS);
    census.request("local");
    await census.settled();
    expect(apartments.list().residents).toMatchObject([
      { session_id: id(8), moved_out_at: old + 2 * HOUR, summary: "Keep me" },
    ]);
    // The evicted transcript is not read again either.
    expect(reads).toHaveLength(2);
  });

  test("a host without history access, or with none, adds nobody", async () => {
    const { apartments, census } = world(new Map());
    census.request("elsewhere");
    census.request("local");
    await census.settled();
    expect(apartments.list().residents).toEqual([]);
    await census.stop();
    census.request("local");
    await census.settled();
  });
});

describe("an SSH host's histories", () => {
  test("its listing and prefixes parse back", () => {
    expect(
      parseRemoteCensus(
        [
          "@claude",
          `1790000000 120 /home/example/.claude/projects/alpha/${id(1)}.jsonl`,
          "1790000000 120 /home/example/.claude/projects/alpha/notes.txt",
          "@codex",
          `1790000001 300 /home/example/.codex/sessions/2026/10/21/rollout-x-${id(2)}.jsonl.zst`,
          "garbage",
          "@unknown",
          "1790000002 10 /home/example/elsewhere.jsonl",
        ].join("\n"),
      ),
    ).toEqual([
      {
        harness: "claude",
        path: `/home/example/.claude/projects/alpha/${id(1)}.jsonl`,
        mtimeMs: 1_790_000_000_000,
        size: 120,
      },
      {
        harness: "codex",
        path: `/home/example/.codex/sessions/2026/10/21/rollout-x-${id(2)}.jsonl.zst`,
        mtimeMs: 1_790_000_001_000,
        size: 300,
      },
    ]);
    const encoder = new TextEncoder();
    const output = new Uint8Array([
      ...encoder.encode("3\nabc"),
      ...encoder.encode("-1\n"),
      ...encoder.encode("2\n\n\n"),
    ]);
    const read = parseRemotePrefixes(["/a", "/b", "/c"], output);
    expect(new TextDecoder().decode(read.get("/a"))).toBe("abc");
    expect(read.has("/b")).toBe(false);
    expect(new TextDecoder().decode(read.get("/c"))).toBe("\n\n");
    expect(
      remotePrefixesCommand(["/a b"], 10, (value) => `'${value}'`),
    ).toContain("for path in '/a b'; do");
  });
});
