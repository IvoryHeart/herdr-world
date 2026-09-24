import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function resolveBuildVersion(
  injectedVersion: string | undefined,
  manifestVersion: string,
  describeVersion?: string,
) {
  const injected = injectedVersion?.trim();
  if (injected) return injected;
  if (manifestVersion !== "0.0.0") return manifestVersion;
  const described = describeVersion?.trim().replace(/^v(?=\d)/u, "");
  return described || "dev";
}

export function currentBuildVersion(
  injectedVersion: string | undefined,
  manifestVersion: string,
) {
  if (injectedVersion?.trim() || manifestVersion !== "0.0.0") {
    return resolveBuildVersion(injectedVersion, manifestVersion);
  }
  let described: string | undefined;
  try {
    described = execFileSync(
      "git",
      ["describe", "--tags", "--match", "v[0-9]*", "--always", "--dirty"],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    // Source archives and installed binaries may not have Git metadata.
  }
  return resolveBuildVersion(injectedVersion, manifestVersion, described);
}
