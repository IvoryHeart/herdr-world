import type { DataPaths } from "../config/data-paths";
import type { GuiSettingsStore } from "../config/gui-settings";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import { storedSourceSettings, withSourceSettings } from "./http";
import { CheckoutResolver, type CheckoutHost } from "./links";
import { readSourceSecrets, writeSourceSecrets } from "./secrets";
import { SourcesService, type SourcesServiceOptions } from "./service";

/** Shared sign-in, non-interactive process runner and private source settings. */
export async function runSourceProcess(argv: string[], timeoutMs: number) {
  try {
    return await runProcessWithCodeTimeout(argv, timeoutMs, {
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GIT_TERMINAL_PROMPT: "0",
        NO_COLOR: "1",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { code: 127, stdout: "", stderr: "" };
    throw error;
  }
}

export async function composeSources(
  options: Pick<SourcesServiceOptions, "topology" | "runtimeOwners" | "now"> & {
    settings: GuiSettingsStore;
    paths: DataPaths;
    storageOpen(): boolean;
    hostOf(connectionId: string): CheckoutHost | null;
  },
) {
  return new SourcesService({
    settings: await options.settings
      .read()
      .then(storedSourceSettings)
      .catch(() => ({})),
    persistSettings: async (sources) => {
      await options.settings.update((current) =>
        withSourceSettings(current, sources),
      );
    },
    secrets: {
      read: () => readSourceSecrets(options.paths.sourceSecrets),
      write: (secrets) => {
        if (!options.storageOpen()) throw new Error("World storage is closed");
        writeSourceSecrets(secrets, options.paths.sourceSecrets);
      },
    },
    run: runSourceProcess,
    topology: options.topology,
    runtimeOwners: options.runtimeOwners,
    resolver: new CheckoutResolver(runSourceProcess, options.hostOf),
    now: options.now,
  });
}
