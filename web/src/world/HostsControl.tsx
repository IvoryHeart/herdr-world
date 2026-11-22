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
import { hostCount, worldMachines, type WorldHost } from "../worldHosts";
import { useViewControlRequest } from "../settings/viewControls";

export type HostsControlProps = {
  connections: readonly WorldHost[];
  ids: HostsFilter;
  explanation: string;
  onChange(ids: HostsFilter): void;
};

/** How many machines an explicit Hosts selection shows. */
export function selectedHostCount(
  connections: readonly WorldHost[],
  ids: readonly string[],
) {
  return hostCount(connections.filter(({ id }) => ids.includes(id)));
}

/** "All hosts", "No hosts", or how many hosts (machines) the filter shows. */
export function hostsSelectionLabel(
  connections: readonly WorldHost[],
  ids: HostsFilter,
) {
  if (ids === null) return "All hosts";
  if (!ids.length) return "No hosts";
  return `${selectedHostCount(connections, ids)} hosts`;
}

/**
 * Manage connections opens over everything, outside the menu it came from,
 * so the dialog outlives that menu closing.
 */
export function useConnectionManager() {
  const [managing, setManaging] = useState(false);
  // Settings and the command box open it too (#1035).
  useViewControlRequest("connections.manage", () => setManaging(true));
  return {
    open: () => setManaging(true),
    dialog: managing
      ? createPortal(
          <ConnectionManagerDialog onClose={() => setManaging(false)} />,
          document.body,
        )
      : null,
  };
}

/**
 * The Hosts filter itself, shared by the top bar's Hosts menu and the phone's
 * corner view menu so both show and change the one filter of this browser.
 * One row per machine (#1227), as Town has one building per machine: a row
 * shows or hides every runtime World holds there, and its status sums theirs
 * up. Each runtime's own detail stays in Manage connections.
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
      {worldMachines(connections).map((machine) => (
        <label key={machine.machine}>
          <input
            type="checkbox"
            aria-label={machine.label}
            checked={ids === null || machine.ids.some((id) => ids.includes(id))}
            onChange={(event) => {
              const selected =
                ids === null ? connections.map((host) => host.id) : [...ids];
              onChange(
                event.target.checked
                  ? [...new Set([...selected, ...machine.ids])]
                  : selected.filter((id) => !machine.ids.includes(id)),
              );
            }}
          />
          {machine.label} · {machine.status}
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

/**
 * The overview's Hosts menu: every machine of `worldHosts`, with its Herdr
 * (TUI) and herdr-core runtimes, to show or hide in World's views.
 */
export function HostsControl({
  connections,
  ids,
  explanation,
  onChange,
}: HostsControlProps) {
  const [open, setOpen] = useState(false);
  const manager = useConnectionManager();
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
              manager.open();
            }}
          />
        </PopoverContent>
      </Popover>
      {explanation ? <span role="status">{explanation}</span> : null}
      {manager.dialog}
    </div>
  );
}
