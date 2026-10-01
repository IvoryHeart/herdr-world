import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep browser profiles and Bun WebView files inside one run-owned directory.
// A failed test can skip its own finally block when the runner exits early.
const directory = mkdtempSync(join(tmpdir(), "hwt-"));
try {
  const child = Bun.spawn(
    [process.execPath, "test", ...process.argv.slice(2)],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
      },
    },
  );
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    process.exitCode = await child.exited;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
} finally {
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
