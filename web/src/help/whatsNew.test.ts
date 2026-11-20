import { expect, test } from "bun:test";
import type { HelpEntry } from "./helpEntry";
import {
  markHelpSeen,
  newestHelpVersion,
  readHelpSeen,
  takeWhatsNewSwitch,
  whatsNew,
} from "./whatsNew";

const entry = (id: string, since: string, firstRun?: number): HelpEntry => ({
  id,
  title: id,
  summary: `${id} summary`,
  steps: ["Press it."],
  place: "town",
  where: "Town",
  control: id,
  since,
  picture: { scene: "town" },
  firstRun,
});
const entries = [
  entry("town.old", "0.2.5", 2),
  entry("town.mid", "0.3.0"),
  entry("town.new", "0.3.10", 1),
  entry("town.newer", "0.3.9"),
];

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("a new user gets the first-run path in order", () => {
  expect(whatsNew(null, false, entries)).toEqual({
    kind: "start",
    entries: [entries[2], entries[0]],
  });
});

test("a returning user sees what is newer than the last version shown, newest first", () => {
  expect(whatsNew("0.2.5", true, entries)?.entries.map((e) => e.id)).toEqual([
    "town.new",
    "town.newer",
    "town.mid",
  ]);
  expect(whatsNew("0.3.10", true, entries)).toBeNull();
  // Shown nothing yet in this browser but been here before: the newest release.
  expect(whatsNew(null, true, entries)?.entries.map((e) => e.id)).toEqual([
    "town.new",
  ]);
});

test("closing the greeting marks the newest version seen", () => {
  const storage = memory();
  expect(newestHelpVersion(entries)).toBe("0.3.10");
  markHelpSeen(storage, entries);
  expect(readHelpSeen(storage)).toBe("0.3.10");
  expect(readHelpSeen(memory({ "help.seen": "junk" }))).toBeNull();
});

test("the testing switch sets what was seen and leaves the address at once", () => {
  const storage = memory({ "help.seen": "0.3.10" });
  const replaced: string[] = [];
  const history = {
    state: null,
    replaceState: (_: unknown, __: string, url?: string | URL | null) =>
      void replaced.push(String(url)),
  };
  expect(
    takeWhatsNewSwitch(
      storage,
      { href: "http://world.example.test/town?whatsNewSince=0.3.0&x=1#a" },
      history,
    ),
  ).toEqual({ returning: true });
  expect(replaced).toEqual(["/town?x=1#a"]);
  expect(storage.values.get("help.seen")).toBe("0.3.0");
  expect(
    takeWhatsNewSwitch(
      storage,
      { href: "http://world.example.test/?whatsNewSince=new" },
      history,
    ),
  ).toEqual({ returning: false });
  expect(storage.values.has("help.seen")).toBe(false);
  expect(
    takeWhatsNewSwitch(
      storage,
      { href: "http://world.example.test/town" },
      history,
    ),
  ).toBeNull();
  expect(replaced).toHaveLength(2);
});
