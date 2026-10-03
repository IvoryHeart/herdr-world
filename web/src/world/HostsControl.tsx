import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Server } from "lucide-react";
import type { ConnectionSummary } from "../api";
import { ConnectionManagerDialog } from "../components/ConnectionSwitcher";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import type { HostsFilter } from "./hostsFilter";

export function HostsControl({
  connections,
  ids,
  explanation,
  onChange,
}: {
  connections: readonly ConnectionSummary[];
  ids: HostsFilter;
  explanation: string;
  onChange(ids: HostsFilter): void;
}) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const openingManager = useRef(false);
  return (
    <div className="world-hosts-control connection-switcher">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="connection-switcher-trigger"
            aria-label="Hosts"
            title={`Hosts (${connections.length})`}
            aria-expanded={open}
          >
            <span className="world-hosts-icon" aria-hidden="true">
              <Server size={16} />
              <span className="world-hosts-count">{connections.length}</span>
            </span>
            <span className="connection-switcher-label">
              {ids === null ? "All hosts" : `${ids.length} hosts`}
            </span>
            <ChevronDown className="world-hosts-chevron" size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="world-hosts-menu"
          role="group"
          aria-label="Hosts filter"
          onCloseAutoFocus={(event) => {
            if (openingManager.current) {
              openingManager.current = false;
              event.preventDefault();
            }
          }}
        >
          <button type="button" onClick={() => onChange(null)}>
            All hosts
          </button>
          {connections.map((connection) => (
            <label key={connection.id}>
              <input
                type="checkbox"
                aria-label={connection.label}
                checked={ids === null || ids.includes(connection.id)}
                onChange={(event) => {
                  const selected =
                    ids === null
                      ? connections.map((host) => host.id)
                      : [...ids];
                  onChange(
                    event.target.checked
                      ? [...new Set([...selected, connection.id])]
                      : selected.filter((id) => id !== connection.id),
                  );
                }}
              />
              {connection.label} · {connection.state}
            </label>
          ))}
          {!connections.length ? (
            <p>Add a connection profile to observe hosts.</p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              openingManager.current = true;
              setOpen(false);
              setManaging(true);
            }}
          >
            Manage connections
          </button>
        </PopoverContent>
      </Popover>
      {explanation ? <span role="status">{explanation}</span> : null}
      {managing
        ? createPortal(
            <ConnectionManagerDialog onClose={() => setManaging(false)} />,
            document.body,
          )
        : null}
    </div>
  );
}
