// HOME must be set before Bun starts: os.homedir() is cached.
// The wrapper reads the durable tripwire log after the process exits, so a
// caught error still fails the run without poisoning unrelated file teardown.
import { ISOLATION } from "./test-isolation";
import "./test-process-preload";
import { relative } from "node:path";
import { afterAll, beforeAll } from "bun:test";
import {
  FILE_TIMEOUT_EXIT,
  fileLimitMs,
  fileWatchdog,
} from "./test-file-timeout";

if (!process.env[ISOLATION])
  throw new Error(
    "Use bun run test <files>; direct bun test cannot isolate Bun's cached home",
  );

// Every file has a hard limit that names it (test-file-timeout.ts). The real
// timers are taken here, before any test file installs a fake clock.
const watchdog = fileWatchdog({
  current: () => relative(process.cwd(), Bun.main),
  limitFor: (file) => fileLimitMs(file, process.env),
  timers: {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis) as never,
  },
  stop: (message) => {
    console.error(message);
    process.exit(FILE_TIMEOUT_EXIT);
  },
});
watchdog.finish();
beforeAll(watchdog.start);
afterAll(watchdog.finish);
