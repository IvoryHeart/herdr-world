import type { ConnectionRpcContext } from "./context";

/** Workspace file methods on one connection (file.*). */
export function handleFilesRpc(
  rpc: ConnectionRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (
    !(
      method === "file.list" ||
      method === "file.resolve" ||
      method === "file.mkdir" ||
      method === "file.move" ||
      method === "file.read" ||
      method === "file.search" ||
      method === "file.reveal"
    )
  )
    return false;
  return dispatchFilesRpc(rpc);
}

async function dispatchFilesRpc(
  rpc: ConnectionRpcContext,
): Promise<false | void> {
  const { id, method, params, sendError, sendReply, ws, connection } = rpc;
  const {
    createWorkspaceDirectory,
    listWorkspaceFiles,
    moveWorkspaceFile,
    readWorkspaceFile,
    resolveWorkspaceFiles,
    revealWorkspaceFile,
    searchWorkspaceFiles,
  } = connection.files;
  if (method === "file.list") {
    try {
      const result = await listWorkspaceFiles(params ?? {});
      sendReply({ id, result }, "file-list");
    } catch (e) {
      sendError("file-list-error", e);
    }
    return;
  }
  if (method === "file.resolve") {
    try {
      const result = await resolveWorkspaceFiles(params ?? {});
      sendReply({ id, result }, "file-resolve");
    } catch (e) {
      sendError("file-resolve-error", e);
    }
    return;
  }
  if (method === "file.mkdir" || method === "file.move") {
    try {
      const result = await (method === "file.mkdir"
        ? createWorkspaceDirectory
        : moveWorkspaceFile)(params ?? {});
      sendReply({ id, result }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "file.read") {
    try {
      const result = await readWorkspaceFile(params ?? {});
      sendReply({ id, result }, "file-read");
    } catch (e) {
      sendError("file-read-error", e);
    }
    return;
  }
  if (method === "file.search") {
    try {
      const result = await searchWorkspaceFiles(params ?? {});
      sendReply({ id, result }, "file-search");
    } catch (e) {
      sendError("file-search-error", e);
    }
    return;
  }
  if (method === "file.reveal") {
    try {
      const result = await revealWorkspaceFile(params ?? {}, ws.remoteAddress);
      sendReply({ id, result }, "file-reveal");
    } catch (e) {
      sendError("file-reveal-error", e);
    }
    return;
  }
  return false;
}
