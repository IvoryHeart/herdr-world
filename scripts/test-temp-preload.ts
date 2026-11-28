// HOME must be set before Bun starts: os.homedir() is cached.
// The wrapper reads the durable tripwire log after the process exits, so a
// caught error still fails the run without poisoning unrelated file teardown.
import { ISOLATION } from "./test-isolation";
import "./test-process-preload";

if (!process.env[ISOLATION])
  throw new Error(
    "Use bun run test <files>; direct bun test cannot isolate Bun's cached home",
  );

// Cover module evaluation, hooks and all cases, including a fake-clock deadlock.
// Bun's per-case timeout alone does not bound a whole test file.
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { fileDeadline } from "./testing/file-deadline";
const deadlineModule = new URL("./testing/file-deadline.ts", import.meta.url)
  .pathname;
plugin({
  name: "test-file-deadline",
  setup(build) {
    build.onLoad({ filter: /\.(?:test|spec)\.[cm]?[jt]sx?$/ }, ({ path }) => {
      // Start before static imports or any of this file's evaluation can run.
      fileDeadline(path);
      return {
        // Only the loader publishes a start. A footer preserves source line numbers
        // and registers cleanup without rewriting the marker during evaluation.
        contents: `${readFileSync(path, "utf8")}\n;import { afterAll as __fileDeadlineAfterAll } from "bun:test"; import { clearFileDeadline as __clearFileDeadline } from ${JSON.stringify(deadlineModule)}; __fileDeadlineAfterAll(() => __clearFileDeadline(${JSON.stringify(path)}));`,
        loader: path.endsWith("x") ? "tsx" : "ts",
      };
    });
  },
});
