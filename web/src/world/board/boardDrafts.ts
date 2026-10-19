import { useSyncExternalStore } from "react";
import type { BoardNote } from "./boardDocument";

/**
 * Note edits that could not be saved (the note changed or was deleted on
 * another device), kept until the user saves or discards them. They outlive
 * Board's mount, survive a reload, and are shared by this browser's tabs:
 * storage is the source of truth, every change merges by draft key, and
 * other tabs' changes arrive through the storage event.
 */
export type KeptDraft = {
  key: string;
  started: BoardNote;
  text: string;
  reason: "changed" | "deleted";
  error?: string;
};

export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const KEPT_DRAFTS_KEY = "herdr-world.board.unsaved";

const isDraft = (value: unknown): value is KeptDraft => {
  const d = value as KeptDraft | null;
  return Boolean(
    d &&
      typeof d.key === "string" &&
      typeof d.text === "string" &&
      d.started &&
      typeof d.started.id === "string" &&
      (d.reason === "changed" || d.reason === "deleted"),
  );
};

export function createDraftStore(storage: DraftStorage | null) {
  /** Used when storage is unavailable, so drafts still outlive remounts. */
  let memory: KeptDraft[] = [];
  /**
   * True after a write failed (full or blocked storage that may still read):
   * this tab's memory is then authoritative, and each change retries.
   */
  let unpersisted = false;
  /** Saves in flight in this tab; kept across remounts, never stored. */
  const saving = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: readonly KeptDraft[] = [];

  const read = (): KeptDraft[] => {
    if (!storage || unpersisted) return memory;
    try {
      const raw = JSON.parse(storage.getItem(KEPT_DRAFTS_KEY) ?? "[]");
      return Array.isArray(raw) ? raw.filter(isDraft) : [];
    } catch {
      return memory;
    }
  };
  const write = (list: KeptDraft[]) => {
    memory = list;
    if (!storage) return;
    try {
      if (list.length) storage.setItem(KEPT_DRAFTS_KEY, JSON.stringify(list));
      else storage.removeItem(KEPT_DRAFTS_KEY);
      unpersisted = false;
    } catch {
      // Full or blocked: memory holds them for this page until a write works.
      unpersisted = true;
    }
  };
  const refresh = () => {
    snapshot = read();
    for (const listener of listeners) listener();
  };
  /** Read, change and write in one step, so other tabs' drafts are kept. */
  const change = (edit: (list: KeptDraft[]) => KeptDraft[]) => {
    write(edit(read()));
    refresh();
  };
  snapshot = read();

  return {
    list: () => snapshot,
    isSaving: (key: string) => saving.has(key),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Another tab changed storage. */
    refresh,
    /** Keep a draft; one per note, the newest text replacing an older one. */
    keep(draft: KeptDraft) {
      change((list) => [
        ...list.filter((d) => d.started.id !== draft.started.id),
        draft,
      ]);
    },
    update(key: string, patch: Partial<Omit<KeptDraft, "key">>) {
      change((list) =>
        list.map((d) => (d.key === key ? { ...d, ...patch } : d)),
      );
    },
    remove(key: string) {
      change((list) => list.filter((d) => d.key !== key));
    },
    /**
     * Run a save for a draft. Its outcome is recorded here, whether or not
     * Board is still mounted: success removes the draft, failure keeps it
     * with the error.
     */
    async save(key: string, write: () => Promise<string | null>) {
      if (saving.has(key)) return;
      saving.add(key);
      change((list) =>
        list.map((d) => (d.key === key ? { ...d, error: undefined } : d)),
      );
      let problem: string | null;
      try {
        problem = await write();
      } catch (error) {
        problem = String(error instanceof Error ? error.message : error);
      }
      saving.delete(key);
      if (problem) this.update(key, { error: problem });
      else this.remove(key);
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

export function useKeptDrafts(store: DraftStore) {
  return useSyncExternalStore(store.subscribe, store.list, store.list);
}
