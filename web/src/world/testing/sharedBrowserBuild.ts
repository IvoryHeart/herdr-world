import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { assertionPhases } from "./assertionPhases";

export type SerializedBuild = {
  success: boolean;
  logs: string[];
  outputs: { name: string; kind: string; type: string; bytes: string }[];
};
export type BuildRequest = {
  key: string;
  action: "claim" | "complete" | "fail";
  label?: string;
  output?: SerializedBuild;
  error?: string;
};
const builds = new Map<string, Promise<SerializedBuild>>();

/** One immutable bundle per fixture/configuration per runner, across test processes. */
export async function sharedBrowserBuild(
  owner: string,
  options: Bun.BuildConfig,
) {
  const { outdir, ...configuration } = options;
  const key = createHash("sha256")
    .update("assertion-phases-v1")
    .update(owner)
    .update(
      JSON.stringify(configuration, (_, value) =>
        typeof value === "function" ? value.toString() : value,
      ),
    )
    .digest("hex");
  const send = async (build: BuildRequest) => {
    const response = await fetch(process.env.HERDR_TEST_BROWSER!, {
      method: "POST",
      headers: {
        authorization: process.env.HERDR_TEST_BROWSER_TOKEN!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        build: {
          ...build,
          label: `${basename(owner)}: ${options.entrypoints.map((entry) => basename(entry)).join(", ")}`,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`Shared browser build failed: ${await response.text()}`);
    return response.json() as Promise<{
      owner: boolean;
      output?: SerializedBuild;
    }>;
  };
  let pending = builds.get(key);
  if (!pending) {
    pending = (async () => {
      const claim = process.env.HERDR_TEST_BROWSER
        ? await send({ key, action: "claim" })
        : { owner: true };
      if (!claim.owner) return claim.output!;
      try {
        const result = await Bun.build({
          ...options,
          plugins: [...(options.plugins ?? []), assertionPhases],
        });
        const output = {
          success: result.success,
          logs: result.logs.map((message) => String(message)),
          outputs: await Promise.all(
            result.outputs.map(async (asset) => ({
              name: basename(asset.path),
              kind: asset.kind,
              type: asset.type,
              bytes: Buffer.from(await asset.arrayBuffer()).toString("base64"),
            })),
          ),
        };
        if (process.env.HERDR_TEST_BROWSER)
          await send({ key, action: "complete", output });
        return output;
      } catch (error) {
        if (process.env.HERDR_TEST_BROWSER)
          await send({ key, action: "fail", error: String(error) }).catch(
            () => {},
          );
        throw error;
      }
    })();
    builds.set(key, pending);
  }
  const result = await pending;
  return {
    success: result.success,
    logs: result.logs,
    outputs: result.outputs.map((asset) =>
      Object.assign(
        new Blob([Buffer.from(asset.bytes, "base64")], { type: asset.type }),
        {
          path: join(outdir || ".", asset.name),
          kind: asset.kind,
        },
      ),
    ),
  };
}
