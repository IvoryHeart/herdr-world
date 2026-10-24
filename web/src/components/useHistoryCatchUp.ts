import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { HistoryEntry } from "./agentHistory";
import type { HistoryChatItem } from "./agentHistoryView";

export type HistoryCatchUp = {
  scope: string | undefined;
  ids: ReadonlySet<string>;
  latest: number;
  unread: number;
};

/** Visible-window identities stay bounded; older pages cannot become new replies. */
export function historyCatchUp(
  previous: HistoryCatchUp | null,
  scope: string | undefined,
  entries: readonly HistoryEntry[],
  away: boolean,
): HistoryCatchUp {
  const ids = new Set(entries.map((entry) => entry.id));
  const latest = entries.reduce(
    (value, entry) =>
      Math.max(
        value,
        Number.isFinite(Date.parse(entry.sent_at))
          ? Date.parse(entry.sent_at)
          : Number.NEGATIVE_INFINITY,
      ),
    previous && previous.scope === scope
      ? previous.latest
      : Number.NEGATIVE_INFINITY,
  );
  let unread = 0;
  if (
    away &&
    previous &&
    previous.scope === scope &&
    (previous.ids.size > 0 || Number.isFinite(previous.latest))
  ) {
    // The latest shared identity separates appended entries from prepended history.
    let anchor = -1;
    for (let index = 0; index < entries.length; index++)
      if (previous.ids.has(entries[index]!.id)) anchor = index;
    unread =
      previous.unread +
      entries.filter(
        (entry, index) =>
          entry.role === "assistant" &&
          entry.kind === "message" &&
          !entry.notice &&
          !previous.ids.has(entry.id) &&
          (anchor >= 0
            ? index > anchor
            : Date.parse(entry.sent_at) > previous.latest),
      ).length;
  } else if (away && previous && previous.scope === scope)
    unread = previous.unread;
  return { scope, ids, latest, unread };
}

export function useHistoryCatchUp(
  items: readonly HistoryChatItem[],
  scope: string | undefined,
  following: RefObject<boolean>,
  enabled: boolean,
) {
  const state = useRef<HistoryCatchUp | null>(null);
  const [unread, setUnread] = useState(0);
  const entries = useMemo(
    () =>
      items.flatMap((item) =>
        item.type === "message" ? [item.entry] : item.entries,
      ),
    [items],
  );
  useLayoutEffect(() => {
    state.current = historyCatchUp(
      state.current,
      scope,
      entries,
      enabled && !following.current,
    );
    setUnread(state.current.unread);
  }, [entries, scope, following, enabled]);
  const clear = useCallback(() => {
    if (state.current) state.current = { ...state.current, unread: 0 };
    setUnread(0);
  }, []);
  return { unread, clear };
}
