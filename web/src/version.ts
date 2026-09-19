import packageJson from "../package.json";

export function resolveAppVersion(
  injectedVersion: string | undefined,
  fallbackVersion: string,
) {
  return injectedVersion?.trim() || fallbackVersion;
}

export const APP_VERSION = resolveAppVersion(
  typeof __HERDR_WORLD_VERSION__ === "string"
    ? __HERDR_WORLD_VERSION__
    : undefined,
  packageJson.version,
);
