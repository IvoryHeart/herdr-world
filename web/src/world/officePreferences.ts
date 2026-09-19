export type OfficeRoomAlignment = "left" | "center" | "right";
export type OfficeLongTitleMode = "expand" | "compact";
export type OfficeInspectorPresentation = "docked" | "floating";

export type OfficePreferences = {
  roomAlignment: OfficeRoomAlignment;
  longTitleMode: OfficeLongTitleMode;
  inspectorPresentation: OfficeInspectorPresentation;
  scrollLeft: number;
  scrollTop: number;
};

export const DEFAULT_OFFICE_PREFERENCES: OfficePreferences = Object.freeze({
  roomAlignment: "left",
  longTitleMode: "expand",
  inspectorPresentation: "docked",
  scrollLeft: 0,
  scrollTop: 0,
});

export const OFFICE_PREFERENCES_KEY = "officePreferences:v1";
const MAX_OFFICE_SCROLL = 1_000_000;

type OfficePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readOfficePreferences(
  storage: OfficePreferenceStorage,
): OfficePreferences {
  try {
    const raw = storage.getItem(OFFICE_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_OFFICE_PREFERENCES };
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      roomAlignment: isRoomAlignment(value.roomAlignment)
        ? value.roomAlignment
        : DEFAULT_OFFICE_PREFERENCES.roomAlignment,
      longTitleMode: isLongTitleMode(value.longTitleMode)
        ? value.longTitleMode
        : DEFAULT_OFFICE_PREFERENCES.longTitleMode,
      inspectorPresentation: isInspectorPresentation(
        value.inspectorPresentation,
      )
        ? value.inspectorPresentation
        : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
      scrollLeft: boundedScroll(value.scrollLeft),
      scrollTop: boundedScroll(value.scrollTop),
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
    roomAlignment: isRoomAlignment(preferences.roomAlignment)
      ? preferences.roomAlignment
      : DEFAULT_OFFICE_PREFERENCES.roomAlignment,
    longTitleMode: isLongTitleMode(preferences.longTitleMode)
      ? preferences.longTitleMode
      : DEFAULT_OFFICE_PREFERENCES.longTitleMode,
    inspectorPresentation: isInspectorPresentation(
      preferences.inspectorPresentation,
    )
      ? preferences.inspectorPresentation
      : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
    scrollLeft: boundedScroll(preferences.scrollLeft),
    scrollTop: boundedScroll(preferences.scrollTop),
  };
  try {
    storage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(admitted));
  } catch {
    // Presentation preferences must never prevent Office from rendering.
  }
}

function isRoomAlignment(value: unknown): value is OfficeRoomAlignment {
  return value === "left" || value === "center" || value === "right";
}

function isLongTitleMode(value: unknown): value is OfficeLongTitleMode {
  return value === "expand" || value === "compact";
}

function isInspectorPresentation(
  value: unknown,
): value is OfficeInspectorPresentation {
  return value === "docked" || value === "floating";
}

function boundedScroll(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_OFFICE_SCROLL, Math.max(0, Math.round(value)))
    : 0;
}
