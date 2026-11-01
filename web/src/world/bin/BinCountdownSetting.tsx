import { Trash2 } from "lucide-react";
import { useState } from "react";
import { bridge } from "../../api";
import {
  BIN_COUNTDOWNS,
  BIN_COUNTDOWN_LABELS,
  DEFAULT_BIN_COUNTDOWN,
  parseBinCountdown,
} from "../../../../shared/bin";
import { useWorldBin, worldBinStore } from "./binStore";

/** Settings › Views: how long an agent waits in the bin (or for the bus). */
export function BinCountdownSetting() {
  const store = worldBinStore(bridge);
  const bin = useWorldBin(store);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="config-preference-row">
      <span className="config-item-icon">
        <Trash2 size={15} />
      </span>
      <span className="config-item-copy">
        <strong>Bin countdown</strong>
        <span>
          {error ??
            "How long an agent waits in the bin, or for Town's bus, before it is closed"}
        </span>
      </span>
      <select
        className="config-preference-select"
        aria-label="Bin countdown"
        value={bin.countdown_s}
        disabled={!bin.verified}
        onChange={(event) => {
          setError(null);
          void store
            .setCountdown(parseBinCountdown(Number(event.target.value)))
            .catch((reason) =>
              setError(
                reason instanceof Error ? reason.message : String(reason),
              ),
            );
        }}
      >
        {BIN_COUNTDOWNS.map((seconds) => (
          <option key={seconds} value={seconds}>
            {BIN_COUNTDOWN_LABELS[seconds]}
            {seconds === DEFAULT_BIN_COUNTDOWN ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
