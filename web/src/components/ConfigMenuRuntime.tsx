import {
  ChevronDown,
  ChevronRight,
  Download,
  Server,
  Wifi,
} from "lucide-react";
import { ConfigMenuItem } from "./ConfigMenuItem";
import { HerdrSetupCard } from "./HerdrSetupCard";

/**
 * The Menu's Runtime section: Herdr's version and protocol, its upgrade or
 * setup, and the connection details. Today's Menu shows it always; the
 * Settings prototype (#1035) shows it when Settings opens "Herdr and
 * connection details", until it moves into Settings.
 */
export function ConfigMenuRuntime({
  herdrInfo,
  herdrUnavailable,
  herdrUpgrade,
  upgrading,
  connectionId,
  setupEnabled,
  socket,
  detailsOpen,
  onToggleDetails,
  onUpgrade,
}: {
  herdrInfo: { version: string; protocol: number } | null;
  herdrUnavailable: boolean;
  herdrUpgrade: { label: string; description: string } | null;
  upgrading: boolean;
  connectionId: string;
  setupEnabled: boolean;
  socket: string | undefined;
  detailsOpen: boolean;
  onToggleDetails(): void;
  onUpgrade(): void;
}) {
  return (
    <div className="config-section config-runtime-section">
      <div className="config-title">Runtime</div>
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
          label={upgrading ? "Updating Herdr..." : herdrUpgrade.label}
          description={herdrUpgrade.description}
          primary
          disabled={upgrading}
          onClick={onUpgrade}
        />
      ) : null}
      {herdrUnavailable ? (
        <HerdrSetupCard key={connectionId} enabled={setupEnabled} compact />
      ) : null}
      <button
        type="button"
        className="config-details-toggle"
        aria-expanded={detailsOpen}
        onClick={onToggleDetails}
      >
        <span className="config-item-icon">
          <Wifi size={15} />
        </span>
        <span>Connection details</span>
        {detailsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {detailsOpen ? (
        <div className="config-details">
          <ConfigRow label="URL" value={location.origin} />
          <ConfigRow label="Socket" value={socket ?? "-"} />
        </div>
      ) : null}
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
