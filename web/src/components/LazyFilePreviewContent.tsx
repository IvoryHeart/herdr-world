import { type ComponentProps, Suspense } from "react";
import { lazyWithReload } from "../lazyWithReload";

/** File preview's lazy chunk, shared by Ranger and the Inspector. */
export const LazyFilePreviewContent = lazyWithReload("file-preview", () =>
  import("./FilePreviewContent").then((module) => ({
    default: module.FilePreviewContent,
  })),
);

/** The Inspector's file preview, showing its loading state until the chunk arrives. */
export function InspectorFilePreview(
  props: ComponentProps<typeof LazyFilePreviewContent>,
) {
  return (
    <Suspense
      fallback={
        <div className="file-preview-state">
          <span className="file-loading-spinner" />
          Loading preview
        </div>
      }
    >
      <LazyFilePreviewContent {...props} />
    </Suspense>
  );
}
