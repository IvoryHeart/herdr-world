import { useSyncExternalStore } from "react";
import type { BoardNote } from "./boardDocument";

/**
 * Note edits that could not be saved (the note changed or was deleted on
 * another device), kept until the user saves or discards them. They outlive
 * Board's mount, survive a reload, and are shared by this browser's tabs.
 *
 * Each draft has its own storage key, so tabs never write the same value
 * (storage has no cross-tab locking). A change this tab could not store is
 * held as pending, overlaid on what storage says (so other tabs' drafts
 * still appear) and retried on every later change.
 */
export type KeptDraft = {
  key: string;
  started: BoardNote;
  text: string;
  reason: "changed" | "deleted";
  error?: string;
  /** When it was kept, for a stable order across tabs. */
  at?: number;
};

export type DraftStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const KEPT_DRAFTS_KEY = "herdr-world.board.unsaved";
const PREFIX = `${KEPT_DRAFTS_KEY}:`;

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
  /** This tab's changes not yet stored: a draft, or null for a removal. */
  const pending = new Map<string, KeptDraft | null>();
  /** Saves in flight in this tab; kept across remounts, never stored. */
  const saving = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: readonly KeptDraft[] = [];

  const stored = (): Map<string, KeptDraft> => {
    const out = new Map<string, KeptDraft>();
    if (!storage) return out;
    try {
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i);
        if (!name?.startsWith(PREFIX)) continue;
        try {
          const draft = JSON.parse(storage.getItem(name) ?? "null");
          if (isDraft(draft)) out.set(draft.key, draft);
        } catch {
          // One unreadable entry does not hide the others.
        }
      }
    } catch {
      // Storage unreadable: pending changes still show.
    }
    return out;
  };
  /** Storage overlaid with this tab's pending changes. */
  const view = (): KeptDraft[] => {
    const all = stored();
    for (const [key, draft] of pending) {
      if (draft) all.set(key, draft);
      else all.delete(key);
    }
    return [...all.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  };
  /** Try to store every pending change; those that fail stay pending. */
  const flush = () => {
    if (!storage) return;
    for (const [key, draft] of [...pending]) {
      try {
        if (draft) storage.setItem(PREFIX + key, JSON.stringify(draft));
        else storage.removeItem(PREFIX + key);
        pending.delete(key);
      } catch {
        // Full or blocked: kept pending and retried on the next change.
      }
    }
  };
  const refresh = () => {
    snapshot = view();
    for (const listener of listeners) listener();
  };
  const set = (key: string, draft: KeptDraft | null) => {
    pending.set(key, draft);
    flush();
    refresh();
  };
  snapshot = view();

  return {
    list: () => snapshot,
    isSaving: (key: string) => saving.has(key),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Another tab changed storage: show it, with this tab's pending changes. */
    refresh() {
      flush();
      refresh();
    },
    /** Keep a draft; one per note, the newest text replacing an older one. */
    keep(draft: KeptDraft) {
      for (const old of view())
        if (old.started.id === draft.started.id && old.key !== draft.key)
          pending.set(old.key, null);
      set(draft.key, { ...draft, at: draft.at ?? Date.now() });
    },
    update(key: string, patch: Partial<Omit<KeptDraft, "key">>) {
      const current = view().find((d) => d.key === key);
      if (current) set(key, { ...current, ...patch });
    },
    remove(key: string) {
      set(key, null);
    },
    /**
     * Run a save for a draft. Its outcome is recorded here, whether or not
     * Board is still mounted: success removes the draft, failure keeps it
     * with the error.
     */
    async save(key: string, write: () => Promise<string | null>) {
      if (saving.has(key)) return;
      saving.add(key);
      this.update(key, { error: undefined });
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
