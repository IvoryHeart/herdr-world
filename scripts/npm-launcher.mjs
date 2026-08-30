#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const SUPPORTED_PLATFORMS = {
  "linux-x64": "linux-x64",
  "darwin-arm64": "macos-arm64",
  "darwin-x64": "macos-x64",
};

export function parseGlibcVersion(value) {
  const match = typeof value === "string" ? value.match(/^(\d+)\.(\d+)$/) : null;
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

function compareVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  return left.minor - right.minor;
}

export function selectBridge({
  platform = process.platform,
  arch = process.arch,
  report = process.report,
} = {}) {
  const key = `${platform}-${arch}`;
  const target = SUPPORTED_PLATFORMS[key];
  if (!target) {
    throw new Error(`Herdr World does not support this platform or architecture: ${key}`);
  }

  if (platform !== "linux") return target;

  const glibcValue = report?.getReport?.().header?.glibcVersionRuntime;
  if (typeof glibcValue !== "string") {
    throw new Error("Herdr World requires a detectable glibc runtime on Linux; musl or unknown libc is unsupported");
  }
  const glibc = parseGlibcVersion(glibcValue);
  if (!glibc) {
    throw new Error(`Herdr World could not parse the Linux glibc version: ${glibcValue}`);
  }
  if (compareVersions(glibc, { major: 2, minor: 34 }) < 0) {
    throw new Error(`Herdr World requires glibc 2.34 or newer; found ${glibcValue}`);
  }
  return target;
}

export function packageHelp() {
  return `Usage: herdr-world [OPTIONS]
       herdr-world task-summary [TEXT] [--ttl-ms N] [--pane ID] [--session NAME]
       herdr-world task-summary --clear [--pane ID] [--session NAME]

Starts the Herdr World browser bridge for the selected Herdr session.

The task-summary command reports bounded, expiring harness metadata for the
current Herdr pane without starting the browser bridge.

Options are forwarded to the bridge:
  --host HOST                 Bind address (loopback by default)
  --port PORT                 HTTP port (8787 by default)
  --session NAME              Select a named Herdr session
  --no-herdr-setup            Disable interactive Herdr setup
  -h, --help                  Show this help without starting Herdr or a bridge

The bridge requires Herdr 0.8.2 or newer with terminal protocol 20.
`;
}

export function isHelpRequest(args) {
  return args.includes("-h") || args.includes("--help");
}

export function runPackageLauncher(args = process.argv.slice(2), {
  platform = process.platform,
  arch = process.arch,
  report = process.report,
  packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
} = {}) {
  if (isHelpRequest(args)) {
    process.stdout.write(packageHelp());
    return null;
  }

  const target = selectBridge({ platform, arch, report });
  const bridge = join(packageRoot, "lib", "bridges", target, "herdr-world-bridge");
  const launcher = join(packageRoot, "lib", "herdr-world-launcher.sh");
  const staticDir = join(packageRoot, "share", "herdr-world", "web");
  const child = spawn("/bin/bash", [launcher, ...args], {
    env: {
      ...process.env,
      HERDR_WORLD_BRIDGE_BIN: bridge,
      HERDR_WORLD_STATIC_DIR: staticDir,
    },
    stdio: "inherit",
  });

  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  child.once("error", (error) => {
    console.error(`could not start Herdr World: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      for (const [forwardedSignal, handler] of signalHandlers) {
        process.removeListener(forwardedSignal, handler);
      }
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });
  return child;
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const result = runPackageLauncher();
    if (!result) process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
