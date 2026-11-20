import { TerminalTransportSettings } from "../../components/TerminalTransportSettings";
import { useStoreSelector } from "../../store";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../../useConnectionClient";

/** Settings → Integrations → Terminal transport, for the open connection. */
export default function ConnectionPage() {
  const label = useStoreSelector(
    (state) =>
      state.connections.find((c) => c.id === state.activeConnectionId)?.label ??
      "Current connection",
  );
  const connectionClient = useConnectionClient();
  return (
    <>
      <p className="configuration-scope">
        Connection: <strong>{label}</strong>
      </p>
      <TerminalTransportSettings
        key={connectionClientScopeKey(
          connectionClient,
          connectionClient.serverRuntimeGeneration,
        )}
      />
    </>
  );
}
