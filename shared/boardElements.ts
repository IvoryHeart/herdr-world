import { ARTEFACT_KINDS, type ArtefactKind } from "./agentArtefacts";

/** Closed, built-in Board registry. Renderer keys are a UI contract, not executable plugins. */
const native = <K extends string>(
  kind: K,
  source: string,
  actions: readonly string[],
) => ({
  kind,
  renderer: kind,
  source,
  actions,
  placement: "existing" as const,
});
const placed = <K extends string>(kind: K, source: string) => ({
  kind,
  renderer: kind,
  source,
  actions: ["read", "edit", "move", "remove"] as const,
  placement: "element" as const,
});
export const BOARD_ELEMENT_TYPES = Object.freeze(
  [
    native("host", "world.snapshot", ["inspect"]),
    native("workspace", "world.snapshot", [
      "inspect",
      "move",
      "fold",
      "colour",
    ]),
    native("tab", "world.snapshot", ["inspect", "move", "pin", "colour"]),
    native("pane", "world.snapshot", ["inspect"]),
    native("note", "world.board.notes", ["edit", "move", "remove", "send"]),
    native("string", "world.board.strings", ["edit", "remove"]),
    native("work", "world.sources", ["inspect", "open"]),
    placed("memory", "project-memory-files"),
    placed("log", "saved-project-transcript"),
    placed("document", "inline-or-project-file"),
    placed("link", "http-url"),
    // A thing an agent made (shared/agentArtefacts.ts): a reference to its
    // file on the agent's host or its published link, never its content.
    placed("artefact", "agent-artefact"),
  ].map((entry) =>
    Object.freeze({ ...entry, actions: Object.freeze(entry.actions) }),
  ),
);

export type BoardRegistryKind = (typeof BOARD_ELEMENT_TYPES)[number]["kind"];
export const BOARD_ANCHOR_KINDS = BOARD_ELEMENT_TYPES.filter(
  (
    entry,
  ): entry is Extract<
    (typeof BOARD_ELEMENT_TYPES)[number],
    { kind: "workspace" | "tab" | "pane" }
  > => ["workspace", "tab", "pane"].includes(entry.kind),
).map((entry) => entry.kind);

export const BOARD_ELEMENT_LIMITS = Object.freeze({
  count: 500,
  id: 128,
  title: 200,
  path: 1024,
  text: 16_000,
  url: 2048,
  readBytes: 65_536,
  directoryEntries: 32,
  concurrentReads: 8,
});
export type BoardProjectSource = {
  connection_id: string;
  workspace_id: string;
  path: string;
};
/**
 * An agent's artefact on Board: the agent's connection and workspace, who
 * made it and either the absolute `file` its transcript names (read through
 * the same Files seam as the Inspector) or its published `url` (never
 * fetched).
 */
export type BoardArtefactSource = {
  connection_id: string;
  workspace_id: string;
  agent_ref: string;
  artefact_kind: ArtefactKind;
} & ({ file: string } | { url: string });
type Sources = {
  memory: BoardProjectSource;
  log: BoardProjectSource & { agent_ref?: string };
  document: BoardProjectSource | { text: string };
  link: { url: string };
  artefact: BoardArtefactSource;
};
export type BoardElementKind = keyof Sources;
export type BoardElement = {
  [K in BoardElementKind]: {
    id: string;
    kind: K;
    title: string;
    x: number;
    y: number;
    rev: number;
    source: Sources[K];
  };
}[BoardElementKind];
export type BoardElementInput = {
  [K in BoardElementKind]: Omit<Extract<BoardElement, { kind: K }>, "rev">;
}[BoardElementKind];
export type BoardElementReadParams = {
  id: string;
  connection_generation?: number;
  path?: string;
};
export type BoardElementReadResult =
  | {
      status: "ready";
      element: BoardElement;
      target?: BoardProjectSource & { connection_generation: number };
      content:
        | {
            type: "text";
            text: string;
            truncated: boolean;
            size?: number;
            mtime_ms?: number;
          }
        | {
            type: "directory";
            entries: {
              name: string;
              type: "directory" | "file" | "symlink";
              size: number;
            }[];
            truncated: boolean;
          }
        | {
            type: "link";
            url: string;
            link_kind: "url" | "pull_request" | "issue";
            fetch: false;
          };
    }
  | {
      status: "unavailable";
      reason:
        | "missing_element"
        | "not_a_file"
        | "not_text"
        | "source_unavailable";
      element?: BoardElement;
    }
  | {
      status: "refused";
      reason: "busy" | "generation_required" | "changed_or_unavailable";
      message?: string;
    };

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid board element object");
  return value as Record<string, unknown>;
};
function text(
  value: unknown,
  name: string,
  max: number,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error(`invalid board element ${name}`);
  return value;
}
export function boardElementPath(value: unknown): string {
  const path = text(value, "relative path", BOARD_ELEMENT_LIMITS.path);
  if (
    path.startsWith("/") ||
    /[\\:\x00-\x1f\x7f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("board element path must stay within the project");
  return path;
}
/** An absolute path on the agent's host, as the agent's transcript names it. */
export function boardArtefactFile(value: unknown): string {
  const path = text(value, "artefact file", BOARD_ELEMENT_LIMITS.path);
  if (
    !path.startsWith("/") ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path
      .slice(1)
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
    throw new Error("board artefact file must be an absolute path");
  return path;
}
function httpUrl(value: unknown): string {
  const url = new URL(text(value, "URL", BOARD_ELEMENT_LIMITS.url));
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.href.length > BOARD_ELEMENT_LIMITS.url ||
    url.username ||
    url.password
  )
    throw new Error("board links require HTTP(S) without credentials");
  return url.href;
}
function project(
  value: Record<string, unknown>,
  memory: boolean,
): BoardProjectSource {
  return {
    connection_id: text(value.connection_id, "connection ID", 512),
    workspace_id: text(value.workspace_id, "workspace ID", 512),
    path: boardElementPath(value.path ?? (memory ? "MEMORY.md" : undefined)),
  };
}
export function parseBoardElement(value: unknown, rev: number): BoardElement {
  const input = record(value),
    source = record(input.source);
  if (
    !BOARD_ELEMENT_TYPES.some(
      (entry) => entry.kind === input.kind && entry.placement === "element",
    )
  )
    throw new Error("unregistered board element kind");
  const id = text(input.id, "ID", BOARD_ELEMENT_LIMITS.id);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id))
    throw new Error("invalid board element ID");
  if (!Number.isSafeInteger(rev) || rev < 1)
    throw new Error("invalid board element revision");
  if (
    ![input.x, input.y].every(
      (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7,
    )
  )
    throw new Error("invalid board element position");
  const base = {
    id,
    title: text(input.title, "title", BOARD_ELEMENT_LIMITS.title),
    x: input.x as number,
    y: input.y as number,
    rev,
  };
  switch (input.kind) {
    case "memory":
      return { ...base, kind: "memory", source: project(source, true) };
    case "log":
      return {
        ...base,
        kind: "log",
        source: {
          ...project(source, false),
          ...(source.agent_ref === undefined
            ? {}
            : { agent_ref: text(source.agent_ref, "agent reference", 512) }),
        },
      };
    case "document":
      return {
        ...base,
        kind: "document",
        source:
          "text" in source
            ? {
                text: text(
                  source.text,
                  "text",
                  BOARD_ELEMENT_LIMITS.text,
                  true,
                ),
              }
            : project(source, false),
      };
    case "link":
      return { ...base, kind: "link", source: { url: httpUrl(source.url) } };
    case "artefact": {
      if (!ARTEFACT_KINDS.includes(source.artefact_kind as ArtefactKind))
        throw new Error("invalid board artefact kind");
      const owner = {
        connection_id: text(source.connection_id, "connection ID", 512),
        workspace_id: text(source.workspace_id, "workspace ID", 512),
        agent_ref: text(source.agent_ref, "agent reference", 512),
        artefact_kind: source.artefact_kind as ArtefactKind,
      };
      if ("file" in source === "url" in source)
        throw new Error("board artefact needs a file or a URL");
      return {
        ...base,
        kind: "artefact",
        source:
          "file" in source
            ? { ...owner, file: boardArtefactFile(source.file) }
            : { ...owner, url: httpUrl(source.url) },
      };
    }
    default:
      throw new Error("unregistered board element kind");
  }
}
