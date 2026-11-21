import { instanceDisplayName } from "../../../shared/instanceName";
import type { ManagedConnectionProfile } from "../connections/profile-service";
import { connectionRecoveryFingerprint } from "../connections/profiles";
import { type AskPeers, createAskPeers } from "../world/ask-peers";
import type { LedgerAsk } from "../world/world-ledger";

type PeerOptions = Omit<
  Parameters<typeof createAskPeers>[0],
  "runtimes" | "name"
>;

/**
 * Owner questions held by sibling World instances on one runtime (#1152):
 * this World's name and runtime keys, and the peers it reads once it listens.
 */
export function createWorldAskPeers(deps: {
  titleSuffix(): Promise<string | undefined>;
  profiles(): Map<string, ManagedConnectionProfile>;
  coreIds(): string[];
  defaultId(): string;
}) {
  let peers: AskPeers | null = null;
  let name = instanceDisplayName("");
  let port = 0;
  const refreshName = () =>
    void deps
      .titleSuffix()
      .then((suffix) => {
        name = suffix
          ? instanceDisplayName(suffix)
          : `Herdr World on port ${port}`;
      })
      .catch(() => {});
  const key = (id: string) => {
    const profile = deps.profiles().get(id);
    return profile ? [connectionRecoveryFingerprint(profile)] : [];
  };
  return {
    peers: () => peers,
    homeName: () => name,
    /**
     * A question shows wherever its alert does: the asker's runtime, and the
     * default Herdr connection that alerts for a herdr-core or unplaced asker.
     */
    askRuntimes: (ask: LedgerAsk) => {
      const asker = ask.actor.connection_id;
      const core = !!asker && deps.coreIds().includes(asker);
      return [
        ...(asker ? [asker] : []),
        ...(!asker || core ? [deps.defaultId()] : []),
      ].flatMap(key);
    },
    /** An owner alert for a question another World may hold. */
    observeAlert(event: {
      kind: string;
      paneId?: string | null;
      title?: string;
      body?: string;
    }) {
      if (event.kind === "blocked" && !event.paneId)
        void peers?.observeAlert(event.title, event.body);
    },
    /**
     * Starts reading peers once World listens on `listenPort`; returns the
     * registry report's `asks` block.
     */
    start(listenPort: number, options: PeerOptions) {
      port = listenPort;
      // Named by its port until its saved title suffix is read.
      name = `Herdr World on port ${port}`;
      refreshName();
      const started = createAskPeers({
        ...options,
        runtimes: () =>
          [...deps.profiles().values()].map(connectionRecoveryFingerprint),
        name: () => name,
      });
      peers = started;
      started.start();
      return () => {
        refreshName();
        return { asks: started.report() };
      };
    },
    stop() {
      peers?.stop();
    },
  };
}
