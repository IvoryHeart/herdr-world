import type { BridgeRuntime } from "../bridge";
import type { HostProfile } from "../hostProfile";
import { hostConnectionState } from "../runtimeClient";
import type { BridgeConnectionState } from "../runtimeConnection";
import type { WorldHostLocation, WorldRuntimeSource } from "./worldModel";

export function worldSourcesFromRuntime(
  profiles: readonly HostProfile[],
  runtimes: readonly BridgeRuntime[],
  connectionStates: Readonly<Record<string, BridgeConnectionState>>,
): WorldRuntimeSource[] {
  const runtimeByProfile = new Map(runtimes.map((runtime) => [runtime.id, runtime]));

  return profiles.map((profile) => {
    const runtime = runtimeByProfile.get(profile.profileId) ?? null;
    const state =
      runtime && connectionStates[profile.profileId]?.connectionKey === runtime.generationKey
        ? connectionStates[profile.profileId]
        : null;
    const features = runtime?.capabilities?.features ?? [];
    const supportsSnapshot = features.includes("snapshot");
    const snapshot = state?.snapshot ?? null;

    return {
      profile,
      location: hostLocation(profile.baseUrl, runtime?.mode),
      connectionState: !profile.enabled
        ? "disabled"
        : runtime
          ? hostConnectionState(
              runtime.capabilityState,
              state?.loadState ?? "loading",
              snapshot !== null,
              supportsSnapshot,
            )
          : "connecting",
      generationKey: state && runtime ? runtime.generationKey : null,
      features,
      snapshot,
    };
  });
}

function hostLocation(baseUrl: string, mode: BridgeRuntime["mode"] | undefined): WorldHostLocation {
  if (mode === "same-origin") {
    return "local";
  }
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
      ? "local"
      : "remote";
  } catch {
    return "remote";
  }
}
