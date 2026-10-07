import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, resolve, win32 } from "node:path";
import { worldEnv } from "../config/environment";
import {
  assertInsideRoot,
  sanitizeExplorerPath,
  sanitizeFilesystemPath,
} from "./file-paths";
import { explorerWindows, focusNewExplorerWindow } from "./windows-focus";

export type FileRevealResult = {
  path: string;
  type: "file" | "directory";
};

export function isLoopbackAddress(address: string) {
  return /^(?:127\.|::1$|::ffff:127\.)/.test(address);
}

/** Loopback is a transport restriction, not proof of the browser's machine. */
export function canRevealFiles(
  address: string,
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    worldEnv("ALLOW_FILE_REVEAL", environment) === "1" &&
    isLoopbackAddress(address)
  );
}

// Files open their containing folder, selected where the platform's file
// manager supports it; directories open themselves.
export function fileManagerCommand(
  platform: NodeJS.Platform,
  target: string,
  directory: boolean,
): string[] {
  if (platform === "win32") {
    return directory
      ? ["explorer.exe", target]
      : ["explorer.exe", `/select,${target}`];
  }
  if (platform === "darwin") {
    return directory ? ["open", target] : ["open", "-R", target];
  }
  return ["xdg-open", directory ? target : dirname(target)];
}

function spawnFileManager(argv: string[]) {
  const before =
    process.platform === "win32" ? tryExplorerWindows() : undefined;
  // explorer.exe exits non-zero even after opening a window, so only a
  // failure to start the opener is reported.
  const proc = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
  // Focusing is best effort; the window is open either way.
  if (before) void focusNewExplorerWindow(before).catch(() => {});
}

function tryExplorerWindows() {
  try {
    return explorerWindows();
  } catch {
    return undefined;
  }
}

/**
 * Opens the host's file manager. Only explicit filesystem scope may leave
 * the root; Changes may fall back to the nearest existing ancestor inside it.
 */
export async function revealLocalPath(
  rootPath: string,
  requestedPath: string,
  {
    platform = process.platform,
    spawn = spawnFileManager,
    scope = "workspace",
    nearestExistingAncestor = false,
  }: {
    platform?: NodeJS.Platform;
    spawn?: (argv: string[]) => void;
    scope?: "workspace" | "filesystem";
    nearestExistingAncestor?: boolean;
  } = {},
): Promise<FileRevealResult> {
  if (scope !== "workspace" && scope !== "filesystem") {
    throw new Error("invalid file.reveal scope");
  }
  const filesystem = scope === "filesystem";
  if (
    !filesystem &&
    (win32.isAbsolute(requestedPath) || /^[a-z]:/i.test(requestedPath))
  ) {
    throw new Error("file.reveal workspace path must be relative");
  }
  const path = filesystem
    ? sanitizeFilesystemPath(requestedPath)
    : sanitizeExplorerPath(requestedPath);
  if (!path) throw new Error("file.reveal requires path");
  const rootReal = await realpath(rootPath);
  let target = filesystem ? path : resolve(rootReal, path);
  if (!filesystem) assertInsideRoot(rootReal, target);
  if (nearestExistingAncestor) {
    while (true) {
      try {
        await lstat(target);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
        const parent = dirname(target);
        if (parent === target) throw error;
        if (!filesystem) assertInsideRoot(rootReal, parent);
        target = parent;
      }
    }
  }
  const targetReal = await realpath(target);
  if (!filesystem) assertInsideRoot(rootReal, targetReal);
  const directory = (await stat(targetReal)).isDirectory();
  const argv = fileManagerCommand(platform, targetReal, directory);
  try {
    spawn(argv);
  } catch (error) {
    throw new Error(
      `Unable to start the file manager (${argv[0]}): ${(error as Error).message}`,
      { cause: error },
    );
  }
  return { path: targetReal, type: directory ? "directory" : "file" };
}
