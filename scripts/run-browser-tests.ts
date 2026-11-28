import assert from "node:assert/strict";
import { join } from "node:path";
import {
  browserSession,
  browserSelectionNeedsChrome,
} from "./testing/browser-session";
import { localTestChrome } from "./test-chrome";
import { acquireCheckSlot, heldEnv } from "./check-lock";
import {
  webBrowserSuites,
  worldBrowserSuites,
  worldPerformanceSuites,
  reportBrowserSuites,
  includesBrowserSuites,
} from "./world-browser-suites";
import { selectedCITests } from "./ci-tests";
import type { ValidationSelection } from "./validation-scope";

// Keep the proven unit runner byte-for-byte unchanged. Browser ownership and
// its prepared assets live outside it, including CI's existing retry wrapper.
const args = process.argv.slice(2);
const ciWeb = args[0]?.match(/^--ci-web=([12]\/2)$/)?.[1];
assert(
  !args.some((arg) => arg.startsWith("--ci-web")) ||
    (ciWeb && args.length === 1),
  "Invalid web CI shard",
);
const selection = ciWeb
  ? (JSON.parse(
      process.env.HERDR_CI_SELECTION || "null",
    ) as ValidationSelection)
  : undefined;
if (ciWeb) assert(selection, "Missing web CI selection");
const files = ciWeb ? selectedCITests(selection!, "web", ciWeb) : args;
const needsChrome =
  process.env.HERDR_TEST_EXCLUDE_WORLD_BROWSER !== "1" &&
  (!ciWeb || files.length > 0) &&
  includesBrowserSuites(files) &&
  browserSelectionNeedsChrome(files, [
    ...worldBrowserSuites,
    ...worldPerformanceSuites,
    ...webBrowserSuites,
    ...reportBrowserSuites,
  ]);
const release = needsChrome
  ? await acquireCheckSlot("browser", { lane: "browser tests" })
  : () => {};
let session: { env: Record<string, string>; close(): Promise<void> } = {
  env: {},
  close: async () => {},
};
try {
  let chrome: string | undefined;
  if (needsChrome) {
    chrome =
      (await localTestChrome()) ||
      Bun.which("google-chrome") ||
      Bun.which("chromium") ||
      (process.platform === "darwin"
        ? Bun.which(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          )
        : undefined) ||
      undefined;
    assert(chrome, "Browser tests require Chrome/Chromium or CHROME_BIN");
    session = await browserSession(chrome, {
      golden: files.some((file) =>
        reportBrowserSuites.includes(file.replace(/^\.\//, "")),
      ),
    });
  }
  const child = Bun.spawn(
    [
      process.execPath,
      ...(ciWeb
        ? [join(import.meta.dir, "ci-web-tests.ts"), ciWeb]
        : [join(import.meta.dir, "run-tests.ts"), ...args]),
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        ...session.env,
        ...(chrome
          ? {
              CHROME_BIN: chrome,
              HERDR_CHROME_WARM: "1",
              ...heldEnv("browser"),
            }
          : {}),
      },
    },
  );
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    process.exitCode = await child.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
} finally {
  await session.close();
  release();
}
