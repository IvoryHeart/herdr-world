import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Run outside the package to avoid dispatching its existing `check` script.
for (const config of [
  "tsconfig.json",
  "web/tsconfig.json",
  "server/tsconfig.json",
]) {
  const child = Bun.spawn([process.execPath, "check", "-p", resolve(config)], {
    cwd: tmpdir(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
