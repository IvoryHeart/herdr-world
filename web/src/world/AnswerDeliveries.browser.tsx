import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AnswerDeliveries } from "./town/AnswerDeliveries";
import { AnswerDeliverySign } from "./town/AnswerDeliverySign";
import { AnswerOutboxContext } from "./town/answerOutbox";
import { TownRail } from "./town/TownRail";
import { TownSummaryPanel } from "./town/TownSummaryPanel";
import {
  WorldPanel,
  WorldPanelWindow,
  WorldPanelsContext,
  useWorldPanelRegistry,
} from "./windows/WorldPanel";
import {
  WorldAnswerDeliveriesStore,
  useAnswerDeliveries,
  type AnswerNotice,
} from "./worldAnswerDeliveries";
import type { TownCall } from "./town/TownRail";
import "../styles/tokens.css";
import "../styles/base.css";
import "./town/town.css";
import "./world.css";
const notice = (
  id: string,
  state: "uncertain" | "pending" | "refused",
  name: string,
  question: string,
  answer: string,
): AnswerNotice => ({
  ask: {
    id,
    at: 1000,
    actor: {
      label: name,
      verified: true,
      connection_id: "studio",
      pane_id: "w1:p1",
    },
    question,
    owner_only: true,
    options: [],
    answer: { text: answer, at: 2000, by: "owner", occurrence: `a-${id}` },
  },
  delivery: {
    state,
    attempt: 1,
    reason:
      state === "uncertain"
        ? "Service restarted before a submission receipt."
        : state === "refused"
          ? `${name}'s session changed after it asked, so World didn't send your answer.`
          : "Waiting for Studio to reconnect.",
  },
  can_resend: state === "uncertain",
});
const original = [
  notice(
    "q-recovery",
    "uncertain",
    "Dispatch",
    "Ship the reviewed fix?",
    "Ship it after the tests pass.",
  ),
  notice(
    "q-offline",
    "pending",
    "Atlas",
    "Which test should I run next?",
    "Run the focused storage suite.",
  ),
  notice(
    "q-changed",
    "refused",
    "Beacon",
    "Continue the migration?",
    "Keep the original data and report the result.",
  ),
];
let entries = structuredClone(original),
  revision = 1;
const settled = new Map<string, AnswerNotice>(),
  calls: { method: string; params: Record<string, unknown> }[] = [],
  opens: string[] = [];
const store = new WorldAnswerDeliveriesStore({
  call: async (method, params = {}) => {
    if (method === "world.ask.delivery.get")
      return settled.get(String(params.id)) ?? null;
    if (method !== "world.ask.deliveries.get") {
      calls.push({ method, params });
      const previous = entries.find((entry) => entry.ask.id === params.id);
      if (previous && method.endsWith("resend"))
        settled.set(previous.ask.id, {
          ...previous,
          delivery: { ...previous.delivery, state: "delivered" },
        });
      entries = entries.filter((entry) => entry.ask.id !== params.id);
      revision++;
    }
    return {
      revision,
      incarnation: "synthetic",
      deliveries: entries,
      next: null,
    };
  },
  onControl: () => () => {},
  onStatus: () => () => {},
});
const openQuestion = {
  id: "q-open",
  at: 1000,
  actor: { label: "Cedar", verified: true },
  question: "Which branch should I review?",
  owner_only: true,
  options: ["The fix", "The migration"],
};
const call: TownCall = {
  agent: { key: "agent-fixture", displayLabel: "Moss" } as TownCall["agent"],
  kind: "blocked",
  since: 1000,
  hostKey: "studio",
  hostLabel: "Studio",
  roomKey: "lantern",
  roomLabel: "Lantern",
};
const askActions = {
  askers: new Map(),
  answer: async () => null,
  dismiss: async () => null,
  open: () => {},
};
let scene: (value: string) => void = () => {};
function Fixture() {
  const state = useAnswerDeliveries(store),
    registry = useWorldPanelRegistry();
  const [collapsed, setCollapsed] = useState(false),
    [summary, setSummary] = useState(false),
    [focus, setFocus] = useState(0),
    [mixed, setMixed] = useState(true);
  const openOutbox = () => {
    setSummary(true);
    setFocus((key) => key + 1);
  };
  scene = (value) => {
    setCollapsed(value === "collapsed");
    setMixed(value !== "waiting");
    setSummary(value === "summary" || value === "confirm");
    setFocus((key) => key + 1);
  };
  const checks = state.counts?.checks ?? 0,
    waiting = state.counts?.waiting ?? 0;
  const deliveries = (
    <AnswerDeliveries
      state={state}
      actions={store}
      focusKey={focus}
      recipient={(entry) => ({
        name: entry.ask.actor.label,
        location: "Studio · Lantern",
        target: {
          name: entry.ask.actor.label,
          key: `agent-${entry.ask.actor.label}`,
          terminal: false,
        },
      })}
      open={(target) => opens.push(target.key!)}
    />
  );
  return (
    <AnswerOutboxContext.Provider value={openOutbox}>
      <WorldPanelsContext.Provider value={registry}>
        <style>{`.answer-capture-window{position:fixed;right:24px;top:64px;bottom:24px;width:min(620px,calc(100vw - 310px));z-index:50;border:1px solid #536154;border-radius:8px;background:#11151d;overflow:hidden}.answer-capture-window .world-panel-window{height:100%;display:flex;flex-direction:column}.answer-capture-window .world-panel-body{flex:1;overflow:auto}@media(max-width:640px){.answer-capture-window{inset:0;width:100%;border:0;border-radius:0}}`}</style>
        <div
          className="town-view-shell"
          style={{
            position: "relative",
            minHeight: "100dvh",
            padding: 16,
            background: "#23332a",
          }}
        >
          <p style={{ margin: "0 0 16px", color: "#dae4d4", fontSize: 13 }}>
            Reception · synthetic component fixture
          </p>
          <div
            className="town-building-sign"
            style={{
              position: "absolute",
              left: "65%",
              top: 100,
              width: 180,
              transform: "translateX(-50%)",
              opacity: 1,
              visibility: "visible",
            }}
          >
            <strong>Studio</strong>
            <span>1 room · 2 desks</span>
            <div className="town-reception-tags">
              <em>!1</em>
              <em>?1</em>
              <AnswerDeliverySign connectionId="studio" store={store} />
            </div>
          </div>
          <TownRail
            needsYouCount={mixed ? 2 : 0}
            asks={mixed ? [openQuestion] : []}
            askActions={askActions}
            deliveryCount={checks}
            deliveryWaiting={waiting}
            onOpenOutbox={openOutbox}
            calls={mixed ? [call] : []}
            activeKey={null}
            now={4000}
            onPeek={() => {}}
            onOpen={() => {}}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
          />
        </div>
        {summary ? (
          <WorldPanel
            name="town-summary"
            label="Town summary"
            focusKey={focus}
            onClose={() => setSummary(false)}
          >
            <TownSummaryPanel
              summary={{
                counts: { needsYou: mixed ? 2 : 0, working: 0, finished: 0 },
                needsYou: [],
                asks: mixed ? [openQuestion] : [],
                finished: [],
                hosts: [],
                spend: { available: false },
              }}
              now={4000}
              askActions={askActions}
              onOpenAgent={() => {}}
              onShowRoom={() => {}}
              deliveries={deliveries}
            />
          </WorldPanel>
        ) : null}
        {registry.panels.map((panel) => (
          <div key={panel.id} className="answer-capture-window">
            <WorldPanelWindow
              label={panel.label}
              controls={{
                maximized: false,
                compact: false,
                onMinimize() {},
                onMaximize() {},
                onClose: panel.onClose,
                onSnap() {},
                onFloat() {},
              }}
              onBody={registry.panelBodyRef(panel.id)}
            />
          </div>
        ))}
      </WorldPanelsContext.Provider>
    </AnswerOutboxContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
const outbox = () =>
  document.querySelector<HTMLButtonElement>(".town-outbox-row")!;
const ready = new MutationObserver(() => {
  if (outbox()) {
    ready.disconnect();
    void fetch("/ready", { method: "POST" });
  }
});
ready.observe(document.body, { subtree: true, childList: true });
async function reset(value = "rail") {
  entries = structuredClone(
    value === "waiting"
      ? original.filter((entry) => entry.delivery.state === "pending")
      : original,
  );
  settled.clear();
  calls.length = 0;
  opens.length = 0;
  revision++;
  await store.refresh();
  scene(value);
  await frame();
  if (value === "confirm") {
    button("Send again…").click();
    await frame();
  }
}
Object.assign(window, {
  answerDeliveryScene: reset,
  async answerDeliveryChecks() {
    await reset();
    const errors: string[] = [],
      check = (ok: boolean, message: string) => {
        if (!ok) errors.push(message);
      };
    check(
      document.querySelectorAll(".answer-delivery").length === 0,
      "Full cards leaked into rail",
    );
    check(
      outbox().textContent!.includes("2 to check · 1 waiting"),
      "Independent rail counts changed",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth,
      "Recovery overflows horizontally",
    );
    outbox().click();
    await frame();
    check(
      document.activeElement?.textContent?.startsWith("Outbox") === true,
      "Outbox route did not focus its heading",
    );
    button("Send again…").click();
    await frame();
    check(
      document.activeElement?.textContent === "Send again",
      "Duplicate confirmation did not receive focus",
    );
    check(calls.length === 0, "Opening confirmation sent input");
    check(
      document.body.textContent!.includes("sees it twice"),
      "Duplicate risk missing",
    );
    button("Cancel").click();
    await frame();
    check(
      document.activeElement?.textContent === "Send again…",
      "Cancel did not return focus",
    );
    check(calls.length === 0, "Cancel sent input");
    button("Open agent").click();
    check(
      opens[0] === "agent-Beacon",
      "Not-sent answer cannot open its current agent",
    );
    check(calls.length === 0, "Opening agent replayed answer");
    button("Send again…").click();
    await frame();
    button("Send again").click();
    await frame();
    await frame();
    check(
      calls[0]?.method === "world.ask.delivery.resend" &&
        calls[0]?.params.confirm_duplicate === true &&
        calls[0]?.params.attempt === 1 &&
        calls[0]?.params.occurrence === "a-q-recovery",
      "Exact duplicate decision lost",
    );
    check(
      document
        .querySelector('[aria-label="Answer delivery to Dispatch"]')
        ?.textContent?.includes("Sent to Dispatch.") === true,
      "Successful resend had no confirmed Sent receipt",
    );
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="Dismiss the delivery to Beacon; your answer stays saved"]',
      )!
      .click();
    await frame();
    await frame();
    check(
      calls[1]?.method === "world.ask.delivery.close",
      "Dismiss did not close delivery",
    );
    check(
      document.activeElement?.classList.contains("answer-delivery") ||
        document.activeElement?.textContent?.startsWith("Outbox") === true,
      "Dismiss lost focus",
    );
    check(
      (document.querySelector('[role="status"]')?.textContent?.length ?? 0) > 0,
      "No polite decision outcome",
    );
    await reset();
    outbox().click();
    await frame();
    button("Send again…").click();
    await frame();
    entries = entries.map((entry) =>
      entry.ask.id === "q-recovery"
        ? { ...entry, delivery: { ...entry.delivery, attempt: 3 } }
        : entry,
    );
    revision++;
    await store.refresh();
    await frame();
    check(
      !button("Send again"),
      "A changed attempt kept an old confirmation open",
    );
    check(calls.length === 0, "Changing confirmation witness sent input");
    check(
      document.body.textContent!.includes("Delivery changed"),
      "Changed confirmation lacked an explanation",
    );
    await reset("waiting");
    check(
      !document.querySelector(".town-rail"),
      "Waiting-only deliveries opened the rail",
    );
    check(
      document.querySelector(".town-reception-letter")?.textContent === "✉1",
      "Waiting-only host letter tag disappeared",
    );
    return errors;
  },
});
