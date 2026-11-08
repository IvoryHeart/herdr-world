/** World's own skill per harness on the service's host (`world.integration.list`). */
export type WorldIntegration = {
  harness: string;
  state: "current" | "outdated" | "not_installed" | "unsupported";
  version?: number;
  available_version: number;
  path?: string;
  reason?: string;
  /** Other harnesses that read, and lose on removal, the same file. */
  shared_with: string[];
};

const STATES = ["current", "outdated", "not_installed", "unsupported"];
const version = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function parseWorldIntegrations(result: unknown): WorldIntegration[] {
  const items = (result as { integrations?: unknown } | null)?.integrations;
  if (
    !Array.isArray(items) ||
    !items.every(
      (item) =>
        item &&
        typeof item.harness === "string" &&
        item.harness &&
        STATES.includes(item.state) &&
        (item.version === undefined || version(item.version)) &&
        version(item.available_version) &&
        (item.state === "unsupported"
          ? typeof item.reason === "string"
          : typeof item.path === "string" && item.path) &&
        Array.isArray(item.shared_with) &&
        item.shared_with.every((name: unknown) => typeof name === "string"),
    )
  )
    throw new Error("Invalid World integration list received.");
  return items;
}

/** Herdr names a few harnesses with underscores (antigravity_cli); World with hyphens. */
export const worldHarnessFor = (herdrTarget: string) =>
  herdrTarget.replace(/_/g, "-");

export function worldStateLabel(item: WorldIntegration) {
  const installed = item.version === undefined ? "" : ` (v${item.version})`;
  switch (item.state) {
    case "current":
      return `Current${installed}`;
    case "outdated":
      return item.version === undefined
        ? `Outdated, v${item.available_version} available`
        : `Outdated (v${item.version} → v${item.available_version})`;
    case "not_installed":
      return "Not installed";
    default:
      return `Unsupported: ${item.reason}`;
  }
}

/** The confirmation text, naming every harness that shares the file. */
export function worldChangePrompt(
  item: WorldIntegration,
  action: "install" | "uninstall",
  label: (harness: string) => string,
) {
  const name = label(item.harness);
  const others = item.shared_with.map(label);
  const shared = others.length
    ? ` ${name}, ${others.join(" and ")} share this file`
    : "";
  if (action === "uninstall")
    return (
      `Uninstall World's skill for ${name}?\n\nThis deletes ${item.path}.` +
      (others.length
        ? `${shared}, so ${others.join(" and ")} lose it too.`
        : "") +
      " Herdr's own integration is not changed."
    );
  return (
    `${item.state === "outdated" ? "Update" : "Install"} World's skill for ${name}?\n\n` +
    `This writes ${item.path} on World's own host.` +
    (others.length ? `${shared}, so it applies to them too.` : "") +
    " Start a new agent session to load it."
  );
}
