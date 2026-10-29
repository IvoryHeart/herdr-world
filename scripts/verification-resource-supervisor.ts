import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// systemd delegates this unit's subtree. Keep the observer in a sibling of the
// bounded payload so a payload OOM (including a whole-group kill) cannot erase
// its exit notification or resource accounting before the client reads them.
const membership = (await readFile("/proc/self/cgroup", "utf8"))
  .split("\n")
  .find((line) => line.startsWith("0::"))
  ?.slice(3);
assert(membership?.startsWith("/"), "Missing unified cgroup membership");
const base = resolve("/sys/fs/cgroup", `.${membership}`);
const supervisor = resolve(base, "supervisor");
const payload = resolve(base, "payload");
const memoryMaxBytes = Number(process.argv[2]);
const command = process.argv.slice(3);
assert(Number.isSafeInteger(memoryMaxBytes) && memoryMaxBytes > 0);
assert(command.length > 0, "Missing resource command");
const exitFile = process.env.RESOURCE_EXIT_FILE;
assert(exitFile, "Missing resource exit file");

await mkdir(supervisor);
await writeFile(resolve(supervisor, "cgroup.procs"), String(process.pid));
// Enabling controllers requires the delegated unit itself to be process-free.
await writeFile(resolve(base, "cgroup.subtree_control"), "+memory +cpu");
await mkdir(payload);
await writeFile(resolve(payload, "memory.max"), String(memoryMaxBytes));
await writeFile(resolve(payload, "memory.swap.max"), "0");
await writeFile(resolve(payload, "memory.oom.group"), "1");
await writeFile(
  resolve(payload, "cpu.max"),
  await readFile(resolve(base, "cpu.max"), "utf8"),
);
const child = Bun.spawn(
  [
    "/bin/sh",
    "-c",
    // Migrate before exec: the entire command and every descendant inherit the
    // hard limits. A failed migration must never run an unconstrained command.
    'printf "%s\\n" "$$" > "$RESOURCE_PAYLOAD_CGROUP/cgroup.procs" && exec "$@"',
    "resource-payload",
    ...command,
  ],
  {
    env: { ...process.env, RESOURCE_PAYLOAD_CGROUP: payload },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  },
);
const code = await child.exited;
await writeFile(`${exitFile}.tmp`, `${code}\n`);
await rename(`${exitFile}.tmp`, exitFile);
// Retain the delegated subtree until the client records accounting and stops
// the whole service, including its surviving descendants.
setInterval(() => {}, 60000);
