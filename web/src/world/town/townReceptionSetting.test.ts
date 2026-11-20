import { expect, test } from "bun:test";
import {
  TOWN_RECEPTION_DEFAULT,
  withTownReceptionMarks,
} from "./townReceptionFilter";
import {
  adoptTownReceptionFilter,
  connectTownReceptionFilter,
  saveTownReceptionFilter,
  townReceptionFilter,
} from "./townReceptionSetting";

test("the reception filter is World's: saved to the service, adopted from other browsers", async () => {
  adoptTownReceptionFilter(null);
  expect(townReceptionFilter()).toEqual(TOWN_RECEPTION_DEFAULT);
  const sent: unknown[] = [];
  connectTownReceptionFilter(async (value) => {
    sent.push(value);
  });
  const doneless = withTownReceptionMarks(TOWN_RECEPTION_DEFAULT, "c1", [
    "blocked",
    "ask",
  ]);
  await saveTownReceptionFilter(doneless);
  expect(sent).toEqual([doneless]);
  expect(townReceptionFilter()).toEqual(doneless);
  // The default is stored as nothing.
  await saveTownReceptionFilter(TOWN_RECEPTION_DEFAULT);
  expect(sent[1]).toBeUndefined();
  // Another browser's change arrives as a push.
  adoptTownReceptionFilter(doneless);
  expect(townReceptionFilter()).toEqual(doneless);
  // A refused write puts back the last saved filter.
  connectTownReceptionFilter(async () => {
    throw new Error("refused");
  });
  await expect(saveTownReceptionFilter(TOWN_RECEPTION_DEFAULT)).rejects.toThrow(
    "refused",
  );
  expect(townReceptionFilter()).toEqual(doneless);
  connectTownReceptionFilter(null);
  await expect(saveTownReceptionFilter(doneless)).rejects.toThrow(
    "Not connected",
  );
});

test("all 24 two-save completion and service-publication schedules fence stale failures", async () => {
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const first = withTownReceptionMarks(TOWN_RECEPTION_DEFAULT, "synthetic-a", [
    "ask",
  ]);
  const second = withTownReceptionMarks(TOWN_RECEPTION_DEFAULT, "synthetic-b", [
    "blocked",
  ]);
  const authoritative = withTownReceptionMarks(
    TOWN_RECEPTION_DEFAULT,
    "synthetic-c",
    ["done"],
  );
  for (const order of orders)
    for (const failureMask of [0, 1, 2, 3]) {
      adoptTownReceptionFilter(null);
      const pending = [
        Promise.withResolvers<void>(),
        Promise.withResolvers<void>(),
      ];
      let request = 0;
      connectTownReceptionFilter(() => pending[request++]!.promise);
      const tasks = [
        saveTownReceptionFilter(first).catch(() => {}),
        saveTownReceptionFilter(second).catch(() => {}),
      ];
      let adopted = false;
      let latestFailed = false;
      for (const event of order) {
        if (event === 2) {
          adopted = true;
          adoptTownReceptionFilter(authoritative);
        } else {
          const fails = (failureMask & (1 << event)) !== 0;
          if (fails)
            pending[event]!.reject(new Error("synthetic save refusal"));
          else pending[event]!.resolve();
          await tasks[event];
          if (event === 1 && fails) latestFailed = true;
        }
        expect(townReceptionFilter()).toEqual(
          adopted
            ? authoritative
            : latestFailed
              ? TOWN_RECEPTION_DEFAULT
              : second,
        );
      }
    }
  connectTownReceptionFilter(null);
  adoptTownReceptionFilter(null);
});
