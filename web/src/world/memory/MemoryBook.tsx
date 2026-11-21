import { memoryEntryEditable } from "../../../../shared/memory";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  MemoryCatalog,
  MemoryEntry,
  MemorySource,
  MemoryTarget,
} from "../../../../shared/memory";
import { memoryClient, memoryErrorCode, memoryErrorText } from "./memoryClient";
import {
  formatAge,
  formatBytes,
  KIND_LABELS,
  LOAD_LABELS,
  entryLoads,
  newEntryName,
  sharingList,
  type MemoryAgentNames,
} from "./memoryModel";

/**
 * One book open (#1027): a memory file's text, who reads it and how, and
 * its explicit actions. Nothing saves by itself: Edit, then Save; Delete,
 * then confirm. A save with an old revision conflicts and keeps your text;
 * an unknown outcome reads the file again before anything else.
 *
 * A draft keeps the revision it was started from (`base`), not whatever the
 * book read last: a recovery read after an uncertain save adopts the host's
 * revision only when the host already holds the draft (the save landed).
 * Otherwise the draft stays on its old base, so the next Save conflicts if
 * anyone else changed the file, and Load latest shows their text.
 */

/** What the book pane shows: an existing file, or a new one to write. */
export type MemoryBookOpen =
  | { kind: "entry"; source: MemorySource; entry: MemoryEntry; line?: number }
  | { kind: "new"; source: MemorySource; path: string | null };

type Loaded = {
  content: string;
  revision: string;
  modified: number;
  size: number;
};

type Notice = {
  tone: "info" | "warn" | "error";
  text: string;
  reload?: boolean;
};

export function MemoryBook({
  target,
  open,
  catalog,
  names,
  onBack,
  onChanged,
  onDeleted,
  onCreated,
}: {
  target: MemoryTarget;
  open: MemoryBookOpen;
  catalog: MemoryCatalog;
  names: MemoryAgentNames;
  onBack(): void;
  /** An update or delete landed: refresh the catalog. */
  onChanged(): void;
  onDeleted(): void;
  /** A create landed: refresh and open the new file. */
  onCreated(path: string): void;
}) {
  const { source } = open;
  const path = open.kind === "entry" ? open.entry.path : open.path;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<string | null>(
    open.kind === "new" ? "" : null,
  );
  /** The revision the draft was started from; Save sends only this one. */
  const [base, setBase] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const token = useRef(0);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const refused = open.kind === "entry" && open.entry.state === "refused";

  /**
   * Read the file fresh. `recover` follows an uncertain save: the draft
   * stays unless the host already holds exactly it.
   */
  const read = (recover = false) => {
    if (open.kind !== "entry" || refused) return;
    const mine = ++token.current;
    setReading(true);
    memoryClient()
      .read(target, source.id, open.entry.path)
      .then(
        (result) => {
          if (mine !== token.current) return;
          setLoaded({
            content: result.content,
            revision: result.revision,
            modified: result.modified_at,
            size: result.size,
          });
          const draftNow = draftRef.current;
          if (!recover || draftNow === null) {
            setDraft(null);
            setBase(null);
          } else if (draftNow === result.content) {
            // The uncertain save landed: the host has the draft.
            setDraft(null);
            setBase(null);
            setNotice({
              tone: "info",
              text: "Saved. World read the file again and it has your text.",
            });
          } else
            setNotice({
              tone: "warn",
              text: "World can't tell whether that went through, and the file on the host doesn't match your text. Your text is still here: Save again only succeeds if nobody else changed the file; Load latest shows the host's text (yours is lost).",
              reload: true,
            });
        },
        (error: unknown) => {
          if (mine !== token.current) return;
          setNotice({ tone: "error", text: memoryErrorText(error) });
        },
      )
      .finally(() => {
        if (mine === token.current) setReading(false);
      });
  };

  // A new book (another file or host) drops the last one's text and replies.
  const identity = `${target.connection_id}\u0000${target.connection_generation}\u0000${source.id}\u0000${path ?? ""}\u0000${open.kind}`;
  useEffect(() => {
    token.current += 1;
    setLoaded(null);
    setDraft(open.kind === "new" ? "" : null);
    setBase(null);
    setName("");
    setNotice(null);
    setConfirming(false);
    setBusy(false);
    read();
    // `read` closes over this identity's props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (confirming) deleteRef.current?.focus();
  }, [confirming]);

  const fail = (error: unknown, recover: boolean) => {
    const code = memoryErrorCode(error);
    if (code === "conflict")
      setNotice({
        tone: "warn",
        text: "This file changed on the host since you opened it. Your text is still here; load the latest to see theirs (yours is lost).",
        reload: true,
      });
    else if (code === "uncertain" && open.kind === "new") {
      setNotice({
        tone: "warn",
        text: "World can't tell whether the note was created. It is reading the shelves again; check them before trying again.",
      });
      onChanged();
    } else if (code === "uncertain") {
      setNotice({
        tone: "warn",
        text: "World can't tell whether that went through. It is reading the file again; check it before trying again.",
      });
      read(recover);
    } else setNotice({ tone: "error", text: memoryErrorText(error) });
  };

  const save = () => {
    if (draft === null || busy) return;
    const client = memoryClient();
    setBusy(true);
    setNotice(null);
    const mine = token.current;
    let job: Promise<unknown>;
    let created: string | null = null;
    if (open.kind === "new") {
      created = open.path ?? newEntryName(source, name);
      if (!created) {
        setBusy(false);
        setNotice({ tone: "error", text: "Name the note, like decisions.md." });
        return;
      }
      job = client.create(target, source.id, created, draft);
    } else {
      if (!base) return setBusy(false);
      job = client.update(target, source.id, open.entry.path, base, draft);
    }
    job.then(
      () => {
        if (mine !== token.current) return;
        setBusy(false);
        if (created) onCreated(created);
        else {
          onChanged();
          setNotice({
            tone: "info",
            text: "Saved. Agents see it the next time they load it.",
          });
          read();
        }
      },
      (error: unknown) => {
        if (mine !== token.current) return;
        setBusy(false);
        fail(error, open.kind === "entry");
      },
    );
  };

  const remove = () => {
    if (open.kind !== "entry" || !loaded || busy) return;
    setBusy(true);
    setNotice(null);
    const mine = token.current;
    memoryClient()
      .remove(target, source.id, open.entry.path, loaded.revision)
      .then(
        () => {
          if (mine !== token.current) return;
          setBusy(false);
          setConfirming(false);
          onChanged();
          onDeleted();
        },
        (error: unknown) => {
          if (mine !== token.current) return;
          setBusy(false);
          setConfirming(false);
          fail(error, false);
        },
      );
  };

  const sharing = sharingList(source, catalog, names);
  const claudeIndex =
    source.kind === "memory" &&
    source.harnesses.includes("claude") &&
    source.shape === "directory" &&
    path !== "MEMORY.md";
  const title =
    open.kind === "new" ? (open.path ?? "New note") : open.entry.path;
  const editing = draft !== null;

  return (
    <div className="memory-book" aria-label={`Book ${title}`}>
      <div className="memory-pane-head">
        <button type="button" className="ghost memory-back" onClick={onBack}>
          <ChevronLeft size={15} aria-hidden="true" /> Shelves
        </button>
        <h3
          title={`${source.path}${source.shape === "directory" && path ? `/${path}` : ""}`}
        >
          {title}
        </h3>
      </div>
      <div className="memory-book-meta">
        <span className={`memory-kind is-${source.kind}`}>
          {KIND_LABELS[source.kind]}
        </span>
        {open.kind === "entry" ? (
          <>
            <span>{formatBytes(loaded?.size ?? open.entry.size)}</span>
            <span className={open.entry.stale ? "memory-stale" : undefined}>
              {open.entry.stale ? "Stale · " : "Changed "}
              {formatAge(open.entry.age_ms)}
            </span>
          </>
        ) : (
          <span>New file</span>
        )}
      </div>
      <p className="memory-book-where" title={source.path}>
        {source.description || source.path}
      </p>
      {open.kind === "entry" ? (
        <ul className="memory-loads" aria-label="How agents load it">
          {entryLoads(open.entry).map((load) => (
            <li
              key={load.harness}
              className={`is-${load.mode}`}
              title={load.reason}
            >
              <b>{load.label}</b> {LOAD_LABELS[load.mode]}
              {load.reason ? <span> — {load.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="memory-book-readers">
        {sharing.agents.length
          ? `Read by ${sharing.agents.join(", ")}`
          : "No agent reads it now"}
        {sharing.projects.length ? ` · in ${sharing.projects.join(", ")}` : ""}
      </p>

      {notice ? (
        <div
          className={`memory-notice is-${notice.tone}`}
          role={notice.tone === "info" ? "status" : "alert"}
        >
          <span>{notice.text}</span>
          {notice.reload ? (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                read();
              }}
            >
              Load latest
            </button>
          ) : null}
        </div>
      ) : null}

      {refused ? (
        <p className="memory-refused">
          World won't open this file: {open.entry.reason ?? "it is refused"}.
        </p>
      ) : editing ? (
        <div className="memory-editor">
          {open.kind === "new" && !open.path ? (
            <label className="memory-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="decisions.md"
                aria-label="Note name"
                autoFocus
              />
            </label>
          ) : null}
          <textarea
            className="memory-text"
            value={draft}
            aria-label={`Text of ${title}`}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus={open.kind !== "new" || Boolean(open.path)}
          />
          <div className="memory-actions">
            <button
              type="button"
              className="memory-primary"
              onClick={save}
              disabled={busy || (open.kind === "entry" && !base)}
            >
              {busy ? "Saving…" : open.kind === "new" ? "Create" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setNotice(null);
                if (open.kind === "new") onBack();
                else {
                  setDraft(null);
                  setBase(null);
                }
              }}
            >
              Cancel
            </button>
            {claudeIndex && open.kind === "new" ? (
              <span className="memory-hint">
                Add it to MEMORY.md too, so Claude finds it.
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {!memoryEntryEditable(path ?? "") ? (
            <p className="memory-hint">
              This rule is read-only in the Library.
            </p>
          ) : null}
          <div className="memory-actions">
            <button
              type="button"
              onClick={() => {
                if (!loaded) return;
                setDraft(loaded.content);
                setBase(loaded.revision);
              }}
              disabled={!loaded || busy || !memoryEntryEditable(path ?? "")}
            >
              <Pencil size={14} aria-hidden="true" /> Edit
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => setConfirming(true)}
              disabled={!loaded || busy || !memoryEntryEditable(path ?? "")}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          </div>
          {confirming ? (
            <div
              className="memory-confirm"
              role="alertdialog"
              aria-label={`Delete ${title}?`}
            >
              <p>
                <b>Delete {title}?</b> It goes from the host for good
                {sharing.agents.length > 1
                  ? `, for all ${sharing.agents.length} agents that read it`
                  : ""}
                .
                {claudeIndex
                  ? " MEMORY.md still lists it until you edit the index."
                  : ""}
              </p>
              <div className="memory-actions">
                <button
                  ref={deleteRef}
                  type="button"
                  className="danger"
                  onClick={remove}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : null}
          <pre
            className="memory-content"
            aria-busy={reading}
            data-line={open.kind === "entry" ? open.line : undefined}
          >
            {loaded
              ? loaded.content || (
                  <span className="memory-empty">This file is empty.</span>
                )
              : reading
                ? "Reading…"
                : ""}
          </pre>
        </>
      )}
    </div>
  );
}
