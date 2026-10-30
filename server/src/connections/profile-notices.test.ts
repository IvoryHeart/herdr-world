import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager, type ConnectionRuntime } from "./manager";
import { ConnectionProfileService } from "./profile-service";
import {
  ConnectionProfileStore,
  type LocalConnectionProfile,
} from "./profiles";

test("profile create, edit, default and removal publish after the catalogue changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "profile-notices-"));
  const local = (id: string): LocalConnectionProfile => ({
    id,
    label: id,
    type: "local",
    auto_connect: false,
    control_socket_path: join(root, `${id}-control.sock`),
    client_socket_path: join(root, `${id}-render.sock`),
  });
  const manager = new ConnectionManager<ConnectionRuntime>("alpha");
  const catalogues: string[][] = [];
  const service: ConnectionProfileService<ConnectionRuntime> =
    new ConnectionProfileService({
      manager,
      store: new ConnectionProfileStore({
        path: join(root, "connections.json"),
      }),
      bootstrap: {
        defaultConnectionId: "alpha",
        explicitStartupOverride: false,
        persistedRegistry: {
          version: 1,
          default_connection_id: "alpha",
          profiles: [local("alpha")],
        },
        registrations: [{ profile: local("alpha"), readOnly: false }],
      },
      createRuntime: (profile) => () => ({
        identity: { id: profile.id, label: profile.label, source: "test" },
        async startTransport() {},
        startBackground() {},
        async stop() {},
      }),
      changed: () => {
        catalogues.push(
          service
            .list()
            .map(
              (profile) =>
                `${profile.id}:${profile.label}:${profile.is_default}`,
            ),
        );
      },
    });
  try {
    await service.create(local("beta"));
    await service.update("beta", { ...local("beta"), label: "Renamed" });
    await service.setDefault("beta");
    await service.remove("alpha");
    expect(catalogues).toEqual([
      ["alpha:alpha:true", "beta:beta:false"],
      ["alpha:alpha:true", "beta:Renamed:false"],
      ["alpha:alpha:false", "beta:Renamed:true"],
      ["beta:Renamed:true"],
    ]);
    await expect(service.update("missing", local("missing"))).rejects.toThrow();
    expect(catalogues).toHaveLength(4);
  } finally {
    service.stopSupervision();
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});
