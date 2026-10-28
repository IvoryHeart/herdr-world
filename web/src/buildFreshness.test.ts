import { afterEach, expect, mock, test } from "bun:test";
import {
  __resetBuildFreshnessForTests,
  buildFingerprint,
  checkServedBuild,
  currentBuildFreshness,
  entryScriptSrc,
  fetchServedBuildFingerprint,
  isStaleBuild,
  loadedBuildFingerprint,
  subscribeBuildFreshness,
} from "./buildFreshness";

const servedHtml = (entry: string) => `<!doctype html>
<html><head>
<script>// inline theme bootstrap</script>
<script type="module" crossorigin src="/assets/${entry}.js"></script>
<link rel="modulepreload" crossorigin href="/assets/bridge-client-a1.js">
</head><body><div id="root"></div></body></html>`;

const htmlResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    headers: { "content-type": "text/html" },
    ...init,
  });

const documentWithEntry = (src: string | null) => ({
  querySelector: (selector: string) =>
    selector === 'script[type="module"][src]' && src
      ? { getAttribute: (name: string) => (name === "src" ? src : null) }
      : null,
});

afterEach(() => {
  __resetBuildFreshnessForTests();
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
});

test("the fingerprint is the entry file name without its extension", () => {
  expect(buildFingerprint("/assets/index-DkL2a9xQ.js")).toBe("index-DkL2a9xQ");
  expect(buildFingerprint("/assets/index-DkL2a9xQ.js?v=1#x")).toBe(
    "index-DkL2a9xQ",
  );
  expect(buildFingerprint("/src/main.tsx")).toBe("main");
  expect(buildFingerprint("")).toBeNull();
  expect(buildFingerprint(null)).toBeNull();
});

test("the entry is the first module script with a src", () => {
  expect(entryScriptSrc(servedHtml("index-B1"))).toBe("/assets/index-B1.js");
  expect(
    entryScriptSrc(
      `<script type=module>inline()</script><script src='/x.js' type='module'></script>`,
    ),
  ).toBe("/x.js");
  expect(entryScriptSrc("<p>Sign in</p>")).toBeNull();
});

test("the loaded build comes from the tab's own entry script", () => {
  expect(loadedBuildFingerprint(documentWithEntry("/assets/index-A1.js"))).toBe(
    "index-A1",
  );
  expect(loadedBuildFingerprint(documentWithEntry(null))).toBeNull();
  expect(loadedBuildFingerprint(undefined)).toBeNull();
});

test("the served build is read from a non-cacheable entry document", async () => {
  const fetchImpl = mock<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async () => htmlResponse(servedHtml("index-B1")));
  expect(
    await fetchServedBuildFingerprint(fetchImpl as unknown as typeof fetch),
  ).toBe("index-B1");
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(url).toStartWith("/index.html?build=");
  expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
});

test("a failed, redirected or unreachable entry is not a build", async () => {
  const failed = async () => htmlResponse("unauthorized", { status: 401 });
  expect(
    await fetchServedBuildFingerprint(failed as unknown as typeof fetch),
  ).toBeNull();

  const redirected = async () => {
    const response = htmlResponse(servedHtml("index-login"));
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  };
  expect(
    await fetchServedBuildFingerprint(redirected as unknown as typeof fetch),
  ).toBeNull();

  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  expect(
    await fetchServedBuildFingerprint(offline as unknown as typeof fetch),
  ).toBeNull();
});

test("only two known, different builds are stale", () => {
  expect(isStaleBuild({ loaded: "index-A1", served: "index-B1" })).toBe(true);
  expect(isStaleBuild({ loaded: "index-A1", served: "index-A1" })).toBe(false);
  expect(isStaleBuild({ loaded: "index-A1", served: null })).toBe(false);
  expect(isStaleBuild({ loaded: null, served: "index-B1" })).toBe(false);
});

test("checks report a newer served build and keep it through a failed check", async () => {
  const listeners = new Map<string, () => void>();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      ...documentWithEntry("/assets/index-A1.js"),
      visibilityState: "hidden",
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
  let changes = 0;
  const unsubscribe = subscribeBuildFreshness(() => (changes += 1));
  expect(listeners.has("visibilitychange")).toBe(true);
  const serve = (entry: string | null) => async () =>
    entry === null
      ? htmlResponse("down", { status: 502 })
      : htmlResponse(servedHtml(entry));

  await checkServedBuild(serve("index-A1") as unknown as typeof fetch);
  expect(currentBuildFreshness()).toEqual({
    loaded: "index-A1",
    served: "index-A1",
  });
  const sameBuildChanges = changes;
  await checkServedBuild(serve("index-B1") as unknown as typeof fetch);
  expect(changes).toBe(sameBuildChanges + 1);
  expect(isStaleBuild(currentBuildFreshness())).toBe(true);
  await checkServedBuild(serve(null) as unknown as typeof fetch);
  expect(changes).toBe(sameBuildChanges + 1);
  expect(currentBuildFreshness().served).toBe("index-B1");

  unsubscribe();
  expect(listeners.has("visibilitychange")).toBe(false);
});
