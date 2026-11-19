/**
 * Draft storage for the mobile terminal composer.
 *
 * Drafts live only in memory: terminal input can contain secrets, so they
 * must never reach localStorage. Keys are scoped by connection identity
 * (including the admitted runtime generation) and pane ID. Transport epochs
 * retire operations, while same-runtime drafts remain in this document.
 */
const drafts = new Map<string, string>();
const selections = new Map<string, { start: number; end: number }>();
const retiredDraftKeys = new Set<string>();
const recoveredUploadKeys = new Set<string>();
let activeDraftScopePrefixes: ReadonlySet<string> | null = null;
/** Scopes an open view holds itself (a herdr-core terminal), by holder count. */
const heldDraftScopePrefixes = new Map<string, number>();
type TerminalComposerDraftListener = (text: string) => void;
type TerminalComposerSubmissionListener = (pending: boolean) => void;
type TerminalComposerUploadListener = (count: number) => void;
const draftListeners = new Map<string, Set<TerminalComposerDraftListener>>();
const pendingSubmissions = new Set<string>();
const submissionListeners = new Map<
  string,
  Set<TerminalComposerSubmissionListener>
>();
const pendingUploads = new Map<string, number>();
const uploadListeners = new Map<string, Set<TerminalComposerUploadListener>>();

function notifyTerminalComposerDraft(key: string, text: string): void {
  for (const listener of draftListeners.get(key) ?? []) listener(text);
}

function notifyTerminalComposerSubmission(key: string, pending: boolean): void {
  for (const listener of submissionListeners.get(key) ?? []) listener(pending);
}

function notifyTerminalComposerUpload(key: string, count: number): void {
  for (const listener of uploadListeners.get(key) ?? []) listener(count);
}

function clearTerminalComposerUploads(key: string): void {
  if (!pendingUploads.delete(key)) return;
  notifyTerminalComposerUpload(key, 0);
}

function terminalComposerDraftScopePrefix(
  connectionId: string,
  connectionGeneration: number,
): string {
  return `${JSON.stringify([connectionId, connectionGeneration]).slice(0, -1)},`;
}

export function terminalComposerDraftKeyIsActive(key: string): boolean {
  return (
    !retiredDraftKeys.has(key) &&
    (activeDraftScopePrefixes === null ||
      [...activeDraftScopePrefixes, ...heldDraftScopePrefixes.keys()].some(
        (prefix) => key.startsWith(prefix),
      ))
  );
}

/**
 * Admits drafts for a connection App's catalogue does not list (herdr-core)
 * while a view on it is open. When the last holder lets go, that scope's
 * drafts go with it.
 */
export function holdTerminalComposerDraftScope(
  connectionId: string,
  connectionGeneration: number,
): () => void {
  const prefix = terminalComposerDraftScopePrefix(
    connectionId,
    connectionGeneration,
  );
  heldDraftScopePrefixes.set(
    prefix,
    (heldDraftScopePrefixes.get(prefix) ?? 0) + 1,
  );
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const count = (heldDraftScopePrefixes.get(prefix) ?? 1) - 1;
    if (count > 0) {
      heldDraftScopePrefixes.set(prefix, count);
      return;
    }
    heldDraftScopePrefixes.delete(prefix);
    for (const key of [...drafts.keys(), ...selections.keys()])
      if (key.startsWith(prefix) && !terminalComposerDraftKeyIsActive(key))
        clearTerminalComposerDraft(key);
  };
}

export function terminalComposerScopeGeneration(snapshot: {
  serverRuntimeGeneration?: number | null;
  connectionGeneration: number;
}): number {
  return snapshot.serverRuntimeGeneration ?? snapshot.connectionGeneration;
}

export function terminalComposerDraftKey(
  connectionId: string,
  connectionGeneration: number,
  paneId: string,
): string {
  // Structured key: plain concatenation would let a digit-ending connection
  // ID collide across generations ("srv1"+2 vs "srv"+12).
  return JSON.stringify([connectionId, connectionGeneration, paneId]);
}

/**
 * Carries unsent drafts from a runtime generation that is being replaced to
 * the same terminals in its successor (Roamgate #485, same document only).
 * Drafts stay in memory; the caller proves each pair is the same connection,
 * destination, pane and terminal. A destination that already has text keeps
 * it.
 */
export function moveTerminalComposerDrafts(
  moves: readonly { from: string; to: string }[],
): void {
  for (const { from, to } of moves) {
    const text = drafts.get(from);
    if (!text || drafts.get(to)) continue;
    writeTerminalComposerDraft(to, text);
    const selection = selections.get(from);
    if (selection) selections.set(to, selection);
  }
}

export function readTerminalComposerDraft(key: string): string {
  return drafts.get(key) ?? "";
}

export function readTerminalComposerSelection(
  key: string,
): { start: number; end: number } | null {
  return selections.get(key) ?? null;
}

/** Records the live textarea selection so async uploads use the latest mount. */
export function writeTerminalComposerSelection(
  key: string,
  selectionStart: number,
  selectionEnd: number,
): void {
  if (!terminalComposerDraftKeyIsActive(key)) return;
  const length = readTerminalComposerDraft(key).length;
  if (length === 0) {
    selections.delete(key);
    return;
  }
  const start = Math.max(0, Math.min(selectionStart, length));
  const end = Math.max(start, Math.min(selectionEnd, length));
  selections.set(key, { start, end });
}

/**
 * Puts text at the end of a pane's composer draft, after a blank line: the
 * draft its terminal composer and its agent chat's message box share.
 */
export function appendToPaneComposerDraft(
  connectionId: string,
  connectionGeneration: number,
  pane: { pane_id: string; terminal_id?: string },
  text: string,
): void {
  const key = terminalComposerDraftKey(
    connectionId,
    connectionGeneration,
    pane.pane_id,
  );
  const draft = readTerminalComposerDraft(key).trimEnd();
  writeTerminalComposerDraft(key, draft ? `${draft}\n\n${text}` : text);
}

export function writeTerminalComposerDraft(key: string, text: string): void {
  if (!text) {
    clearTerminalComposerDraft(key);
    return;
  }
  if (!terminalComposerDraftKeyIsActive(key)) return;
  if (drafts.get(key) === text) return;
  drafts.set(key, text);
  notifyTerminalComposerDraft(key, text);
}

export function clearTerminalComposerDraft(key: string): void {
  recoveredUploadKeys.delete(key);
  selections.delete(key);
  if (!drafts.delete(key)) return;
  notifyTerminalComposerDraft(key, "");
}

/** Keeps mounted composers synchronized with async updates to their draft. */
export function subscribeTerminalComposerDraft(
  key: string,
  listener: TerminalComposerDraftListener,
): () => void {
  const listeners = draftListeners.get(key) ?? new Set();
  listeners.add(listener);
  draftListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) draftListeners.delete(key);
  };
}

export function terminalComposerSubmissionPending(key: string): boolean {
  return pendingSubmissions.has(key);
}

/** Text was pasted, but delivery of its separate submit key is uncertain. */
export class TerminalComposerSubmitKeyError extends Error {
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super(
      "Text reached the terminal, but the submit key could not be confirmed. Check the terminal and submit there if needed; do not send the message again.",
    );
    this.cause = cause;
    this.name = "TerminalComposerSubmitKeyError";
  }
}

/**
 * Sends `draft` from the shared pane draft under the composer submission
 * contract. At most one submission runs per draft key. The submitted prefix
 * leaves the draft before the request, so an unmount/remount cannot expose it
 * as a second send while the first is pending; text typed meanwhile stays in
 * the draft. On failure the submitted text is restored unless it has already
 * reached the terminal; the error is rethrown. Returns false when another
 * submission for the key is already pending. `onBegin` runs once it is claimed.
 */
export async function submitTerminalComposerDraft(
  key: string,
  draft: string,
  send: (text: string) => Promise<void>,
  onBegin?: () => void,
): Promise<boolean> {
  if (!beginTerminalComposerSubmission(key)) return false;
  try {
    onBegin?.();
    const current = readTerminalComposerDraft(key);
    const next = current.startsWith(draft)
      ? current.slice(draft.length)
      : current;
    if (next) writeTerminalComposerDraft(key, next);
    else clearTerminalComposerDraft(key);
    try {
      await send(draft);
    } catch (error) {
      if (!(error instanceof TerminalComposerSubmitKeyError)) {
        const pendingText = readTerminalComposerDraft(key);
        writeTerminalComposerDraft(key, `${draft}${pendingText}`);
      }
      throw error;
    }
    return true;
  } finally {
    finishTerminalComposerSubmission(key);
  }
}

/** Starts at most one submission for a pane draft, even across remounts. */
export function beginTerminalComposerSubmission(key: string): boolean {
  if (!terminalComposerDraftKeyIsActive(key)) return false;
  if (pendingSubmissions.has(key)) return false;
  pendingSubmissions.add(key);
  notifyTerminalComposerSubmission(key, true);
  return true;
}

export function finishTerminalComposerSubmission(key: string): void {
  if (!pendingSubmissions.delete(key)) return;
  notifyTerminalComposerSubmission(key, false);
}

export function subscribeTerminalComposerSubmission(
  key: string,
  listener: TerminalComposerSubmissionListener,
): () => void {
  const listeners = submissionListeners.get(key) ?? new Set();
  listeners.add(listener);
  submissionListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) submissionListeners.delete(key);
  };
}

export function terminalComposerUploadCount(key: string): number {
  return pendingUploads.get(key) ?? 0;
}

/** Tracks uploads across composer remounts for the same pane draft. */
export function beginTerminalComposerUpload(key: string): boolean {
  if (!terminalComposerDraftKeyIsActive(key)) return false;
  const count = terminalComposerUploadCount(key) + 1;
  pendingUploads.set(key, count);
  notifyTerminalComposerUpload(key, count);
  return true;
}

export function finishTerminalComposerUpload(key: string): void {
  const count = terminalComposerUploadCount(key);
  if (count <= 0) return;
  if (count === 1) {
    clearTerminalComposerUploads(key);
    return;
  }
  pendingUploads.set(key, count - 1);
  notifyTerminalComposerUpload(key, count - 1);
}

export function subscribeTerminalComposerUpload(
  key: string,
  listener: TerminalComposerUploadListener,
): () => void {
  const listeners = uploadListeners.get(key) ?? new Set();
  listeners.add(listener);
  uploadListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) uploadListeners.delete(key);
  };
}

/**
 * Retains the routing scope and other current managed runtimes. Focus changes
 * must not retire concurrent Inspector drafts; removed generations and their
 * async work remain unreachable.
 */
export function activateTerminalComposerDraftScope(
  connectionId: string,
  connectionGeneration: number,
  concurrentScopes: readonly {
    connectionId: string;
    connectionGeneration: number;
  }[] = [],
): void {
  activeDraftScopePrefixes = new Set([
    terminalComposerDraftScopePrefix(connectionId, connectionGeneration),
    ...concurrentScopes.map((scope) =>
      terminalComposerDraftScopePrefix(
        scope.connectionId,
        scope.connectionGeneration,
      ),
    ),
  ]);
  for (const key of drafts.keys()) {
    if (!terminalComposerDraftKeyIsActive(key) && !recoveredUploadKeys.has(key))
      clearTerminalComposerDraft(key);
  }
  for (const key of selections.keys()) {
    if (!terminalComposerDraftKeyIsActive(key)) selections.delete(key);
  }
  for (const key of pendingSubmissions) {
    if (!terminalComposerDraftKeyIsActive(key)) {
      finishTerminalComposerSubmission(key);
    }
  }
  for (const key of pendingUploads.keys()) {
    if (!terminalComposerDraftKeyIsActive(key)) {
      clearTerminalComposerUploads(key);
    }
  }
}

/** Atomically inserts into the latest shared draft and advances its caret. */
export function insertIntoTerminalComposerDraft(
  key: string,
  insertion: string,
): { text: string; caret: number } {
  const current = readTerminalComposerDraft(key);
  if (!terminalComposerDraftKeyIsActive(key)) {
    return { text: current, caret: current.length };
  }
  const { start = current.length, end = start } =
    readTerminalComposerSelection(key) ?? {};
  const next = terminalComposerInsertAtCaret(current, start, end, insertion);
  // Publish the selection before the draft notification so a remounted
  // subscriber restores this caret when it renders the inserted path.
  selections.set(key, { start: next.caret, end: next.caret });
  writeTerminalComposerDraft(key, next.text);
  return next;
}

/** Recovery only: uploaded paths must survive even a retired connection/pane.
 * Never reactivates the key or permits input/submission to that old target.
 */
export function retainTerminalComposerUploadPaths(
  key: string,
  paths: string,
): void {
  recoveredUploadKeys.add(key);
  const current = readTerminalComposerDraft(key);
  const selection = readTerminalComposerSelection(key);
  const next = terminalComposerInsertAtCaret(
    current,
    selection?.start ?? current.length,
    selection?.end ?? current.length,
    paths,
  );
  selections.set(key, { start: next.caret, end: next.caret });
  drafts.set(key, next.text);
  notifyTerminalComposerDraft(key, next.text);
}

/** Test hook: number of retained drafts. */
export function terminalComposerDraftCount(): number {
  return drafts.size;
}

/**
 * Returns the subset of paneIds that currently hold a non-empty draft. Close
 * flows use this to warn before the draft becomes unreachable.
 */
export function terminalComposerDraftPaneIds(
  connectionId: string,
  connectionGeneration: number,
  paneIds: readonly string[],
): string[] {
  return paneIds.filter(
    (paneId) =>
      readTerminalComposerDraft(
        terminalComposerDraftKey(connectionId, connectionGeneration, paneId),
      ) !== "",
  );
}

/** Discards drafts and retires async work for panes confirmed closing. */
export function clearTerminalComposerDrafts(
  connectionId: string,
  connectionGeneration: number,
  paneIds: readonly string[],
): void {
  for (const paneId of paneIds) {
    const key = terminalComposerDraftKey(
      connectionId,
      connectionGeneration,
      paneId,
    );
    retiredDraftKeys.add(key);
    clearTerminalComposerDraft(key);
    finishTerminalComposerSubmission(key);
    clearTerminalComposerUploads(key);
  }
}

/**
 * Sentence appended to a close-confirmation message when the close would
 * discard composer drafts. Returns "" when there is nothing to warn about.
 */
export function terminalComposerCloseWarning(draftCount: number): string {
  if (draftCount <= 0) return "";
  return draftCount === 1
    ? " The unsent composer draft will be discarded."
    : ` ${draftCount} unsent composer drafts will be discarded.`;
}

export {
  sendTerminalComposerText,
  terminalComposerRequest,
  uploadedPathPieces,
  IMAGE_SETTLE_MS,
} from "./terminalComposerSend";

/**
 * Inserts an uploaded image path at the composer caret, replacing the current
 * selection. A single space is added before the path when it would otherwise
 * touch non-whitespace text, and always after it unless whitespace follows,
 * so the path stays a separate shell word and continued typing cannot merge
 * into it. Returns the next draft text and the caret position after it.
 */
export function terminalComposerInsertAtCaret(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
): { text: string; caret: number } {
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);
  const needsLeadingSpace = before !== "" && !/\s$/.test(before);
  const needsTrailingSpace = !/^\s/.test(after);
  const inserted = `${needsLeadingSpace ? " " : ""}${insertion}${
    needsTrailingSpace ? " " : ""
  }`;
  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}
