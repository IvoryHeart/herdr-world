import {
  harnessLabel,
  readinessNote,
  type LauncherCatalog,
} from "./agentProfiles";

/** Evidence describes the last check, not profile configuration or enablement. */
export function HarnessReadinessSummary({
  catalog,
}: {
  catalog: LauncherCatalog;
}) {
  return (
    <div className="agent-launcher-note" aria-label="Harness readiness">
      <p>
        Use Check again to retry a check, or Edit profiles to review
        configuration.
      </p>
      <ul>
        {catalog.readiness.map((ready) => (
          <li key={ready.kind}>
            {harnessLabel(ready.kind)}:{" "}
            {readinessNote(ready.kind, catalog)?.text ??
              "Installed and signed in"}
            . World harness probe ·{" "}
            {ready.probe.observed_at === null ? (
              "Time unknown"
            ) : (
              <time dateTime={new Date(ready.probe.observed_at).toISOString()}>
                Observed{" "}
                {new Date(ready.probe.observed_at).toLocaleTimeString()}
              </time>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
