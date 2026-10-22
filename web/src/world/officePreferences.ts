/**
 * World's view preferences that outlived the Pixel Office. The storage key is
 * kept so choices saved before Office was retired still apply; fields that
 * only Office used are ignored and dropped on the next write.
 */
export type OfficeInspectorPresentation = "docked" | "floating";

/** What tapping an agent or its desk in Town opens. */
export type TownOpens = "chat" | "terminal";

export type OfficePreferences = {
  inspectorPresentation: OfficeInspectorPresentation;
  /** Less ambient motion and shorter camera moves in Town. */
  townCalm: boolean;
  townOpens: TownOpens;
};

export const DEFAULT_OFFICE_PREFERENCES: OfficePreferences = Object.freeze({
  inspectorPresentation: "floating",
  townCalm: false,
  townOpens: "chat",
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
  };
  try {
    storage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(admitted));
  } catch {
    // Presentation preferences must never prevent World from rendering.
  }
  return admitted;
}

function isInspectorPresentation(
  value: unknown,
): value is OfficeInspectorPresentation {
  return value === "docked" || value === "floating";
}
