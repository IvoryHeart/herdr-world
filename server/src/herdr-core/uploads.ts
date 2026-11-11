import { createImageUploadHandler } from "../http/image-upload";
import { createTerminalUploadHandler } from "../http/terminal-upload";
import type { CoreHost } from "./host";

/** Uploads to a core connection's host; one per runtime generation. */
export type CoreUploads = {
  image(req: Request): Promise<Response>;
  file(
    req: Request,
    filename: string | null,
    isCurrent: () => boolean,
  ): Promise<Response>;
  stop(): void;
};

/**
 * Files a person sends a core agent from World (the phone composer's image
 * and file buttons): staged on the machine the agent runs on, exactly as for
 * a Herdr (TUI) connection, and answered with the path to paste. A local
 * core stages on this computer; a Unix SSH core over that host's ssh. A
 * Windows SSH host takes none, as for Herdr connections there.
 * `signal` ends transfers in flight when the generation retires.
 */
export function createCoreUploads(
  host: Pick<CoreHost, "destination" | "windows"> | null,
  options: {
    signal: AbortSignal;
    onCleanupError?(error: unknown): void;
    /** Where local uploads are staged (the system temp directory). */
    tempRoot?: () => string;
  },
): CoreUploads | null {
  if (host?.windows) return null;
  const handlers = {
    sshHost: () => host?.destination,
    runtimeSignal: options.signal,
    tempRoot: options.tempRoot,
  };
  const cleanupError = options.onCleanupError ?? (() => undefined);
  const image = createImageUploadHandler(handlers);
  const file = createTerminalUploadHandler({
    ...handlers,
    onCleanupError: cleanupError,
  });
  // Expired uploads are swept once this generation has been used for one.
  let sweeping = false;
  const used = () => {
    if (sweeping) return;
    sweeping = true;
    void file.startCleanup().catch(cleanupError);
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
