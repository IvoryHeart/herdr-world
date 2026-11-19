import { existsSync } from "node:fs";
import { WORLD_INTEGRATIONS_PATH } from "../../../shared/integrations";
import { type CliRuntime, currentRuntime } from "../cli/command";
import { worldIntegrationStatus } from "../cli/integration";
import { integrationPaths, WORLD_HARNESSES } from "../cli/integration-paths";
import type { ConnectionProfileService } from "../connections/profile-service";
import { createSourcesHttpHandler } from "../sources/http";
import type { SourcesService } from "../sources/service";
import type { OfficeObservabilityService } from "../world/observability";
import {
  type HarnessInput,
  type IntegrationsInputs,
  integrationsSnapshot,
  type RuntimeInput,
} from "./registry";
import { fileVault, type Vault } from "./vault";

type Profiles = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: any runtime type lists alike.
  ConnectionProfileService<any>,
  "list" | "coreList"
>;

/** The registry's inputs from the service's existing owners. */
export function serviceIntegrationsInputs(args: {
  profiles: Profiles;
  sources: Pick<SourcesService, "snapshot">;
  metrics: Pick<OfficeObservabilityService, "configuration">;
  /** Where harness configuration lives; the service user's by default. */
  runtime?: () => CliRuntime;
  vault: Pick<Vault, "status">;
  now: () => number;
}): IntegrationsInputs {
  return {
    runtimes: () => [
      ...args.profiles.list().map(
        (item): RuntimeInput => ({
          id: item.id,
          label: item.label,
          runtime: "herdr",
          state: item.state,
          generation: item.generation,
          transport: item.type === "ssh" ? "ssh" : "local",
          ...(item.type === "ssh"
            ? { sshDestination: item.ssh_destination }
            : {}),
          readOnly: item.read_only,
          ...(item.error ? { error: item.error.message } : {}),
        }),
      ),
      ...args.profiles.coreList().map(
        (item): RuntimeInput => ({
          id: item.id,
          label: item.label,
          runtime: "herdr-core",
          state: item.state,
          generation: item.generation,
          transport: item.type,
          ...(item.type === "ssh" && item.ssh_destination
            ? { sshDestination: item.ssh_destination }
            : {}),
          readOnly: item.read_only,
          ...(item.error ? { error: item.error.message } : {}),
        }),
      ),
    ],
    sources: async () => (await args.sources.snapshot()).sources,
    metrics: () => args.metrics.configuration(),
    harnesses: () => {
      const runtime = (args.runtime ?? currentRuntime)();
      return WORLD_HARNESSES.map((harness): HarnessInput => {
        const config = integrationPaths(harness, runtime)?.config;
        return {
          skill: worldIntegrationStatus(harness, runtime),
          detected: config ? existsSync(config) : false,
        };
      });
    },
    vault: () => args.vault.status(),
    now: args.now,
  };
}

/** `GET /api/world/integrations`: the read-only registry. */
export function createIntegrationsHttpHandler(inputs: IntegrationsInputs) {
  return async (request: Request, pathname: string) => {
    if (pathname !== WORLD_INTEGRATIONS_PATH) return null;
    if (request.method !== "GET")
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET" },
      });
    return Response.json(await integrationsSnapshot(inputs), {
      headers: { "cache-control": "no-store" },
    });
  };
}

/**
 * The service's `/api/world` sources handler with the read-only registry
 * ahead of it. Each registry row acts through its owner's existing route.
 */
export function withIntegrations(
  sources: SourcesService,
  owners: {
    profiles: Profiles;
    metrics: Pick<OfficeObservabilityService, "configuration">;
    vaultPath: string;
    now: () => number;
  },
) {
  const next = createSourcesHttpHandler(sources);
  const integrations = createIntegrationsHttpHandler(
    serviceIntegrationsInputs({
      ...owners,
      sources,
      vault: fileVault(owners.vaultPath),
    }),
  );
  return async (request: Request, pathname: string) =>
    (await integrations(request, pathname)) ?? next(request, pathname);
}
