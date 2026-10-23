import { test } from "bun:test";
import { resolve } from "node:path";
import {
  verifyPostExitCancellation,
  verifyTimeoutAccounting,
} from "./verification-resources";

// The required resource command explicitly selects its systemd manager and runs
// these real-cgroup regressions. Ordinary unit runs report the missing prerequisite.
const manager = Bun.env.HERDR_RESOURCE_MANAGER;
test
  .skipIf(manager !== "user" && manager !== "system")
  .serial.each(["exited", "cleanup"] as const)(
  "post-exit %s cancellation rejects after accounting and descendant cleanup",
  async (boundary) => {
    await verifyPostExitCancellation(
      resolve(import.meta.dir, ".."),
      manager === "system",
      boundary,
    );
  },
  20000,
);

test.skipIf(manager !== "user" && manager !== "system").serial(
  "a run past its deadline is measured, drained and reported as a timeout",
  async () => {
    await verifyTimeoutAccounting(
      resolve(import.meta.dir, ".."),
      manager === "system",
    );
  },
  20000,
);
