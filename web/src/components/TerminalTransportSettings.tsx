import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Wifi } from "lucide-react";
import { bridge } from "../api";
import { useConnectionClient } from "../useConnectionClient";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const TRANSPORT_DESCRIPTION =
  "Reduces Herdr-to-Herdr World traffic when the server supports delta and reuse frames. " +
  "Saved by the Herdr World server for this connection and shared by all viewers. " +
  "Changes briefly reconnect terminal displays; running tasks are not stopped. " +
  "Older Herdr servers keep their existing transport.";

export function TerminalTransportSettings() {
  const client = useConnectionClient();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    message: string;
    value?: boolean;
  } | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await client.call("settings.terminal_transport.get");
      if (typeof result?.surface_codecs !== "boolean")
        throw new Error("Invalid terminal transport settings");
      if (
        !mounted.current ||
        !client.isCurrent() ||
        request !== sequence.current
      )
        return;
      setEnabled(result.surface_codecs);
      setError(null);
    } catch (e) {
      if (
        !mounted.current ||
        !client.isCurrent() ||
        request !== sequence.current
      )
        return;
      setEnabled(null);
      setError({ message: (e as Error).message });
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const off = bridge.onEvent((event) => {
      if (
        event.event === "settings.terminal_transport.updated" &&
        event.connection_id === client.connectionId &&
        client.acceptsServerGeneration(event.connection_generation) &&
        client.isCurrent()
      )
        void load();
    });
    return () => {
      mounted.current = false;
      sequence.current += 1;
      off();
    };
  }, [client, load]);

  const save = async (value: boolean) => {
    if (pending.current || !client.isCurrent()) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    sequence.current += 1;
    try {
      await client.call("settings.terminal_transport.update", {
        surface_codecs: value,
      });
      if (mounted.current && client.isCurrent()) await load();
    } catch (e) {
      if (mounted.current && client.isCurrent())
        setError({ message: (e as Error).message, value });
    } finally {
      pending.current = false;
      if (mounted.current && client.isCurrent()) setSaving(false);
    }
  };

  return (
    <>
      <div className="config-preference-row">
        <span className="config-item-icon">
          <Wifi size={15} />
        </span>
        <div className="config-item-copy">
          <div className="configuration-setting-label">
            <strong id="terminal-transport-label">
              Terminal incremental transport
            </strong>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="configuration-help"
                  aria-label="About terminal incremental transport"
                  title={TRANSPORT_DESCRIPTION}
                >
                  <Info size={14} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="configuration-help-content"
                aria-label="About terminal incremental transport"
                aria-describedby="terminal-transport-description"
                collisionPadding={12}
              >
                {TRANSPORT_DESCRIPTION}
              </PopoverContent>
            </Popover>
          </div>
          <span role="status">
            {saving
              ? "Saving..."
              : enabled === null
                ? error
                  ? "Unavailable"
                  : "Loading..."
                : enabled
                  ? "Enabled"
                  : "Disabled"}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-labelledby="terminal-transport-label"
          aria-describedby="terminal-transport-description"
          aria-checked={enabled === true}
          aria-disabled={enabled === null || saving || !client.isCurrent()}
          className={"settings-switch" + (enabled ? " is-on" : "")}
          onClick={() => {
            if (enabled !== null) void save(!enabled);
          }}
        >
          <span />
        </button>
      </div>
      <p id="terminal-transport-description" hidden>
        {TRANSPORT_DESCRIPTION}
      </p>
      {error ? (
        <div className="configuration-error" role="alert">
          <span>{error.message}</span>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              void (error.value === undefined ? load() : save(error.value))
            }
          >
            Retry
          </button>
        </div>
      ) : null}
    </>
  );
}
