import {
  connectionRoutingErrorResponse,
  type ParsedConnectionHttpRoute,
  publishConnectionHttpResponse,
  resolveConnectionHttpRoute,
} from "../connections/http-routing";
import {
  ConnectionRoutingError,
  type ReadyConnectionRegistry,
} from "../connections/protocol";
import type { CoreConnectionProfile } from "../connections/profiles";
import type { CoreUploads } from "./runtime";
import { createImageUploadHandler } from "../http/image-upload";
import { createTerminalUploadHandler } from "../http/terminal-upload";

/**
 * Files a person sends a core agent from World (the phone composer's image
 * and file buttons): staged on the machine the agent runs on, exactly as for
 * a Herdr (TUI) connection, and answered with the path to paste. A local
 * core stages on this machine; a Unix SSH core over that host's ssh.
 */

/**
 * The upload handlers for one core runtime, or null where World cannot
 * stage files (a Windows SSH host, as for Herdr connections there).
 * `signal` ends transfers in flight when the runtime retires.
 */
export function coreUploadsForProfile(
  profile: CoreConnectionProfile,
  options: {
    signal: AbortSignal;
    sshControlPath?: string;
    onCleanupError(error: unknown): void;
    /** Where local uploads are staged (the system temp directory). */
    tempRoot?: () => string;
  },
): CoreUploads | null {
  if (profile.remote_platform === "windows") return null;
  const destination =
    profile.type === "ssh" ? profile.ssh_destination : undefined;
  if (profile.type === "ssh" && !destination) return null;
  const handlers = {
    sshHost: () => destination,
    sshControlPath: options.sshControlPath,
    runtimeSignal: options.signal,
    tempRoot: options.tempRoot,
  };
  const image = createImageUploadHandler(handlers);
  const file = createTerminalUploadHandler({
    ...handlers,
    onCleanupError: options.onCleanupError,
  });
  // Expired uploads are swept once this connection has been used for one.
  let sweeping = false;
  const used = () => {
    if (sweeping) return;
    sweeping = true;
    void file.startCleanup().catch(options.onCleanupError);
  };
  return {
    image: (req) => {
      used();
      return image(req);
    },
    file: (req, filename, isCurrent) => {
      used();
      return file(req, filename, isCurrent);
    },
    stop: () => file.stopCleanup(),
  };
}

/**
 * A herdr-core connection's HTTP: uploads only, qualified by connection ID
 * and generation like a Herdr connection's, and answered for that
 * generation alone (a reply that outlives it says so).
 */
export async function handleCoreUploadRequest(args: {
  registry: ReadyConnectionRegistry<{ uploads: CoreUploads | null }>;
  route: Extract<ParsedConnectionHttpRoute, { kind: "connection" }>;
  requestedGeneration: unknown;
  url: URL;
  req: Request;
}): Promise<Response> {
  let resolved: ReturnType<
    typeof resolveConnectionHttpRoute<{ uploads: CoreUploads | null }>
  >;
  try {
    resolved = resolveConnectionHttpRoute({
      route: args.route,
      requestedGeneration: args.requestedGeneration,
      registry: args.registry,
    });
  } catch (error) {
    if (error instanceof ConnectionRoutingError)
      return connectionRoutingErrorResponse(error);
    return Response.json(
      { error: "connection routing failed" },
      { status: 500 },
    );
  }
  const { endpoint, runtime } = resolved;
  const uploads = runtime.uploads;
  if (
    !uploads ||
    (endpoint !== "upload-image" && endpoint !== "terminal-upload")
  )
    return publishConnectionHttpResponse(
      resolved,
      Response.json(
        {
          error: uploads
            ? "herdr-core connections offer uploads only"
            : "Uploads to a herdr-core agent need a local or Unix SSH host.",
        },
        { status: 501 },
      ),
    );
  try {
    const response =
      endpoint === "upload-image"
        ? await uploads.image(args.req)
        : await uploads.file(
            args.req,
            args.url.searchParams.get("filename"),
            resolved.isCurrent,
          );
    return publishConnectionHttpResponse(resolved, response);
  } catch (error) {
    return publishConnectionHttpResponse(
      resolved,
      Response.json({ error: (error as Error).message }, { status: 500 }),
    );
  }
}
