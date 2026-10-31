import type {
  ProfileStorePort,
  ProfilesDocument,
  ProfileAssignment,
} from "../agent/profile-store";
import { StorageWriteRejected, type StorageRequest } from "./world-protocol";
import type { ProfileOperation } from "./world-profiles";

/** Only acknowledged worker commits advance the synchronous launch/read cache. */
export function createProfilePort(
  initial: ProfilesDocument | null,
  request: <T>(operation: StorageRequest) => Promise<T>,
): ProfileStorePort {
  let document = initial && structuredClone(initial),
    closed = false;
  const get = () => {
    if (!document) throw new Error("World profiles were not initialized");
    return structuredClone(document);
  };
  const write = async (operation: ProfileOperation) => {
    if (closed) throw new StorageWriteRejected("World storage is closed");
    const next = await request<ProfilesDocument>({
      type: "profiles",
      operation: structuredClone(operation),
    });
    if (!document || next.revision >= document.revision) document = next;
    return structuredClone(next);
  };
  return {
    get,
    profile: (id) => get().profiles.find((profile) => profile.id === id),
    settingsState: () =>
      get().terminal_settings ?? {
        imported_connections: [],
        highest_master_revision: 0,
      },
    save: (profile) => write({ type: "save", profile }),
    saveChimes: (chimes) => write({ type: "chimes", chimes }),
    delete: (id) => write({ type: "delete", id }),
    assign: (assignment: ProfileAssignment) =>
      write({ type: "assign", assignment }),
    setTownMaster: (terminal, options = {}) =>
      write({ type: "legacy-master", terminal, replace: options.replace }),
    rememberMaster: async (revision) => {
      await write({ type: "remember-master", revision });
    },
    nextMasterRevision: async (minimum) =>
      (await write({ type: "next-master", minimum })).terminal_settings!
        .highest_master_revision,
    finishSettingsImport: async (connectionId) => {
      await write({ type: "finish-import", connectionId });
    },
    backupLegacySettings: () => {
      if (closed) throw new StorageWriteRejected("World storage is closed");
      // Startup cannot expose this port until its exact legacy backup and
      // one-time import have committed. There is no later JSON writer to back up.
    },
    close: () => {
      closed = true;
    },
  };
}
