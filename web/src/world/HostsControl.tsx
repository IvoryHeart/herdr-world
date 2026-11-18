import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Server } from "lucide-react";
import { ConnectionManagerDialog } from "../components/ConnectionSwitcher";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import type { HostsFilter } from "./hostsFilter";
import { hostCount, hostRuntimeLabel, type WorldHost } from "../worldHosts";

/**
 * The overview's Hosts menu: every host of `worldHosts`, Herdr (TUI) and
 * herdr-core alike, to show or hide in World's views.
 */
export type HostsControlProps = {
  connections: readonly WorldHost[];
  ids: HostsFilter;
  explanation: string;
  onChange(ids: HostsFilter): void;
};

export function HostsControl({
  connections,
  ids,
  explanation,
  onChange,
}: HostsControlProps) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const openingManager = useRef(false);
  const count = hostCount(connections);
  return (
    <div className="world-hosts-control connection-switcher">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="connection-switcher-trigger"
            aria-label="Hosts"
            title={`Hosts (${count})`}
            aria-expanded={open}
          >
            <span className="world-hosts-icon" aria-hidden="true">
              <Server size={16} />
              <span className="world-hosts-count">{count}</span>
            </span>
            <span className="connection-switcher-label">
              {hostsSelectionLabel(connections, ids)}
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
          <HostsFilterOptions
            connections={connections}
            ids={ids}
            onChange={onChange}
            onManage={() => {
              openingManager.current = true;
              setOpen(false);
              setManaging(true);
            }}
          />
        </PopoverContent>
      </Popover>
      {explanation ? <span role="status">{explanation}</span> : null}
      {managing ? (
        <ConnectionManagerPortal onClose={() => setManaging(false)} />
      ) : null}
    </div>
  );
}

/** "All hosts", or how many of them the filter shows. */
export function hostsSelectionLabel(
  connections: readonly WorldHost[],
  ids: HostsFilter,
) {
  if (ids === null) return "All hosts";
  return `${hostCount(connections.filter(({ id }) => ids.includes(id)))} hosts`;
}

/**
 * The Hosts filter's choices, shared by the top-bar menu and the phone's
 * corner view menu so both show and change the one filter of this browser.
 */
export function HostsFilterOptions({
  connections,
  ids,
  onChange,
  onManage,
}: Omit<HostsControlProps, "explanation"> & { onManage(): void }) {
  return (
    <>
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
                ids === null ? connections.map((host) => host.id) : [...ids];
              onChange(
                event.target.checked
                  ? [...new Set([...selected, connection.id])]
                  : selected.filter((id) => id !== connection.id),
              );
            }}
          />
          {connection.label}
          {hostRuntimeLabel(connection) ? (
            <span className="world-hosts-runtime">
              {" "}
              · {hostRuntimeLabel(connection)}
            </span>
          ) : null}{" "}
          · {connection.state}
        </label>
      ))}
      {!connections.length ? (
        <p>Add a connection profile to observe hosts.</p>
      ) : null}
      <button type="button" onClick={onManage}>
        Manage connections
      </button>
    </>
  );
}

export function ConnectionManagerPortal({ onClose }: { onClose(): void }) {
  return createPortal(
    <ConnectionManagerDialog onClose={onClose} />,
    document.body,
  );
}
