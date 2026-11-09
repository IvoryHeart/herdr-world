import { lstatSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { worldEnv } from "../config/environment";
import {
  updateInstallationBlockReason,
  compareVersion,
  curlTransportArgs,
  fetchLatestUpdateManifest,
  normalizeUpdateBaseUrl,
  renderUpdateInstallScript,
  resolveUpdateTarget,
  type RunProcessWithCodeTimeout,
  UPDATE_INSTALL_TIMEOUT_MS,
} from "../http/update";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import {
  type CliCommand,
  type CliContext,
  EXIT_FAILURE,
  EXIT_OK,
  isStandaloneBinary,
  parseCommandArgs,
  printJson,
  UsageError,
  wantsHelp,
} from "./command";
import { readServiceSetup } from "./service-context";
import { finishUpdate, restartServiceUsing } from "./update-finish";
import { syncWorldIntegrations } from "./integration-sync";

export interface UpdateDependencies {
  runProcess?: RunProcessWithCodeTimeout;
}

function updateHelp(): string {
  return `Update the standalone herdr-world executable to the latest release.

Usage:
  herdr-world update [--check] [--json]
  herdr-world update --finish-install

Options:
  --check   only report whether a newer release exists
  --json    print machine-readable output (with --check)
  --finish-install  finish an installer replacement without downloading World

The release manifest, archive checksum, package VERSION and binary version are
verified before the executable is replaced in place. The previous executable is
kept as herdr-world.previous; \`herdr-world rollback\` restores it. The new
release then runs \`herdr-world herdr upgrade\` to bring Herdr, the harness
integrations and the Herdr World plugin up to the versions it declares. A
running managed service that uses this executable is restarted afterwards.

The installer uses --finish-install after replacing an existing executable;
HERDR_WORLD_SKIP_HERDR=1 skips Herdr and its integrations in that mode.
Every update also discovers harness config folders and installs or refreshes
World's skills and Claude limits tap, even if World is already current.
HERDR_WORLD_SKIP_INTEGRATIONS=1 leaves these manual. Uninstall stays removed.

HERDR_WORLD_UPDATE_BASE_URL selects a mirror (from the shell, else the service
config). To install a specific version, rerun the installer with
HERDR_WORLD_VERSION=X.Y.Z. Windows builds update by downloading a release.
`;
}

function rollbackHelp(): string {
  return `Swap the herdr-world executable with herdr-world.previous.

Usage:
  herdr-world rollback

The update command and installer keep the replaced executable as
herdr-world.previous. Rollback swaps the two files, so running it again undoes the
rollback. A running managed service that uses this executable is restarted.
`;
}

function serviceEnv(context: CliContext): Record<string, string> {
  try {
    return readServiceSetup(context.runtime).env;
  } catch {
    return {};
  }
}

export function createUpdateCommand(
  dependencies: UpdateDependencies = {},
): CliCommand {
  const runProcess = dependencies.runProcess ?? runProcessWithCodeTimeout;
  return {
    name: "update",
    summary: "update herdr-world to the latest release",
    flags: ["--check", "--json"],
    help: updateHelp,
    async run(args, context) {
      if (wantsHelp(args)) {
        context.log(updateHelp());
        return EXIT_OK;
      }
      const { values } = parseCommandArgs(args, {
        check: { type: "boolean" },
        json: { type: "boolean" },
        "finish-install": { type: "boolean" },
      });
      const { runtime } = context;
      if (values["finish-install"]) {
        if (values.check || values.json)
          throw new UsageError(
            "--finish-install cannot be combined with --check or --json",
          );
        return finishUpdate(
          context,
          runProcess,
          worldEnv("SKIP_HERDR", runtime.env) === "1",
        );
      }
      const target = resolveUpdateTarget(runtime.platform, runtime.arch);
      if (!target) {
        context.error(
          `herdr-world update: no update package for ${runtime.platform}-${runtime.arch}; download it from https://github.com/IvoryHeart/herdr-world/releases/latest`,
        );
        return EXIT_FAILURE;
      }
      const baseUrl = normalizeUpdateBaseUrl(
        worldEnv("UPDATE_BASE_URL", runtime.env) ??
          worldEnv("UPDATE_BASE_URL", serviceEnv(context)),
      );
      const manifest = await fetchLatestUpdateManifest({
        baseUrl,
        target,
        runProcessWithCodeTimeout: runProcess,
      });
      const available = compareVersion(manifest.version, context.version) > 0;

      if (values.check) {
        if (values.json) {
          printJson(context, {
            current_version: context.version,
            latest_version: manifest.version,
            update_available: available,
            platform: target.platform,
          });
        } else {
          context.log(`Current: herdr-world ${context.version}`);
          context.log(`Latest:  herdr-world ${manifest.version}`);
          context.log(
            available
              ? "An update is available: run `herdr-world update`."
              : "Up to date.",
          );
        }
        return EXIT_OK;
      }
      if (!available) {
        context.log(`herdr-world ${context.version} is up to date.`);
        return syncWorldIntegrations(context);
      }
      if (!isStandaloneBinary(runtime)) {
        context.error(
          "herdr-world update: only the standalone binary can update itself; pull and rebuild source checkouts.",
        );
        return EXIT_FAILURE;
      }

      const blockReason = updateInstallationBlockReason(
        context.version,
        runtime.execPath,
      );
      if (blockReason) {
        context.error(`herdr-world update: ${blockReason}`);
        return EXIT_FAILURE;
      }

      context.log(
        `Updating herdr-world ${context.version} -> ${manifest.version}...`,
      );
      const script = renderUpdateInstallScript({
        targetPath: runtime.execPath,
        target,
        manifest,
        archiveUrl: `${baseUrl}/${target.archiveName}`,
        curlTransport: curlTransportArgs(baseUrl).map(shQuote).join(" "),
        shQuote,
      });
      const result = await runProcess(
        ["sh", "-c", script],
        UPDATE_INSTALL_TIMEOUT_MS,
      );
      if (result.code !== 0) {
        context.error(
          `herdr-world update: ${(result.stderr || result.stdout || `install exited ${result.code}`).trim().slice(0, 1000)}`,
        );
        return EXIT_FAILURE;
      }
      context.log(
        `Installed herdr-world ${manifest.version} at ${runtime.execPath}.`,
      );
      context.log(`Previous executable: ${runtime.execPath}.previous`);
      return finishUpdate(context, runProcess);
    },
  };
}

function regularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export const rollbackCommand: CliCommand = {
  name: "rollback",
  summary: "restore the executable replaced by the last update",
  help: rollbackHelp,
  async run(args, context) {
    if (wantsHelp(args)) {
      context.log(rollbackHelp());
      return EXIT_OK;
    }
    parseCommandArgs(args, {});
    const { runtime } = context;
    if (!isStandaloneBinary(runtime) || runtime.platform === "win32") {
      context.error(
        "herdr-world rollback: only the standalone Linux and macOS binary can roll back.",
      );
      return EXIT_FAILURE;
    }
    const current = runtime.execPath;
    const previous = `${current}.previous`;
    if (!regularFile(current) || !regularFile(previous)) {
      context.error(
        `herdr-world rollback: no previous executable at ${previous}`,
      );
      return EXIT_FAILURE;
    }
    const probe = Bun.spawnSync([previous, "--version"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const previousVersion = probe.stdout.toString().trim();
    if (probe.exitCode !== 0 || !/^herdr-world \S+$/.test(previousVersion)) {
      context.error(
        `herdr-world rollback: ${previous} is not a working herdr-world executable; nothing changed.`,
      );
      return EXIT_FAILURE;
    }
    const parked = join(
      dirname(current),
      `.${basename(current)}.rollback-${process.pid}`,
    );
    renameSync(current, parked);
    try {
      renameSync(previous, current);
    } catch (error) {
      renameSync(parked, current);
      throw error;
    }
    renameSync(parked, previous);
    context.log(
      `Rolled back herdr-world ${context.version} -> ${previousVersion.slice("herdr-world ".length)}.`,
    );
    context.log("Run `herdr-world rollback` again to undo.");
    return restartServiceUsing(context, current);
  },
};
