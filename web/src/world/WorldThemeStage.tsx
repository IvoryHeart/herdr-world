import { Suspense } from "react";

import { useCoreNavigation } from "../CoreNavigation";
import type { SurfaceComponentProps } from "../surfaceRegistry";
import { SurfaceSlotBoundary } from "../SurfaceSlotBoundary";
import { worldThemeRegistry } from "./worldThemeRegistry";
import type { WorldThemeRegistry } from "./worldThemeRegistry";

export default function WorldThemeStage(props: SurfaceComponentProps) {
  return <WorldThemeOutlet {...props} />;
}

export function WorldThemeOutlet({
  themeRegistry = worldThemeRegistry,
  ...props
}: SurfaceComponentProps & { themeRegistry?: WorldThemeRegistry }) {
  const { activeWorldTheme, navigateWorldTheme } = useCoreNavigation();
  const Theme = themeRegistry.component(activeWorldTheme.id);
  if (!Theme) {
    return <div role="alert">World theme unavailable</div>;
  }
  return (
    <SurfaceSlotBoundary
      label={activeWorldTheme.label}
      resetKey={activeWorldTheme.id}
      recoveryLabel="Return to Office"
      onRecover={() => navigateWorldTheme("office")}
    >
      <Suspense
        fallback={(
          <div className="surface-loading surface-loading-stage" role="status">
            Loading {activeWorldTheme.label}…
          </div>
        )}
      >
        <Theme {...props} />
      </Suspense>
    </SurfaceSlotBoundary>
  );
}
