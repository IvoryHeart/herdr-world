import { useEffect, useRef, useState } from "react";
import { WORLD_OBSERVABILITY_UPDATED_EVENT } from "../workspaceResource";
import {
  fetchOfficeObservabilityConfiguration,
  updateOfficeObservabilityConfiguration,
  type OfficeObservabilityConfiguration,
} from "./officeObservability";
import type { RunIntegrationTask } from "./SourceFields";

/** Saves or clears the Prometheus URL and tells Town's board to read again. */
export async function saveUsageMetrics(endpoint: string | null) {
  const next = await updateOfficeObservabilityConfiguration(endpoint);
  window.dispatchEvent(new Event(WORLD_OBSERVABILITY_UPDATED_EVENT));
  return next;
}

/**
 * The optional Prometheus connector for agent usage and cost. The service
 * makes bounded queries; the browser never contacts Prometheus.
 */
export function UsageMetricsFields({
  busy,
  run,
  autoFocus = false,
}: {
  busy: boolean;
  run: RunIntegrationTask;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [endpoint, setEndpoint] = useState("");
  const [configuration, setConfiguration] =
    useState<OfficeObservabilityConfiguration | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void fetchOfficeObservabilityConfiguration()
      .then((next) => {
        if (disposed) return;
        setConfiguration(next);
        setEndpoint(next.endpoint ?? "");
        if (autoFocus) inputRef.current?.focus();
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setLoadError(
            cause instanceof Error && cause.message
              ? cause.message
              : "Could not load metrics settings",
          );
      });
    return () => {
      disposed = true;
    };
  }, [autoFocus]);

  const loading = configuration === null && loadError === null;
  return (
    <form
      className="integration-fields"
      aria-label="Usage metrics settings"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          "source:metrics",
          async () => {
            const next = await saveUsageMetrics(endpoint.trim() || null);
            setConfiguration(next);
            setEndpoint(next.endpoint ?? "");
          },
          endpoint.trim() ? "Prometheus URL saved." : "Usage metrics off.",
        );
      }}
    >
      <p className="integration-field-help">
        Optionally connect Prometheus to show agent usage and cost on the Town
        board. Town, Board and terminals work without it.
      </p>
      <label className="form-field">
        <span>Prometheus URL</span>
        <input
          ref={inputRef}
          type="url"
          value={endpoint}
          placeholder="http://127.0.0.1:9090"
          autoComplete="off"
          spellCheck={false}
          disabled={loading || busy}
          onChange={(event) => setEndpoint(event.currentTarget.value)}
        />
      </label>
      <p className="integration-field-help">
        HTTP or HTTPS base URL only. Embedded credentials, query strings and
        fragments are rejected.
      </p>
      {configuration?.source === "environment" ? (
        <p className="integration-field-help">
          This URL came from the World environment. Saving or clearing it
          creates an explicit local setting.
        </p>
      ) : null}
      {configuration?.lastSuccessAt ? (
        <p className="integration-field-help">
          Last successful reading:{" "}
          {new Date(configuration.lastSuccessAt).toLocaleString()}
        </p>
      ) : null}
      {loadError ? (
        <p className="modal-error" role="alert">
          {loadError}
        </p>
      ) : null}
      <div className="modal-actions integration-field-actions">
        <button type="submit" disabled={loading || busy}>
          Save URL
        </button>
      </div>
    </form>
  );
}
