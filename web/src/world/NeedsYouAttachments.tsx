import { FileText, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../components/agentSession";
import type { AskAttachmentUpload } from "./askAttachments";

/** One file attached to an answer: uploading, stored at its path, or failed. */
export type AnswerAttachment = {
  id: string;
  file: File;
  name: string;
  /** An object URL for an image's thumbnail. */
  preview: string | null;
  status: "uploading" | "done" | "failed";
  loaded: number;
  path: string | null;
  error: string | null;
};

let nextId = 0;

const previewOf = (file: File) =>
  file.type.startsWith("image/") && typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(file)
    : null;
const release = (attachment: AnswerAttachment) => {
  if (attachment.preview) URL.revokeObjectURL(attachment.preview);
};

/**
 * The files attached to one answer. Each uploads as soon as it is attached,
 * so sending only waits for the ones still on their way; a removed file is
 * forgotten even if its upload lands later.
 */
export function useAnswerAttachments(upload: AskAttachmentUpload | undefined) {
  const [items, setItems] = useState<readonly AnswerAttachment[]>([]);
  const shown = useRef(items);
  shown.current = items;
  useEffect(() => () => shown.current.forEach(release), []);
  const patch = (id: string, change: Partial<AnswerAttachment>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  const run = (id: string, file: File) => {
    if (!upload) return;
    patch(id, { status: "uploading", loaded: 0, error: null });
    upload(file, (loaded) => patch(id, { loaded })).then(
      (path) => patch(id, { status: "done", path, loaded: file.size }),
      (error: unknown) =>
        patch(id, {
          status: "failed",
          error: error instanceof Error ? error.message : "Upload failed",
        }),
    );
  };
  const add = (files: readonly File[]) => {
    if (!upload || !files.length) return;
    const added = files.map(
      (file): AnswerAttachment => ({
        id: `answer-file-${++nextId}`,
        file,
        name: file.name || "pasted file",
        preview: previewOf(file),
        status: "uploading",
        loaded: 0,
        path: null,
        error: null,
      }),
    );
    setItems((current) => [...current, ...added]);
    for (const item of added) run(item.id, item.file);
  };
  const remove = (id: string) =>
    setItems((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone) release(gone);
      return current.filter((item) => item.id !== id);
    });
  const retry = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (item?.status === "failed") run(id, item.file);
  };
  const clear = () =>
    setItems((current) => {
      current.forEach(release);
      return [];
    });
  return {
    items,
    add,
    remove,
    retry,
    clear,
    uploading: items.some((item) => item.status === "uploading"),
    failed: items.some((item) => item.status === "failed"),
    paths: items.flatMap((item) =>
      item.status === "done" && item.path ? [item.path] : [],
    ),
  };
}

/** One chip per attached file: a thumbnail (or file icon), its state and ✕. */
export function NeedsYouAttachmentChips({
  items,
  disabled,
  onRemove,
  onRetry,
}: {
  items: readonly AnswerAttachment[];
  disabled: boolean;
  onRemove(id: string): void;
  onRetry(id: string): void;
}) {
  if (!items.length) return null;
  return (
    <ul className="needs-you-files" aria-label="Attached files">
      {items.map((item) => {
        const percent = item.file.size
          ? Math.min(100, Math.round((item.loaded / item.file.size) * 100))
          : 0;
        const state =
          item.status === "uploading"
            ? item.loaded > 0
              ? `Uploading ${percent}% of ${formatBytes(item.file.size)}`
              : "Uploading…"
            : item.status === "done"
              ? formatBytes(item.file.size)
              : `Failed: ${item.error ?? "upload failed"}`;
        return (
          <li
            key={item.id}
            className="needs-you-file"
            data-status={item.status}
            title={`${item.name} · ${state}`}
          >
            {item.preview ? (
              <img src={item.preview} alt="" />
            ) : (
              <FileText size={16} aria-hidden="true" />
            )}
            <span className="needs-you-file-name">{item.name}</span>
            <small role="status">{state}</small>
            {item.status === "failed" ? (
              <button
                type="button"
                className="needs-you-icon"
                aria-label={`Retry ${item.name}`}
                title="Retry"
                disabled={disabled}
                onClick={() => onRetry(item.id)}
              >
                <RotateCw size={14} aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              className="needs-you-icon"
              aria-label={`Remove ${item.name}`}
              title="Remove"
              disabled={disabled}
              onClick={() => onRemove(item.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
