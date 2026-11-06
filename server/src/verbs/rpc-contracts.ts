import { Type, type TProperties, type TSchema } from "typebox";
import { object, optionalText, result } from "./declaration";

const optionalNumber = Type.Optional(Type.Number());
const identifiers = {
  workspace_id: optionalText,
  tab_id: optionalText,
  pane_id: optionalText,
  terminal_id: optionalText,
};

// Native selector fields remain optional: Herdr supports implicit selections.
// Terminal and service owners retain their existing coercion/filtering contracts.
const nativeFields: Record<string, TProperties> = {
  "workspace.list": {},
  "workspace.get": identifiers,
  "workspace.create": { cwd: optionalText, label: optionalText },
  "workspace.rename": { workspace_id: optionalText, label: optionalText },
  "workspace.close": identifiers,
  "workspace.focus": identifiers,
  "workspace.move": { ...identifiers, insert_index: optionalNumber },
  "tab.list": identifiers,
  "tab.create": { ...identifiers, cwd: optionalText, label: optionalText },
  "tab.rename": { ...identifiers, label: optionalText },
  "tab.close": identifiers,
  "tab.focus": identifiers,
  "tab.move": { ...identifiers, insert_index: optionalNumber },
  "tab.next": identifiers,
  "tab.previous": identifiers,
  "pane.list": identifiers,
  "pane.get": identifiers,
  "pane.close": identifiers,
  "pane.focus": identifiers,
  "pane.focus_direction": { ...identifiers, direction: optionalText },
  "pane.move": identifiers,
  "pane.split": { ...identifiers, direction: optionalText },
  "pane.swap": identifiers,
  "pane.zoom": identifiers,
  "pane.layout": identifiers,
  "pane.resize": { ...identifiers, cols: optionalNumber, rows: optionalNumber },
  "pane.read": { ...identifiers, lines: optionalNumber },
  "pane.scroll": { ...identifiers, lines: optionalNumber },
  "pane.send_text": { ...identifiers, text: optionalText },
  "pane.send_keys": {
    ...identifiers,
    keys: Type.Optional(Type.Array(Type.String())),
  },
};
const inputs: Record<string, TSchema> = Object.fromEntries(
  Object.entries(nativeFields).map(([name, fields]) => [name, object(fields)]),
);

const rows = Type.Array(object());
const outputs: Record<string, TSchema> = {
  "bridge.ping": object({ ok: Type.Boolean() }),
  "workspace.list": object({ workspaces: rows }),
  "tab.list": object({ tabs: rows }),
  "pane.list": object({ panes: rows }),
  "agent.list": object({ agents: rows }),
  "agent_quest.list": object({ quests: rows }),
  "agent_conversation.steps": object({ steps: rows }),
  "world.board.get": object({ revision: Type.Number() }),
  "settings.terminal_transport.get": object({ surface_codecs: Type.Boolean() }),
  "settings.terminal_transport.update": object({
    surface_codecs: Type.Boolean(),
  }),
};

export const rpcInput = (name: string) => inputs[name] ?? object();
export const rpcOutput = (name: string) => outputs[name] ?? result;
