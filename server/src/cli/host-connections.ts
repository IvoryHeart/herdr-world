import { HostConnectionService } from "../connections/host-service";
import { type WorldHost } from "../connections/hosts";
import { type DiscoverHost } from "../connections/host-discovery";
import {
  CONNECTION_PROFILE_FILE_VERSION,
  type ConnectionProfile,
  type ConnectionProfileStore,
  type PersistedConnectionRegistry,
} from "../connections/profiles";
import type { WorldSnapshotResult } from "../world/snapshot";
import {
  applyLiveConnectionChange,
  connectionServiceTarget,
  supportsLiveConnectionChanges,
} from "./connection-service";
import {
  EXIT_FAILURE,
  EXIT_OK,
  parseCommandArgs,
  printJson,
  UsageError,
  type CliContext,
} from "./command";
import { type ListenerProbe, type ServiceSetup } from "./service-context";

/** Offline discovery shares the service provider seam and private atomic store. */
export function offlineHosts(
  store: ConnectionProfileStore,
  initial: ConnectionProfile[],
  discover?: DiscoverHost,
) {
  let registry = store.load();
  let profiles = registry?.profiles ?? initial;
  let saved = registry?.hosts ?? [];
  return new HostConnectionService({
    profiles: () => profiles,
    saved: () => saved,
    defaultId: () =>
      registry?.default_connection_id ?? profiles[0]?.id ?? "startup-default",
    status: (id) => ({
      id,
      label: profiles.find((profile) => profile.id === id)!.label,
      source: "saved-profile",
      state: "disconnected",
      generation: 0,
      is_default: registry?.default_connection_id === id,
    }),
    mutate: (operation) => operation(),
    drop: async (id, ids) => {
      if (
        ids.includes(
          registry?.default_connection_id ??
            profiles[0]?.id ??
            "startup-default",
        )
      )
        throw new UsageError(
          "cannot remove the default connection; choose another default first",
        );
      const next: PersistedConnectionRegistry = {
        version: CONNECTION_PROFILE_FILE_VERSION,
        default_connection_id:
          registry?.default_connection_id ?? "startup-default",
        profiles: profiles.filter((profile) => !ids.includes(profile.id)),
        hosts: saved.filter((host) => host.id !== id),
      };
      await store.save(next);
      registry = next;
      profiles = next.profiles;
      saved = next.hosts!;
      return { ok: true };
    },
    persist: async (hosts, additions) => {
      const nextProfiles = [...profiles, ...additions];
      const next: PersistedConnectionRegistry = {
        version: CONNECTION_PROFILE_FILE_VERSION,
        profiles: nextProfiles,
        hosts,
        default_connection_id:
          registry?.default_connection_id ??
          nextProfiles[0]?.id ??
          "startup-default",
      };
      await store.save(next);
      registry = next;
      profiles = nextProfiles;
      saved = hosts;
    },
    start: async () => {},
    stop: async () => {},
    discover,
  });
}

export function printHosts(
  context: CliContext,
  hosts: WorldHost[],
  snapshot?: WorldSnapshotResult,
) {
  for (const host of hosts) {
    context.log(`${host.label} (${host.host_id}) — ${host.state}`);
    if (host.discovery_error) context.log(`  ${host.discovery_error}`);
    for (const runtime of host.runtimes) {
      context.log(
        `  ${runtime.kind} ${runtime.version ?? "(version unknown)"} — ${runtime.state} [${runtime.connection_id}]`,
      );
      for (const room of snapshot?.connections.find(
        (connection) => connection.connection_id === runtime.connection_id,
      )?.snapshot?.workspaces ?? [])
        context.log(`    ${String(room.label ?? room.workspace_id)}`);
    }
    if (host.state === "empty")
      context.log(
        `  No runtime installed. Install ${host.installable_runtimes.map((runtime) => runtime.label).join(" or ")}; then run connections discover ${host.host_id}.`,
      );
  }
}

/** New host verbs; runtime-specific legacy add flags remain compatible. */
export async function runHostConnectionCommand(args: {
  action: "add" | "discover" | "remove";
  rest: string[];
  context: CliContext;
  setup: ServiceSetup;
  store: ConnectionProfileStore;
  initial: ConnectionProfile[];
  probe: ListenerProbe;
  apply?: typeof applyLiveConnectionChange;
  discover?: DiscoverHost;
}): Promise<number> {
  const { action, context, setup, store } = args;
  const target = connectionServiceTarget(context, setup);
  const serving =
    target.running || (target.managed && (await args.probe(target.access)));
  const { values, positionals } = parseCommandArgs(
    args.rest,
    {
      label: { type: "string" },
      local: { type: "boolean" },
      windows: { type: "boolean" },
      json: { type: "boolean" },
      "preview-empty": { type: "boolean" },
    },
    1,
  );
  if (action === "remove") {
    if (!positionals[0])
      throw new UsageError("connections remove needs a host id");
    if (serving) {
      const reply = await (args.apply ?? applyLiveConnectionChange)(
        context,
        target,
        "host-remove",
        { registry_path: store.path, host_id: positionals[0] },
      );
      if (!reply.ok) {
        if (reply.code === "usage")
          throw new UsageError(reply.error ?? "host removal refused");
        context.error(reply.error ?? "host removal unavailable");
        return EXIT_FAILURE;
      }
    } else
      await offlineHosts(store, args.initial, args.discover).remove(
        positionals[0],
      );
    if (values.json) printJson(context, { ok: true });
    else context.log(`Removed host ${positionals[0]}.`);
    return EXIT_OK;
  }
  if (action === "add" && !values.local && !positionals[0])
    throw new UsageError("connections add needs an SSH destination or --local");
  if (values.local && (positionals[0] || values.windows))
    throw new UsageError("--local cannot have an SSH destination or --windows");
  const host = {
    type: values.local ? "local" : "ssh",
    ...(values.local ? {} : { ssh_destination: positionals[0] }),
    ...(values.label ? { label: values.label } : {}),
    ...(values.windows ? { remote_platform: "windows" } : {}),
    ...(values["preview-empty"]
      ? { preview_fixture: "empty", auto_connect: false }
      : {}),
  };
  let result: { host: WorldHost; snapshot?: WorldSnapshotResult };
  if (serving) {
    if (!supportsLiveConnectionChanges(target))
      throw new UsageError(
        "host discovery needs the configured service on loopback; stop it before offline edits",
      );
    const reply = await (args.apply ?? applyLiveConnectionChange)(
      context,
      target,
      action === "add" ? "host-add" : "discover",
      {
        registry_path: store.path,
        ...(action === "add" ? { host } : { host_id: positionals[0] }),
      },
    );
    if (!reply.ok) {
      if (reply.code === "usage")
        throw new UsageError(reply.error ?? "host change refused");
      context.error(
        reply.error ?? "host change refused; no offline write was attempted",
      );
      return EXIT_FAILURE;
    }
    result = reply.result as typeof result;
  } else {
    const hosts = offlineHosts(store, args.initial, args.discover);
    try {
      result = {
        host:
          action === "add"
            ? await hosts.add(host)
            : await hosts.connect(positionals[0]),
      };
    } catch (error) {
      if ((error as Error).name === "ProfileInputError")
        throw new UsageError((error as Error).message);
      throw error;
    }
    if (!values.json)
      context.log(
        "Saved for the next World start; runtimes are disconnected while World is offline.",
      );
  }
  if (values.json) printJson(context, result);
  else printHosts(context, [result.host], result.snapshot);
  return result.host.discovery === "error" ? EXIT_FAILURE : EXIT_OK;
}

export function hostArgumentIsLegacy(rest: string[]): boolean {
  return rest.some((arg) =>
    /^--(?:ssh|core|control-socket|client-socket|remote-control-socket|remote-client-socket|herdr-path|session|default|auto-connect|restart)(?:=|$)/.test(
      arg,
    ),
  );
}
