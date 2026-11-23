import {
  ChevronLeft,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BOARD_ELEMENT_LIMITS,
  type BoardElement,
  type BoardElementReadParams,
  type BoardElementReadResult,
} from "../../../../../shared/boardElements";
import { CloseButton } from "../../../components/CloseButton";
import { focusDialogElement } from "../../../components/dialogFocus";
import { useLayer } from "../../../layerStack";
import {
  BOARD_KIND_PRESENTATION,
  baseName,
  classifyLink,
  projectSource,
} from "./boardElementKinds";
import {
  readProblem,
  type SourcePlace,
  type TranscriptTurn,
  transcriptTurns,
} from "./boardElementRead";

type ReadState =
  | { phase: "reading" }
  | { phase: "offline" }
  | { phase: "failed" }
  | { phase: "done"; result: BoardElementReadResult };

const WHO: Record<TranscriptTurn["who"], string> = {
  you: "You",
  agent: "Agent",
  tool: "Tools",
  note: "Note",
};

const LINK_WORDS = {
  pull_request: "Pull request",
  issue: "Issue",
  url: "Web address",
} as const;

/**
 * An element, opened: Board reads its source now, from the saved connection
 * at its current generation, and never from another host. A memory folder
 * lists its files one level at a time; a log reads as turns when it is JSON
 * lines; a link is shown and opened by the browser, never fetched by World.
 */
export function BoardElementReader({
  element,
  place,
  read,
  onOpenFiles,
  onEdit,
  onRemove,
  onClose,
}: {
  element: BoardElement;
  place: SourcePlace | null;
  read(params: BoardElementReadParams): Promise<BoardElementReadResult>;
  /**
   * Opens an artefact file in World's Files viewer: undefined for anything
   * else, null while no agent on its connection is live to open it.
   */
  onOpenFiles?: (() => void) | null;
  onEdit(): void;
  onRemove(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const kind = BOARD_KIND_PRESENTATION[element.kind];
  const Icon = kind.icon;
  const project = projectSource(element);
  const generation = project ? (place?.generation ?? null) : null;
  /** A file inside a memory folder, relative to the folder. */
  const [child, setChild] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [raw, setRaw] = useState(false);
  const [state, setState] = useState<ReadState>({ phase: "reading" });
  useLayer(true, onClose, { element: () => ref.current });
  useEffect(() => focusDialogElement(ref.current), []);

  useEffect(() => {
    void attempt;
    if (project && generation === null) {
      setState({ phase: "offline" });
      return;
    }
    let live = true;
    setState({ phase: "reading" });
    read({
      id: element.id,
      ...(generation !== null ? { connection_generation: generation } : {}),
      ...(child !== undefined ? { path: child } : {}),
    }).then(
      (result) => live && setState({ phase: "done", result }),
      () => live && setState({ phase: "failed" }),
    );
    return () => {
      live = false;
    };
    // `project` follows the element's identity and revision.
  }, [element.id, element.rev, generation, child, attempt, read]);

  const retry = () => setAttempt((value) => value + 1);
  const hostLabel = place?.hostLabel ?? "The host";
  const where = project
    ? `${child ? `${project.path}/${child}` : project.path} · ${place?.workspaceLabel} · ${hostLabel}`
    : element.kind === "link"
      ? classifyLink(element.source.url).site
      : element.kind === "artefact" && "url" in element.source
        ? classifyLink(element.source.url).site
        : "Written on Board";
  const url =
    element.kind === "link" ||
    (element.kind === "artefact" && "url" in element.source)
      ? (element.source as { url: string }).url
      : null;

  return createPortal(
    <div
      className="modal-backdrop board-reader-backdrop"
      onMouseDown={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={ref}
        className={`modal board-reader board-reader-${element.kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${kind.label}: ${element.title}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div className="board-reader-heading">
            {child !== undefined ? (
              <button
                type="button"
                className="board-add-back"
                aria-label="Back to the folder"
                onClick={() => setChild(parentOf(child))}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            ) : (
              <span className="board-reader-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
            )}
            <div className="board-reader-titles">
              <h2>{element.title}</h2>
              <small title={where}>
                {kind.label} · {where}
              </small>
            </div>
          </div>
          <CloseButton label={`Close ${element.title}`} onClick={onClose} />
        </div>
        <div className="board-reader-body" aria-live="polite">
          <ReadBody
            element={element}
            state={state}
            hostLabel={hostLabel}
            filesHint={onOpenFiles !== undefined}
            raw={raw}
            onOpen={(name) => setChild(child ? `${child}/${name}` : name)}
            onRetry={retry}
          />
        </div>
        <div className="modal-actions board-reader-actions">
          {element.kind === "log" &&
          state.phase === "done" &&
          state.result.status === "ready" &&
          state.result.content.type === "text" &&
          transcriptTurns(
            state.result.content.text,
            state.result.content.truncated,
          ) ? (
            <button
              type="button"
              className="ghost"
              aria-pressed={raw}
              onClick={() => setRaw((value) => !value)}
            >
              {raw ? "Show turns" : "Show raw"}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost danger board-reader-remove"
            title={
              project
                ? "Takes it off Board. The file stays in the project."
                : "Takes it off Board."
            }
            onClick={onRemove}
          >
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
          <button type="button" className="ghost" onClick={onEdit}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
          {onOpenFiles !== undefined ? (
            <button
              type="button"
              className="ghost board-reader-files-open"
              disabled={!onOpenFiles}
              title={
                onOpenFiles
                  ? "Opens it in World's Files viewer"
                  : `No agent is live on ${hostLabel} to open it`
              }
              onClick={() => onOpenFiles?.()}
            >
              <FolderOpen size={14} aria-hidden="true" /> Open in Files
            </button>
          ) : null}
          {url ? (
            <a
              className="board-reader-open"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} aria-hidden="true" /> Open link
            </a>
          ) : (
            <button type="button" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const parentOf = (path: string) => {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? undefined : path.slice(0, cut);
};

function ReadBody({
  element,
  state,
  hostLabel,
  filesHint,
  raw,
  onOpen,
  onRetry,
}: {
  element: BoardElement;
  state: ReadState;
  hostLabel: string;
  /** Files can show what Board cannot (an image, a PDF). */
  filesHint: boolean;
  raw: boolean;
  onOpen(name: string): void;
  onRetry(): void;
}) {
  if (state.phase === "reading")
    return (
      <p className="board-reader-status" role="status">
        Reading…
      </p>
    );
  if (state.phase === "offline")
    return (
      <p className="board-reader-status" role="status">
        {hostLabel} is offline. Board reads this only from {hostLabel}, and
        opens it again once {hostLabel} is back.
      </p>
    );
  if (state.phase === "failed" || state.result.status !== "ready") {
    const reason =
      state.phase === "done" && state.result.status !== "ready"
        ? state.result.reason
        : "";
    return (
      <div className="board-reader-status" role="alert">
        <p>
          {filesHint && reason === "not_text"
            ? "Board shows only text. Use Open in Files to see this file."
            : readProblem(reason, hostLabel)}
        </p>
        {reason !== "missing_element" ? (
          <button type="button" className="ghost" onClick={onRetry}>
            <RotateCw size={14} aria-hidden="true" /> Try again
          </button>
        ) : null}
      </div>
    );
  }
  const content = state.result.content;
  if (content.type === "link")
    return (
      <div className="board-reader-link">
        <p>{LINK_WORDS[content.link_kind]}</p>
        <code>{content.url}</code>
        <p className="board-reader-hint">
          World keeps this address and never opens it for you. Open link uses
          your browser.
        </p>
      </div>
    );
  if (content.type === "directory")
    return (
      <>
        {content.entries.length ? (
          <ul className="board-reader-files">
            {content.entries.map((entry) => (
              <li key={entry.name}>
                <button type="button" onClick={() => onOpen(entry.name)}>
                  {entry.type === "directory" ? (
                    <Folder size={14} aria-hidden="true" />
                  ) : (
                    <File size={14} aria-hidden="true" />
                  )}
                  <span>
                    {entry.name}
                    {entry.type === "directory" ? "/" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="board-reader-status">This folder is empty.</p>
        )}
        {content.truncated ? (
          <p className="board-reader-hint">
            Board lists the first {BOARD_ELEMENT_LIMITS.directoryEntries}{" "}
            entries.
          </p>
        ) : null}
      </>
    );
  const turns =
    element.kind === "log" && !raw
      ? transcriptTurns(content.text, content.truncated)
      : null;
  return (
    <>
      {turns ? (
        <ol className="board-reader-turns">
          {turns.map((turn, index) => (
            // Turns never reorder; the index is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
            <li key={index} data-who={turn.who}>
              <span className="board-reader-who">{WHO[turn.who]}</span>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      ) : content.text.trim() ? (
        <pre className="board-reader-text">{content.text}</pre>
      ) : (
        <p className="board-reader-status">
          {projectSource(element)
            ? `${baseName(projectSource(element)?.path ?? "")} is empty.`
            : "This page is empty. Use Edit to write on it."}
        </p>
      )}
      {content.truncated ? (
        <p className="board-reader-hint">
          Board shows the first{" "}
          {Math.round(BOARD_ELEMENT_LIMITS.readBytes / 1024)} KB.
        </p>
      ) : null}
    </>
  );
}
