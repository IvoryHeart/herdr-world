import { RotateCw, X } from "lucide-react";
import {
  dismissAttachmentUpload,
  retryAttachmentUpload,
  useAttachmentUploads,
} from "../attachmentUploads";
import { formatBytes } from "./agentSession";
import "./AttachmentChips.css";

/** One chip per attached file: uploading with progress, done, or failed. */
export function AttachmentChips({ scope }: { scope: string | null }) {
  const uploads = useAttachmentUploads(scope);
  if (!scope || !uploads.length) return null;
  return (
    <ul className="attachment-chips" aria-label="Attachments">
      {uploads.map((upload) => {
        const percent = upload.size
          ? Math.min(100, Math.round((upload.loaded / upload.size) * 100))
          : 0;
        const state =
          upload.status === "uploading"
            ? upload.loaded > 0
              ? `Uploading ${percent}% of ${formatBytes(upload.size)}`
              : "Uploading…"
            : upload.status === "done"
              ? "Uploaded"
              : `Failed: ${upload.error ?? "upload failed"}`;
        return (
          <li
            key={upload.id}
            className="attachment-chip"
            data-status={upload.status}
            title={`${upload.name} · ${state}`}
          >
            <span className="attachment-chip-name">{upload.name}</span>
            <span className="attachment-chip-state" role="status">
              {state}
            </span>
            {upload.status === "uploading" ? (
              <span
                className="attachment-chip-bar"
                role="progressbar"
                aria-label={`Uploading ${upload.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                style={{ width: `${percent}%` }}
              />
            ) : null}
            {upload.status === "failed" ? (
              <>
                <button
                  type="button"
                  aria-label={`Retry ${upload.name}`}
                  title="Retry"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => retryAttachmentUpload(scope, upload.id)}
                >
                  <RotateCw size={12} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${upload.name}`}
                  title="Remove"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => dismissAttachmentUpload(scope, upload.id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
