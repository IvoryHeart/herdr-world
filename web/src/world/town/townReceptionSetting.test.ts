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
