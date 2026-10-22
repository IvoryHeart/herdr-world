import { useEffect, useRef, useSyncExternalStore } from "react";
import type { UploadProgress } from "./terminalImageUpload";

/**
 * Attachment uploads a composer shows as chips: one per file, uploading with
 * its byte progress, then done or failed. A failed file can be retried or
 * removed. Uploads are kept per scope (a composer's draft key) in memory, so a
 * remounted composer shows the same chips. Picking a file again while it is
 * still uploading does not upload it twice, and picking a failed file again
 * retries it.
 *
 * A task either delivers its path itself (into a draft store that outlives the
 * composer) or resolves to the text to insert. That text is kept for the scope
 * until a composer mounted for it takes it (`useAttachmentDelivery`), so a
 * path is never lost because the composer that started the upload closed.
 */
export type AttachmentUpload = {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: "uploading" | "done" | "failed";
  error: string | null;
};

/**
 * Uploads one file and either delivers its path itself or resolves to the
 * text to insert. It reports byte progress and throws when the upload or its
 * own delivery fails.
 */
export type AttachmentTask = (
  file: File,
  onProgress: UploadProgress,
) => Promise<string | void>;

type Job = AttachmentUpload & {
  file: File;
  fingerprint: string;
  task: AttachmentTask;
};

/** How long a finished chip stays, so the user sees it land. */
const DONE_VISIBLE_MS = 2_500;

const jobs = new Map<string, readonly Job[]>();
const listeners = new Map<string, Set<() => void>>();
/** Text from finished uploads that no composer has taken yet, per scope. */
const deliveries = new Map<string, string[]>();
const deliveryListeners = new Map<string, Set<() => void>>();
const NONE: readonly AttachmentUpload[] = [];
let nextId = 0;

const fingerprint = (file: File) =>
  JSON.stringify([file.name, file.size, file.lastModified, file.type]);

function write(scope: string, next: readonly Job[]) {
  if (next.length) jobs.set(scope, next);
  else jobs.delete(scope);
  for (const listener of listeners.get(scope) ?? []) listener();
}

function patch(scope: string, id: string, change: Partial<Job>) {
  const current = jobs.get(scope) ?? [];
  if (!current.some((job) => job.id === id)) return;
  write(
    scope,
    current.map((job) => (job.id === id ? { ...job, ...change } : job)),
  );
}

export function dismissAttachmentUpload(scope: string, id: string) {
  const current = jobs.get(scope) ?? [];
  const job = current.find((candidate) => candidate.id === id);
  // A chip that is still uploading cannot be removed: its path may yet land.
  if (!job || job.status === "uploading") return;
  write(
    scope,
    current.filter((candidate) => candidate.id !== id),
  );
}

async function run(scope: string, id: string) {
  const job = jobs.get(scope)?.find((candidate) => candidate.id === id);
  if (!job) return;
  patch(scope, id, { status: "uploading", loaded: 0, error: null });
  try {
    const text = await job.task(job.file, (loaded, total) =>
      patch(scope, id, { loaded, size: total || job.size }),
    );
    // Kept before the chip says done, so a done chip's path always lands.
    if (text) {
      deliveries.set(scope, [...(deliveries.get(scope) ?? []), text]);
      for (const listener of [...(deliveryListeners.get(scope) ?? [])])
        listener();
    }
    patch(scope, id, { status: "done", loaded: job.size });
    setTimeout(() => dismissAttachmentUpload(scope, id), DONE_VISIBLE_MS);
  } catch (error) {
    patch(scope, id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Upload failed",
    });
  }
}

/**
 * Uploads files one after another, in the order given, so their paths land
 * in that order. A file already uploading in this scope is skipped; a file
 * that failed is retried with this `task`. Resolves once every file is done
 * or failed.
 */
export async function startAttachmentUploads(
  scope: string,
  files: readonly File[],
  task: AttachmentTask,
) {
  const added: string[] = [];
  for (const file of files) {
    const print = fingerprint(file);
    const current = jobs.get(scope) ?? [];
    const same = current.find(
      (job) => job.fingerprint === print && job.status !== "done",
    );
    if (same?.status === "uploading") continue;
    if (same) {
      patch(scope, same.id, { file, task });
      added.push(same.id);
      continue;
    }
    const id = `upload-${++nextId}`;
    added.push(id);
    write(scope, [
      ...current,
      {
        id,
        name: file.name || "pasted file",
        size: file.size,
        loaded: 0,
        status: "uploading",
        error: null,
        file,
        fingerprint: print,
        task,
      },
    ]);
  }
  for (const id of added) await run(scope, id);
}

export function retryAttachmentUpload(scope: string, id: string) {
  const job = jobs.get(scope)?.find((candidate) => candidate.id === id);
  if (job?.status === "failed") void run(scope, id);
}

export function attachmentUploads(scope: string): readonly AttachmentUpload[] {
  return jobs.get(scope) ?? NONE;
}

export function attachmentUploading(scope: string) {
  return attachmentUploads(scope).some((job) => job.status === "uploading");
}

function subscribe(scope: string, listener: () => void) {
  const set = listeners.get(scope) ?? new Set();
  set.add(listener);
  listeners.set(scope, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(scope);
  };
}

export function useAttachmentUploads(
  scope: string | null,
): readonly AttachmentUpload[] {
  return useSyncExternalStore(
    (listener) => (scope ? subscribe(scope, listener) : () => {}),
    () => (scope ? attachmentUploads(scope) : NONE),
  );
}

/**
 * Takes the text of this scope's finished uploads into a mounted composer:
 * any kept while no composer was mounted, then each as it finishes.
 */
export function useAttachmentDelivery(
  scope: string | null,
  deliver: (text: string) => void,
) {
  const latest = useRef(deliver);
  latest.current = deliver;
  useEffect(() => {
    if (!scope) return;
    const drain = () => {
      const texts = deliveries.get(scope);
      if (!texts?.length) return;
      deliveries.delete(scope);
      for (const text of texts) latest.current(text);
    };
    const set = deliveryListeners.get(scope) ?? new Set();
    set.add(drain);
    deliveryListeners.set(scope, set);
    drain();
    return () => {
      set.delete(drain);
      if (!set.size) deliveryListeners.delete(scope);
    };
  }, [scope]);
}
