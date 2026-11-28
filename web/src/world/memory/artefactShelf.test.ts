import { afterEach, expect, test } from "bun:test";
import { artefactFixtureShelf } from "./artefactFixture";
import {
  ARTEFACT_SHELF_FRESH_MS,
  artefactShelfState,
  requestArtefactShelf,
  setArtefactShelfClientForTests,
} from "./artefactShelfClient";
import {
  artefactMaker,
  artefactProject,
  artefactReadable,
  madeSummary,
  readerArtefacts,
  searchArtefacts,
} from "./artefactShelfModel";
import { publishMemoryHosts } from "./memoryClient";

afterEach(() => {
  setArtefactShelfClientForTests(null);
  publishMemoryHosts([]);
});

/**
 * Timers scheduled while `body` runs, caught instead of started: the owed
 * read's timer is the code's own, so the test runs it itself.
 */
async function caughtTimers(body: () => Promise<void>) {
  const real = globalThis.setTimeout;
  const caught: (() => void)[] = [];
  globalThis.setTimeout = ((callback: () => void) => {
    caught.push(callback);
    return caught.length;
  }) as unknown as typeof setTimeout;
  try {
    await body();
  } finally {
    globalThis.setTimeout = real;
  }
  return caught;
}

const host = (generation = 1) => ({
  connection_id: "c1",
  connection_generation: generation,
  label: "Laptop",
  names: {},
});
const shelf = artefactFixtureShelf(host(), Date.parse("2026-01-02T00:00:00Z"));
const titles = (list: readonly { title: string }[]) =>
  list.map((one) => one.title);

test("readers pick an agent's or a room's artefacts, everything by default", () => {
  const list = shelf.artefacts;
  expect(readerArtefacts(list, { kind: "all" })).toHaveLength(5);
  expect(titles(readerArtefacts(list, { kind: "agent", id: "p3" }))).toEqual([
    "docs.example.com/guide",
    "draft-plan.md",
  ]);
  expect(titles(readerArtefacts(list, { kind: "project", id: "w1" }))).toEqual([
    "release-report.md",
    "example/web-app#12",
    "architecture.png",
  ]);
});

test("the maker is World's name, a gone agent's name as it was, or the harness", () => {
  const [report, , guess, , gone] = shelf.artefacts;
  expect(artefactMaker(report!, { p1: "builder" })).toBe("builder");
  expect(artefactMaker(guess!, {})).toBe("Codex p3");
  expect(artefactMaker(gone!, { p9: "someone-new" })).toBe("old-designer");
});

test("search matches every word over title, kind, maker, project and place", () => {
  const list = shelf.artefacts;
  const names = { p1: "builder" };
  const project = (id: string | null) => (id === "w2" ? "docs-site" : null);
  const find = (query: string) =>
    titles(searchArtefacts(list, query, names, project));
  expect(find("release")).toEqual(["release-report.md"]);
  expect(find("REPORT builder")).toEqual(["release-report.md"]);
  expect(find("docs-site")).toEqual([
    "docs.example.com/guide",
    "draft-plan.md",
  ]);
  expect(find("pull/12")).toEqual(["example/web-app#12"]);
  expect(find("image old-designer")).toEqual(["architecture.png"]);
  expect(find("release missing")).toEqual([]);
  expect(find("   ")).toEqual([]);
});

test("a gone maker's room is found by its name now, else as it was kept", () => {
  const gone = shelf.artefacts[shelf.artefacts.length - 1]!;
  const moved = {
    ...gone,
    made_by: { ...gone.made_by, workspace_id: null },
    where: { type: "file" as const, path: "/srv/example/diagram.png" },
    gone_room: "Project Alpha",
  };
  const rooms = (id: string | null) => (id === "w1" ? "Renamed room" : null);
  expect(artefactProject(gone, rooms)).toBe("Renamed room");
  expect(artefactProject(moved, rooms)).toBe("Project Alpha");
  expect(titles(searchArtefacts([moved], "project alpha", {}, rooms))).toEqual([
    "architecture.png",
  ]);
});

test("a Made summary counts and names the latest two", () => {
  expect(madeSummary([])).toBeNull();
  expect(madeSummary(undefined)).toBeNull();
  expect(madeSummary(shelf.artefacts)).toEqual({
    count: 5,
    latest: ["release-report.md", "example/web-app#12"],
  });
});

test("the reader shows Markdown, PDFs, images and text files, never links", () => {
  const file = (path: string) => ({ where: { type: "file" as const, path } });
  expect(artefactReadable(file("/w/notes.MD"))).toBe("markdown");
  expect(artefactReadable(file("/w/a.pdf"))).toBe("pdf");
  expect(artefactReadable(file("/w/a.png"))).toBe("image");
  expect(artefactReadable(file("/w/a.csv"))).toBe("text");
  expect(artefactReadable(file("/w/a.zip"))).toBeNull();
  expect(artefactReadable(shelf.artefacts[1]!)).toBeNull();
});

test("a shelf is read once a minute per generation and dropped with it", async () => {
  let calls = 0;
  setArtefactShelfClientForTests({
    list: async (target) => {
      calls += 1;
      return artefactFixtureShelf(target, 0);
    },
    read: () => Promise.reject(new Error("unused")),
  });
  publishMemoryHosts([host(1)]);
  await Promise.all([
    requestArtefactShelf(host(1), { now: 0 }),
    requestArtefactShelf(host(1), { now: 0 }),
  ]);
  expect(calls).toBe(1);
  expect(artefactShelfState(host(1))?.shelf?.artefacts).toHaveLength(5);
  await requestArtefactShelf(host(1), { now: Date.now() });
  expect(calls).toBe(1);
  await requestArtefactShelf(host(1), {
    now: Date.now() + ARTEFACT_SHELF_FRESH_MS,
  });
  expect(calls).toBe(2);
  await requestArtefactShelf(host(1), { force: true });
  expect(calls).toBe(3);

  publishMemoryHosts([host(2)]);
  expect(artefactShelfState(host(1))).toBeNull();
  expect(artefactShelfState(host(2))).toBeNull();
});

test("a request the minute holds back is read once the minute is up", async () => {
  let calls = 0;
  setArtefactShelfClientForTests({
    list: async (target) => {
      calls += 1;
      const shelf = artefactFixtureShelf(target, 0);
      // Empty at first; the report appears after the first read.
      return calls === 1 ? { ...shelf, artefacts: [] } : shelf;
    },
    read: () => Promise.reject(new Error("unused")),
  });
  publishMemoryHosts([host(1)]);
  await requestArtefactShelf(host(1));
  expect(artefactShelfState(host(1))?.shelf?.artefacts).toEqual([]);
  // Chat's turn ends while the shelf is fresh: held back, but owed, once.
  const at = (artefactShelfState(host(1)) as { at: number }).at;
  const almost = at + ARTEFACT_SHELF_FRESH_MS - 5;
  const owed = await caughtTimers(async () => {
    await requestArtefactShelf(host(1), { now: almost });
    await requestArtefactShelf(host(1), { now: almost });
  });
  expect(calls).toBe(1);
  // One owed read for both requests.
  expect(owed).toHaveLength(1);
  owed[0]!();
  await requestArtefactShelf(host(1), { force: true });
  expect(calls).toBe(2);
  expect(artefactShelfState(host(1))?.shelf?.artefacts).toHaveLength(5);
});

test("an owed read is dropped with its generation", async () => {
  let calls = 0;
  setArtefactShelfClientForTests({
    list: async (target) => {
      calls += 1;
      return artefactFixtureShelf(target, 0);
    },
    read: () => Promise.reject(new Error("unused")),
  });
  publishMemoryHosts([host(1)]);
  await requestArtefactShelf(host(1));
  const at = (artefactShelfState(host(1)) as { at: number }).at;
  const owed = await caughtTimers(() =>
    requestArtefactShelf(host(1), { now: at + ARTEFACT_SHELF_FRESH_MS - 5 }),
  );
  expect(owed).toHaveLength(1);
  publishMemoryHosts([host(2)]);
  // The timer comes due after the host's generation went away.
  owed[0]!();
  expect(calls).toBe(1);
});

test("a reply for a generation that went away is dropped", async () => {
  let answer: (() => void) | undefined;
  setArtefactShelfClientForTests({
    list: (target) =>
      new Promise((resolve) => {
        answer = () => resolve(artefactFixtureShelf(target, 0));
      }),
    read: () => Promise.reject(new Error("unused")),
  });
  publishMemoryHosts([host(1)]);
  const job = requestArtefactShelf(host(1));
  publishMemoryHosts([host(2)]);
  answer?.();
  await job;
  publishMemoryHosts([host(1)]);
  expect(artefactShelfState(host(1))?.shelf).toBeUndefined();
});
