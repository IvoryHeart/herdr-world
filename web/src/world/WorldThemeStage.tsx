import { Suspense } from "react";

import { useCoreNavigation } from "../CoreNavigation";
import type { SurfaceComponentProps } from "../surfaceRegistry";
import { SurfaceSlotBoundary } from "../SurfaceSlotBoundary";
import { WorldConversationLayer } from "./WorldConversationLayer";
import { isWorldSurfaceContext } from "./WorldSurface";
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
  const context = isWorldSurfaceContext(props.context) ? props.context : null;
  const back = context?.compact ? <button className="btn" type="button" aria-label="Back to Herdr sidebar"
    onClick={context.onBackToSidebar}>Back to Herdr sidebar</button> : null;
  if (!Theme) {
    return <div role="alert">World theme unavailable{back}</div>;
  }
  return (
    <WorldConversationLayer
      activeThemeId={activeWorldTheme.id}
      panels={context?.conversationBubbles ?? []}
      compact={context?.compact ?? false}
      onFocus={context?.onFocusConversation ?? (() => {})}
      onClose={context?.onCloseConversation ?? (() => {})}
    >
      <SurfaceSlotBoundary
        label={activeWorldTheme.label}
        resetKey={activeWorldTheme.id}
        recoveryLabel={context?.compact ? "Back to Herdr sidebar" : "Return to Office"}
        onRecover={context?.compact ? context.onBackToSidebar : () => navigateWorldTheme("office")}
      >
        <Suspense
          fallback={(
            <div className="surface-loading surface-loading-stage" role="status">
              Loading {activeWorldTheme.label}…
              {back}
            </div>
          )}
        >
          <Theme {...props} />
        </Suspense>
      </SurfaceSlotBoundary>
    </WorldConversationLayer>
  );
}
