import { AgentIntegrationsSettings } from "../../components/AgentIntegrationsSettings";
import { IntegrationsSettings } from "../../components/IntegrationsSettings";
import { shallowEqual, useStoreSelector } from "../../store";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../../useConnectionClient";
import type { SettingsPageProps } from "../registry";

/**
 * Settings → Integrations: the one Integrations screen (#1008), tabbed by
 * kind, with the Agents list for the connection that is open.
 */
export default function IntegrationsPage({ focus }: SettingsPageProps) {
  const s = useStoreSelector((state) => {
    const connection = state.connections.find(
      (c) => c.id === state.activeConnectionId,
    );
    return {
      connectionLabel: connection?.label ?? "Current connection",
      sshDestination: connection?.ssh_destination,
    };
  }, shallowEqual);
  const connectionClient = useConnectionClient();
  return (
    <IntegrationsSettings
      focus={focus}
      agents={(query, onMatches) => (
        <AgentIntegrationsSettings
          key={connectionClientScopeKey(
            connectionClient,
            connectionClient.serverRuntimeGeneration,
          )}
          connectionLabel={s.connectionLabel}
          sshDestination={s.sshDestination}
          query={query}
          onMatches={onMatches}
        />
      )}
    />
  );
}
