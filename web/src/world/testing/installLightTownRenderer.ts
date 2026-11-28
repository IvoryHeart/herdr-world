import { clock } from "./installTestClock";
import { injectTownRenderer } from "../town/townRendererPort";
import { createLightTownRenderer } from "./lightTownRenderer";

if (
  !new URLSearchParams(location.search)
    .get("operation")
    ?.startsWith("town-idle")
)
  injectTownRenderer(createLightTownRenderer);
export { clock };
