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

function installedState(file: string, id: string) {
  const info = stat(file);
  if (!info) return "not installed";
  if (!info.isFile()) return "outdated";
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
    ? `${version >= WORLD_SKILL_VERSION ? "current" : "outdated"} (v${version})`
    : "outdated";
}

export const integrationCommand: CliCommand = {
  name: "integration",
  summary: "install, remove or check the World skill for an agent harness",
  actions: ["install", "uninstall", "status"],
  help: () => `Usage: herdr-world integration install|uninstall <harness>
       herdr-world integration status [<harness>]

Harnesses: ${WORLD_HARNESSES.join(", ")}

Installs only the release's World skill on this host. The harness's config
folder must already exist. Codex, Pi and Kimi share ~/.agents/skills/herdr-world/SKILL.md;
removing any of them removes that file for all three. No service is required.`,
  async run(args, context) {
    if (wantsHelp(args)) {
      context.log(integrationCommand.help());
      return EXIT_OK;
    }
    const { positionals } = parseCommandArgs(args, {}, 2);
    const [action, name] = positionals;
    if (!["install", "uninstall", "status"].includes(action ?? ""))
      throw new UsageError("expected install, uninstall or status");
    if (
      (!name && action !== "status") ||
      (name && !WORLD_HARNESSES.includes(name as WorldHarness))
    )
      throw new UsageError(
        name ? `unknown harness: ${name}` : "missing harness",
      );
    let exit = EXIT_OK;
    for (const harness of name ? [name as WorldHarness] : WORLD_HARNESSES) {
      const paths = integrationPaths(harness, context.runtime);
      if (!paths) {
        context.log(`${harness}: unsupported (no documented skill folder)`);
        if (action !== "status") exit = EXIT_FAILURE;
        continue;
      }
      const path = displayPath(paths.file, context.runtime);
      if (action === "install") {
        let configured = false;
        try {
          configured = statSync(paths.config).isDirectory();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (!configured)
          throw new Error(
            `${displayPath(paths.config, context.runtime)} does not exist. Run ${harness} first to create its configuration folder.`,
          );
        requireRegular(paths.folder, true);
        requireRegular(paths.file);
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
        context.log(`${harness}: installed (${path})`);
      } else if (action === "uninstall") {
        requireRegular(paths.folder, true);
        requireRegular(paths.file);
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
        context.log(`${harness}: uninstalled (${path})`);
        if (SHARED_HARNESSES.includes(harness)) {
          const labels: Record<string, string> = {
            codex: "Codex",
            pi: "Pi",
            kimi: "Kimi",
          };
          context.log(
            `The shared file is also removed for ${SHARED_HARNESSES.filter(
              (other) => other !== harness,
            )
              .map((other) => labels[other])
              .join(" and ")}.`,
          );
        }
      } else
        context.log(
          `${harness}: ${installedState(paths.file, paths.id)} (${path})`,
        );
    }
    return exit;
  },
};
