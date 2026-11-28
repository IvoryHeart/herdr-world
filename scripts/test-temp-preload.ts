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
const deadlineModule = new URL("./testing/file-deadline.ts", import.meta.url)
  .pathname;
plugin({
  name: "test-file-deadline",
  setup(build) {
    build.onLoad({ filter: /\.(?:test|spec)\.[cm]?[jt]sx?$/ }, ({ path }) => ({
      contents: `import { afterAll as __fileDeadlineAfterAll } from "bun:test"; import { fileDeadline as __startFileDeadline } from ${JSON.stringify(deadlineModule)}; const __clearFileDeadline = __startFileDeadline(${JSON.stringify(path)});\n${readFileSync(path, "utf8")}\n__fileDeadlineAfterAll(__clearFileDeadline);`,
      loader: path.endsWith("x") ? "tsx" : "ts",
    }));
  },
});
