import { useEffect, useState } from "react";
import {
  desktopIdeCall,
  desktopIdeFixture,
  parseDesktopIdes,
  type DesktopIdes,
} from "../desktopIdes";
import "./DesktopIdeDialog.css";

export function DesktopIdeSettings() {
  const [data, setData] = useState<DesktopIdes | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    void desktopIdeCall("list")
      .then(parseDesktopIdes)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const save = async (ide: string | null) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await desktopIdeCall("default", { ide });
      setData((value) => (value ? { ...value, default_id: ide } : value));
      setMessage("Default desktop IDE saved.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="desktop-ide-settings"
      aria-label="Desktop IDE integrations"
    >
      <div className="desktop-ide-heading">
        <h3>Desktop IDEs</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh desktop IDEs
        </button>
      </div>
      <p>
        Detected on the World host. Open in… sends projects and files to this
        computer’s desktop, even from a phone. Remote projects require the IDE’s
        SSH support and your existing OpenSSH configuration.
      </p>
      {desktopIdeFixture() ? (
        <p role="status">
          Preview fixture — no IDE is launched or preference saved.
        </p>
      ) : null}
      <label>
        Default IDE{" "}
        <select
          aria-label="Default desktop IDE"
          value={data?.default_id ?? ""}
          disabled={!data || busy}
          onChange={(event) => void save(event.currentTarget.value || null)}
        >
          <option value="">Always choose</option>
          {data?.ides.map((ide) => (
            <option key={ide.id} value={ide.id} disabled={!ide.installed}>
              {ide.label}
              {ide.installed ? "" : " (not found)"}
            </option>
          ))}
        </select>
      </label>
      <ul>
        {data?.ides.map((ide) => (
          <li key={ide.id}>
            <strong>{ide.label}</strong> —{" "}
            {ide.installed ? "Installed" : "Not found"}
            <small>
              {!ide.installed
                ? ide.reason
                : ide.ssh
                  ? "Local and SSH handoff"
                  : "Local handoff; SSH requires a Gateway backend link"}
            </small>
          </li>
        ))}
      </ul>
      {!data && !error ? <p role="status">Detecting desktop IDEs…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
