import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CliCommand,
  type CliRuntime,
  displayPath,
  EXIT_FAILURE,
  EXIT_OK,
  parseCommandArgs,
  UsageError,
  wantsHelp,
} from "./command";
import {
  integrationPaths,
  SHARED_HARNESSES,
  WORLD_HARNESSES,
  type WorldHarness,
} from "./integration-paths";
import { WORLD_SKILL } from "./world-skill";
import { changeClaudeTap, claudeTapCurrent } from "./integration-claude";
import { setIntegrationDisabled } from "./integration-preferences";

export const WORLD_SKILL_VERSION = 1;

function stat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function requireRegular(path: string, directory = false) {
  const info = stat(path);
  if (info && !(directory ? info.isDirectory() : info.isFile()))
    throw new Error(
      `refusing non-${directory ? "directory" : "regular file"}: ${path}`,
    );
}

function skillFile(id: string) {
  return `---
name: herdr-world
description: Use Herdr World to ask the owner questions, report results, publish a task summary and stamp parent-child agents.
---
<!--
installed by herdr-world
managed by herdr-world; reinstalling or updating overwrites this file
HERDR_WORLD_INTEGRATION_ID=${id}
HERDR_WORLD_INTEGRATION_VERSION=${WORLD_SKILL_VERSION}
-->
${WORLD_SKILL}`;
}

function installedState(
  file: string,
  id: string,
): Pick<WorldIntegrationStatus, "state" | "version"> {
  const info = stat(file);
  if (!info) return { state: "not_installed" };
  if (!info.isFile()) return { state: "outdated" };
  const contents = readFileSync(file, "utf8");
  const ids = [
    ...contents.matchAll(/^HERDR_WORLD_INTEGRATION_ID=([^\r\n]+)\r?$/gm),
  ];
  const versions = [
    ...contents.matchAll(/^HERDR_WORLD_INTEGRATION_VERSION=(\d+)\r?$/gm),
  ];
  const version = versions.length === 1 ? Number(versions[0]![1]) : NaN;
  const valid =
    ids.length === 1 && ids[0]![1] === id && Number.isSafeInteger(version);
  return valid
    ? {
        state: version >= WORLD_SKILL_VERSION ? "current" : "outdated",
        version,
      }
    : { state: "outdated" };
}

export type WorldIntegrationState =
  | "current"
  | "outdated"
  | "not_installed"
  | "unsupported";

/** One harness's World skill, as the CLI and Settings report it. */
export interface WorldIntegrationStatus {
  harness: WorldHarness;
  state: WorldIntegrationState;
  /** The installed version, when its marker is valid. */
  version?: number;
  available_version: number;
  /** Home-relative skill file; absent when unsupported. */
  path?: string;
  /** Why it is unsupported, or which part besides the skill is outdated. */
  reason?: string;
  /** Other harnesses that read, and lose on removal, the same file. */
  shared_with: WorldHarness[];
}

const UNSUPPORTED_REASON = "no documented skill folder";

export function isWorldHarness(name: unknown): name is WorldHarness {
  return WORLD_HARNESSES.includes(name as WorldHarness);
}

export function worldIntegrationStatus(
  harness: WorldHarness,
  runtime: CliRuntime,
): WorldIntegrationStatus {
  const paths = integrationPaths(harness, runtime);
  const base = { harness, available_version: WORLD_SKILL_VERSION };
  if (!paths)
    return {
      ...base,
      state: "unsupported",
      reason: UNSUPPORTED_REASON,
      shared_with: [],
    };
  let installed: Pick<WorldIntegrationStatus, "state" | "version" | "reason"> =
    installedState(paths.file, paths.id);
  if (
    harness === "claude" &&
    installed.state === "current" &&
    !claudeTapCurrent(paths.config, runtime)
  )
    installed = { state: "outdated", reason: "Claude limits tap" };
  return {
    ...base,
    ...installed,
    path: displayPath(paths.file, runtime),
    shared_with: SHARED_HARNESSES.includes(harness)
      ? SHARED_HARNESSES.filter((other) => other !== harness)
      : [],
  };
}

function supportedPaths(harness: WorldHarness, runtime: CliRuntime) {
  const paths = integrationPaths(harness, runtime);
  if (!paths)
    throw new Error(`${harness}: unsupported (${UNSUPPORTED_REASON})`);
  return paths;
}

function requireManagedSkill(
  paths: NonNullable<ReturnType<typeof integrationPaths>>,
) {
  requireRegular(paths.folder, true);
  requireRegular(paths.file);
  const installed = installedState(paths.file, paths.id);
  if (installed.state !== "not_installed" && installed.version === undefined)
    throw new Error(`refusing skill not managed by World: ${paths.file}`);
  return installed.state !== "not_installed";
}

/** What one install did: new, changed, or nothing to change. */
export type WorldIntegrationInstall = "installed" | "updated" | "current";

/** Writes the release's skill for one harness; the CLI and Settings share it. */
export function installWorldIntegration(
  harness: WorldHarness,
  runtime: CliRuntime,
): WorldIntegrationInstall {
  const paths = supportedPaths(harness, runtime);
  let configured = false;
  try {
    configured = statSync(paths.config).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!configured)
    throw new Error(
      `${displayPath(paths.config, runtime)} does not exist. Run ${harness} first to create its configuration folder.`,
    );
  const existed = requireManagedSkill(paths);
  // Judged before writing: rewriting identical files changes nothing.
  const current =
    existed &&
    readFileSync(paths.file, "utf8") === skillFile(paths.id) &&
    (harness !== "claude" || claudeTapCurrent(paths.config, runtime));
  if (harness === "claude") changeClaudeTap(paths.config, "install", runtime);
  mkdirSync(paths.folder, { recursive: true });
  const temporary = join(paths.folder, `.SKILL.md-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, skillFile(paths.id), {
      flag: "wx",
      mode: 0o644,
    });
    renameSync(temporary, paths.file);
  } finally {
    if (stat(temporary)) unlinkSync(temporary);
  }
  setIntegrationDisabled(paths.id, runtime, false);
  return current ? "current" : existed ? "updated" : "installed";
}

/** How the CLI and installers report one install. */
export function installedMessage(action: WorldIntegrationInstall) {
  return action === "current"
    ? "World's integration is already current"
    : `${action} World's integration`;
}

/** Removes World's skill file, and its folder when empty. */
export function uninstallWorldIntegration(
  harness: WorldHarness,
  runtime: CliRuntime,
) {
  const paths = supportedPaths(harness, runtime);
  requireManagedSkill(paths);
  // Persist intent before removing files, including an already absent skill.
  setIntegrationDisabled(paths.id, runtime, true);
  if (harness === "claude") changeClaudeTap(paths.config, "uninstall", runtime);
  if (stat(paths.file)) unlinkSync(paths.file);
  try {
    rmdirSync(paths.folder);
  } catch (error) {
    if (
      !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  }
}

const SHARED_LABELS: Partial<Record<WorldHarness, string>> = {
  codex: "Codex",
  pi: "Pi",
  kimi: "Kimi",
};

export const integrationCommand: CliCommand = {
  name: "integration",
  summary: "install, remove or check the World skill for an agent harness",
  actions: ["install", "uninstall", "status", "sync"],
  help: () => `Usage: herdr-world integration install|uninstall <harness>
       herdr-world integration status [<harness>]
       herdr-world integration sync

Harnesses: ${WORLD_HARNESSES.join(", ")}

Installs the release's World skill on this host, plus Claude's chained limits tap.
The harness's config
folder must already exist. Codex, Pi and Kimi share ~/.agents/skills/herdr-world/SKILL.md;
removing any of them removes that file for all three. No service is required.
Installers and updates use sync to discover config folders and refresh integrations.
HERDR_WORLD_SKIP_INTEGRATIONS=1 skips sync. Uninstall stays removed until explicit install.`,
  async run(args, context) {
    if (wantsHelp(args)) {
      context.log(integrationCommand.help());
      return EXIT_OK;
    }
    const { positionals } = parseCommandArgs(args, {}, 2);
    const [action, name] = positionals;
    if (action === "sync") {
      if (name) throw new UsageError("sync takes no harness argument");
      const { syncWorldIntegrations } = await import("./integration-sync");
      return syncWorldIntegrations(context);
    }
    if (!["install", "uninstall", "status"].includes(action ?? ""))
      throw new UsageError("expected install, uninstall or status");
    if ((!name && action !== "status") || (name && !isWorldHarness(name)))
      throw new UsageError(
        name ? `unknown harness: ${name}` : "missing harness",
      );
    let exit = EXIT_OK;
    for (const harness of name ? [name as WorldHarness] : WORLD_HARNESSES) {
      const paths = integrationPaths(harness, context.runtime);
      if (!paths) {
        context.log(`${harness}: unsupported (${UNSUPPORTED_REASON})`);
        if (action !== "status") exit = EXIT_FAILURE;
        continue;
      }
      const path = displayPath(paths.file, context.runtime);
      if (action === "install") {
        const done = installWorldIntegration(harness, context.runtime);
        context.log(`${harness}: ${installedMessage(done)} (${path})`);
      } else if (action === "uninstall") {
        uninstallWorldIntegration(harness, context.runtime);
        context.log(`${harness}: uninstalled (${path})`);
        const others = SHARED_HARNESSES.filter((other) => other !== harness);
        if (SHARED_HARNESSES.includes(harness))
          context.log(
            `The shared file is also removed for ${others
              .map((other) => SHARED_LABELS[other])
              .join(" and ")}.`,
          );
      } else {
        const status = worldIntegrationStatus(harness, context.runtime);
        const label =
          status.state === "not_installed"
            ? "not installed"
            : status.state === "outdated" && status.reason
              ? `outdated (${status.reason})`
              : status.state;
        const version =
          status.version === undefined ? "" : ` (v${status.version})`;
        context.log(`${harness}: ${label}${version} (${path})`);
      }
    }
    return exit;
  },
};
