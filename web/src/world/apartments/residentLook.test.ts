import { expect, test } from "bun:test";
import { STARTER_PROFILES } from "../../../../shared/agentProfile";
import type { ApartmentResident } from "../../../../shared/apartments";
import { townLookOf } from "../agentProfiles";
import { townLookFor } from "../town/townSprites";
import { fixtureResidents } from "../testing/apartmentsFixture";
import { worldObjectId } from "../worldObject";
import {
  residentLook,
  residentLookNote,
  residentTownKey,
} from "./residentLook";

const residents = new Map(
  fixtureResidents(Date.UTC(2026, 10, 19)).map((resident) => [
    resident.name,
    resident,
  ]),
);
const fixture = (name: string) => residents.get(name)!;
const profiles = { profiles: STARTER_PROFILES };
const look = (id: string) =>
  townLookOf(STARTER_PROFILES.find((profile) => profile.id === id)!.look);

test("a resident's kept look is the character it had in Town", () => {
  expect(residentLook(fixture("ada"), profiles)).toEqual({
    look: look("builder"),
    source: "own",
  });
  // Kept, even when no profiles are loaded or its profile changed since.
  expect(residentLook(fixture("grace"), null)).toEqual({
    look: look("designer"),
    source: "own",
  });
});

test("an agent started without a profile keeps the character Town drew from its key", () => {
  const linus = fixture("linus");
  // Town keys a live agent by its World object ID (officeAgent.ts).
  expect(residentTownKey(linus)).toBe(
    worldObjectId(linus.connection_id, "terminal", linus.terminal_id),
  );
  expect(residentLook(linus, profiles)).toEqual({
    look: townLookFor(residentTownKey(linus)),
    source: "own",
  });
});

test("a look that was not kept falls back to its profile, then its harness, then World's default", () => {
  // Its profile's look now.
  const lovelace = residentLook(fixture("lovelace"), profiles);
  expect(lovelace).toEqual({
    look: look("reviewer"),
    source: "profile",
    profile: "Reviewer",
  });
  expect(residentLookNote(lovelace)).toBe("Avatar from its profile Reviewer");
  // Its profile is gone, and no other profile has its harness: the default.
  expect(
    residentLook(fixture("lovelace"), {
      profiles: STARTER_PROFILES.filter((profile) => profile.id !== "reviewer"),
    }).source,
  ).toBe("default");
  // A resident from before World kept looks: the nearest, by harness.
  const hopper = residentLook(fixture("hopper"), profiles);
  expect(hopper).toEqual({
    look: look("reviewer"),
    source: "harness",
    profile: "Reviewer",
  });
  expect(residentLookNote(hopper)).toBe(
    "Nearest avatar: the Reviewer profile, same harness",
  );
  const claude: ApartmentResident = { ...fixture("hopper"), harness: "claude" };
  expect(residentLook(claude, profiles).profile).toBe("Builder");
  // No profile of its harness (pi), or no harness at all: World's default.
  for (const resident of [
    fixture("turing"),
    { ...fixture("turing"), harness: null },
  ]) {
    const found = residentLook(resident, profiles);
    expect(found).toEqual({
      look: townLookFor(residentTownKey(resident)),
      source: "default",
    });
    expect(residentLookNote(found)).toBe("World's default avatar");
  }
});
