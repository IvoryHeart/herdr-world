export const TREE_PREFERENCES_KEY = "worldTreePreferences:v1";
const MAX_COLLAPSED_IDS = 2_304;
const MAX_ID_LENGTH = 1_024;

type TreePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type TreePreferences = { collapsedIds: string[] };

export function readTreePreferences(
  storage: TreePreferenceStorage,
): TreePreferences {
  try {
    const raw = storage.getItem(TREE_PREFERENCES_KEY);
    return raw ? parseTreePreferences(JSON.parse(raw)) : { collapsedIds: [] };
  } catch {
    return { collapsedIds: [] };
  }
}

export function writeTreePreferences(
  storage: TreePreferenceStorage,
  preferences: TreePreferences,
) {
  try {
    storage.setItem(
      TREE_PREFERENCES_KEY,
      JSON.stringify(parseTreePreferences(preferences)),
    );
  } catch {
    // Tree disclosure is optional presentation state.
  }
}

export function parseTreePreferences(value: unknown): TreePreferences {
  if (!value || typeof value !== "object") return { collapsedIds: [] };
  const collapsedIds = (value as Record<string, unknown>).collapsedIds;
  return {
    collapsedIds: Array.isArray(collapsedIds)
      ? [
          ...new Set(
            collapsedIds.filter(
              (id): id is string =>
                typeof id === "string" &&
                id.length > 0 &&
                id.length <= MAX_ID_LENGTH,
            ),
          ),
        ].slice(0, MAX_COLLAPSED_IDS)
      : [],
  };
}
