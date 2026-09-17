export type OfficeDebugEntry = {
  t: number;
  event: string;
  details?: Record<string, unknown>;
};

declare global {
  interface Window {
    __HERDR_OFFICE_DEBUG_LOG__?: OfficeDebugEntry[];
    __HERDR_OFFICE_DEBUG_CLEAR__?: () => void;
  }
}

const OFFICE_DEBUG_STORAGE_KEY = "herdrWeb.debug.office";
const OFFICE_DEBUG_QUERY_KEY = "officeDebug";
const MAX_OFFICE_DEBUG_ENTRIES = 500;

export function officeDebugEnabled() {
  try {
    if (globalThis.location?.search) {
      const query = new URLSearchParams(globalThis.location.search);
      if (query.get(OFFICE_DEBUG_QUERY_KEY) === "1") {
        return true;
      }
    }
    return globalThis.localStorage?.getItem(OFFICE_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function officeDebug(
  event: string,
  details: Record<string, unknown> = {},
) {
  if (!officeDebugEnabled() || typeof window === "undefined") {
    return;
  }
  const entry: OfficeDebugEntry = {
    t: Math.round(globalThis.performance?.now?.() ?? 0),
    event,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
  const log = window.__HERDR_OFFICE_DEBUG_LOG__ ?? [];
  log.push(entry);
  if (log.length > MAX_OFFICE_DEBUG_ENTRIES) {
    log.splice(0, log.length - MAX_OFFICE_DEBUG_ENTRIES);
  }
  window.__HERDR_OFFICE_DEBUG_LOG__ = log;
  window.__HERDR_OFFICE_DEBUG_CLEAR__ = () => {
    window.__HERDR_OFFICE_DEBUG_LOG__ = [];
  };
  console.info("[office-debug]", JSON.stringify(entry));
}
