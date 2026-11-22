import {
  BOARD_ELEMENT_LIMITS,
  BOARD_ELEMENT_TYPES,
  boardElementPath,
  isLibraryMemory,
} from "../../../shared/boardElements";
import type {
  BoardElement,
  BoardProjectSource,
} from "../../../shared/boardElements";
import type {
  FileListResult,
  FilePreviewResult,
} from "../workspace/file-types";
import { BoardConflictError, type BoardStorePort } from "./board-store";
import { planBoardPatch } from "./board-plan";

export type BoardElementFiles = {
  readWorkspaceFile(
    params: Record<string, unknown>,
  ): Promise<FilePreviewResult>;
  listWorkspaceFiles(params: Record<string, unknown>): Promise<FileListResult>;
};
export type BoardElementProject = {
  files: BoardElementFiles;
  isCurrent(): boolean;
};
export type BoardElementAction = "types" | "list" | "put" | "delete" | "read";
export class BoardSourceRefusal extends Error {}

/** All transports share this owner. Sources are read on demand, never cached in Board. */
export function createBoardElementService(deps: {
  board(): Pick<BoardStorePort, "get" | "patch">;
  publish(revision: number): void;
  project(source: BoardProjectSource, generation: number): BoardElementProject;
}) {
  let reads = 0;
  return {
    async call(
      action: BoardElementAction,
      params: Record<string, unknown> = {},
      current: () => boolean = () => true,
    ): Promise<unknown> {
      const recheck = () => {
        if (!current())
          throw new BoardSourceRefusal("The request is no longer current.");
      };
      recheck();
      if (action === "types")
        return { types: BOARD_ELEMENT_TYPES, limits: BOARD_ELEMENT_LIMITS };
      if (action === "list") {
        const board = deps.board().get();
        return { revision: board.revision, elements: board.elements ?? [] };
      }
      if (action === "put" || action === "delete") {
        try {
          const document = await deps.board().patch(
            planBoardPatch([params], () => {
              recheck();
              return action === "put"
                ? [
                    {
                      op: "element.put",
                      element: params.element as BoardElement,
                      rev: params.rev as number | undefined,
                    },
                  ]
                : [
                    {
                      op: "element.delete",
                      id: params.id as string,
                      rev: params.rev as number,
                    },
                  ];
            }),
          );
          deps.publish(document.revision);
          return { status: "saved", document };
        } catch (error) {
          if (error instanceof BoardConflictError)
            return {
              status: "conflict",
              message: error.message,
              document: error.document,
            };
          throw error;
        }
      }
      if (action !== "read") throw new Error("unknown Board element action");
      const element = deps
        .board()
        .get()
        .elements?.find((entry) => entry.id === params.id);
      if (!element) return { status: "unavailable", reason: "missing_element" };
      if (element.kind === "link") {
        const url = new URL(element.source.url);
        const link_kind =
          url.hostname === "github.com" &&
          /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
            ? "pull_request"
            : url.hostname === "github.com" &&
                /^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname)
              ? "issue"
              : "url";
        return {
          status: "ready",
          element,
          content: { type: "link", url: url.href, link_kind, fetch: false },
        };
      }
      // A Library memory is read by the memory service, which owns its
      // discovery and generation fence; Board names it without a host read.
      if (element.kind === "memory" && isLibraryMemory(element.source))
        return {
          status: "ready",
          element,
          content: {
            type: "library",
            connection_id: element.source.connection_id,
            memory_source_id: element.source.memory_source_id,
            path: element.source.path,
            read_with: "world.memory.read",
          },
        };
      if ("text" in element.source)
        return {
          status: "ready",
          element,
          content: {
            type: "text",
            text: element.source.text,
            truncated: false,
          },
        };
      if (reads >= BOARD_ELEMENT_LIMITS.concurrentReads)
        return { status: "refused", reason: "busy" };
      if (
        !Number.isSafeInteger(params.connection_generation) ||
        Number(params.connection_generation) < 0
      )
        return { status: "refused", reason: "generation_required" };
      reads++;
      try {
        const source = element.source as BoardProjectSource;
        const project = deps.project(
          source,
          Number(params.connection_generation),
        );
        const check = () => {
          recheck();
          if (!project.isCurrent())
            throw new BoardSourceRefusal("The connection generation changed.");
          const saved = deps
            .board()
            .get()
            .elements?.find((entry) => entry.id === element.id);
          if (saved?.rev !== element.rev)
            throw new BoardSourceRefusal("The element changed while reading.");
        };
        const read = async (path: string) => {
          check();
          const result = await project.files.readWorkspaceFile({
            workspace_id: source.workspace_id,
            path,
          });
          check();
          return result;
        };
        let result = await read(source.path);
        let path = source.path;
        if (params.path !== undefined) {
          if (element.kind !== "memory" || result.type !== "directory")
            throw new BoardSourceRefusal(
              "Only memory directories accept a child path.",
            );
          path = `${path}/${boardElementPath(params.path)}`;
          result = await read(path);
        }
        const target = {
          connection_id: source.connection_id,
          connection_generation: params.connection_generation,
          workspace_id: source.workspace_id,
          path,
        };
        if (result.type === "directory") {
          if (element.kind !== "memory")
            return { status: "unavailable", reason: "not_a_file", element };
          check();
          const listing = await project.files.listWorkspaceFiles({
            workspace_id: source.workspace_id,
            path,
            show_hidden: true,
          });
          check();
          return {
            status: "ready",
            element,
            target,
            content: {
              type: "directory",
              entries: listing.entries
                .slice(0, BOARD_ELEMENT_LIMITS.directoryEntries)
                .map((entry) => ({
                  name: entry.name,
                  type: entry.type,
                  size: entry.size,
                })),
              truncated:
                listing.truncated ||
                listing.entries.length > BOARD_ELEMENT_LIMITS.directoryEntries,
            },
          };
        }
        if (result.binary || result.text === null || result.text === undefined)
          return { status: "unavailable", reason: "not_text", element };
        const bytes = Buffer.from(result.text);
        const truncated =
          result.truncated || bytes.length > BOARD_ELEMENT_LIMITS.readBytes;
        // TextDecoder streaming omits a partial UTF-8 codepoint at the byte boundary.
        const text = new TextDecoder().decode(
          bytes.subarray(0, BOARD_ELEMENT_LIMITS.readBytes),
          { stream: truncated },
        );
        return {
          status: "ready",
          element,
          target,
          content: {
            type: "text",
            text,
            truncated,
            size: result.size,
            mtime_ms: result.mtime_ms,
          },
        };
      } catch (error) {
        return error instanceof BoardSourceRefusal
          ? {
              status: "refused",
              reason: "changed_or_unavailable",
              message: error.message,
            }
          : { status: "unavailable", reason: "source_unavailable" };
      } finally {
        reads--;
      }
    },
  };
}
export type BoardElementService = ReturnType<typeof createBoardElementService>;
