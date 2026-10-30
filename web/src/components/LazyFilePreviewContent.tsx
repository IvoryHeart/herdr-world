import { ChevronLeft } from "lucide-react";
import { type ComponentProps, Suspense } from "react";
import { lazyWithReload } from "../lazyWithReload";
import "./FilePreviewFrame.css";

/** File preview's lazy chunk, shared by Ranger and the Inspector. */
export const LazyFilePreviewContent = lazyWithReload("file-preview", () =>
  import("./FilePreviewContent").then((module) => ({
    default: module.FilePreviewContent,
  })),
);

type PreviewProps = ComponentProps<typeof LazyFilePreviewContent>;

/**
 * The preview's frame and header while its code downloads, with the file's
 * name and path and the phone's Back, so they do not pop in afterwards.
 */
export function FilePreviewLoading({
  entry,
  backAction,
}: Pick<PreviewProps, "entry" | "backAction">) {
  return (
    <section
      className="file-preview"
      aria-label="File preview"
      aria-busy="true"
    >
      <div className="file-preview-head">
        <div className="file-preview-title-row">
          {backAction ? (
            <button
              type="button"
              className="file-preview-back"
              title={backAction.label}
              aria-label={backAction.label}
              onClick={backAction.onClick}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          ) : null}
          <div className="file-preview-title" title={entry?.name}>
            {entry?.name ?? "Preview"}
          </div>
        </div>
        {entry ? <span>{entry.path}</span> : null}
      </div>
      <div className="file-preview-state" role="status">
        <span className="file-loading-spinner" />
        Loading preview
      </div>
    </section>
  );
}

/** The Inspector's file preview, showing its frame until the chunk arrives. */
export function InspectorFilePreview(props: PreviewProps) {
  return (
    <Suspense
      fallback={
        <FilePreviewLoading entry={props.entry} backAction={props.backAction} />
      }
    >
      <LazyFilePreviewContent {...props} />
    </Suspense>
  );
}
