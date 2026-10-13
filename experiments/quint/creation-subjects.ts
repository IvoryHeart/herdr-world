// One bundle boundary preserves shared singleton/class identities in fault controls.
export { bridge, UncertainRequestError } from "../../web/src/api";
export {
  store,
  __storeTesting,
  emptyServerSessionState,
  connectionSnapshot,
} from "../../web/src/store";
export {
  creationSources,
  subscribeCreationSources,
  subscribeCreations,
  creationPendingReason,
  creationFailureMessage,
  retainCreationSource,
} from "../../web/src/creationRequests";
export {
  admitCreatedTerminal,
  createdTerminalIdentity,
} from "../../web/src/world/createdTerminalAdmission";
