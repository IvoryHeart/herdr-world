const DATABASE = "herdr-world:foundation-v2:update-notifications";
const STORE = "versions";

/** One read/write transaction arbitrates between independent browsing contexts. */
function claimInDatabase(
  factory: IDBFactory,
  version: string,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    let database: IDBDatabase | undefined;
    let settled = false;
    const finish = (result: boolean | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database?.close();
      resolve(result);
    };
    // A slow persistent transaction must not race a best-effort fallback.
    const timer = setTimeout(() => finish(false), 5000);
    try {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => {
        database = request.result;
        if (settled) {
          database.close();
          return;
        }
        try {
          const transaction = database.transaction(STORE, "readwrite");
          const records = transaction.objectStore(STORE);
          const reading = records.get(version);
          let won = false;
          reading.onsuccess = () => {
            if (reading.result !== undefined) return;
            records.put(true, version);
            won = true;
          };
          transaction.oncomplete = () => finish(won);
          transaction.onabort = () => finish(null);
          transaction.onerror = () => finish(null);
        } catch {
          finish(null);
        }
      };
    } catch {
      finish(null);
    }
  });
}

/** Browser-profile and World-origin scoped; separate origins never share this history. */
export function createUpdateNotificationHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
  databaseFactory = typeof indexedDB === "undefined" ? undefined : indexedDB,
) {
  const seen = new Set<string>();
  return {
    async claim(version: string): Promise<boolean> {
      const key = `notifiedUpdateVersion:${encodeURIComponent(version)}`;
      const alreadyStored = () => {
        try {
          return storage.getItem(key) === "1";
        } catch {
          return false;
        }
      };
      if (seen.has(version) || alreadyStored()) return false;
      const persistent = databaseFactory
        ? await claimInDatabase(databaseFactory, version)
        : null;
      if (persistent === false) {
        seen.add(version);
        return false;
      }
      // Persistent storage can be blocked. This fallback cannot arbitrate between
      // windows; it retains the documented best-effort history/page guarantee.
      if (persistent === null && (seen.has(version) || alreadyStored()))
        return false;
      seen.add(version);
      try {
        storage.setItem(key, "1");
      } catch {
        /* Without persistent storage, history lasts only for this page. */
      }
      return true;
    },
  };
}
