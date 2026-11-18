import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeConnectionProfiles } from "../connections/first-run";
import { ConnectionProfileStore } from "../connections/profiles";

/** Exercise production first-run discovery against scratch state, never the user's registry. */
export async function checkCoreOnlyFirstRun(
  root: string,
  socket: string,
): Promise<string> {
  const state = join(root, "first-run-state");
  const coreState = join(state, "herdr-core", "default");
  mkdirSync(coreState, { recursive: true, mode: 0o700 });
  writeFileSync(join(coreState, "core.lock"), socket);
  const store = new ConnectionProfileStore({
    path: join(root, "first-run-world", "connections.json"),
  });
  try {
    const bootstrap = await initializeConnectionProfiles({
      store,
      explicitStartupOverride: false,
      startupProfile: {
        id: "startup-default",
        label: "Default",
        type: "local",
        auto_connect: true,
        control_socket_path: join(root, "absent-tui.sock"),
        client_socket_path: join(root, "absent-tui-client.sock"),
      },
      discovery: {
        homeDir: root,
        platform: "linux",
        env: { PATH: "", XDG_STATE_HOME: state },
      },
    });
    const saved = store.load();
    if (
      bootstrap.defaultConnectionId !== "core-local" ||
      saved?.profiles.length !== 1 ||
      !saved.profiles.every(
        (profile) => "runtime" in profile && profile.runtime === "herdr-core",
      )
    ) {
      throw new Error(
        "Core-only first run did not discover and save core-local as its only default.",
      );
    }
    return bootstrap.defaultConnectionId;
  } finally {
    await store.close();
  }
}
