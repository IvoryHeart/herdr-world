import { existsSync } from "node:fs";
import {
  resolveServicePaths,
  resolveServicePlatform,
} from "../config/service-definitions";
import {
  type CliContext,
  EXIT_FAILURE,
  parseCommandArgs,
  UsageError,
} from "./command";

/** `herdr-world service logs`: show the managed service's output on every platform. */
export function runServiceLogs(args: string[], context: CliContext): number {
  const { values } = parseCommandArgs(args, {
    follow: { type: "boolean", short: "f" },
    lines: { type: "string", short: "n" },
  });
  const lines = values.lines ?? "100";
  if (!/^[0-9]{1,6}$/.test(lines))
    throw new UsageError("--lines must be a number from 0 to 999999");

  const { runtime } = context;
  const platform = resolveServicePlatform(runtime.platform);
  if (platform === "systemd") {
    return context.runCommand([
      "journalctl",
      "--user",
      "--unit",
      "herdr-world.service",
      "--no-pager",
      "--lines",
      lines,
      ...(values.follow ? ["--follow"] : []),
    ]);
  }
  if (platform === "windows-task") {
    context.error(
      "herdr-world service logs: the Windows scheduled task does not capture output.",
    );
    context.error(
      "Stop the task and run `herdr-world` in a terminal to see its log lines.",
    );
    return EXIT_FAILURE;
  }
  const paths = resolveServicePaths(
    platform,
    runtime.homeDir,
    runtime.appDataDir,
  );
  const files = [paths.stderrLog, paths.stdoutLog].filter(
    (path): path is string => !!path && existsSync(path),
  );
  if (files.length === 0) {
    context.error(
      `herdr-world service logs: no log files yet (${paths.stderrLog}); is the service installed?`,
    );
    return EXIT_FAILURE;
  }
  return context.runCommand([
    "tail",
    "-n",
    lines,
    ...(values.follow ? ["-F"] : []),
    ...files,
  ]);
}
