import {
  runStatus,
  type RuntimeStatusPort,
  type AutoSyncRunStatus,
} from "../runtime-status";
/** Inert-runtime unit fixture; real writer/root/crash tests exercise persistence. */
export function memoryRuntimeStatus(
  initial: Record<string, AutoSyncRunStatus> = {},
): RuntimeStatusPort {
  const rows = new Map(Object.entries(structuredClone(initial)));
  let closed = false;
  return {
    get: (key) => {
      const row = rows.get(key);
      return row && structuredClone(row);
    },
    list: () => Object.fromEntries(rows),
    put: async (key, status) => {
      if (closed) throw new Error("closed");
      const saved = runStatus(status);
      rows.set(key, saved);
      return structuredClone(saved);
    },
    close: () => {
      closed = true;
    },
  };
}
