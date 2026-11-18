import { AgentProfileLink } from "./AgentProfileLink";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";
import { tabCardKey } from "../../../shared/terminalColor";
import { useState } from "react";
import type { AgentAddress } from "../../../shared/agentMove";
import { bridge } from "../api";
import { useWorldRuntime, type WorldRuntimeConnection } from "./runtimeStore";
import {
  agentMoveDestinations,
  moveBusyPreview,
  type AgentMoveOutcome,
} from "./agentMove";

/** A bounded handoff in the agent's existing Settings popover. */
export function AgentMoveControl({
  source,
  disabled,
}: {
  source: AgentAddress;
  disabled?: boolean;
}) {
  const { connections } = useWorldRuntime();
  return (
    <AgentMoveForm
      source={source}
      disabled={disabled}
      connections={connections}
    />
  );
}
export function AgentMoveForm({
  source,
  disabled,
  connections,
}: {
  source: AgentAddress;
  disabled?: boolean;
  connections: readonly WorldRuntimeConnection[];
}) {
  const destinations = agentMoveDestinations(connections, source.connection_id);
  const [open, setOpen] = useState(false),
    [selected, select] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const preview = moveBusyPreview();
  const choice = destinations.find(
    (d) => JSON.stringify(d.destination) === selected,
  );
  return (
    <section className="agent-move-control" aria-label="Move agent">
      <button
        type="button"
        disabled={disabled || busy || finished}
        onClick={() => setOpen(!open)}
      >
        Move to…
      </button>
      {open ? (
        <div>
          <p>
            Continue this conversation in another runtime. Pins, colours and
            links follow. The shell is recreated; terminal scrollback stays
            here.
          </p>
          <label>
            Destination room
            <select
              aria-label="Destination room"
              value={selected}
              disabled={busy || finished}
              onChange={(event) => select(event.target.value)}
            >
              <option value="">Choose a runtime and room</option>
              {destinations.map((d) => (
                <option
                  key={JSON.stringify(d.destination)}
                  value={JSON.stringify(d.destination)}
                >
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Folder on destination (optional)
            <input
              aria-label="Folder on destination"
              value={folder}
              disabled={busy || finished}
              placeholder="Same folder as the source"
              onChange={(event) => setFolder(event.target.value)}
            />
          </label>
          {!destinations.length ? (
            <p>Connect another runtime in Hosts → Manage connections first.</p>
          ) : null}
          {preview ? (
            <p>
              Preview test: Move will refuse background work without quitting.
            </p>
          ) : null}
          <button
            type="button"
            disabled={!choice || disabled || busy || finished}
            onClick={async () => {
              if (!choice || busy) return;
              setBusy(true);
              setMessage("Checking the destination and the original agent…");
              try {
                const result = (await bridge.call(
                  "world.agent.move",
                  {
                    source,
                    destination: {
                      ...choice.destination,
                      ...(folder.trim() ? { cwd: folder.trim() } : {}),
                    },
                    ...(preview ? { preview_busy: true } : {}),
                  },
                  180_000,
                )) as AgentMoveOutcome;
                setMessage(
                  result.message +
                    (result.status === "moved"
                      ? " Open its desk in the destination room to continue."
                      : ""),
                );
                if (
                  ["moved", "rolled_back", "uncertain"].includes(result.status)
                )
                  setFinished(true);
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Moving…" : "Move agent"}
          </button>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

export function AgentInspectorActions({
  conversation,
  workspaceIds,
  disabled,
}: {
  conversation: WorldInspectorConversation;
  workspaceIds: string[];
  disabled: boolean;
}) {
  return (
    <>
      <AgentProfileLink
        connectionId={conversation.connectionId}
        terminalId={conversation.terminalId}
      />
      {conversation.tabId && conversation.paneId && conversation.terminalId ? (
        <AgentMoveControl
          disabled={disabled}
          source={{
            connection_id: conversation.connectionId,
            generation: conversation.runtimeGeneration,
            workspace_id: conversation.workspaceId,
            tab_id: conversation.tabId,
            pane_id: conversation.paneId,
            terminal_id: conversation.terminalId,
            color_key: tabCardKey(
              conversation.connectionId,
              conversation.tabId,
              new Set(workspaceIds),
            ),
          }}
        />
      ) : null}
    </>
  );
}
