/**
 * World's view preferences that outlived the Pixel Office. The storage key is
 * kept so choices saved before Office was retired still apply; fields that
 * only Office used are ignored and dropped on the next write.
 */
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
  /**
   * The agent whose chat Town docks on wide screens from the start (the
   * Town's master, FirstMate), by its name; empty docks none.
   */
  townMaster: string;
  /** The Town Master greets each visit (Show this on start). */
  townGreeting: boolean;
  /** The tab title and app icon show the Needs you count (this browser). */
  tabBadge: boolean;
};

export const DEFAULT_OFFICE_PREFERENCES: OfficePreferences = Object.freeze({
  // Town's chat docks right by default (owner decision, 2026-10-22).
  inspectorPresentation: "docked",
  townCalm: false,
  townOpens: "chat",
  // One building per machine: hosts are machines, runtimes are what they run (#1047).
  townBuildings: "host",
  townRoomsPerRow: "auto",
  townMaster: "firstmate",
  townGreeting: true,
  tabBadge: true,
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
      townMaster: townMasterName(value.townMaster),
      townGreeting: value.townGreeting !== false,
      tabBadge: value.tabBadge !== false,
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
    townMaster: townMasterName(preferences.townMaster),
    townGreeting: preferences.townGreeting !== false,
    tabBadge: preferences.tabBadge !== false,
  };
  try {
    storage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(admitted));
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

/** An agent name, at most 64 characters; anything else is the default. */
function townMasterName(value: unknown) {
  return typeof value === "string" && value.length <= 64
    ? value.trim()
    : DEFAULT_OFFICE_PREFERENCES.townMaster;
}
