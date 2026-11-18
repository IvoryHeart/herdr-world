import {
  type ManagedConnectionProfile,
  type StartupLocalProfile,
  testConnectionProfile,
} from "../connections/profile-service";
import {
  CONNECTION_PROFILE_FILE_VERSION,
  type ConnectionProfile,
  ConnectionProfileStore,
  isCoreProfile,
  type PersistedConnectionRegistry,
  validateConnectionProfile,
} from "../connections/profiles";
import { applyLiveConnectionChange } from "./connection-service";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import { HerdrClient } from "../bridge/herdr-client";
import { detectHerdrSetup } from "../herdr/bootstrap";
import {
  type CliCommand,
  type CliContext,
  displayPath,
  EXIT_FAILURE,
  EXIT_OK,
  parseCommandArgs,
  printJson,
  UsageError,
  wantsHelp,
} from "./command";
import {
  connectionRegistryPath,
  type ListenerProbe,
  probeListener,
  readServiceAccess,
  readServiceSetup,
  restartRunningService,
  serviceHerdrSockets,
  serviceStatus,
  type ServiceSetup,
} from "./service-context";

export interface ConnectionsDependencies {
  probe?: ListenerProbe;
  test?: typeof testConnectionProfile;
  apply?: typeof applyLiveConnectionChange;
  /** Whether this computer has the Herdr TUI; `herdr status`'s detection. */
  herdrInstalled?: (implicit: StartupLocalProfile) => Promise<boolean>;
}

function connectionsHelp(): string {
  return `List, test and edit saved Herdr connection profiles.

Usage:
  herdr-world connections list [--json]
  herdr-world connections test [<id>...] [--json]
  herdr-world connections add <id> --ssh <destination> [ssh options] [common options]
  herdr-world connections add <id> --control-socket <path> --client-socket <path>
                                [common options]
  herdr-world connections add <id> --core [--ssh <destination> [--windows]]
                                [--session <name>] [common options]
  herdr-world connections remove <id> [--restart]
  herdr-world connections set-default <id> [--restart]

Common add options:
  --label <text>     display name (default: the id)
  --auto-connect     connect when Herdr World starts
  --default          make it the default connection
  --restart          also restart the managed service after applying the change

SSH add options:
  --remote-control-socket <path>, --remote-client-socket <path>
                     remote socket paths (default: inferred from the remote home)
  --windows          the SSH host runs Windows
  --herdr-path <path>, --session <name>
                     Windows host executable and Herdr session

herdr-core add options:
  --core             watch a herdr-core already running on this computer, or
                     on the --ssh host; World reads core.lock and never starts
                     core. --session names the core session (default: default).
                     The first saved connection keeps the local Herdr server
                     as the default; without the Herdr TUI, core is the
                     default and no Local profile is saved.

The profiles are the same ones the connection selector edits. While World serves,
it admits these changes live: auto-connect profiles connect, removed profiles
disconnect, and the default changes without restarting other connections or
browser sessions. --restart remains available but is no longer needed.
With no service running, edits are saved for the next start. Only the address
in the service config is checked: stop any other herdr-world process sharing
this registry on another port before editing here. SSH tests need a running
remote Herdr and non-interactive SSH authentication.
`;
}

const ADD_OPTIONS = {
  label: { type: "string" },
  ssh: { type: "string" },
  "control-socket": { type: "string" },
  "client-socket": { type: "string" },
  "remote-control-socket": { type: "string" },
  "remote-client-socket": { type: "string" },
  windows: { type: "boolean" },
  core: { type: "boolean" },
  "herdr-path": { type: "string" },
  session: { type: "string" },
  "auto-connect": { type: "boolean" },
  default: { type: "boolean" },
  restart: { type: "boolean" },
} as const;

/** Mirrors index.ts: explicit Herdr settings pin the process default. */
function explicitOverride(setup: ServiceSetup): boolean {
  return Boolean(
    setup.env.HERDR_SOCKET_PATH ||
      setup.env.HERDR_CLIENT_SOCKET_PATH ||
      setup.env.HERDR_SSH_HOST ||
      setup.env.HERDR_SESSION,
  );
}

function implicitDefault(
  context: CliContext,
  setup: ServiceSetup,
): StartupLocalProfile {
  const sockets = serviceHerdrSockets(context.runtime, setup.env);
  return {
    id: STARTUP_DEFAULT_CONNECTION_ID,
    label: "Default",
    type: "local",
    control_socket_path: sockets.socketPath,
    client_socket_path: sockets.clientSocketPath,
    auto_connect: true,
  };
}

function describe(profile: ManagedConnectionProfile): string {
  if (isCoreProfile(profile)) {
    const where =
      profile.type === "ssh"
        ? ` ${profile.ssh_destination}${profile.remote_platform === "windows" ? " (Windows)" : ""}`
        : "";
    return `${profile.type === "ssh" ? "ssh  " : "local"}  herdr-core${where} (session ${profile.core_session})`;
  }
  if (profile.type === "local") return `local  ${profile.control_socket_path}`;
  const remote =
    profile.remote_platform === "windows"
      ? ` (Windows${profile.remote_session ? `, session ${profile.remote_session}` : ""})`
      : "";
  return `ssh    ${profile.ssh_destination}${remote}`;
}

function finishEdit(
  context: CliContext,
  action: string,
  id: string,
  restart: boolean,
): number {
  context.log(
    action === "add"
      ? `Added connection ${id}.`
      : action === "remove"
        ? `Removed connection ${id}.`
        : `Default connection is now ${id}.`,
  );
  if (restart) {
    const code = restartRunningService(context);
    if (code === 0) context.log("Restarted the service.");
    return code ?? EXIT_OK;
  }
  return EXIT_OK;
}

function profileFromFlags(
  id: string,
  values: Record<string, string | boolean | undefined>,
): ConnectionProfile {
  const label = (values.label as string | undefined) ?? id;
  const autoConnect = values["auto-connect"] === true;
  const ssh = values.ssh as string | undefined;
  if (values.core === true) {
    const used = [
      "control-socket",
      "client-socket",
      "remote-control-socket",
      "remote-client-socket",
      "herdr-path",
    ].find((key) => values[key] !== undefined);
    if (used) throw new UsageError(`--${used} cannot be combined with --core`);
    if (values.windows && ssh === undefined)
      throw new UsageError("--windows requires --ssh");
    return validateConnectionProfile({
      id,
      label,
      type: ssh === undefined ? "local" : "ssh",
      runtime: "herdr-core",
      ...(ssh === undefined ? {} : { ssh_destination: ssh }),
      ...(values.windows ? { remote_platform: "windows" } : {}),
      core_session: (values.session as string | undefined) ?? "default",
      core_state_dir: "",
      auto_connect: autoConnect,
    });
  }
  const sshOnly = [
    "remote-control-socket",
    "remote-client-socket",
    "windows",
    "herdr-path",
    "session",
  ];
  if (ssh === undefined) {
    const used = sshOnly.find((key) => values[key] !== undefined);
    if (used) throw new UsageError(`--${used} requires --ssh`);
    if (!values["control-socket"] || !values["client-socket"])
      throw new UsageError(
        "add needs --ssh <destination>, or both --control-socket and --client-socket",
      );
    return validateConnectionProfile({
      id,
      label,
      type: "local",
      control_socket_path: values["control-socket"],
      client_socket_path: values["client-socket"],
      auto_connect: autoConnect,
    });
  }
  if (values["control-socket"] || values["client-socket"])
    throw new UsageError("local socket options cannot be combined with --ssh");
  const windows = values.windows === true;
  return validateConnectionProfile({
    id,
    label,
    type: "ssh",
    ssh_destination: ssh,
    remote_control_socket_path:
      (values["remote-control-socket"] as string | undefined) ?? "",
    remote_client_socket_path:
      (values["remote-client-socket"] as string | undefined) ?? "",
    auto_connect: autoConnect,
    ...(windows ? { remote_platform: "windows" } : {}),
    ...(values["herdr-path"] !== undefined
      ? { remote_herdr_path: values["herdr-path"] }
      : {}),
    ...(values.session !== undefined ? { remote_session: values.session } : {}),
  });
}

export function createConnectionsCommand(
  dependencies: ConnectionsDependencies = {},
): CliCommand {
  const probe = dependencies.probe ?? probeListener;
  const test = dependencies.test ?? testConnectionProfile;
  const herdrInstalled =
    dependencies.herdrInstalled ??
    (async (implicit: StartupLocalProfile) =>
      (
        await detectHerdrSetup({
          ping: () => new HerdrClient(implicit.control_socket_path).ping(),
        })
      ).state !== "missing");
  return {
    name: "connections",
    summary: "list, test and edit Herdr connection profiles",
    actions: ["list", "test", "add", "remove", "set-default"],
    flags: [
      "--json",
      "--ssh",
      "--control-socket",
      "--client-socket",
      "--label",
      "--auto-connect",
      "--default",
      "--restart",
      "--remote-control-socket",
      "--remote-client-socket",
      "--windows",
      "--herdr-path",
      "--session",
    ],
    help: connectionsHelp,
    async run(args, context) {
      const action = args[0];
      if (wantsHelp(args) || action === undefined) {
        context.log(connectionsHelp());
        return EXIT_OK;
      }
      const rest = args.slice(1);
      const setup = readServiceSetup(context.runtime);
      const store = new ConnectionProfileStore({
        path: connectionRegistryPath(context.runtime, setup.env),
      });
      let edit:
        | {
            id: string;
            values: Record<string, string | boolean | undefined>;
            profile?: ConnectionProfile;
          }
        | undefined;
      if (action === "add" || action === "remove" || action === "set-default") {
        const { values, positionals } =
          action === "add"
            ? parseCommandArgs(rest, ADD_OPTIONS, 1)
            : parseCommandArgs(rest, { restart: { type: "boolean" } }, 1);
        const id = positionals[0];
        if (!id)
          throw new UsageError(`connections ${action} needs a connection id`);
        let profile: ConnectionProfile | undefined;
        if (action === "add") {
          try {
            profile = profileFromFlags(id, values);
          } catch (error) {
            if (error instanceof UsageError) throw error;
            throw new UsageError((error as Error).message, { cause: error });
          }
        }
        edit = { id, values, profile };
        // Do not load, validate against, or save a CLI snapshot while the service
        // owns the registry. Settings and CLI mutations share its admission queue.
        if (await probe(readServiceAccess(setup))) {
          try {
            const reply = await (
              dependencies.apply ?? applyLiveConnectionChange
            )(context, setup, action, {
              registry_path: store.path,
              id,
              profile,
              default: edit.values.default === true,
            });
            if (!reply.ok) {
              if (reply.code === "usage")
                throw new UsageError(
                  reply.error ?? "connection change refused",
                );
              throw new Error(reply.error ?? "connection change refused");
            }
          } catch (error) {
            if (error instanceof UsageError) throw error;
            context.error(
              `herdr-world connections: ${(error as Error).message}. No offline write was attempted; check the live catalogue before retrying.`,
            );
            return EXIT_FAILURE;
          }
          return finishEdit(context, action, id, values.restart === true);
        }
        // A starting or unreachable managed service can still own the file.
        let active = false;
        try {
          active = serviceStatus(context).active;
        } catch {
          /* foreground-only platform */
        }
        if (active) {
          context.error(
            "herdr-world connections: the managed service is active but not reachable; the registry was not changed.",
          );
          return EXIT_FAILURE;
        }
      }
      const registry = store.load();
      // Copy: the explicit default is listed but must never reach a save.
      const profiles: ManagedConnectionProfile[] = registry
        ? [...registry.profiles]
        : [implicitDefault(context, setup)];
      const defaultId = explicitOverride(setup)
        ? STARTUP_DEFAULT_CONNECTION_ID
        : (registry?.default_connection_id ?? STARTUP_DEFAULT_CONNECTION_ID);
      if (registry && explicitOverride(setup))
        profiles.unshift(implicitDefault(context, setup));

      if (action === "list") {
        const { values } = parseCommandArgs(rest, {
          json: { type: "boolean" },
        });
        if (values.json) {
          printJson(context, {
            path: store.path,
            default_connection_id: defaultId,
            profiles: profiles.map((profile) => ({
              ...profile,
              default: profile.id === defaultId,
              saved: profile.id !== STARTUP_DEFAULT_CONNECTION_ID,
            })),
          });
          return EXIT_OK;
        }
        context.log(displayPath(store.path, context.runtime));
        if (!registry)
          context.log(
            "No saved profiles; Herdr World uses the default local connection.",
          );
        const width = Math.max(...profiles.map((profile) => profile.id.length));
        for (const profile of profiles) {
          const flags = [
            profile.id === defaultId ? "default" : "",
            profile.auto_connect ? "auto-connect" : "",
            profile.id === STARTUP_DEFAULT_CONNECTION_ID
              ? "from service config"
              : "",
          ].filter(Boolean);
          context.log(
            `${profile.id === defaultId ? "*" : " "} ${profile.id.padEnd(width)}  ${describe(profile)}  ${profile.label}${flags.length ? `  [${flags.join(", ")}]` : ""}`,
          );
        }
        return EXIT_OK;
      }

      if (action === "test") {
        const { values, positionals } = parseCommandArgs(
          rest,
          { json: { type: "boolean" } },
          Number.POSITIVE_INFINITY,
        );
        const selected = positionals.length
          ? positionals.map((id) => {
              const profile = profiles.find((entry) => entry.id === id);
              if (!profile) throw new UsageError(`unknown connection: ${id}`);
              return profile;
            })
          : profiles;
        const results = await Promise.all(
          selected.map(async (profile) => {
            try {
              if (isCoreProfile(profile))
                throw new Error(
                  "herdr-core connections are tested from the Connections page",
                );
              const result = await test(profile);
              return {
                id: profile.id,
                ok: true,
                version: result.version,
                protocol: result.protocol,
              };
            } catch (error) {
              return {
                id: profile.id,
                ok: false,
                error: (error as Error).message,
              };
            }
          }),
        );
        if (values.json) printJson(context, { results });
        else
          for (const result of results) {
            context.log(
              result.ok
                ? `ok    ${result.id}  Herdr ${result.version ?? "(unknown version)"}, protocol ${result.protocol}`
                : `fail  ${result.id}  ${result.error}`,
            );
          }
        return results.every((result) => result.ok) ? EXIT_OK : EXIT_FAILURE;
      }

      if (action === "add" || action === "remove" || action === "set-default") {
        const { id, values: flagValues } = edit!;
        let next: PersistedConnectionRegistry | null;
        if (action === "add") {
          const profile = edit!.profile!;
          if (profiles.some((entry) => entry.id === id))
            throw new UsageError(`connection already exists: ${id}`);
          if (registry) {
            next = {
              ...registry,
              version: CONNECTION_PROFILE_FILE_VERSION,
              profiles: [...registry.profiles, profile],
            };
          } else if (explicitOverride(setup)) {
            if (isCoreProfile(profile))
              throw new UsageError(
                "add a Herdr connection before a herdr-core one",
              );
            next = {
              version: CONNECTION_PROFILE_FILE_VERSION,
              default_connection_id: profile.id,
              profiles: [profile],
            };
          } else if (
            isCoreProfile(profile) &&
            !(await herdrInstalled(implicitDefault(context, setup)))
          ) {
            // Like the web UI: no Herdr TUI, so no Local profile; core is
            // the default (#935).
            next = {
              version: CONNECTION_PROFILE_FILE_VERSION,
              default_connection_id: profile.id,
              profiles: [profile],
            };
          } else {
            // Like the web UI, keep the implicit local server as a saved profile.
            const implicit = implicitDefault(context, setup);
            const seed: ConnectionProfile = {
              id: id === "local" ? "localhost" : "local",
              label: "Local",
              type: "local",
              control_socket_path: implicit.control_socket_path,
              client_socket_path: implicit.client_socket_path,
              auto_connect: true,
            };
            next = {
              version: CONNECTION_PROFILE_FILE_VERSION,
              default_connection_id: seed.id,
              profiles: [seed, profile],
            };
          }
          if (flagValues.default === true) {
            if (explicitOverride(setup))
              throw new UsageError(
                "explicit Herdr settings in the service config remain the default connection",
              );
            next.default_connection_id = profile.id;
          }
        } else {
          if (
            !registry ||
            id === STARTUP_DEFAULT_CONNECTION_ID ||
            !registry.profiles.some((entry) => entry.id === id)
          )
            throw new UsageError(`no saved connection: ${id}`);
          if (action === "set-default") {
            if (explicitOverride(setup))
              throw new UsageError(
                "explicit Herdr settings in the service config remain the default connection",
              );
            next = {
              ...registry,
              version: CONNECTION_PROFILE_FILE_VERSION,
              default_connection_id: id,
            };
          } else {
            if (
              registry.default_connection_id === id &&
              !explicitOverride(setup)
            )
              throw new UsageError(
                "cannot remove the default connection; choose another default first",
              );
            const remaining = registry.profiles.filter(
              (entry) => entry.id !== id,
            );
            // Without explicit Herdr settings the last profile is always the
            // default, so only an explicit override can clear the registry.
            next = remaining.length
              ? {
                  ...registry,
                  version: CONNECTION_PROFILE_FILE_VERSION,
                  profiles: remaining,
                  default_connection_id:
                    registry.default_connection_id === id
                      ? remaining[0].id
                      : registry.default_connection_id,
                }
              : null;
          }
        }

        if (next) await store.save(next);
        else await store.clear();
        return finishEdit(context, action, id, flagValues.restart === true);
      }

      throw new UsageError(`unknown connections action: ${action}`);
    },
  };
}
