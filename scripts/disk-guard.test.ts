import { expect, test } from "bun:test";
import { diskSpaceProblems } from "./disk-guard";

const GB = 2 ** 30;
const free = (sizes: Record<string, number>) => (path: string) =>
  sizes[path]! * GB;

test("heavy checks refuse below the free-space floor on the checkout or tmp", () => {
  const sizes = { "/work": 2.5, "/tmp": 10 };
  expect(diskSpaceProblems(["/work", "/tmp"], {}, free(sizes))).toEqual([
    "/work has 2.5 GB free (needs 3 GB)",
  ]);
  expect(
    diskSpaceProblems(["/work", "/tmp"], {}, free({ "/work": 5, "/tmp": 1 })),
  ).toEqual(["/tmp has 1.0 GB free (needs 3 GB)"]);
  expect(
    diskSpaceProblems(["/work", "/tmp"], {}, free({ "/work": 5, "/tmp": 9 })),
  ).toEqual([]);
});

test("the floor is configurable, can be turned off, and CI skips it", () => {
  const low = free({ "/work": 2.5 });
  expect(
    diskSpaceProblems(["/work"], { HERDR_WORLD_MIN_FREE_GB: "2" }, low),
  ).toEqual([]);
  expect(
    diskSpaceProblems(["/work"], { HERDR_WORLD_MIN_FREE_GB: "5" }, low),
  ).toEqual(["/work has 2.5 GB free (needs 5 GB)"]);
  expect(
    diskSpaceProblems(["/work"], { HERDR_WORLD_MIN_FREE_GB: "0" }, low),
  ).toEqual([]);
  expect(diskSpaceProblems(["/work"], { CI: "true" }, low)).toEqual([]);
  // A shared filesystem is reported once.
  expect(diskSpaceProblems(["/work", "/work"], {}, low)).toHaveLength(1);
});
