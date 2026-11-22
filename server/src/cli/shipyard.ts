import {
  SHIPYARD_LIMITS,
  shipyardRepository,
  type ShipyardCatalog,
  type ShipyardSnapshot,
} from "../../../shared/shipyard";
import { SHIPYARD_CLI_PATH } from "../shipyard/http";
import { demoShipyard, SHIPYARD_DEMOS } from "../shipyard/testing/demo";
import {
  type CliCommand,
  type CliContext,
  EXIT_FAILURE,
  EXIT_OK,
  parseCommandArgs,
  printJson,
  UsageError,
  wantsHelp,
} from "./command";
import { serviceEndpoint } from "./world";

type Reply = {
  ok: boolean;
  code?: string;
  error?: string;
  result?: ShipyardCatalog | ShipyardSnapshot;
};
export type ShipyardTransport = (
  context: CliContext,
  command: "list" | "show",
  params: Record<string, unknown>,
) => Promise<Reply>;

export const shipyardTransport: ShipyardTransport = async (
  context,
  command,
  params,
) => {
  const endpoint = serviceEndpoint(context);
  const url = new URL(SHIPYARD_CLI_PATH, endpoint.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Shipyard needs a plain loopback World URL");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ command, params }),
    redirect: "error",
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(10_000),
  });
  const reply = (await response.json()) as Reply;
  if (
    typeof reply?.ok !== "boolean" ||
    (reply.ok && (!response.ok || !reply.result))
  )
    throw new Error("World did not return a Shipyard response");
  return reply;
};

export function createShipyardCommand(
  transport: ShipyardTransport = shipyardTransport,
): CliCommand {
  return {
    name: "shipyard",
    summary: "read releases, waiting changes and local World instances",
    actions: ["list", "show", "demo"],
    flags: ["--json", "--refresh", "--scenario"],
    help: () => `Read-only Shipyard data; no release, tag or deployment mutations.

Usage:
  herdr-world shipyard list [--json]
  herdr-world shipyard show <owner/repository> [--refresh] [--json]
  herdr-world shipyard demo [--scenario ${SHIPYARD_DEMOS.join("|")}] [--json]

list shows the projects open in World's rooms and spaces, by GitHub repository.
show uses the running local World, its GitHub source switch and gh sign-in.
--refresh requests a read now (at least ${SHIPYARD_LIMITS.forcedRefreshMs / 1000}s between reads).
The CLI uses HERDR_WORLD_URL and the matching HERDR_WORLD_DATA_DIR/token, as
the other World commands do. A slow read returns refreshing; run again later.
demo is testing-only: synthetic data, no World service, credentials or network.
Output distinguishes fresh, stale, unavailable and incomplete evidence. Links
are for navigation only. Instances report themselves; no hosts/ports are scanned.
`,
    async run(args, context) {
      if (wantsHelp(args)) {
        context.log(this.help());
        return EXIT_OK;
      }
      const action = args[0];
      if (!["list", "show", "demo"].includes(action ?? ""))
        throw new UsageError(
          "Choose list, show or demo; Shipyard is read-only",
        );
      const { values, positionals } = parseCommandArgs(
        args.slice(1),
        {
          json: { type: "boolean" },
          refresh: { type: "boolean" },
          scenario: { type: "string" },
        },
        action === "show" ? 1 : 0,
      );
      if (action !== "show" && values.refresh !== undefined)
        throw new UsageError("--refresh goes with show");
      if (action !== "demo" && values.scenario !== undefined)
        throw new UsageError("--scenario goes with demo");
      let result: ShipyardCatalog | ShipyardSnapshot;
      if (action === "demo") {
        const scenario = values.scenario ?? "populated";
        if (
          !SHIPYARD_DEMOS.includes(scenario as (typeof SHIPYARD_DEMOS)[number])
        )
          throw new UsageError("Unknown synthetic scenario");
        result = await demoShipyard(
          scenario as (typeof SHIPYARD_DEMOS)[number],
        );
      } else {
        let repo: string | undefined;
        if (action === "show") {
          try {
            repo = shipyardRepository(positionals[0]);
          } catch (error) {
            throw new UsageError((error as Error).message);
          }
        }
        const reply = await transport(
          context,
          action as "list" | "show",
          repo ? { repo, refresh: values.refresh === true } : {},
        );
        if (!reply.ok || !reply.result) {
          context.error(reply.error ?? "Shipyard is unavailable");
          return reply.code === "usage" ? 2 : EXIT_FAILURE;
        }
        result = reply.result;
      }
      if (values.json) printJson(context, result);
      else context.log(shipyardHuman(result));
      return action !== "demo" &&
        "data" in result &&
        !result.data &&
        !result.refreshing
        ? EXIT_FAILURE
        : EXIT_OK;
    },
  };
}

export function shipyardHuman(
  value: ShipyardCatalog | ShipyardSnapshot,
): string {
  const lines: string[] = [];
  if ("repositories" in value) {
    lines.push(
      "Shipyard projects (open in World)",
      ...value.projects.map(
        (project) =>
          `  ${project.repo ?? `${project.name} (no GitHub remote)`}`,
      ),
    );
    if (value.pending)
      lines.push(
        `${value.pending} open folder(s) still being read; run again.`,
      );
    if (value.omitted)
      lines.push(
        `${value.omitted} open folder(s) past the limit of ${value.limits.repositories} were not read; use show <owner/repository>.`,
      );
  } else {
    lines.push(
      `${value.repo}: ${value.state}${value.refreshing ? " (refreshing)" : ""}`,
      value.detail,
    );
    if (value.data) {
      const { main, releases, waiting } = value.data;
      lines.push(
        `main ${main.sha.slice(0, 12)}: ${main.health} (observed workflows)`,
        `Baseline: ${waiting.baseline?.tag ?? "unknown"}; waiting: ${waiting.pullRequests.length} observed PRs (${waiting.state})`,
      );
      if (waiting.detail) lines.push(waiting.detail);
      for (const pr of waiting.pullRequests)
        lines.push(`  #${pr.number} ${pr.title} ${pr.url}`);
      for (const release of releases.items)
        lines.push(
          `  ${release.tag} ${release.channel} ${new Date(release.publishedAt).toISOString()} ${release.url}`,
        );
      lines.push(`PR list: ${waiting.pullRequestsUrl}`);
    }
  }
  lines.push(
    `Local instances: ${value.instances.items.length}${value.instances.complete ? "" : " (incomplete)"}`,
  );
  for (const i of value.instances.items)
    lines.push(
      `  ${i.version} :${i.port} ${i.branch ?? i.kind} ${i.state}${i.openUrl ? ` ${i.openUrl}` : ""}`,
    );
  if (value.instances.detail) lines.push(value.instances.detail);
  return lines.join("\n");
}
