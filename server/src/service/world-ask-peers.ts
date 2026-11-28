import { instanceDisplayName } from "../../../shared/instanceName";
import type { ManagedConnectionProfile } from "../connections/profile-service";
import { connectionRecoveryFingerprint } from "../connections/profiles";
import {
  type AskPeers,
  createAskPeers,
  sameAlertQuestion,
} from "../world/ask-peers";
import type { CliActor, LedgerStore } from "../world/world-ledger";

type PeerOptions = Omit<
  Parameters<typeof createAskPeers>[0],
  "runtimes" | "name" | "isLocal" | "held"
>;

/**
 * Owner questions held by sibling World instances on one runtime (#1152):
 * this World's name and runtime keys, and the peers it reads once it listens.
 */
export function createWorldAskPeers(deps: {
  titleSuffix(): Promise<string | undefined>;
  profiles(): Map<string, ManagedConnectionProfile>;
  coreIds(): string[];
  /** The Herdr connection that alerts for a herdr-core or unplaced asker. */
  alertConnectionId(): string | null;
  /** This World's own questions. */
  ledger(): Pick<LedgerStore, "ask" | "openAsks">;
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
     * The runtimes a new question belongs to, captured once when it is
     * recorded: it shows wherever its alert does, the asker's runtime and the
     * Herdr connection that alerts for a herdr-core or unplaced asker.
     * Editing a saved connection later does not move the question.
     */
    askRuntimes: (asker: CliActor) => {
      const connection = asker.connection_id;
      const core = !!connection && deps.coreIds().includes(connection);
      return [
        ...new Set(
          [
            ...(connection ? [connection] : []),
            ...(!connection || core ? [deps.alertConnectionId()] : []),
          ]
            .filter((id): id is string => !!id)
            .flatMap(key),
        ),
      ];
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
        // An alert for a question held here, possibly shortened.
        isLocal: (id, question) => {
          const local = deps.ledger().ask(id)?.question;
          return local !== undefined && sameAlertQuestion(question, local);
        },
        // Open questions stay findable on the runtimes they were asked on.
        held: () =>
          deps
            .ledger()
            .openAsks()
            .asks.flatMap((ask) => ask.runtimes ?? []),
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
    /** Settles after `count` more sibling reads; see `AskPeers.afterReads`. */
    afterReads: (count = 1) =>
      peers
        ? peers.afterReads(count)
        : Promise.reject(new Error("not started")),
  };
}
