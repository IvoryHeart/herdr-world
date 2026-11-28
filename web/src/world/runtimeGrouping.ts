import { worldLocalStorage } from "../browserStorage";
import {
  parseRuntimeGrouping,
  RUNTIME_GROUPING_DEFAULT,
  type RuntimeGrouping,
} from "../../../shared/hostGrouping";
import { readOfficePreferences } from "./officePreferences";

/**
 * World's "Group runtimes" setting (#1307) in this browser. The browser keeps
 * no copy of it: World publishes the setting and the grouping derived from it
 * under one revision (`host_grouping`, shared/hostGrouping.ts), and every
 * view, the Settings control included, reads that one value from the
 * replica (world/runtimeStore.ts). An explicit change is a World command
 * (`world.command`, entity `setting`), which World records in its change
 * history; the views follow once World publishes it.
 *
 * Before #1307 the choice was Town's own browser preference
 * (`officePreferences:v1` `townBuildings`). While the service holds no value,
 * a browser that holds a non-default older choice offers it once per
 * connection as an only-if-absent write: the service stores it only if no
 * value is stored meanwhile, so it never replaces an explicit choice.
 */

/**
 * The Settings control's way to World's published grouping. The Settings
 * catalog loads apart from the World views and this module loads with the
 * page's settings store, so neither imports the replica: the World app hands
 * over a reader of the replica and its World command
 * (world/worldCommands.ts `installRuntimeGroupingControl`). It holds no
 * value of its own.
 */
type RuntimeGroupingControl = {
  get(): RuntimeGrouping;
  subscribe(listener: () => void): () => void;
  set(value: RuntimeGrouping): void;
};

let control: RuntimeGroupingControl | null = null;
const controlListeners = new Set<() => void>();
const notifyControl = () => {
  for (const listener of controlListeners) listener();
};

/** The World app's reader and command; installed once per page. */
export function provideRuntimeGroupingControl(next: RuntimeGroupingControl) {
  if (control) return;
  control = next;
  next.subscribe(notifyControl);
  notifyControl();
}

/** What the Settings control shows and does. */
export const runtimeGroupingControl = {
  get: (): RuntimeGrouping => control?.get() ?? RUNTIME_GROUPING_DEFAULT,
  set: (value: RuntimeGrouping) => control?.set(value),
  subscribe(listener: () => void) {
    controlListeners.add(listener);
    return () => {
      controlListeners.delete(listener);
    };
  },
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type LegacyOffer = (value: RuntimeGrouping) => Promise<unknown>;

/**
 * One browser's one-time offer of its pre-#1307 Town choice. The page has
 * one (below); the exhaustive schedule test
 * (server/src/bridge/runtime-grouping-schedules.test.ts) runs several
 * against one service.
 *
 * @internal
 */
export function createRuntimeGroupingMigration(storage: PreferenceStorage) {
  let send: LegacyOffer | null = null;
  let offered = false;
  return {
    /** The write path while the socket is connected; null when it closes. */
    connect(next: LegacyOffer | null) {
      send = next;
      offered = false;
    },
    /**
     * The service's stored value: on connecting and at each publication.
     * While it holds none, this browser's older choice is offered once.
     */
    adopt(stored: unknown) {
      const write = send;
      if (offered || !write || parseRuntimeGrouping(stored)) return;
      if (readOfficePreferences(storage).townBuildings !== "runtime") return;
      offered = true;
      // A refused offer is made again on the next connection.
      void write("runtime").catch(() => {});
    },
  };
}

const page = createRuntimeGroupingMigration(worldLocalStorage);

export const connectRuntimeGroupingMigration = page.connect;
export const adoptRuntimeGroupingSetting = page.adopt;
