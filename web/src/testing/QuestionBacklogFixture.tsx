import { useState } from "react";
import { questionAskerKey } from "../../../shared/questionAsker";
import { NeedsYouAskerActions } from "../world/NeedsYouAskerActions";
import { NeedsYouMessage } from "../world/NeedsYouItem";
import {
  useWorldAsks,
  WorldAsksStore,
  type WorldAsk,
} from "../world/worldAsks";
import "../world/needsYouTab.css";

/** Isolated synthetic backlog: no request can reach World or Herdr. */
export function createQuestionBacklogFixture(count = 20) {
  let revision = 1;
  let fail = false;
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  let asks: WorldAsk[] = Array.from({ length: count + 1 }, (_, i) => ({
    id: `q-fixture-${i}`,
    at: Date.now() - 3600000,
    actor: {
      label: "Synthetic asker",
      name: i < count ? "Atlas" : "Beacon",
      verified: true,
      connection_id: "synthetic-core",
      terminal_id: i < count ? "t1" : "t2",
      pane_id: i < count ? "t1" : "t2",
      connection_generation: i % 2 ? 1 : 3,
      agent_session_fingerprint: i % 2 ? "before-restart" : "after-restart",
    },
    question:
      i < count
        ? `Finished task ${i + 1}: continue?`
        : "Keep my separate question open?",
    options: [],
    owner_only: true,
  }));
  const store = new WorldAsksStore({
    async call(method, params) {
      calls.push({ method, params });
      if (method !== "world.asks.get") {
        if (fail) throw new Error("Synthetic save failure; try again");
        const ask = asks.find((entry) => entry.id === params?.id)!;
        asks = asks.filter((entry) =>
          params?.all_from_asker
            ? questionAskerKey(entry.actor) !== questionAskerKey(ask.actor)
            : entry.id !== ask.id,
        );
        revision++;
      }
      return { revision, asks: structuredClone(asks) };
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  return {
    store,
    calls,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

export default function QuestionBacklogFixture() {
  const [fixture] = useState(() => createQuestionBacklogFixture());
  const asks = useWorldAsks(fixture.store);
  return (
    <main style={{ maxWidth: 560, margin: "auto", padding: 24 }}>
      <h1>Needs you · question backlog preview</h1>
      <p>
        Synthetic questions from before and after a runtime restart. Dismiss
        Atlas's backlog in one step; Beacon's question stays open. Reload to
        leave the preview.
      </p>
      <p role="status">{asks.length} open questions</p>
      <div className="needs-you">
        <NeedsYouAskerActions asks={asks} store={fixture.store} />
        {asks.map((ask) => (
          <NeedsYouMessage
            key={ask.id}
            item={{ kind: "asks", key: `ask:${ask.id}`, ask, leaf: null }}
            now={Date.now()}
            focused={false}
            stop={null}
            onChat={() => {}}
            onOpenTerminal={() => {}}
            onAnswer={(text) => fixture.store.answer(ask.id, text)}
            onDismiss={() => fixture.store.dismiss(ask.id)}
            onReviewed={async () => false}
          />
        ))}
      </div>
    </main>
  );
}
