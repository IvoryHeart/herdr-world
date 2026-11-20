import { Download, Server, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfigMenuItem } from "../../components/ConfigMenuItem";
import { HerdrSetupCard } from "../../components/HerdrSetupCard";
import { connectionHttpPath } from "../../connectionHttp";
import {
  herdrUpgradeMenuEntry,
  herdrUpgradeOffered,
  shallowEqual,
  store,
  useStoreSelector,
} from "../../store";
import { useConnectionClient } from "../../useConnectionClient";
import type { SettingsPageProps } from "../registry";

/**
 * Settings → This World → Herdr and connection: Herdr's version and
 * protocol, its upgrade or setup, and the connection's address. Read when
 * the page opens, for the connection that is open then.
 */
export default function RuntimePage({ close }: SettingsPageProps) {
  const s = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      defaultConnectionId: state.defaultConnectionId,
      connectionPaused: state.connectionPaused,
      herdrUpgrading: state.herdrUpgrading,
    }),
    shallowEqual,
  );
  const connectionClient = useConnectionClient();
  // The upgrade concerns this machine's Herdr: offered on the default
  // connection only.
  const onDefaultConnection =
    !s.connectionPaused && s.activeConnectionId === s.defaultConnectionId;
  const [socket, setSocket] = useState<string>();
  const [herdrInfo, setHerdrInfo] = useState<{
    version: string;
    protocol: number;
  } | null>(null);
  const [herdrUnavailable, setHerdrUnavailable] = useState(false);
  const [herdrUpgrade, setHerdrUpgrade] = useState<{
    label: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHerdrInfo(null);
    setHerdrUnavailable(false);
    setHerdrUpgrade(null);
    if (onDefaultConnection)
      fetch("/api/herdr/status", {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((status) => {
          if (cancelled || !herdrUpgradeOffered(status)) return;
          setHerdrUpgrade(herdrUpgradeMenuEntry(status));
        });
    fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((info) => {
        if (!cancelled) setSocket(info?.socket);
      });
    if (connectionClient.isCurrent()) {
      const url = new URL(
        connectionHttpPath(
          connectionClient.connectionId,
          "/herdr-info",
          connectionClient.serverRuntimeGeneration,
        ),
        window.location.origin,
      );
      if (url.origin === window.location.origin)
        fetch(url, { credentials: "same-origin", cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((info) => {
            if (cancelled || !connectionClient.isCurrent()) return;
            if (info) setHerdrInfo(info);
            else setHerdrUnavailable(true);
          });
    }
    return () => {
      cancelled = true;
    };
  }, [connectionClient, onDefaultConnection]);

  return (
    <div className="config-section config-runtime-section">
      <div className="config-runtime-row">
        <span className="config-item-icon">
          <Server size={15} />
        </span>
        <div className="config-item-copy">
          <strong>Herdr server</strong>
          <span>
            {herdrInfo?.version
              ? `Version ${herdrInfo.version}`
              : herdrUnavailable
                ? "Unavailable"
                : "Loading server information"}
          </span>
        </div>
        <code>
          {typeof herdrInfo?.protocol === "number"
            ? `Protocol ${herdrInfo.protocol}`
            : "-"}
        </code>
      </div>
      {herdrUpgrade ? (
        <ConfigMenuItem
          icon={<Download size={15} />}
          label={s.herdrUpgrading ? "Updating Herdr..." : herdrUpgrade.label}
          description={herdrUpgrade.description}
          primary
          disabled={!!s.herdrUpgrading}
          onClick={() => {
            close();
            void store.upgradeHerdr();
          }}
        />
      ) : null}
      {herdrUnavailable && connectionClient.isCurrent() ? (
        <HerdrSetupCard
          key={connectionClient.connectionId}
          enabled={onDefaultConnection}
          compact
        />
      ) : null}
      <div className="config-runtime-row">
        <span className="config-item-icon">
          <Wifi size={15} />
        </span>
        <div className="config-item-copy">
          <strong>Connection details</strong>
          <span>How this browser reaches World</span>
        </div>
      </div>
      <div className="config-details">
        <ConfigRow label="URL" value={location.origin} />
        <ConfigRow label="Socket" value={socket ?? "-"} />
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}
