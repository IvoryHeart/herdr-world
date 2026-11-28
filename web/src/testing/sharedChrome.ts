import { afterAll } from "bun:test";
import {
  type BrowserConnection,
  type ChromePage,
  chromeBinary,
  connectBrowser,
  launchChrome,
  type LaunchedChrome,
  openPage,
  type PageOptions,
  sharedChromeEndpoints,
} from "./chromeBrowser";

export { chromeBinary, type ChromePage, type PageOptions };

/**
 * The browser a test file's cases open their pages in: a runner's shared
 * Chrome (`HERDR_TEST_CHROME_WS`: one per job, or one per four CPUs), or,
 * for a file run on its own, one Chrome for this test process. Each case gets its own browser
 * context and page (`chromeBrowser.ts`), so cases stay isolated while sharing
 * the browser's start-up cost.
 */
type Shared = {
  browser: BrowserConnection;
  exited: Promise<never>;
  own?: LaunchedChrome;
};

const browsers = new Map<string, Promise<Shared>>();

// Pages take the runner's Chromes in turn, each worker from its own offset
// (Bun numbers `--parallel` workers from 1 in `BUN_TEST_WORKER_ID`).
let nextShared = Math.max(0, Number(Bun.env.BUN_TEST_WORKER_ID) - 1 || 0);

async function start(
  launchFlags: readonly string[],
  endpoint: string | undefined,
): Promise<Shared> {
  const own = endpoint ? undefined : await launchChrome(launchFlags);
  const browser = await connectBrowser(endpoint ?? own!.endpoint);
  const exited = (
    own
      ? own.child.exited.then((code) => `Browser exited (${code})`)
      : browser.closed.then(() => "The shared test browser went away")
  ).then((reason) => {
    throw new Error(`${reason}: ${own?.log() ?? ""}`);
  });
  exited.catch(() => {});
  return { browser, exited, own };
}

afterAll(async () => {
  const all = [...browsers.values()];
  browsers.clear();
  for (const started of all) {
    const shared = await started.catch(() => undefined);
    if (!shared) continue;
    shared.browser.close();
    await shared.own?.stop();
  }
});

/**
 * Open an isolated page. `launchFlags` are for the rare launch-level need no
 * emulation covers (`--blink-settings` pointer types): those cases get a
 * Chrome of their own, one per distinct set, for this process.
 */
export async function openChromePage(
  options: PageOptions & { launchFlags?: readonly string[] } = {},
): Promise<ChromePage> {
  const flags = options.launchFlags ?? [];
  const endpoints = flags.length ? [] : sharedChromeEndpoints();
  const endpoint = endpoints.length
    ? endpoints[nextShared++ % endpoints.length]
    : undefined;
  const key = endpoint ?? flags.join(" ");
  let started = browsers.get(key);
  if (!started) {
    started = start(flags, endpoint);
    browsers.set(key, started);
    started.catch(() => browsers.delete(key));
  }
  const shared = await started;
  const page = await openPage(shared.browser, shared.exited, options);
  return endpoint ? Object.assign(page, { sharedEndpoint: endpoint }) : page;
}
