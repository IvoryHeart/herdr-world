import { useEffect } from "react";
import { worldLocalStorage } from "../../browserStorage";
import { store } from "../../store";
import {
  profilesSnapshot,
  setTownMaster,
  type ProfilesDocument,
  type TerminalTarget,
} from "../agentProfiles";
import {
  OFFICE_PREFERENCES_KEY,
  forgetLegacyTownMaster,
  legacyTownMaster,
  readOfficePreferences,
} from "../officePreferences";
import { DEVTOOLS } from "../devtools/flag";
import type { WorldObject } from "../worldObject";

type StoragePort = Pick<Storage, "getItem" | "setItem">;

/** Import an explicit browser name once; never replace the shared role or guess a host. */
export async function migrateLegacyTownMaster(
  storage: StoragePort,
  world: Pick<WorldObject, "leaves">,
  document: ProfilesDocument | null,
  assign: (target: TerminalTarget) => Promise<unknown>,
) {
  const legacy = legacyTownMaster(storage);
  if (!Object.prototype.hasOwnProperty.call(legacy, "townMaster") || !document)
    return;
  const name = legacy.townMaster;
  if (
    document.town_master ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 64
  ) {
    forgetLegacyTownMaster(storage);
    return;
  }
  const wanted = name.trim().toLowerCase();
  const agents = world.leaves.filter((leaf) => leaf.kind === "agent");
  const native = agents.filter(
    (leaf) => leaf.agentName?.toLowerCase() === wanted,
  );
  const matches = native.length
    ? native
    : agents.filter(
        (leaf) =>
          (leaf.agentName ?? leaf.agentLabel ?? leaf.label).toLowerCase() ===
          wanted,
      );
  if (matches.length !== 1) return;
  const leaf = matches[0]!;
  if (leaf.stale || !(leaf.actionable || leaf.coreControl)) return;
  if (!forgetLegacyTownMaster(storage)) return;
  // The service arbitrates a concurrent claim through replace=false and checks this lease.
  await assign({
    connection_id: leaf.connectionId,
    connection_generation: leaf.generation,
    terminal_id: leaf.terminalId,
    pane_id: leaf.pane.pane_id,
  });
}

/** Development previews only: seed the retired preference without editing browser storage. */
export function seedLegacyTownMasterPreview() {
  if (!DEVTOOLS || typeof location === "undefined") return;
  const url = new URL(location.href);
  if (!url.searchParams.has("legacyTownMaster")) return;
  const name = url.searchParams.get("legacyTownMaster") ?? "";
  url.searchParams.delete("legacyTownMaster");
  history.replaceState(history.state, "", url);
  if (!name.trim() || name.length > 64) return;
  try {
    worldLocalStorage.setItem(
      OFFICE_PREFERENCES_KEY,
      JSON.stringify({
        ...readOfficePreferences(worldLocalStorage),
        townMaster: name,
      }),
    );
  } catch {
    /* A refused fixture write leaves the real preferences unchanged. */
  }
}

export function useLegacyTownMaster(
  world: WorldObject,
  document: ProfilesDocument | null,
) {
  useEffect(() => {
    seedLegacyTownMasterPreview();
    void migrateLegacyTownMaster(
      worldLocalStorage,
      world,
      profilesSnapshot(),
      (target) => setTownMaster(target),
    ).catch(() =>
      store.notify({
        kind: "error",
        message:
          "Town master could not be migrated. Choose an agent in Settings → Town master.",
      }),
    );
  }, [world, document]);
}
