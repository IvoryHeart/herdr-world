import { useState } from "react";
import { NeedsYouMessage } from "../world/NeedsYouItem";
import {
  useWorldAsks,
  WorldAsksStore,
  type WorldAsk,
} from "../world/worldAsks";
import "../world/needsYouTab.css";

/**
 * Isolated synthetic questions from other World instances (#1152): one this
 * World holds, one another World on the same runtime holds, and two alerts
 * whose question only their home can show. No request reaches World or Herdr.
 */
export function createSiblingQuestionsFixture() {
  let revision = 1;
  const at = Date.now() - 600_000;
  let asks: WorldAsk[] = [
    {
      id: "q-local1",
      at,
      actor: { label: "claude in w1:p2", name: "Atlas", verified: true },
      question: "Use the staging database for this run?",
      options: ["Yes", "No"],
      owner_only: true,
    },
    {
      id: "peer~0123456789abcdef01234567~q-home1",
      at: at + 1_000,
      actor: { label: "codex in w2:p1", name: "Beacon", verified: true },
      question: "Open the release PR now?",
      options: ["Open it", "Wait"],
      owner_only: true,
      home: {
        name: "Herdr World · release",
        url: "http://127.0.0.1:19100/",
        port: 19_100,
        tls: false,
        any: false,
      },
    },
    {
      id: "alert~q-alert1",
      at: at + 2_000,
      actor: { label: "Comet", name: "Comet", verified: false },
      question: "Rename the shared branch?",
      options: [],
      owner_only: true,
      home: {
        name: "Herdr World · release",
        url: "http://127.0.0.1:19100/",
        port: 19_100,
      },
      alert_only: true,
    },
    {
      id: "alert~q-alert2",
      at: at + 3_000,
      actor: { label: "Dune", name: "Dune", verified: false },
      question: "Keep the old screenshots?",
      options: [],
      owner_only: true,
      home: { name: "another World", url: null },
      alert_only: true,
    },
  ];
  const store = new WorldAsksStore({
    async call(method, params) {
      if (method !== "world.asks.get") {
        const id = params?.id as string;
        if (method === "world.ask.answer" && id.startsWith("alert~"))
          throw new Error("Answer this question in Herdr World · release");
        asks = asks.filter((entry) => entry.id !== id);
        revision++;
      }
      return { revision, asks: structuredClone(asks) };
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  return { store };
}

export default function SiblingQuestionsFixture() {
  const [fixture] = useState(() => createSiblingQuestionsFixture());
  const asks = useWorldAsks(fixture.store);
  return (
    <main style={{ maxWidth: 560, margin: "auto", padding: 24 }}>
      <h1>Needs you · questions from other Worlds preview</h1>
      <p>
        Synthetic questions: one this World holds, one another World on the same
        runtime holds, and two alerts whose question only their World can show.
        Nothing reaches a runtime; reload to leave.
      </p>
      <p role="status">{asks.length} open questions</p>
      <div className="needs-you">
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
