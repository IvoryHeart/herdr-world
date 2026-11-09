import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../api";
import {
  parseWorldIntegrations,
  worldChangePrompt,
  worldStateLabel,
  type WorldIntegration,
} from "../worldIntegrations";

/**
 * World's skill rows (world.integration.*): the same installer as
 * `herdr-world integration`, on the World service's own host.
 */
export function useWorldIntegrations(
  enabled: boolean,
  label: (harness: string) => string,
  /** Reload whenever this changes, such as World's connection after a restart. */
  epoch?: unknown,
) {
  const [items, setItems] = useState<WorldIntegration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    void epoch;
    if (!enabled) return;
    const request = ++sequence.current;
    try {
      const next = parseWorldIntegrations(
        await bridge.call("world.integration.list"),
      );
      if (mounted.current && request === sequence.current) {
        setItems(next);
        setLoadError(null);
      }
    } catch (e) {
      if (mounted.current && request === sequence.current) {
        setItems(null);
        setLoadError(`Could not load World skills: ${(e as Error).message}`);
      }
    }
  }, [enabled, epoch]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const change = async (
    item: WorldIntegration,
    action: "install" | "uninstall",
  ) => {
    if (busy || !window.confirm(worldChangePrompt(item, action, label))) return;
    const verb =
      action === "uninstall"
        ? "Uninstall"
        : item.state === "outdated"
          ? "Update"
          : "Install";
    setBusy(item.harness);
    setChangeError(null);
    setMessage(null);
    try {
      await bridge.call(`world.integration.${action}`, {
        harness: item.harness,
      });
      if (mounted.current)
        setMessage(
          `${verb} of World's skill for ${label(item.harness)} completed.`,
        );
    } catch (e) {
      if (mounted.current)
        setChangeError(
          `${verb} of World's skill for ${label(item.harness)} failed: ${(e as Error).message}`,
        );
    } finally {
      await load();
      if (mounted.current) setBusy(null);
    }
  };

  return {
    items,
    busy,
    error: changeError ?? loadError,
    message,
    load,
    change,
  };
}

export function WorldIntegrationRow({
  item,
  label,
  disabled,
  onChange,
}: {
  item: WorldIntegration;
  label: (harness: string) => string;
  disabled: boolean;
  onChange: (item: WorldIntegration, action: "install" | "uninstall") => void;
}) {
  const name = label(item.harness);
  const installable =
    item.state === "not_installed" || item.state === "outdated";
  const removable = item.state === "current" || item.state === "outdated";
  return (
    <div className="agent-integrations-world" data-state={item.state}>
      <div className="agent-integrations-world-copy">
        <span className="agent-integrations-world-name">World skill</span>
        <span className="agent-integrations-badge" data-state={item.state}>
          {worldStateLabel(item)}
        </span>
        {item.path ? (
          <code className="agent-integrations-world-path">{item.path}</code>
        ) : null}
        {item.shared_with.length > 0 ? (
          <span className="agent-integrations-world-shared">
            Shared with {item.shared_with.map(label).join(" and ")}
          </span>
        ) : null}
      </div>
      {installable || removable ? (
        <div className="agent-integrations-actions">
          {installable ? (
            <button
              type="button"
              className={
                item.state === "outdated" ? "agent-integrations-update" : ""
              }
              aria-label={`${item.state === "outdated" ? "Update" : "Install"} World skill for ${name}`}
              aria-disabled={disabled}
              onClick={() => {
                if (!disabled) onChange(item, "install");
              }}
            >
              {item.state === "outdated" ? "Update" : "Install"}
            </button>
          ) : null}
          {removable ? (
            <button
              type="button"
              aria-label={`Uninstall World skill for ${name}`}
              aria-disabled={disabled}
              onClick={() => {
                if (!disabled) onChange(item, "uninstall");
              }}
            >
              Uninstall
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
