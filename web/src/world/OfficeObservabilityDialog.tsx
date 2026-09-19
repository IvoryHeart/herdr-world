import { Activity, CircleOff, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CloseButton } from "../components/CloseButton";
import { focusDialogElement } from "../components/dialogFocus";
import {
  fetchOfficeObservabilityConfiguration,
  updateOfficeObservabilityConfiguration,
  type OfficeObservabilityConfiguration,
} from "./officeObservability";

export function OfficeObservabilityDialog({
  onClose,
  onSaved,
}: {
  onClose(): void;
  onSaved(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const [endpoint, setEndpoint] = useState("");
  const [configuration, setConfiguration] =
    useState<OfficeObservabilityConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    let disposed = false;
    const cancelFocus = focusDialogElement(inputRef.current, { select: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    void fetchOfficeObservabilityConfiguration()
      .then((next) => {
        if (disposed) return;
        setConfiguration(next);
        setEndpoint(next.endpoint ?? "");
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError(errorText(cause, "Could not load metrics settings"));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      cancelFocus();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const update = async (nextEndpoint: string | null) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await updateOfficeObservabilityConfiguration(nextEndpoint);
      setConfiguration(next);
      setEndpoint(next.endpoint ?? "");
      setMessage(
        next.configured
          ? "Prometheus provider saved."
          : "Prometheus provider disabled.",
      );
      onSaved();
    } catch (cause) {
      setError(errorText(cause, "Could not save metrics settings"));
    } finally {
      setBusy(false);
    }
  };

  const status = configurationStatus(configuration, loading);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal compact-modal world-observability-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Office metrics settings"
        onSubmit={(event) => {
          event.preventDefault();
          void update(endpoint.trim() || null);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Office metrics</h2>
          <CloseButton
            onClick={onClose}
            label="Close Office metrics settings"
          />
        </div>

        <p className="world-observability-help">
          Optionally connect Prometheus to the Economy board. The World service
          performs bounded queries; the browser never contacts Prometheus, and
          Office topology and terminals work without it.
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
        <p className="world-observability-field-help">
          HTTP or HTTPS base URL only. Embedded credentials, query strings and
          fragments are rejected.
        </p>

        <div
          className="world-observability-health"
          data-status={configuration?.health ?? "unavailable"}
          role="status"
        >
          {configuration?.health === "available" ? (
            <Activity size={15} aria-hidden="true" />
          ) : configuration?.health === "degraded" ? (
            <TriangleAlert size={15} aria-hidden="true" />
          ) : (
            <CircleOff size={15} aria-hidden="true" />
          )}
          <span>{status}</span>
        </div>
        {configuration?.source === "environment" ? (
          <p className="world-observability-field-help">
            This URL came from the World environment. Saving or disabling it
            creates an explicit local setting.
          </p>
        ) : null}
        {configuration?.lastSuccessAt ? (
          <p className="world-observability-field-help">
            Last successful observation:{" "}
            {formatObservedAt(configuration.lastSuccessAt)}
          </p>
        ) : null}

        {error ? (
          <p className="modal-error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p className="modal-message">{message}</p> : null}

        <div className="modal-actions world-observability-actions">
          <button
            type="button"
            className="ghost"
            disabled={
              loading || busy || (!configuration?.configured && !endpoint)
            }
            onClick={() => void update(null)}
          >
            Disable
          </button>
          <button type="submit" disabled={loading || busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function configurationStatus(
  configuration: OfficeObservabilityConfiguration | null,
  loading: boolean,
) {
  if (loading) return "Loading provider configuration…";
  if (!configuration?.configured) {
    return "Not configured; Economy shows no provider data.";
  }
  if (configuration.health === "available") {
    return "Connected; Economy is using authoritative provider data.";
  }
  if (configuration.health === "degraded") {
    return "Configured, but the latest Prometheus queries failed.";
  }
  return "Configured; waiting for the first provider observation.";
}

function formatObservedAt(value: number) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "unknown";
  }
}

function errorText(value: unknown, fallback: string) {
  return value instanceof Error && value.message ? value.message : fallback;
}
