import { ChevronLeft } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BOARD_ELEMENT_LIMITS,
  type BoardElement,
  type BoardElementInput,
  type BoardElementKind,
  parseBoardElement,
} from "../../../../../shared/boardElements";
import { CloseButton } from "../../../components/CloseButton";
import { focusDialogElement } from "../../../components/dialogFocus";
import { useLayer } from "../../../layerStack";
import { useApartments } from "../../apartments/useApartments";
import {
  memoryCatalogState,
  memoryHosts,
  requestMemoryCatalog,
  useMemoryStore,
} from "../../memory/memoryClient";
import type { WorldObject } from "../../worldObject";
import {
  ARRIVING_KINDS,
  BOARD_KIND_PRESENTATION,
  classifyLink,
  DEFAULT_TITLES,
  PLACED_KINDS,
} from "./boardElementKinds";
import {
  libraryMemoryChoices,
  residentChoices,
  residentLabel,
} from "./boardElementLinks";
import { projectChoices } from "./boardElementRead";

export type AddDialogHost = { key: string; label: string };

/** Plain words for the shared validator's refusals. */
function fieldProblem(message: string) {
  if (message.includes("path"))
    return "Use a path inside the project, such as notes/MEMORY.md.";
  if (
    message.includes("HTTP") ||
    message.includes("URL") ||
    message.includes("Invalid URL")
  )
    return "Use a full web address starting with https://, without a password in it.";
  if (message.includes("title")) return "Give it a title.";
  if (message.includes("text"))
    return `Keep the page under ${BOARD_ELEMENT_LIMITS.text.toLocaleString()} characters.`;
  if (message.includes("agent")) return "Shorten the agent or session name.";
  if (message.includes("memory source"))
    return "Choose a memory from the Library.";
  return "Board cannot save this. Check the fields.";
}

/**
 * Board's Add dialog: every kind in the one registry, then a short form for
 * the kinds placed as elements. Kinds Board already had keep their own
 * seams: a note starts where notes start, a workspace opens the New
 * workspace dialog, Work opens its lens, and the rest say where they come from.
 * The same form edits an element.
 */
export function BoardAddDialog({
  world,
  editing,
  newWorkspaceHosts,
  preferredProject,
  onNote,
  onWork,
  onNewWorkspace,
  onSave,
  onClose,
}: {
  world: Pick<WorldObject, "hosts">;
  /** The element being edited; absent when adding. */
  editing?: BoardElement;
  /** Hosts where a workspace can be made. */
  newWorkspaceHosts: AddDialogHost[];
  /** The selected workspace, so its project is the first choice. */
  preferredProject?: { connectionId: string; workspaceId: string } | null;
  onNote(): void;
  onWork(): void;
  onNewWorkspace(hostKey: string): void;
  /** Saves the element; resolves to a problem, or null once saved. */
  onSave(
    element: Omit<BoardElementInput, "id" | "x" | "y">,
    editing?: BoardElement,
  ): Promise<string | null>;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<BoardElementKind | null>(
    editing?.kind ?? null,
  );
  useLayer(true, onClose, { element: () => ref.current });
  useEffect(() => focusDialogElement(ref.current), [kind]);
  const title = editing
    ? `Edit ${BOARD_KIND_PRESENTATION[editing.kind].label.toLowerCase()}`
    : kind
      ? `Add ${BOARD_KIND_PRESENTATION[kind].label.toLowerCase()}`
      : "Add to Board";
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={ref}
        className="modal compact-modal board-add-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          {kind && !editing ? (
            <button
              type="button"
              className="board-add-back"
              aria-label="Back to every kind"
              onClick={() => setKind(null)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          ) : null}
          <h2>{title}</h2>
          <CloseButton label={`Close ${title}`} onClick={onClose} />
        </div>
        {kind ? (
          <ElementForm
            key={kind}
            kind={kind}
            world={world}
            editing={editing}
            preferredProject={preferredProject}
            onSave={onSave}
            onClose={onClose}
          />
        ) : (
          <KindPicker
            newWorkspaceHosts={newWorkspaceHosts}
            onPick={setKind}
            onNote={onNote}
            onWork={onWork}
            onNewWorkspace={onNewWorkspace}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function KindPicker({
  newWorkspaceHosts,
  onPick,
  onNote,
  onWork,
  onNewWorkspace,
}: {
  newWorkspaceHosts: AddDialogHost[];
  onPick(kind: BoardElementKind): void;
  onNote(): void;
  onWork(): void;
  onNewWorkspace(hostKey: string): void;
}) {
  return (
    <div className="board-add-kinds">
      <h3 className="board-add-section">Place on Board</h3>
      <div className="board-add-grid" role="list">
        {PLACED_KINDS.map((entry) => {
          const Icon = entry.icon;
          return (
            <div role="listitem" key={entry.kind}>
              <button
                type="button"
                className={`board-add-kind board-add-kind-${entry.kind}`}
                data-kind={entry.kind}
                onClick={() =>
                  entry.add === "note"
                    ? onNote()
                    : onPick(entry.kind as BoardElementKind)
                }
              >
                <span className="board-add-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="board-add-name">{entry.label}</span>
                <span className="board-add-blurb">{entry.blurb}</span>
              </button>
            </div>
          );
        })}
      </div>
      <h3 className="board-add-section">Arrive on their own</h3>
      <ul className="board-add-list">
        {ARRIVING_KINDS.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.kind} data-kind={entry.kind}>
              <Icon size={15} aria-hidden="true" />
              <span>
                <strong>{entry.label}</strong> {entry.blurb}
              </span>
              {entry.add === "work" ? (
                <button type="button" onClick={onWork}>
                  Open Work
                </button>
              ) : null}
              {entry.add === "workspace"
                ? newWorkspaceHosts.map((host) => (
                    <button
                      type="button"
                      key={host.key}
                      onClick={() => onNewWorkspace(host.key)}
                    >
                      {newWorkspaceHosts.length > 1
                        ? `New on ${host.label}`
                        : "New workspace…"}
                    </button>
                  ))
                : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ElementForm({
  kind,
  world,
  editing: opened,
  preferredProject,
  onSave,
  onClose,
}: {
  kind: BoardElementKind;
  world: Pick<WorldObject, "hosts">;
  editing?: BoardElement;
  preferredProject?: { connectionId: string; workspaceId: string } | null;
  onSave(
    element: Omit<BoardElementInput, "id" | "x" | "y">,
    editing?: BoardElement,
  ): Promise<string | null>;
  onClose(): void;
}) {
  // The draft starts from the record as it was when the form opened, and
  // saves against that record's rev; a later remote change does not refresh
  // it, so the service refuses the save instead of the draft overwriting it.
  const [editing] = useState(opened);
  const choices = useMemo(() => projectChoices(world), [world]);
  const saved = editing?.source as Record<string, string> | undefined;
  const savedProject =
    saved?.connection_id !== undefined
      ? JSON.stringify([saved.connection_id, saved.workspace_id])
      : null;
  const preferred = preferredProject
    ? JSON.stringify([
        preferredProject.connectionId,
        preferredProject.workspaceId,
      ])
    : null;
  const [titleText, setTitle] = useState(
    editing?.title ?? DEFAULT_TITLES[kind],
  );
  const [project, setProject] = useState(
    savedProject ??
      choices.find((choice) => choice.value === preferred)?.value ??
      choices[0]?.value ??
      "",
  );
  const [path, setPath] = useState(saved?.path ?? "");
  const [agent, setAgent] = useState(saved?.agent_ref ?? "");
  const [inline, setInline] = useState(
    kind === "document" ? !saved || "text" in saved : false,
  );
  const [text, setText] = useState(saved?.text ?? "");
  // A Memory element names a Library memory, or reads project files. A new
  // one starts in the Library whenever the Library can read a host.
  const [fromLibrary, setFromLibrary] = useState(
    kind === "memory" &&
      (saved ? "memory_source_id" in saved : memoryHosts().length > 0),
  );
  const savedLibrary =
    saved && "memory_source_id" in saved
      ? {
          connectionId: saved.connection_id!,
          value: JSON.stringify([
            saved.memory_source_id,
            saved.path,
            saved.workspace_id ?? "",
          ]),
        }
      : null;
  const [libraryHost, setLibraryHost] = useState(
    savedLibrary?.connectionId ??
      memoryHosts().find(
        (host) => host.connection_id === preferredProject?.connectionId,
      )?.connection_id ??
      memoryHosts()[0]?.connection_id ??
      "",
  );
  const [libraryMemory, setLibraryMemory] = useState(savedLibrary?.value ?? "");
  const [apartment, setApartment] = useState(saved?.apartment_id ?? "");
  const [url, setUrl] = useState(saved?.url ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const usesProject =
    (kind === "memory" && !fromLibrary) ||
    kind === "log" ||
    (kind === "document" && !inline);
  // The saved project stays a choice while its host is offline, so editing
  // the title never moves the element to another host.
  const shownChoices =
    savedProject && !choices.some((choice) => choice.value === savedProject)
      ? [
          ...choices,
          {
            value: savedProject,
            label: `${saved!.workspace_id} · ${saved!.connection_id} (offline)`,
          },
        ]
      : choices;

  function source(): Record<string, string> {
    if (kind === "link") return { url: url.trim() };
    if (kind === "document" && inline) return { text };
    if (kind === "memory" && fromLibrary) {
      const [memory_source_id, entry, workspace_id] = libraryMemory
        ? (JSON.parse(libraryMemory) as [string, string, string])
        : ["", "", ""];
      return {
        connection_id: libraryHost,
        ...(workspace_id ? { workspace_id } : {}),
        memory_source_id,
        path: entry,
      };
    }
    const [connection_id, workspace_id] = project
      ? (JSON.parse(project) as [string, string])
      : ["", ""];
    return {
      connection_id,
      workspace_id,
      ...(path.trim() || kind !== "memory" ? { path: path.trim() } : {}),
      ...(kind === "log" && agent.trim() ? { agent_ref: agent.trim() } : {}),
      ...(kind === "log" && apartment ? { apartment_id: apartment } : {}),
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (usesProject && !project) {
      setProblem("Choose a project on a connected host.");
      return;
    }
    if (kind === "memory" && fromLibrary && !libraryMemory) {
      setProblem("Choose a memory from the Library.");
      return;
    }
    const input = { kind, title: titleText.trim(), source: source() };
    try {
      // The service's own validator, so the form refuses what it would.
      parseBoardElement({ ...input, id: "check", x: 0, y: 0 }, 1);
    } catch (error) {
      setProblem(fieldProblem(String((error as Error).message ?? error)));
      return;
    }
    setSaving(true);
    const result = await onSave(
      input as Omit<BoardElementInput, "id" | "x" | "y">,
      editing,
    );
    setSaving(false);
    if (result) setProblem(result);
    else onClose();
  }
  const link = kind === "link" && url.trim() ? classifyLink(url.trim()) : null;
  return (
    <form className="board-add-form" onSubmit={(event) => void submit(event)}>
      <label>
        Title
        <input
          value={titleText}
          maxLength={BOARD_ELEMENT_LIMITS.title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {kind === "document" ? (
        <div className="board-add-choice" role="radiogroup" aria-label="Page">
          <button
            type="button"
            role="radio"
            aria-checked={inline}
            onClick={() => setInline(true)}
          >
            Write here
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!inline}
            onClick={() => setInline(false)}
          >
            Project file
          </button>
        </div>
      ) : null}
      {kind === "memory" ? (
        <div
          className="board-add-choice"
          role="radiogroup"
          aria-label="Memory from"
        >
          <button
            type="button"
            role="radio"
            aria-checked={fromLibrary}
            onClick={() => setFromLibrary(true)}
          >
            From the Library
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!fromLibrary}
            onClick={() => setFromLibrary(false)}
          >
            Project file
          </button>
        </div>
      ) : null}
      {kind === "memory" && fromLibrary ? (
        <LibraryMemoryPicker
          host={libraryHost}
          value={libraryMemory}
          savedValue={savedLibrary?.value}
          firstProject={
            preferredProject?.connectionId === libraryHost
              ? preferredProject.workspaceId
              : null
          }
          onHost={(next) => {
            setLibraryHost(next);
            setLibraryMemory("");
          }}
          onChange={setLibraryMemory}
        />
      ) : null}
      {usesProject ? (
        <>
          <label>
            Project
            <select
              value={project}
              disabled={!shownChoices.length}
              onChange={(event) => {
                const next = event.target.value;
                // A finished agent belongs to one host: another host's
                // project drops it, never re-pointing it there.
                if (
                  project &&
                  next &&
                  (JSON.parse(project) as string[])[0] !==
                    (JSON.parse(next) as string[])[0]
                )
                  setApartment("");
                setProject(next);
              }}
            >
              {shownChoices.length ? null : (
                <option value="">No connected project</option>
              )}
              {shownChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {kind === "memory"
              ? "File or folder"
              : kind === "log"
                ? "Saved log or transcript"
                : "File"}
            <input
              value={path}
              maxLength={BOARD_ELEMENT_LIMITS.path}
              placeholder={
                kind === "memory"
                  ? "MEMORY.md"
                  : kind === "log"
                    ? "logs/agent.jsonl"
                    : "docs/plan.md"
              }
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setPath(event.target.value)}
            />
            <small>
              {kind === "memory"
                ? "Inside the project. Leave empty for MEMORY.md; a folder lists its files."
                : "Inside the project. Board reads it when you open it."}
            </small>
          </label>
          {kind === "log" ? (
            <label>
              Agent or session (optional)
              <input
                value={agent}
                maxLength={512}
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setAgent(event.target.value)}
              />
            </label>
          ) : null}
          {kind === "log" ? (
            <ResidentPicker
              connectionId={
                project ? (JSON.parse(project) as string[])[0]! : null
              }
              value={apartment}
              onChange={setApartment}
            />
          ) : null}
        </>
      ) : null}
      {kind === "document" && inline ? (
        <label>
          Page
          <textarea
            value={text}
            rows={7}
            maxLength={BOARD_ELEMENT_LIMITS.text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      ) : null}
      {kind === "link" ? (
        <label>
          Address
          <input
            type="url"
            inputMode="url"
            value={url}
            maxLength={BOARD_ELEMENT_LIMITS.url}
            placeholder="https://github.com/example/project/pull/42"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
          />
          <small>
            {link?.kind === "pull_request"
              ? `Pull request ${link.ref}`
              : link?.kind === "issue"
                ? `Issue ${link.ref}`
                : "World keeps the address only; it never opens it for you."}
          </small>
        </label>
      ) : null}
      {problem ? (
        <p className="modal-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={saving}>
          {editing ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}

/**
 * A memory from World's Library on one host: the host (when the Library
 * reads more than one), then the memory, shelved by project as the Library
 * shelves it. The catalog is the Library's own (requestMemoryCatalog), so
 * this lists what the Library lists. A saved choice stays offered while its
 * host or catalog is away, so editing the title never re-points it.
 */
function LibraryMemoryPicker({
  host,
  value,
  savedValue,
  firstProject,
  onHost,
  onChange,
}: {
  host: string;
  value: string;
  savedValue?: string;
  firstProject: string | null;
  onHost(connectionId: string): void;
  onChange(value: string): void;
}) {
  useMemoryStore();
  const hosts = memoryHosts();
  const target = hosts.find((entry) => entry.connection_id === host);
  useEffect(() => {
    if (target) void requestMemoryCatalog(target);
  }, [target]);
  const state = target ? memoryCatalogState(target) : null;
  const catalog = state?.catalog;
  const choices = catalog ? libraryMemoryChoices(catalog, firstProject) : [];
  // The first memory is the default, once the catalog is in.
  const firstChoice = choices[0]?.value;
  useEffect(() => {
    if (!value && firstChoice) onChange(firstChoice);
  }, [value, firstChoice, onChange]);
  const groups = new Map<string, typeof choices>();
  for (const choice of choices)
    groups.set(choice.group, [...(groups.get(choice.group) ?? []), choice]);
  const savedMissing =
    savedValue !== undefined &&
    value === savedValue &&
    !choices.some((choice) => choice.value === savedValue);
  const status = !target
    ? hosts.length
      ? "That host is not one the Library can read now."
      : "The Library reads memory where a supported agent runs. Start one, or use a project file."
    : !catalog
      ? state?.status === "failed"
        ? state.error
        : "Reading the Library…"
      : choices.length
        ? "Board keeps which memory it is; the Library reads it when you open it."
        : "The Library has no memory to read on this host yet.";
  return (
    <>
      {hosts.length > 1 ? (
        <label>
          Host
          <select value={host} onChange={(event) => onHost(event.target.value)}>
            {hosts.map((entry) => (
              <option key={entry.connection_id} value={entry.connection_id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Memory
        <select
          value={value}
          disabled={!choices.length && !savedMissing}
          onChange={(event) => onChange(event.target.value)}
        >
          {choices.length || savedMissing ? null : (
            <option value="">No memory to choose</option>
          )}
          {savedMissing ? (
            <option value={savedValue}>
              {(JSON.parse(savedValue) as string[])[1]} (not read now)
            </option>
          ) : null}
          {[...groups].map(([group, entries]) => (
            <optgroup key={group} label={group}>
              {entries.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <small>{status}</small>
      </label>
    </>
  );
}

/**
 * The finished agent a log belongs to, from Apartments on the project's
 * host, so the reader can open its apartment. Optional; a saved one that has
 * moved out of Apartments stays named until it is changed.
 */
function ResidentPicker({
  connectionId,
  value,
  onChange,
}: {
  connectionId: string | null;
  value: string;
  onChange(value: string): void;
}) {
  const apartments = useApartments();
  const choices = residentChoices(
    apartments.residents,
    connectionId,
    value || undefined,
  );
  const savedMissing =
    value !== "" && !choices.some((resident) => resident.id === value);
  return (
    <label>
      Finished agent (optional)
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">None</option>
        {savedMissing ? (
          <option value={value}>
            {apartments.verified ? "Not in Apartments now" : "Saved agent"}
          </option>
        ) : null}
        {choices.map((resident) => (
          <option key={resident.id} value={resident.id}>
            {residentLabel(resident)}
          </option>
        ))}
      </select>
      <small>
        {choices.length || savedMissing
          ? "Its apartment opens from the log."
          : "Agents that finished on this host appear here, from Apartments."}
      </small>
    </label>
  );
}
