/**
 * World's view preferences that outlived the Pixel Office. The storage key is
 * kept so choices saved before Office was retired still apply; fields that
 * only Office used are ignored and dropped on the next write.
 */
import {
  TOWN_QUIET_DEFAULT_MINUTES,
  townQuietMinutes,
} from "./town/townQuietWork";

export type OfficeInspectorPresentation = "docked" | "floating";

/** What opening an agent shows in Town, Board and Desk (the Agents open setting). */
export type TownOpens = "chat" | "terminal";

/** Town's buildings: one per host (machine), or one per runtime (#1047). */
export type TownBuildings = "host" | "runtime";

/** Rooms per row in a Town building: Auto keeps each one about square (#1188). */
export type TownRoomsPerRow = "auto" | 2 | 3 | 4 | 5;

export type OfficePreferences = {
  inspectorPresentation: OfficeInspectorPresentation;
  /** Less ambient motion and shorter camera moves in Town. */
  townCalm: boolean;
  townOpens: TownOpens;
  /** A building per host holding every runtime's rooms, or one per runtime. */
  townBuildings: TownBuildings;
  /** Rooms per row in each building; Auto follows its rooms and the view. */
  townRoomsPerRow: TownRoomsPerRow;
  /** The Town Master greets each visit (Show this on start). */
  townGreeting: boolean;
  /** The tab title and app icon show the Needs you count (this browser). */
  tabBadge: boolean;
  /**
   * Minutes a working agent's session may stay still before Town marks it
   * quiet (townQuietWork.ts); 0 turns the mark off.
   */
  townQuietMinutes: number;
};

export const DEFAULT_OFFICE_PREFERENCES: OfficePreferences = Object.freeze({
  // Town's chat docks right by default (owner decision, 2026-10-22).
  inspectorPresentation: "docked",
  townCalm: false,
  townOpens: "chat",
  // One building per machine: hosts are machines, runtimes are what they run (#1047).
  townBuildings: "host",
  townRoomsPerRow: "auto",
  townGreeting: true,
  tabBadge: true,
  townQuietMinutes: TOWN_QUIET_DEFAULT_MINUTES,
});

export const OFFICE_PREFERENCES_KEY = "officePreferences:v1";
export const WORLD_OFFICE_PREFERENCES_CHANGED_EVENT =
  "herdr-world:office-preferences-changed";

type OfficePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readOfficePreferences(
  storage: OfficePreferenceStorage,
): OfficePreferences {
  try {
    const raw = storage.getItem(OFFICE_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_OFFICE_PREFERENCES };
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      inspectorPresentation: isInspectorPresentation(
        value.inspectorPresentation,
      )
        ? value.inspectorPresentation
        : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
      townCalm: value.townCalm === true,
      townOpens: value.townOpens === "terminal" ? "terminal" : "chat",
      townBuildings: value.townBuildings === "runtime" ? "runtime" : "host",
      townRoomsPerRow: townRoomsPerRow(value.townRoomsPerRow),
      townGreeting: value.townGreeting !== false,
      tabBadge: value.tabBadge !== false,
      townQuietMinutes: townQuietMinutes(value.townQuietMinutes),
    };
  } catch {
    return { ...DEFAULT_OFFICE_PREFERENCES };
  }
}

export function writeOfficePreferences(
  storage: OfficePreferenceStorage,
  preferences: OfficePreferences,
) {
  const admitted: OfficePreferences = {
    inspectorPresentation: isInspectorPresentation(
      preferences.inspectorPresentation,
    )
      ? preferences.inspectorPresentation
      : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
    townCalm: preferences.townCalm === true,
    townOpens: preferences.townOpens === "terminal" ? "terminal" : "chat",
    townBuildings: preferences.townBuildings === "runtime" ? "runtime" : "host",
    townRoomsPerRow: townRoomsPerRow(preferences.townRoomsPerRow),
    townGreeting: preferences.townGreeting !== false,
    tabBadge: preferences.tabBadge !== false,
    townQuietMinutes: townQuietMinutes(preferences.townQuietMinutes),
  };
  try {
    storage.setItem(
      OFFICE_PREFERENCES_KEY,
      JSON.stringify({
        ...admitted,
        // Preserve a pending legacy name until the synced role migration consumes it.
        ...legacyTownMaster(storage),
      }),
    );
  } catch {
    // Presentation preferences must never prevent World from rendering.
  }
  return admitted;
}

/** A saved Rooms per row, or Auto for anything else. */
export function townRoomsPerRow(value: unknown): TownRoomsPerRow {
  return value === 2 || value === 3 || value === 4 || value === 5
    ? value
    : "auto";
}

function isInspectorPresentation(
  value: unknown,
): value is OfficeInspectorPresentation {
  return value === "docked" || value === "floating";
}

/** Only the migration reads this retired preference; it has no default. */
export function legacyTownMaster(storage: OfficePreferenceStorage): {
  townMaster?: unknown;
} {
  try {
    const raw = JSON.parse(storage.getItem(OFFICE_PREFERENCES_KEY) ?? "null");
    return raw && Object.prototype.hasOwnProperty.call(raw, "townMaster")
      ? { townMaster: raw.townMaster }
      : {};
  } catch {
    return {};
  }
}

/** Consume before sending: an uncertain write must never replay after reload. */
export function forgetLegacyTownMaster(
  storage: OfficePreferenceStorage,
): boolean {
  try {
    const raw = JSON.parse(storage.getItem(OFFICE_PREFERENCES_KEY) ?? "null");
    if (raw && Object.prototype.hasOwnProperty.call(raw, "townMaster")) {
      delete raw.townMaster;
      storage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(raw));
    }
    return true;
  } catch {
    return false;
  }
}
