import { useMemo, useState } from "react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import { ResourceConnectionClientContext } from "../useConnectionClient";
import { AgentHistoryDrawer } from "../components/AgentHistoryDrawer";
import type { AgentPrompt } from "../agentPrompt";
import "../styles/layout/app.css";

/** A testing-only, wholly synthetic chat: every RPC terminates here. */
export default function PaneChatFixture() {
  const [mode, setMode] = useState("question");
  const [answer, setAnswer] = useState("");
  const client = useMemo(
    () =>
      ({
        connectionId: "preview-fixture",
        generation: 1,
        serverRuntimeGeneration:
          ["question", "working", "missing", "send-error"].indexOf(mode) + 1,
        isCurrent: () => true,
        call: async (method: string) => {
          if (method.startsWith("pane."))
            throw new Error(
              "Synthetic send failure; nothing was sent to a terminal.",
            );
          if (method === "agent_commands.get") return { commands: [] };
          if (method === "agent_artifacts.get") return { artifacts: [] };
          if (mode === "missing")
            return {
              status: "unavailable",
              detail: "Synthetic missing transcript",
              stats: {},
            };
          if (method === "agent_session.get")
            return {
              status: "ok",
              title: "Pane chat preview",
              stats: { turns: 1, records: 2 },
              session: { value: "synthetic-session" },
            };
          return {
            status: "ok",
            agent: "claude",
            pane_id: "fixture-pane",
            workspace_id: "fixture-workspace",
            tab_id: "fixture-tab",
            path: "/synthetic/session.jsonl",
            updated_at: "2026-11-19T12:00:00Z",
            history_version: 2,
            mode: "snapshot",
            cursor: { epoch: mode, revision: 1 },
            window_limit: 200,
            entries: [
              {
                id: "fixture-message",
                role: "assistant",
                kind: "message",
                text: "A synthetic conversation. Change the state above to try a question or a failed send.",
                sent_at: "2026-11-19T12:00:00Z",
              },
            ],
          };
        },
      }) as unknown as ConnectionClient,
    [mode],
  );
  const pane: Pane = {
    pane_id: "fixture-pane",
    terminal_id: "fixture-terminal",
    workspace_id: "fixture-workspace",
    tab_id: "fixture-tab",
    agent: "claude",
    agent_status:
      mode === "working" ? "working" : mode === "question" ? "blocked" : "idle",
    focused: true,
    revision: 1,
  };
  const prompt: AgentPrompt = {
    lines: [answer || "Preview question: which option?"],
    confirm: true,
    options: [
      { key: "1", label: "First option", input: "1", cursor: true },
      { key: "2", label: "Second option", input: "2" },
    ],
  };
  return (
    <main
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        padding: 12,
        gap: 8,
        background: "var(--shell-panel)",
        color: "var(--text)",
      }}
    >
      <nav aria-label="Synthetic chat states">
        {["question", "working", "missing", "send-error"].map((state) => (
          <button
            type="button"
            key={state}
            onClick={() => {
              setAnswer("");
              setMode(state);
            }}
          >
            {state}
          </button>
        ))}
      </nav>
      <ResourceConnectionClientContext.Provider value={client}>
        <AgentHistoryDrawer
          key={mode}
          pane={pane}
          open
          embedded
          paneChat={{
            prompt: mode === "question" ? prompt : null,
            activity: { word: "Testing", detail: "Synthetic working state" },
            onKeys: (key) =>
              setAnswer(
                `Preview key received: ${JSON.stringify(key)}; no terminal input sent.`,
              ),
            onShowTerminal: () => {
              location.href = location.pathname;
            },
          }}
          onOpenChange={() => {}}
        />
      </ResourceConnectionClientContext.Provider>
    </main>
  );
}
