import { TerminalTransportSettings } from "../../components/TerminalTransportSettings";
import { AgentAutoRenameSettings } from "../../components/AgentAutoRenameSettings";
import type { SettingsPageProps } from "../registry";
import { useStoreSelector } from "../../store";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../../useConnectionClient";

/** Connection-owned preferences, opened at their respective Settings entries. */
export default function ConnectionPage({ focus }: SettingsPageProps) {
  const label = useStoreSelector(
    (state) =>
      state.connections.find((c) => c.id === state.activeConnectionId)?.label ??
      "Current connection",
  );
  const connectionClient = useConnectionClient();
  const Preferences =
    focus === "auto-rename"
      ? AgentAutoRenameSettings
      : TerminalTransportSettings;
  return (
    <>
      <p className="configuration-scope">
        Connection: <strong>{label}</strong>
      </p>
      <Preferences
        key={connectionClientScopeKey(
          connectionClient,
          connectionClient.serverRuntimeGeneration,
        )}
      />
    </>
  );
}
