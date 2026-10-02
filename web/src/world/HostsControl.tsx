import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConnectionSummary } from "../api";
import { ConnectionManagerDialog } from "../components/ConnectionSwitcher";
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
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current
          ?.querySelector<HTMLButtonElement>('button[aria-label="Hosts"]')
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="world-hosts-control">
      <button
        type="button"
        aria-label="Hosts"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Hosts · {ids === null ? "All hosts" : `${ids.length} selected`}
      </button>
      {open ? (
        <div
          className="world-hosts-menu"
          role="group"
          aria-label="Hosts filter"
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
              setOpen(false);
              setManaging(true);
            }}
          >
            Manage connections
          </button>
        </div>
      ) : null}
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
