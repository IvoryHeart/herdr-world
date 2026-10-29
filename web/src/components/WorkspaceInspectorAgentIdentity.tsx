import type { CSSProperties, ReactNode } from "react";
import { Check, FolderTree, SquareTerminal } from "lucide-react";
import type { ManagedWindowControls } from "../world/windows/WindowControls";
import type { WorkspaceInspectorContext } from "../workspaceResource";
import { AgentIcon } from "./AgentIcon";
import { ColorSwatches } from "./ColorSwatch";
import { agentName } from "./agentDisplayName";
import { middleEllipsis } from "./middleEllipsis";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * The agent's identity in the window bar. Its icon sits on its terminal
 * colour, carries its state as a badge and opens the agent's settings; the
 * name reads "<name>-<harness>" (otter-claude), shortened in the middle.
 */
export function WorkspaceInspectorAgentIdentity({
  context,
  terminalColor,
  agentSettings,
  location,
  paneMap,
}: {
  context: WorkspaceInspectorContext;
  terminalColor?: ManagedWindowControls["color"];
  /** More of the agent's settings, below the colour in the icon's popover. */
  agentSettings?: ReactNode;
  /** The location line under the name. */
  location: ReactNode;
  /** A multi-pane tab's map (InspectorPaneMap), first in the title. */
  paneMap?: ReactNode;
}) {
  const name = agentName(context);
  // The state is a badge on the icon; the word stays in its label and title.
  const badge = context.statusTone ? (
    <span
      className="workspace-inspector-agent-badge"
      data-tone={context.statusTone}
      aria-hidden="true"
    >
      {context.statusTone === "done" ? (
        <Check size={9} strokeWidth={3.5} />
      ) : context.statusTone === "blocked" ? (
        "!"
      ) : null}
    </span>
  ) : null;
  const icon = context.portrait ? (
    <img
      className="workspace-inspector-portrait"
      src={context.portrait}
      alt=""
    />
  ) : context.kind === "agent" ? (
    <AgentIcon agent={context.agent ?? context.label} compact />
  ) : context.kind === "terminal" ? (
    <SquareTerminal size={16} />
  ) : (
    <FolderTree size={16} />
  );
  return (
    <div
      className="workspace-inspector-identity workspace-inspector-agent-identity"
      data-kind={context.kind}
    >
      {paneMap}
      {terminalColor ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="workspace-inspector-agent-avatar is-settings"
              style={avatarColour(terminalColor)}
              aria-label={`Agent settings for ${name}, ${context.stateLabel}`}
              title={`${context.stateLabel} · colour and agent settings`}
            >
              {icon}
              {badge}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="workspace-inspector-agent-settings"
            align="start"
            aria-label={`Agent settings for ${context.label}`}
          >
            <strong>{name}</strong>
            <span className="workspace-inspector-agent-settings-label">
              Colour
            </span>
            <ColorSwatches
              label="Terminal colour"
              palette={terminalColor.palette}
              current={terminalColor.current}
              onColor={terminalColor.onColor}
            />
            {agentSettings}
          </PopoverContent>
        </Popover>
      ) : (
        <span
          className="workspace-inspector-agent-avatar"
          title={context.stateLabel}
        >
          {icon}
          {badge}
        </span>
      )}
      <span
        className="workspace-inspector-checkout"
        title={`${name} · ${context.stateLabel}`}
      >
        {middleEllipsis(name, 14)}
      </span>
      {location}
    </div>
  );
}

/** The icon's background: the terminal's colour, chosen or by default. */
function avatarColour(
  color: NonNullable<ManagedWindowControls["color"]>,
): CSSProperties | undefined {
  const hex = color.palette.find((entry) => entry.id === color.current.id)?.hex;
  return hex ? ({ "--agent-colour": hex } as CSSProperties) : undefined;
}
