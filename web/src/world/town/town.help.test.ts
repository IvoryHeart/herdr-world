import { expect, test } from "bun:test";
import { scanHelpAnchors } from "../../../../scripts/help-declarations";
import { helpEntry } from "../../help/entries";
import { whatsNew } from "../../help/whatsNew";

test("Apartments ships its help: the sign is its control and it is new after 0.3.5", () => {
  const entry = helpEntry("town.apartments");
  expect(entry?.place).toBe("town");
  expect(entry?.picture.scene).toBe("town");
  expect(
    scanHelpAnchors()
      .get("town.apartments")
      ?.map((anchor) => anchor.file),
  ).toEqual(["web/src/world/town/TownApartments.tsx"]);
  expect(whatsNew("0.3.5", true)?.entries.map((item) => item.id)).toContain(
    "town.apartments",
  );
});
