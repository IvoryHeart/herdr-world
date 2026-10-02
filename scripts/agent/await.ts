import { closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Keep the child in the foreground. Disk output avoids pipe backpressure and
// unbounded model context; child.exited is an event wait, not a status loop.
const args = process.argv.slice(2);
if (args[0] !== "--log" || !args[1] || args[2] !== "--" || !args[3]) {
  console.error(
    "Usage: bun run agent:await --log <new-log> -- <command> [args...]",
  );
  process.exit(2);
}
const log = resolve(args[1]);
mkdirSync(dirname(log), { recursive: true });
const fd = openSync(log, "wx", 0o600);
const started = Date.now();
try {
  const child = Bun.spawn(args.slice(3), {
    stdin: "inherit",
    stdout: fd,
    stderr: fd,
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const exit = await child.exited;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  const length = fstatSync(fd).size;
  const tail = Buffer.alloc(Math.min(length, 8192));
  // Reopen for reading because the exclusive creation descriptor is write-only.
  const reader = openSync(log, "r");
  try {
    readSync(reader, tail, 0, tail.length, length - tail.length);
  } finally {
    closeSync(reader);
  }
  if (length > tail.length)
    console.log("[output truncated; full output in log]");
  process.stdout.write(tail.toString("utf8"));
  console.log(`\nexit=${exit} elapsed_ms=${Date.now() - started} log=${log}`);
  process.exitCode = exit;
} finally {
  closeSync(fd);
}
