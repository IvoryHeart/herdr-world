import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliRuntime } from "./command";

function disabledPath(id: string, runtime: CliRuntime) {
  const home = runtime.env.HOME || runtime.homeDir;
  const root =
    runtime.platform === "win32"
      ? runtime.env.APPDATA ||
        runtime.appDataDir ||
        join(home, "AppData/Roaming")
      : join(home, ".config");
  return join(root, "herdr-world/integrations", `${id}.disabled`);
}

/** One preference per skill, so shared Codex/Pi/Kimi removal stays removed. */
export function integrationDisabled(id: string, runtime: CliRuntime) {
  const file = disabledPath(id, runtime);
  try {
    if (!lstatSync(file).isFile())
      throw new Error(`refusing non-regular integration preference: ${file}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function setIntegrationDisabled(
  id: string,
  runtime: CliRuntime,
  disabled: boolean,
) {
  const exists = integrationDisabled(id, runtime);
  const file = disabledPath(id, runtime);
  if (disabled && !exists) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(
      file,
      "Removed with herdr-world integration uninstall; explicit install reenables automatic updates.\n",
      { flag: "wx", mode: 0o600 },
    );
  } else if (!disabled && exists) unlinkSync(file);
}
