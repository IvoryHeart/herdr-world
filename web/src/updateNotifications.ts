/** Browser-profile and World-origin scoped; separate origins never share this history. */
export function createUpdateNotificationHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const seen = new Set<string>();
  return {
    claim(version: string): boolean {
      const key = `notifiedUpdateVersion:${encodeURIComponent(version)}`;
      try {
        if (storage.getItem(key) === "1") {
          seen.add(version);
          return false;
        }
      } catch {
        // Restricted storage still suppresses repeats for this page lifetime.
      }
      if (seen.has(version)) return false;
      seen.add(version);
      try {
        storage.setItem(key, "1");
      } catch {
        // Reload persistence needs writable browser storage.
      }
      return true;
    },
  };
}
