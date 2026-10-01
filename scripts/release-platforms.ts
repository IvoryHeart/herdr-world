export const RELEASE_PLATFORMS = [
  { id: "linux-x64", os: "linux", cpu: "x64", binary: "herdr-world" },
  { id: "linux-arm64", os: "linux", cpu: "arm64", binary: "herdr-world" },
  { id: "darwin-x64", os: "darwin", cpu: "x64", binary: "herdr-world" },
  { id: "darwin-arm64", os: "darwin", cpu: "arm64", binary: "herdr-world" },
  { id: "windows-x64", os: "win32", cpu: "x64", binary: "herdr-world.exe" },
  { id: "windows-arm64", os: "win32", cpu: "arm64", binary: "herdr-world.exe" },
] as const;

export function npmPlatformName(id: string) {
  return `@ivoryheart/herdr-world-${id}`;
}
