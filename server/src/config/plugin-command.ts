import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { readAuthToken } from "./auth-token";
import { browserUrlFor, withLoginToken } from "./server-config";
import { prepareServiceAccess } from "./service-manager";
import { resolveServicePlatform } from "./service-definitions";
import { dataRoot, assertSafeDataPath } from "./data-paths";

function capture(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  return {
    code: result.status ?? 1,
    out: result.stdout ?? "",
    err: result.error?.message ?? result.stderr ?? "",
  };
}

/** The managed service's environment file folder, whatever this process's HERDR_WORLD_DATA_DIR. */
function configDir(): string {
  return dataRoot(homedir(), process.platform, process.env.APPDATA, {});
}

// URL/status are read-only and never consult another product's storage.
function readableConfigFile(dir: string, name: string): string {
  const path = join(dir, name);
  assertSafeDataPath(path);
  return path;
}

// Mirrors the server's service env parser: leading whitespace, an optional
// `export` prefix, whitespace around `=`, and optionally quoted values; the
// last occurrence wins.
export function readServiceEnv(
  contents: string,
  name: string,
): string | undefined {
  let value: string | undefined;
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(
      new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`),
    );
    if (!match) continue;
    const raw = match[1] ?? "";
    value =
      raw.length >= 2 &&
      (raw.startsWith("'") || raw.startsWith('"')) &&
      raw.at(-1) === raw[0]
        ? raw.slice(1, -1)
        : raw;
  }
  return value;
}

export function computeUrl(dir = configDir()): string {
  const envFile = readableConfigFile(dir, "herdr-world.env");
  const contents = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const access = prepareServiceAccess(
    envFile,
    contents,
    resolveServicePlatform(process.platform),
    homedir(),
  );
  let url = browserUrlFor(access.host, access.port, access.tls);
  // The service's own token, which its HERDR_WORLD_DATA_DIR may move.
  const tokenPath = access.tokenPath!;
  assertSafeDataPath(tokenPath);
  if (!access.usesFixedPassword && existsSync(tokenPath)) {
    // Match the managed URL command: invalid credentials are never published.
    try {
      url = withLoginToken(url, readAuthToken(tokenPath));
    } catch {
      // The URL remains useful for repairing the managed service's credentials.
    }
  }
  return url;
}

function printUrl(): number {
  const envFile = readableConfigFile(configDir(), "herdr-world.env");
  if (!existsSync(envFile)) {
    console.error(
      `herdr-world plugin: no service environment at ${envFile}, showing defaults`,
    );
  }
  console.log(computeUrl());
  return 0;
}

function statusText(binary: string): string {
  const result = capture(binary, ["service", "status"]);
  if (result.code !== 0) return "not installed";
  return result.out.trim().split("\n")[0]?.trim() || "installed";
}

function panel(binary: string, version: string): Promise<number> {
  if (!process.stdin.isTTY) {
    console.log(`Status:  ${statusText(binary)}`);
    console.log(`URL:     ${computeUrl()}`);
    console.log(`Version: herdr-world ${version}`);
    return Promise.resolve(0);
  }
  const stdin = process.stdin;
  return new Promise((resolve) => {
    let done = false;
    function render(message = "") {
      const lines = [
        "Herdr World",
        "",
        `Status:  ${statusText(binary)}`,
        `URL:     ${computeUrl()}`,
        `Version: herdr-world ${version}`,
        "",
        "[s] start  [r] restart  [u] uninstall  [q] close",
      ];
      if (message) lines.push("", message);
      process.stdout.write(`\x1b[?25l\x1b[2J\x1b[H${lines.join("\r\n")}\r\n`);
    }
    const cleanup = () => {
      if (done) return;
      done = true;
      process.stdout.write("\x1b[?25h\x1b[0m\n");
      stdin.setRawMode(false);
      stdin.pause();
      resolve(0);
    };
    // Restore the terminal when the host closes or signals the panel.
    stdin.on("end", cleanup);
    stdin.on("close", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (chunk: Buffer) => {
      const key = chunk.toString("utf8");
      if (key === "q" || key === "\x03") return cleanup();
      const args =
        key === "s"
          ? ["install", "--force"]
          : key === "r"
            ? ["install"]
            : key === "u"
              ? ["uninstall"]
              : null;
      if (!args || done) return;
      render("working...");
      const result = capture(binary, ["service", ...args]);
      const detail = (result.err || result.out).trim().split("\n").pop() ?? "";
      render(
        result.code === 0 ? "done" : `failed (exit ${result.code}): ${detail}`,
      );
    });
    render();
  });
}

export async function runPluginCommand(
  args: string[],
  version: string,
  binary = process.execPath,
): Promise<number | null> {
  // Existing Herdr installations cache this filename and direct verb argv.
  // Keep the native binary usable as their compatibility launcher, while all
  // service installation records the canonical executable for update ownership.
  if (basename(binary).toLowerCase() === "herdr-world-plugin.exe") {
    if (
      args.length === 1 &&
      [
        "start",
        "restart",
        "status",
        "url",
        "version",
        "uninstall",
        "panel",
      ].includes(args[0]!)
    ) {
      args = ["plugin", ...args];
    }
    binary = join(
      dirname(binary),
      process.platform === "win32" ? "herdr-world.exe" : "herdr-world",
    );
  }
  if (args[0] !== "plugin") return null;
  if (args.length === 2) {
    if (args[1] === "version") {
      console.log(`herdr-world ${version}`);
      return 0;
    }
    if (args[1] === "url") return printUrl();
    if (args[1] === "panel") return panel(binary, version);
    const serviceArgs =
      args[1] === "start"
        ? ["install", "--force"]
        : args[1] === "restart"
          ? ["install"]
          : args[1] === "status"
            ? ["status"]
            : args[1] === "uninstall"
              ? ["uninstall"]
              : null;
    if (serviceArgs) {
      const result = spawnSync(binary, ["service", ...serviceArgs], {
        stdio: "inherit",
      });
      if (result.error)
        console.error(`herdr-world plugin: ${result.error.message}`);
      return result.status ?? 1;
    }
  }
  console.error(
    "Usage: herdr-world plugin <start|restart|status|url|version|uninstall|panel>",
  );
  return args.length === 1 || (args.length === 2 && args[1] === "--help")
    ? 0
    : 1;
}
