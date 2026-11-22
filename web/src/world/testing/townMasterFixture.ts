import { DEFAULT_CHIMES } from "../../../../shared/chimes";
import { bridge } from "../../api";
import {
  refreshProfiles,
  type ProfilesDocument,
  type TerminalKey,
} from "../agentProfiles";

/** Browser fixtures exercise the synced profiles store, without a World service. */
export function installTownMasterFixture() {
  let document: ProfilesDocument = {
    version: 1,
    revision: 1,
    profiles: [],
    assignments: [],
    chimes: structuredClone(DEFAULT_CHIMES),
    town_master: null,
  };
  const call = bridge.call.bind(bridge);
  bridge.call = async (method, params, timeout) => {
    if (method === "world.profiles.get") return structuredClone(document);
    if (method === "world.town_master.set") {
      document = {
        ...document,
        revision: document.revision + 1,
        town_master: params?.terminal as TerminalKey | null,
      };
      return structuredClone(document);
    }
    return call(method, params, timeout);
  };
  return async (holder: TerminalKey | null) => {
    document = {
      ...document,
      revision: document.revision + 1,
      town_master: holder,
    };
    await refreshProfiles();
  };
}
