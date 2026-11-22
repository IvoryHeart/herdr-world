import { memo } from "react";
import { lazyWithReload } from "../../lazyWithReload";

/** World's Code view, in its own chunk loaded when first shown. */
export const LazyCodeView = memo(
  lazyWithReload("world-code", () => import("./CodeView")),
);
