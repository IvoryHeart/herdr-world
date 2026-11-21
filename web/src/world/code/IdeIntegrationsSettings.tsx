import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { type IdeClient, pageIdeClient } from "./ideClient";
import { IdeProviderList } from "./IdeProviders";
import { IdeServerList } from "./IdeServers";
import { useIdeStatus } from "./useIdeStatus";
import "./IdeProviders.css";

/**
 * Settings → Integrations: the installed IDEs on World's own computer, the
 * same rows the Code view shows before one is enabled, and every IDE server
 * World started that still runs, here or on an SSH host, with Stop.
 */
export function IdeIntegrationsSettings({ client }: { client?: IdeClient }) {
  const ide = useMemo(() => client ?? pageIdeClient(), [client]);
  const { status, error, reload, apply } = useIdeStatus(ide);
  return (
    <section className="ide-integrations-settings" aria-label="IDEs">
      <div className="agent-integrations-toolbar">
        <div className="agent-integrations-heading">
          <strong>This World computer</strong>
          <span>IDEs for the Code view</span>
        </div>
        <button
          type="button"
          className="agent-integrations-icon-button"
          aria-label="Look for IDEs again"
          title="Look for IDEs again"
          onClick={() => void reload(true)}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      {status ? (
        <>
          <IdeProviderList status={status} client={ide} onStatus={apply} />
          <div className="agent-integrations-heading">
            <strong>Running IDE servers</strong>
            <span>They run until you stop them, also while World is away</span>
          </div>
          <IdeServerList
            status={status}
            onStop={async (instance) => apply(await ide.stop(instance.id))}
            onForget={async (instance) => apply(await ide.forget(instance.id))}
          />
        </>
      ) : (
        <p className="muted" role={error ? "alert" : "status"}>
          {error ?? "Looking for installed IDEs…"}
        </p>
      )}
    </section>
  );
}
