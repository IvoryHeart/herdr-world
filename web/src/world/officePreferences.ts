export type OfficeInspectorPresentation = "docked" | "floating";

export type OfficePreferences = {
  inspectorPresentation: OfficeInspectorPresentation;
  /** Less ambient motion and shorter camera moves in the Office town. */
  calm: boolean;
};

export const DEFAULT_OFFICE_PREFERENCES: OfficePreferences = Object.freeze({
  inspectorPresentation: "floating",
  calm: false,
});

export const OFFICE_PREFERENCES_KEY = "officePreferences:v1";
export const WORLD_OFFICE_PREFERENCES_CHANGED_EVENT =
  "herdr-world:office-preferences-changed";

type OfficePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** Read Office preferences; fields from the retired Pixel Office are ignored. */
export function readOfficePreferences(
  storage: OfficePreferenceStorage,
): OfficePreferences {
  try {
    const raw = storage.getItem(OFFICE_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_OFFICE_PREFERENCES };
    const value = JSON.parse(raw) as Record<string, unknown>;
    return admit(value);
  } catch {
    return { ...DEFAULT_OFFICE_PREFERENCES };
  }
}

export function writeOfficePreferences(
  storage: OfficePreferenceStorage,
  preferences: OfficePreferences,
) {
  const admitted = admit(preferences);
  try {
    storage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(admitted));
  } catch {
    // Presentation preferences must never prevent Office from rendering.
  }
  return admitted;
}

function admit(
  value: Record<string, unknown> | OfficePreferences,
): OfficePreferences {
  const record = value as Record<string, unknown>;
  return {
    inspectorPresentation: isInspectorPresentation(record.inspectorPresentation)
      ? record.inspectorPresentation
      : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
    calm:
      typeof record.calm === "boolean"
        ? record.calm
        : DEFAULT_OFFICE_PREFERENCES.calm,
  };
}

function isInspectorPresentation(
  value: unknown,
): value is OfficeInspectorPresentation {
  return value === "docked" || value === "floating";
}
