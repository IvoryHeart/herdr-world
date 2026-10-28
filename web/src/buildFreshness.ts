import { useSyncExternalStore } from "react";

// A long-lived tab keeps running the JavaScript it loaded, whatever the server
// serves after a rebuild or upgrade. The hashed entry script names the build:
// the tab's own <script> tag is the loaded build, and the non-cacheable entry
// document says which build the next navigation would load. A difference is
// reported, never acted on: reloading is the operator's choice.

export interface BuildFreshness {
  /** Build this tab is running, or null outside a browser document. */
  loaded: string | null;
  /** Build the server last served, or null before a successful check. */
  served: string | null;
}

/** Re-check while visible; reconnects and refocus check sooner. */
export const BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** "/assets/index-DkL2a9xQ.js" → "index-DkL2a9xQ". */
export function buildFingerprint(src: string | null | undefined) {
  if (!src) return null;
  const file = src.split(/[?#]/u)[0]!.split("/").pop() ?? "";
  return file.replace(/\.[^.]+$/u, "") || null;
}

/** The first module script with a src: Vite's entry chunk in a build. */
export function entryScriptSrc(html: string) {
  for (const tag of html.matchAll(/<script\b[^>]*>/giu)) {
    const attributes = tag[0];
    if (!/\btype\s*=\s*["']?module\b/iu.test(attributes)) continue;
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(
      attributes,
    );
    if (src) return src[1] ?? src[2] ?? src[3] ?? null;
  }
  return null;
}

export function loadedBuildFingerprint(
  doc: Pick<Document, "querySelector"> | undefined = typeof document ===
  "undefined"
    ? undefined
    : document,
) {
  return buildFingerprint(
    doc?.querySelector('script[type="module"][src]')?.getAttribute("src"),
  );
}

/** The served entry document's build, or null when it cannot be read. */
export async function fetchServedBuildFingerprint(
  fetchImpl: typeof fetch = fetch,
) {
  try {
    const response = await fetchImpl(`/index.html?build=${Date.now()}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "text/html" },
    });
    // A login page or proxy error is not a build; keep the last answer.
    if (!response.ok || response.redirected) return null;
    return buildFingerprint(entryScriptSrc(await response.text()));
  } catch {
    return null;
  }
}

export function isStaleBuild({ loaded, served }: BuildFreshness) {
  return loaded !== null && served !== null && loaded !== served;
}

const listeners = new Set<() => void>();
let snapshot: BuildFreshness = { loaded: null, served: null };
let pending: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function publish(next: BuildFreshness) {
  if (next.loaded === snapshot.loaded && next.served === snapshot.served)
    return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Asks the server which build it serves now; concurrent calls share one. */
export function checkServedBuild(
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  pending ??= fetchServedBuildFingerprint(fetchImpl)
    .then((served) => {
      const loaded = loadedBuildFingerprint();
      publish({ loaded, served: served ?? snapshot.served });
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function checkWhenVisible() {
  if (document.visibilityState === "visible") void checkServedBuild();
}

function startChecks() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  publish({ loaded: loadedBuildFingerprint(), served: snapshot.served });
  document.addEventListener("visibilitychange", checkWhenVisible);
  window.addEventListener("online", checkWhenVisible);
  timer = setInterval(checkWhenVisible, BUILD_CHECK_INTERVAL_MS);
  checkWhenVisible();
}

function stopChecks() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", checkWhenVisible);
  window.removeEventListener("online", checkWhenVisible);
  if (timer) clearInterval(timer);
  timer = null;
}

export function subscribeBuildFreshness(listener: () => void) {
  if (listeners.size === 0) startChecks();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopChecks();
  };
}

export function currentBuildFreshness() {
  return snapshot;
}

export function useBuildFreshness() {
  return useSyncExternalStore(
    subscribeBuildFreshness,
    currentBuildFreshness,
    currentBuildFreshness,
  );
}

/** Test hook: forget the module state between cases. */
export function __resetBuildFreshnessForTests() {
  stopChecks();
  listeners.clear();
  snapshot = { loaded: null, served: null };
  pending = null;
}
