import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { validateSshDestination } from "../bridge/ssh-command";

// One entry per product. Launch syntax is shared by family, never browser input.
export const IDE_REGISTRY = [
  {
    id: "vscode",
    label: "VS Code",
    family: "code",
    commands: ["code"],
    mac: "Visual Studio Code",
    bin: "code",
    windows: "Microsoft VS Code/Code.exe",
  },
  {
    id: "cursor",
    label: "Cursor",
    family: "code",
    commands: ["cursor"],
    mac: "Cursor",
    bin: "cursor",
    windows: "cursor/Cursor.exe",
  },
  {
    id: "zed",
    label: "Zed",
    family: "zed",
    commands: ["zed", "zeditor"],
    mac: "Zed",
    bin: "zed",
    windows: "Zed/zed.exe",
  },
  {
    id: "idea",
    label: "IntelliJ IDEA",
    family: "jetbrains",
    commands: ["idea", "idea.sh", "idea64.exe"],
    mac: "IntelliJ IDEA",
    bin: "idea",
  },
  {
    id: "webstorm",
    label: "WebStorm",
    family: "jetbrains",
    commands: ["webstorm", "webstorm.sh", "webstorm64.exe"],
    mac: "WebStorm",
    bin: "webstorm",
  },
  {
    id: "pycharm",
    label: "PyCharm",
    family: "jetbrains",
    commands: ["pycharm", "pycharm.sh", "pycharm64.exe"],
    mac: "PyCharm",
    bin: "pycharm",
  },
  {
    id: "phpstorm",
    label: "PhpStorm",
    family: "jetbrains",
    commands: ["phpstorm", "phpstorm.sh", "phpstorm64.exe"],
    mac: "PhpStorm",
    bin: "phpstorm",
  },
  {
    id: "goland",
    label: "GoLand",
    family: "jetbrains",
    commands: ["goland", "goland.sh", "goland64.exe"],
    mac: "GoLand",
    bin: "goland",
  },
  {
    id: "clion",
    label: "CLion",
    family: "jetbrains",
    commands: ["clion", "clion.sh", "clion64.exe"],
    mac: "CLion",
    bin: "clion",
  },
  {
    id: "rider",
    label: "Rider",
    family: "jetbrains",
    commands: ["rider", "rider.sh", "rider64.exe"],
    mac: "Rider",
    bin: "rider",
  },
] as const;
export type DesktopIdeId = (typeof IDE_REGISTRY)[number]["id"];
export type DetectedIde = {
  id: DesktopIdeId;
  label: string;
  executable: string | null;
  reason?: string;
  ssh: boolean;
};
export function desktopIde(id: unknown) {
  const entry = IDE_REGISTRY.find((item) => item.id === id);
  if (!entry) throw new Error("Choose a supported desktop IDE.");
  return entry;
}

/** Filesystem/PATH checks only: no process, install, network or version probe. */
export function detectDesktopIdes({
  platform = process.platform,
  home = homedir(),
  which = (command: string) => Bun.which(command),
  exists = existsSync,
  environment = process.env,
}: {
  platform?: NodeJS.Platform;
  home?: string;
  which?: (command: string) => string | null;
  exists?: (path: string) => boolean;
  environment?: Record<string, string | undefined>;
} = {}): DetectedIde[] {
  return IDE_REGISTRY.map((entry) => {
    const candidates: string[] = [];
    for (const command of entry.commands) {
      const executable = which(command);
      // Windows .cmd/.bat require a shell: use native executables only.
      if (executable && !/\.(?:cmd|bat)$/i.test(executable))
        candidates.push(executable);
    }
    if (platform === "darwin") {
      for (const directory of ["/Applications", join(home, "Applications")]) {
        const bundle = join(directory, `${entry.mac}.app`, "Contents");
        candidates.push(
          entry.family === "code"
            ? join(bundle, "Resources/app/bin", entry.bin)
            : join(bundle, "MacOS", entry.bin),
        );
      }
    }
    if (platform === "linux" && entry.family === "jetbrains")
      candidates.push(
        join(home, ".local/share/JetBrains/Toolbox/scripts", entry.bin),
      );
    if (platform === "win32" && "windows" in entry) {
      for (const directory of [
        environment.LOCALAPPDATA &&
          win32.join(environment.LOCALAPPDATA, "Programs"),
        environment.ProgramFiles,
      ]) {
        if (directory) candidates.push(win32.join(directory, entry.windows));
      }
    }
    const executable = candidates.find((path) => exists(path)) ?? null;
    return {
      id: entry.id,
      label: entry.label,
      executable,
      ssh: entry.family !== "jetbrains",
      ...(!executable
        ? {
            reason:
              "Desktop launcher not found on the World host. Install the IDE and enable its command-line launcher, then refresh.",
          }
        : {}),
    };
  });
}

export function desktopIdeArgs(
  id: unknown,
  path: string,
  destination?: string,
  line?: number,
  directory = false,
): string[] {
  const entry = desktopIde(id);
  if (
    !/^(?:\/|[a-z]:[\\/])/i.test(path) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(path) ||
    path.length > 4096
  )
    throw new Error("IDE handoff needs a valid absolute path.");
  if (
    line !== undefined &&
    (!Number.isSafeInteger(line) || line < 1 || line > 10_000_000)
  )
    throw new Error("Invalid IDE line number.");
  if (destination) {
    validateSshDestination(destination);
    if (entry.family === "jetbrains")
      throw new Error(
        "JetBrains SSH handoff needs a configured Gateway backend link. Open this project in Gateway manually or choose VS Code, Cursor or Zed.",
      );
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error(
        "This SSH path is unsupported by the desktop IDE handoff.",
      );
  }
  if (entry.family === "code")
    return [
      ...(destination ? ["--remote", `ssh-remote+${destination}`] : []),
      // Remote CLI otherwise guesses from extensions: a dotted directory and an
      // extensionless file must keep their observed kind. Arguments need no URL encoding.
      ...(!directory
        ? ["--goto", line ? `${path}:${line}` : path]
        : [destination ? `${path.replace(/\/+$/, "")}/` : path]),
    ];
  if (entry.family === "jetbrains")
    return [...(!directory && line ? ["--line", String(line)] : []), path];
  const target = destination
    ? `ssh://${destination.split("@").map(encodeURIComponent).join("@")}${path.split("/").map(encodeURIComponent).join("/")}`
    : path;
  return [!directory && line ? `${target}:${line}` : target];
}

/** A successful request acknowledges dispatch, not that a GUI has rendered. */
export async function launchDesktopIde(executable: string, args: string[]) {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([executable, ...args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    throw new Error(
      "Could not start the desktop IDE on the World host. Check its desktop session and launcher.",
    );
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([
      child.exited,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 1200);
      }),
    ]);
    if (code !== null && code !== 0)
      throw new Error(
        "The desktop IDE launcher failed. Check its desktop session and remote-development setup.",
      );
  } finally {
    clearTimeout(timeout);
    child.unref();
  }
}
