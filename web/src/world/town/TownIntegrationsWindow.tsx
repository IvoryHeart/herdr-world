import { lazy, Suspense } from "react";
import { PlaceWindow } from "../PlaceWindow";

const IntegrationsPage = lazy(
  () => import("../../settings/pages/IntegrationsPage"),
);

/**
 * Integrations at the GitHub row, in Town's one window (#1170): the
 * warehouse opens it while GitHub is off or signed out, so its building and
 * sign open the same frame as every other place. The content is Settings →
 * Integrations itself.
 */
export function TownIntegrationsWindow({ onClose }: { onClose(): void }) {
  return (
    <PlaceWindow name="integrations" label="Integrations" onClose={onClose}>
      <Suspense
        fallback={
          <p className="muted" role="status">
            Loading Integrations…
          </p>
        }
      >
        <IntegrationsPage focus="source:github" close={onClose} />
      </Suspense>
    </PlaceWindow>
  );
}
