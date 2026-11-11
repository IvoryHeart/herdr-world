import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { CoreChat } from "./CoreChat";
import type { WorldLeafObject } from "./worldObject";
import { useDrawReadiness } from "./useDrawReadiness";
import "../styles/tokens.css";
import "../styles/base.css";

const token = `${"a".repeat(64)}.${"b".repeat(32)}`;
const leaf = {
  id: "core-agent",
  kind: "agent",
  label: "Claude",
  agentName: "reviewer",
  stale: false,
  connectionId: "example-core",
  generation: 7,
  status: "blocked",
  pane: {
    runtime: "herdr-core",
    pane_id: "t1",
    core_recipient: token,
    status_message: "Which branch should I merge into?",
  },
} as WorldLeafObject;
const calls: { method: string; params: Record<string, unknown> }[] = [];
let outcome = "sent";
bridge.call = (async (method: string, params: Record<string, unknown>) => {
  calls.push({ method, params });
  if (method === "world.core.screen")
    return { text: "Which branch?\n1) main\n2) release" };
  if (outcome === "refused")
    return {
      status: "refused",
      reason: "changed",
      message: "A shell runs there now. Nothing was sent.",
    };
  if (outcome === "uncertain")
    return {
      status: "uncertain",
      message: "The input may have gone in. World will not send it again.",
    };
  return { status: "sent", turn: 1, started: true };
}) as typeof bridge.call;

function Fixture() {
  const root = useRef<HTMLElement | null>(null);
  useDrawReadiness("desk", root);
  const [scene, setScene] = useState(0);
  Object.assign(window, {
    coreChatScene(value: string) {
      outcome = value;
      flushSync(() => setScene((n) => n + 1));
    },
    coreChatCalls: calls,
  });
  return (
    <main
      ref={root}
      style={{
        minHeight: "100vh",
        padding: 16,
        boxSizing: "border-box",
        background: "var(--bg-primary)",
      }}
    >
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <h1>reviewer · Chat</h1>
        <CoreChat key={scene} leaf={leaf} />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
void fetch("/ready");
