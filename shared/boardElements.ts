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
    placed("memory", "memory-library-or-project-files"),
    placed("log", "saved-project-transcript"),
    placed("document", "inline-or-project-file"),
    placed("link", "http-url"),
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
 * A memory chosen from World's memory Library (openspec/specs/world-memory):
 * its host, the Library's source ID and the entry inside that source, as
 * `world.memory.read` takes them. Board keeps the reference only; the memory
 * service reads it, at the host's current generation, when someone opens it.
 * `workspace_id` is the project it was chosen from: Open in Library opens there.
 */
export type BoardLibraryMemorySource = {
  connection_id: string;
  workspace_id?: string;
  memory_source_id: string;
  path: string;
};
/**
 * A saved log or transcript in a project. `agent_ref` describes the agent
 * (a name or session ID) and grants nothing; `apartment_id` names the
 * Apartments resident it belongs to, so the reader can open that apartment.
 */
export type BoardLogSource = BoardProjectSource & {
  agent_ref?: string;
  apartment_id?: string;
};
type Sources = {
  memory: BoardProjectSource | BoardLibraryMemorySource;
  log: BoardLogSource;
  document: BoardProjectSource | { text: string };
  link: { url: string };
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
          }
        | {
            /**
             * A Library memory: Board does not read it. Read it with
             * `world.memory.read` (or `herdr-world memory read`) on this
             * connection at its current generation.
             */
            type: "library";
            connection_id: string;
            memory_source_id: string;
            path: string;
            read_with: "world.memory.read";
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
/** Whether a memory element names a Library memory rather than project files. */
export function isLibraryMemory(
  source: Sources["memory"],
): source is BoardLibraryMemorySource {
  return "memory_source_id" in source;
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
      return {
        ...base,
        kind: "memory",
        source:
          source.memory_source_id === undefined
            ? project(source, true)
            : {
                connection_id: text(source.connection_id, "connection ID", 512),
                ...(source.workspace_id === undefined
                  ? {}
                  : {
                      workspace_id: text(
                        source.workspace_id,
                        "workspace ID",
                        512,
                      ),
                    }),
                memory_source_id: text(
                  source.memory_source_id,
                  "memory source ID",
                  512,
                ),
                path: boardElementPath(source.path),
              },
      };
    case "log":
      return {
        ...base,
        kind: "log",
        source: {
          ...project(source, false),
          ...(source.agent_ref === undefined
            ? {}
            : { agent_ref: text(source.agent_ref, "agent reference", 512) }),
          ...(source.apartment_id === undefined
            ? {}
            : {
                apartment_id: text(
                  source.apartment_id,
                  "apartment resident ID",
                  512,
                ),
              }),
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
    case "link": {
      const url = new URL(text(source.url, "URL", BOARD_ELEMENT_LIMITS.url));
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.href.length > BOARD_ELEMENT_LIMITS.url ||
        url.username ||
        url.password
      )
        throw new Error("board links require HTTP(S) without credentials");
      return { ...base, kind: "link", source: { url: url.href } };
    }
    default:
      throw new Error("unregistered board element kind");
  }
}
