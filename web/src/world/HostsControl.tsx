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
import {
  hostStateLabel,
  runtimeName,
  type WorldHostGroup,
} from "../hostGroups";
import { openIntegrations } from "../integrations";
import { useViewControlRequest } from "../settings/viewControls";

export type HostsControlProps = {
  /** One entry per machine (`worldHostGroups`), never per runtime. */
  hosts: readonly WorldHostGroup[];
  ids: HostsFilter;
  explanation: string;
  onChange(ids: HostsFilter): void;
};

/** A host is ticked when the filter shows all hosts or any of its runtimes. */
export function hostSelected(host: WorldHostGroup, ids: HostsFilter) {
  return ids === null || host.connectionIds.some((id) => ids.includes(id));
}

/** The filter after ticking or unticking one host: all its runtimes at once. */
export function toggledHostIds(
  hosts: readonly WorldHostGroup[],
  ids: HostsFilter,
  host: WorldHostGroup,
  checked: boolean,
): string[] {
  const selected =
    ids === null
      ? hosts.flatMap((each) => each.connectionIds)
      : hosts
          .filter((each) => hostSelected(each, ids))
          .flatMap((each) => each.connectionIds);
  return checked
    ? [...new Set([...selected, ...host.connectionIds])]
    : selected.filter((id) => !host.connectionIds.includes(id));
}

/** "All hosts", or how many hosts the filter shows. */
export function hostsSelectionLabel(
  hosts: readonly WorldHostGroup[],
  ids: HostsFilter,
) {
  if (ids === null) return "All hosts";
  const shown = hosts.filter((host) => hostSelected(host, ids)).length;
  return `${shown} ${shown === 1 ? "host" : "hosts"}`;
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
 * One row and one tick per machine: its runtimes are listed in Integrations.
 */
export function HostsFilterOptions({
  hosts,
  ids,
  onChange,
  onManage,
  onClose,
}: Omit<HostsControlProps, "explanation"> & {
  onManage(): void;
  /** Closes the menu before Integrations opens over it. */
  onClose?(): void;
}) {
  const toggle = (host: WorldHostGroup, checked: boolean) =>
    onChange(toggledHostIds(hosts, ids, host, checked));
  return (
    <>
      <button type="button" onClick={() => onChange(null)}>
        All hosts
      </button>
      {hosts.map((host) => {
        const empty = !host.runtimes.length;
        const state = hostStateLabel(host);
        return (
          <div
            key={host.id}
            className="world-hosts-row"
            data-host={host.id}
            data-empty={empty || undefined}
          >
            <label
              title={
                host.runtimes.length > 1
                  ? `Runs ${host.runtimes.map(runtimeName).join(" and ")}`
                  : undefined
              }
            >
              <input
                type="checkbox"
                aria-label={host.label}
                disabled={empty}
                checked={!empty && hostSelected(host, ids)}
                onChange={(event) => toggle(host, event.target.checked)}
              />
              {host.label} · {state}
            </label>
            {empty && host.entry?.discovery !== "pending" ? (
              <button
                type="button"
                className="world-hosts-add-runtime"
                aria-label={`Add a runtime to ${host.label}`}
                onClick={() => {
                  onClose?.();
                  openIntegrations(`host:${host.id}`);
                }}
              >
                Add a runtime
              </button>
            ) : null}
          </div>
        );
      })}
      {!hosts.length ? <p>Add a host to see its rooms and agents.</p> : null}
      <button type="button" onClick={onManage}>
        Manage connections
      </button>
    </>
  );
}

/**
 * The overview's Hosts menu: every machine World knows, whichever runtimes
 * serve it, to show or hide in World's views.
 */
export function HostsControl({
  hosts,
  ids,
  explanation,
  onChange,
}: HostsControlProps) {
  const [open, setOpen] = useState(false);
  const manager = useConnectionManager();
  const openingManager = useRef(false);
  const count = hosts.length;
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
              {hostsSelectionLabel(hosts, ids)}
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
            hosts={hosts}
            ids={ids}
            onChange={onChange}
            onClose={() => setOpen(false)}
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
