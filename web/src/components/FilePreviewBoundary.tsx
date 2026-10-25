import { Component, type ReactNode } from "react";
import type { FileExplorerEntry, FilePreview } from "../types";
import type { NewReviewAnnotation, ReviewAnnotation } from "../annotations";

export type ActiveFilePreviewSelection = {
  entry: FileExplorerEntry | null;
  preview: FilePreview | null;
  loading: boolean;
  error: string | null;
  fragment?: string;
  line?: number;
  snippet?: string;
};

export type FilePreviewSelectionMeta = {
  userInitiated?: boolean;
  deletedEntry?: Pick<FileExplorerEntry, "path" | "type">;
};

export type FilePreviewContentProps = ActiveFilePreviewSelection & {
  changesContent?: ReactNode;
  changesKey?: string;
  backAction?: { label: string; onClick: () => void };
  annotations?: readonly ReviewAnnotation[];
  onOpenChanges?: () => void;
  onOpenFile?: (path: string, fragment?: string) => void;
  onRefresh?: () => void;
  onClosePreview?: () => void;
  onCreateAnnotation?: (annotation: NewReviewAnnotation) => void;
  onReanchorAnnotations?: (path: string, text: string) => void;
};

/** Keep a stale preview's render failure inside the preview, including while hidden. */
export class FilePreviewBoundary extends Component<
  {
    children: ReactNode;
    resetKey: string;
    onRefresh?: () => void;
    onClosePreview?: () => void;
    backAction?: FilePreviewContentProps["backAction"];
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="file-preview" aria-label="File preview">
        <div className="file-preview-head">File preview unavailable</div>
        <div className="file-preview-state" role="alert">
          <p>
            This file is no longer available to preview. Refresh the worktree or
            choose another file.
          </p>
          <button
            type="button"
            aria-label="Retry file preview"
            onClick={() => {
              this.props.onRefresh?.();
              this.setState({ failed: false });
            }}
          >
            Retry preview
          </button>
          {this.props.backAction ? (
            <button type="button" onClick={this.props.backAction.onClick}>
              {this.props.backAction.label}
            </button>
          ) : null}
          {this.props.onClosePreview ? (
            <button
              type="button"
              aria-label="Close file preview"
              onClick={this.props.onClosePreview}
            >
              Close preview
            </button>
          ) : null}
        </div>
      </section>
    );
  }
}
