import { useSyncExternalStore } from "react";

// A long-lived tab keeps running the JavaScript it loaded, whatever the server
// serves after a rebuild or upgrade. The hashed entry script names the build:
// the tab's own <script> tag is the loaded build, and the non-cacheable entry
// document says which build the next navigation would load. A difference, or a
// lazy chunk the server no longer has, is reported and never acted on:
// reloading replaces open terminals, so it is the operator's choice.

export interface BuildFreshness {
  /** Build this tab is running, or null outside a browser document. */
  loaded: string | null;
  /** Build the server last served, or null before a successful check. */
  served: string | null;
  /** A lazy part of the app failed to load and needs a page reload. */
  reloadNeeded: boolean;
}

export type ReloadOffer =
  | { kind: "build"; loaded: string; served: string }
  | { kind: "chunk" };

/** Re-check while visible; reconnects and refocus check sooner. */
export const BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Bounds the whole entry-document read so a stalled check cannot block the next. */
export const BUILD_CHECK_TIMEOUT_MS = 10 * 1000;

/** "/assets/index-DkL2a9xQ.js" → "index-DkL2a9xQ". */
export function buildFingerprint(src: string | null | undefined) {
  if (!src) return null;
  const file = src.split(/[?#]/u)[0]!.split("/").pop() ?? "";
  return file.replace(/\.[^.]+$/u, "") || null;
}

// The Vite dev server prepends its own client (/@vite/client) to the document.
const isEntrySrc = (src: string) => !src.startsWith("/@");

/** The first module script with an app src: Vite's entry chunk in a build. */
export function entryScriptSrc(html: string) {
  for (const tag of html.matchAll(/<script\b[^>]*>/giu)) {
    const attributes = tag[0];
    if (!/\btype\s*=\s*["']?module\b/iu.test(attributes)) continue;
    const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(
      attributes,
    );
    const src = match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
    if (src && isEntrySrc(src)) return src;
  }
  return null;
}

export function loadedBuildFingerprint(
  doc:
    | {
        querySelectorAll(
          selector: string,
        ): Iterable<Pick<Element, "getAttribute">>;
      }
    | undefined = typeof document === "undefined" ? undefined : document,
) {
  if (!doc) return null;
  for (const script of doc.querySelectorAll('script[type="module"][src]')) {
    const src = script.getAttribute("src");
    if (src && isEntrySrc(src)) return buildFingerprint(src);
  }
  return null;
}

/** The served entry document's build, or null when it cannot be read in time. */
export async function fetchServedBuildFingerprint(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = BUILD_CHECK_TIMEOUT_MS,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const read = async () => {
    try {
      const response = await fetchImpl(`/index.html?build=${Date.now()}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "text/html" },
        signal: controller.signal,
      });
      // A login page or proxy error is not a build; keep the last answer.
      if (!response.ok || response.redirected) return null;
      return buildFingerprint(entryScriptSrc(await response.text()));
    } catch {
      return null;
    }
  };
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function isStaleBuild({ loaded, served }: BuildFreshness) {
  return loaded !== null && served !== null && loaded !== served;
}

/** What to offer: a failed chunk always, a different build unless dismissed. */
export function reloadOffer(
  build: BuildFreshness,
  dismissedServed: string | null,
): ReloadOffer | null {
  if (build.reloadNeeded) return { kind: "chunk" };
  if (!isStaleBuild(build) || build.served === dismissedServed) return null;
  return { kind: "build", loaded: build.loaded!, served: build.served! };
}

const listeners = new Set<() => void>();
const initialSnapshot: BuildFreshness = {
  loaded: null,
  served: null,
  reloadNeeded: false,
};
let snapshot = initialSnapshot;
let pending: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function publish(change: Partial<BuildFreshness>) {
  const next = { ...snapshot, ...change };
  if (
    next.loaded === snapshot.loaded &&
    next.served === snapshot.served &&
    next.reloadNeeded === snapshot.reloadNeeded
  )
    return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Asks the server which build it serves now; concurrent calls share one. */
export function checkServedBuild(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = BUILD_CHECK_TIMEOUT_MS,
): Promise<void> {
  pending ??= fetchServedBuildFingerprint(fetchImpl, timeoutMs)
    .then((served) => {
      publish({
        loaded: loadedBuildFingerprint(),
        served: served ?? snapshot.served,
      });
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** A lazy chunk failed to load: offer a reload instead of taking one. */
export function requestReload() {
  publish({ reloadNeeded: true });
  if (typeof document !== "undefined") void checkServedBuild();
}

/** Later on a failed-chunk offer: hide it until another chunk fails. */
export function dismissReloadRequest() {
  publish({ reloadNeeded: false });
}

function checkWhenVisible() {
  if (document.visibilityState === "visible") void checkServedBuild();
}

function startChecks() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  publish({ loaded: loadedBuildFingerprint() });
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
  snapshot = initialSnapshot;
  pending = null;
}
