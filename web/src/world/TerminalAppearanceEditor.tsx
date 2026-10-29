import { useEffect, useState, type ReactNode } from "react";
import {
  appearanceFor,
  AVATAR_CHOICES,
  type AppearanceFields,
} from "../../../shared/appearance";
import {
  tabCardKey,
  TERMINAL_COLOR_NAMES,
} from "../../../shared/terminalColor";
import { ColorSwatches } from "../components/ColorSwatch";
import { AppearanceAvatar } from "./AppearanceAvatar";
import {
  renameAppearanceTab,
  saveAppearance,
  useAppearanceDocument,
  type AppearanceIdentity,
} from "./appearance";
import type { ManagedWindowControls } from "./windows/WindowControls";
import "./appearance.css";

export type TerminalAppearanceEditorProps = {
  connectionId: string;
  generation: number;
  tabId: string;
  paneId: string;
  terminalId: string;
  tabTerminals?: readonly string[];
  workspaceIds: readonly string[];
  tabName: string;
  color: NonNullable<ManagedWindowControls["color"]>;
  disabled?: boolean;
  children?: ReactNode;
};
/** Separate native-name and metadata saves keep failures attributable and drafts intact. */
export function TerminalAppearanceEditor(props: TerminalAppearanceEditorProps) {
  const {
    connectionId,
    generation,
    tabId,
    paneId,
    terminalId,
    workspaceIds,
    tabName,
    color,
    disabled,
    children,
  } = props;
  const document = useAppearanceDocument();
  const tab: AppearanceIdentity = {
    connection_id: connectionId,
    connection_generation: generation,
    kind: "tab",
    native_id: tabId,
    color_key: tabCardKey(connectionId, tabId, new Set(workspaceIds)),
    witness: [...(props.tabTerminals ?? [terminalId])],
  };
  const pane: AppearanceIdentity = {
    connection_id: connectionId,
    connection_generation: generation,
    kind: "pane",
    native_id: paneId,
    witness: [terminalId],
  };
  const savedStatus = appearanceFor(document?.appearance, tab)?.status ?? "";
  const avatar = appearanceFor(document?.appearance, pane)?.avatar;
  const [name, setName] = useState(tabName),
    [status, setStatus] = useState(savedStatus);
  const [nameDirty, setNameDirty] = useState(false),
    [statusDirty, setStatusDirty] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (!nameDirty) setName(tabName);
  }, [tabName, nameDirty]);
  useEffect(() => {
    if (!statusDirty) setStatus(savedStatus);
  }, [savedStatus, statusDirty]);
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const save = async (target: AppearanceIdentity, fields: AppearanceFields) => {
    const failure = await saveAppearance(target, fields);
    if (failure) throw new Error(failure);
  };
  return (
    <section
      className="terminal-appearance-editor"
      aria-label="Terminal appearance"
    >
      <fieldset disabled={disabled || busy}>
        <legend>Tab appearance</legend>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await renameAppearanceTab(tab, name);
              setNameDirty(false);
            }, "Native tab name saved");
          }}
        >
          <label>
            Tab name
            <input
              aria-label="Tab name"
              value={name}
              maxLength={160}
              onChange={(event) => {
                setName(event.target.value);
                setNameDirty(true);
              }}
            />
          </label>
          <button type="submit" disabled={!name.trim() || !nameDirty}>
            Save name
          </button>
        </form>
        <ColorSwatches
          label="Terminal colour"
          palette={color.palette}
          current={color.current}
          onColor={(id) => {
            if (
              id !== null &&
              !(TERMINAL_COLOR_NAMES as readonly string[]).includes(id)
            )
              return;
            void run(
              () => save(tab, { color: id as AppearanceFields["color"] }),
              "Tab colour saved",
            );
          }}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await save(tab, { status });
              setStatusDirty(false);
            }, "Tab status saved");
          }}
        >
          <label>
            Status message
            <input
              aria-label="Tab status message"
              value={status}
              maxLength={160}
              onChange={(event) => {
                setStatus(event.target.value);
                setStatusDirty(true);
              }}
            />
          </label>
          <button type="submit" disabled={!statusDirty}>
            Save status
          </button>
          <button
            type="button"
            disabled={!savedStatus && !status}
            onClick={() =>
              void run(async () => {
                await save(tab, { status: null });
                setStatus("");
                setStatusDirty(false);
              }, "Tab status reset")
            }
          >
            Clear status
          </button>
        </form>
        <div role="group" aria-label="Pane avatar">
          <strong>Pane avatar</strong>
          <div className="appearance-avatars">
            {AVATAR_CHOICES.map((choice) => (
              <button
                type="button"
                key={choice.id}
                aria-label={`Avatar ${choice.name}`}
                aria-pressed={avatar === choice.id}
                onClick={() =>
                  void run(
                    () => save(pane, { avatar: choice.id }),
                    "Pane avatar saved",
                  )
                }
              >
                <AppearanceAvatar id={choice.id} />
                <span>{choice.name}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!avatar}
            onClick={() =>
              void run(() => save(pane, { avatar: null }), "Pane avatar reset")
            }
          >
            Default avatar
          </button>
        </div>
        {children}
      </fieldset>
      {disabled ? (
        <p>Appearance is unavailable while this terminal is stale.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
