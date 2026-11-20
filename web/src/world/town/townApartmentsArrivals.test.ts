import { expect, test } from "bun:test";
import {
  TOWN_ARRIVAL_MS,
  resetTownApartmentsArrivals,
  townApartmentsArrive,
  townApartmentsCount,
  townApartmentsPending,
} from "./townApartmentsArrivals";

const resident = (terminal: string) => ({
  connection_id: "c1",
  terminal_id: terminal,
});
const arrival = (id: string, at: number, demo = false) => ({
  id,
  connection_id: "c1",
  terminal_id: `t-${id}`,
  at,
  demo,
});

test("the sign counts each rider seen walking in until Apartments lists it", () => {
  const residents = [resident("t-old")];
  expect(townApartmentsCount(residents, [], 0)).toBe(1);
  // In at the door: one more, before the service makes it a resident.
  const pending = [arrival("a", 1_000)];
  expect(townApartmentsCount(residents, pending, 1_500)).toBe(2);
  // Listed: counted once, not twice.
  expect(
    townApartmentsCount([...residents, resident("t-a")], pending, 2_000),
  ).toBe(2);
  // Never listed (its close failed): it stops counting after a minute.
  expect(townApartmentsCount(residents, pending, 1_000 + TOWN_ARRIVAL_MS)).toBe(
    1,
  );
  // A demo rider counts until the page reloads.
  expect(
    townApartmentsCount(
      residents,
      [arrival("d", 0, true)],
      10 * TOWN_ARRIVAL_MS,
    ),
  ).toBe(2);
});

test("a rider arrives once however often Town sees it walk in", () => {
  resetTownApartmentsArrivals();
  townApartmentsArrive(arrival("a", 1));
  townApartmentsArrive(arrival("a", 2));
  townApartmentsArrive(arrival("b", 3));
  expect(townApartmentsPending().map((known) => [known.id, known.at])).toEqual([
    ["a", 1],
    ["b", 3],
  ]);
  resetTownApartmentsArrivals();
  expect(townApartmentsPending()).toEqual([]);
});
