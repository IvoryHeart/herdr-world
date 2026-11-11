import type { CoreRpcServices } from "../rpc/core";
import {
  connectionRoutingErrorResponse,
  publishConnectionHttpResponse,
  type ParsedConnectionHttpRoute,
} from "../connections/http-routing";
import { ConnectionRoutingError } from "../connections/protocol";
import { workspaceFileParams } from "../http/workspace-file-params";

/**
 * A file transfer on a herdr-core connection (Files, or a terminal
 * upload): its generation must be named and current, and the response is
 * published only while it is.
 */
export async function handleCoreFileHttpRequest(
  core: CoreRpcServices,
  route: Extract<ParsedConnectionHttpRoute, { kind: "connection" }>,
  url: URL,
  req: Request,
): Promise<Response> {
  const connectionId = route.requestedConnectionId!;
  const lease = core.manager.readyRuntimeLease(connectionId);
  const generationText = url.searchParams.get("connection_generation");
  if (!lease?.isCurrent())
    return Response.json(
      { error: "The host's herdr-core is not connected." },
      { status: 503 },
    );
  if (generationText !== String(lease.generation))
    return connectionRoutingErrorResponse(
      new ConnectionRoutingError(
        "The host's herdr-core reconnected; look again and retry.",
        409,
        connectionId,
        lease.generation,
      ),
    );
  const resolved = { ...lease, connectionId };
  const { endpoint } = route;
  if (endpoint === "upload-image" || endpoint === "terminal-upload")
    return publishConnectionHttpResponse(
      resolved,
      await coreTerminalUpload(core, lease, endpoint, url, req),
    );
  if (
    endpoint !== "file-download" &&
    endpoint !== "file-upload" &&
    endpoint !== "file-delete"
  )
    return publishConnectionHttpResponse(
      resolved,
      Response.json(
        { error: "Not available on a herdr-core connection." },
        { status: 501 },
      ),
    );
  let response: Response;
  try {
    const { files, remotePlatform } = core.hostRuntime(lease);
    if (remotePlatform === "windows")
      response = Response.json(
        { error: "Remote file transfers require a Unix SSH host." },
        { status: 501 },
      );
    else if (endpoint === "file-download")
      response = await files.downloadWorkspaceFile({
        ...workspaceFileParams(url),
        range: req.headers.get("range") ?? undefined,
        if_range: req.headers.get("if-range") ?? undefined,
      });
    else
      response = Response.json(
        endpoint === "file-upload"
          ? await files.uploadWorkspaceFile(workspaceFileParams(url), req)
          : await files.deleteWorkspaceFile(workspaceFileParams(url)),
      );
  } catch (error) {
    response =
      endpoint === "file-download"
        ? new Response((error as Error).message, { status: 400 })
        : Response.json({ error: (error as Error).message }, { status: 400 });
  }
  return publishConnectionHttpResponse(resolved, response);
}

/**
 * The composer's image or file for a core agent, staged on the agent's
 * machine for this generation and answered with the path to paste.
 */
async function coreTerminalUpload(
  core: CoreRpcServices,
  lease: Parameters<CoreRpcServices["hostRuntime"]>[0],
  endpoint: "upload-image" | "terminal-upload",
  url: URL,
  req: Request,
): Promise<Response> {
  try {
    const { uploads } = core.hostRuntime(lease);
    return endpoint === "upload-image"
      ? await uploads.image(req)
      : await uploads.file(req, url.searchParams.get("filename"), () =>
          lease.isCurrent(),
        );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
