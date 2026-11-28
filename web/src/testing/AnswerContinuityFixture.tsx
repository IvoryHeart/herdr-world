import { useState, useSyncExternalStore } from "react";
import {
  AnswerDeliveries,
  answerDeliveryLabel,
} from "../world/town/AnswerDeliveries";
import { AnswerDeliverySign } from "../world/town/AnswerDeliverySign";
import { AnswerOutboxContext } from "../world/town/answerOutbox";
import { TownSummaryPanel } from "../world/town/TownSummaryPanel";
import {
  WorldAnswerDeliveriesStore,
  useAnswerDeliveries,
  type AnswerNotice,
} from "../world/worldAnswerDeliveries";
import "../world/town/town.css";
import "../world/world.css";

/** The service's plain refusal (server/src/world/ask-recipient.ts). */
const RESTART_UNPROVED =
  "World restarted and couldn't prove the agent that asked is still the same session; answer not sent, use ask get";

type Agent = "Atlas" | "Beacon";
const asked: Record<Agent, { id: string; question: string; answer: string }> = {
  Atlas: {
    id: "q-continuity-atlas",
    question: "Run the storage migration now?",
    answer: "Yes, after the backup finishes.",
  },
  Beacon: {
    id: "q-continuity-beacon",
    question: "Delete the old preview data?",
    answer: "Keep it until Friday.",
  },
};

/**
 * Isolated synthetic outcome of the service's continuity proof: no request
 * reaches World, Herdr or herdr-core. Atlas resumed its original session;
 * a different session now runs in Beacon's terminal.
 */
export function createAnswerContinuityFixture() {
  let restarted = false,
    revision = 1;
  const typed: Record<Agent, number> = { Atlas: 0, Beacon: 0 };
  const dismissed = new Set<string>();
  const listeners = new Set<() => void>();
  const notice = (agent: Agent, refused: boolean): AnswerNotice => ({
    ask: {
      id: asked[agent].id,
      at: Date.now() - 600_000,
      actor: {
        label: agent,
        verified: true,
        connection_id: "synthetic-host",
        pane_id: agent === "Atlas" ? "w1:p1" : "w1:p2",
      },
      question: asked[agent].question,
      options: [],
      owner_only: true,
      answer: {
        text: asked[agent].answer,
        at: Date.now() - 300_000,
        by: "owner",
        occurrence: `a-${agent}`,
      },
    },
    delivery: refused
      ? { state: "refused", attempt: 1, reason: RESTART_UNPROVED }
      : {
          state: "pending",
          attempt: 0,
          reason: "Answer stored; World stopped before sending it",
        },
    can_resend: false,
  });
  const entries = () =>
    (restarted
      ? [notice("Beacon", true)]
      : [notice("Atlas", false), notice("Beacon", false)]
    ).filter((entry) => !dismissed.has(entry.ask.id));
  const store = new WorldAnswerDeliveriesStore({
    async call(method, params) {
      // Dismiss only hides the card; the answer stays saved.
      if (method === "world.ask.delivery.close")
        dismissed.add(String(params?.id));
      if (method === "world.ask.delivery.resend")
        throw new Error("Not offered in this preview");
      if (
        method !== "world.ask.deliveries.get" &&
        method !== "world.ask.delivery.close"
      )
        return null;
      const deliveries = entries();
      return {
        revision,
        incarnation: restarted ? "synthetic-next-run" : "synthetic-run",
        deliveries,
        next: null,
        counts: {
          checks: deliveries.filter((e) => e.delivery.state === "refused")
            .length,
          waiting: deliveries.filter((e) => e.delivery.state === "pending")
            .length,
          connections: { "synthetic-host": deliveries.length },
        },
      };
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  const publish = async () => {
    revision++;
    for (const listener of listeners) listener();
    await store.refresh();
  };
  let snapshot = { restarted, typed: { ...typed } };
  return {
    store,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => snapshot,
    /** World starts again; only the proven original session is typed into. */
    async restart() {
      if (!restarted) typed.Atlas++;
      restarted = true;
      snapshot = { restarted, typed: { ...typed } };
      await publish();
    },
    /** A later dispatcher pass: nothing refused is ever replayed. */
    async checkAgain() {
      snapshot = { restarted, typed: { ...typed } };
      await publish();
    },
  };
}

export default function AnswerContinuityFixture() {
  const [fixture] = useState(createAnswerContinuityFixture);
  const state = useAnswerDeliveries(fixture.store);
  const model = useSyncExternalStore(fixture.subscribe, fixture.get);
  const [outbox, setOutbox] = useState(false),
    [focus, setFocus] = useState(0);
  const openOutbox = () => {
    setOutbox(true);
    setFocus((key) => key + 1);
  };
  return (
    <AnswerOutboxContext.Provider value={openOutbox}>
      <main
        className="answer-continuity-fixture"
        style={{ maxWidth: 640, margin: "auto", padding: 16 }}
      >
        <h1>Town · answers across a World restart</h1>
        <p>
          Testing preview with synthetic agents; nothing reaches World, Herdr or
          herdr-core. Atlas resumes its own session after the restart; a
          different session takes Beacon's terminal. Reload to leave.
        </p>
        <div className="answer-delivery-actions">
          <button
            type="button"
            disabled={model.restarted}
            onClick={() => void fixture.restart()}
          >
            Restart World
          </button>
          <button
            type="button"
            disabled={!model.restarted}
            onClick={() => void fixture.checkAgain()}
          >
            Check again
          </button>
        </div>
        <section aria-label="Terminal input">
          <h2>Typed into terminals</h2>
          <ul>
            {(["Atlas", "Beacon"] as const).map((agent) => (
              <li key={agent} data-agent={agent}>
                {agent}: {model.typed[agent]}{" "}
                {model.typed[agent] === 1 ? "answer" : "answers"}
                {agent === "Atlas" && model.typed.Atlas
                  ? ` · ${answerDeliveryLabel("delivered")}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
        <div
          className="town-building-sign"
          style={{ position: "static", opacity: 1, visibility: "visible" }}
        >
          <strong>Reception</strong>
          <span>Synthetic host</span>
          <div className="town-reception-tags">
            <AnswerDeliverySign
              connectionId="synthetic-host"
              store={fixture.store}
            />
          </div>
        </div>
        {outbox ? (
          <TownSummaryPanel
            summary={{
              counts: {
                needsYou: 0,
                working: 0,
                finished: 0,
                quiet: 0,
                unknown: 0,
                outOfFuel: 0,
                agents: 2,
                buildings: 1,
              },
              needsYou: [],
              asks: [],
              finished: [],
              hosts: [],
              harnesses: [],
              spend: { available: false },
            }}
            now={Date.now()}
            askActions={{
              askers: new Map(),
              answer: async () => null,
              dismiss: async () => null,
              open: () => {},
            }}
            onOpenAgent={() => {}}
            onShowRoom={() => {}}
            deliveries={
              <AnswerDeliveries
                state={state}
                actions={fixture.store}
                focusKey={focus}
              />
            }
          />
        ) : null}
      </main>
    </AnswerOutboxContext.Provider>
  );
}
