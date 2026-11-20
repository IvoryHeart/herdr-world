import { useState } from "react";
import { questionAskerKey } from "../../../shared/questionAsker";
import {
  askClosed,
  askerName,
  type WorldAsk,
  type WorldAsksStore,
} from "./worldAsks";

/** Full backlog, including questions outside the current page or runtime. */
export function NeedsYouAskerActions({
  asks,
  store,
}: {
  asks: readonly WorldAsk[];
  store: Pick<WorldAsksStore, "dismissAsker">;
}) {
  const groups = new Map<string, WorldAsk[]>();
  for (const ask of asks) {
    const key = questionAskerKey(ask.actor);
    if (!key || askClosed(ask)) continue;
    const group = groups.get(key) ?? [];
    group.push(ask);
    groups.set(key, group);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismiss = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = await store.dismissAsker(id);
    setBusy(false);
    setError(problem);
  };
  return (
    <>
      {[...groups]
        .filter(([, group]) => group.length > 1)
        .map(([key, group]) => {
          const ask = group[0]!;
          return (
            <button
              key={key}
              type="button"
              className="needs-you-more"
              disabled={busy}
              title={`Close every open question from ${ask.actor.pane_id ?? ask.actor.terminal_id} on ${ask.actor.connection_id} without answering`}
              onClick={() => void dismiss(ask.id)}
            >
              Dismiss all {group.length} questions from {askerName(ask)}
            </button>
          );
        })}
      {error ? (
        <p className="needs-you-notice" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
