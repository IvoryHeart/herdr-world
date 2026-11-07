import { bridge, type ConnectionClient, type ConnectionSummary } from "../api";
import { store } from "../store";
import {
  uploadTerminalFile,
  uploadTerminalImage,
  type UploadProgress,
} from "../terminalImageUpload";
import { leafOwner } from "./conversationRead";
import type { WorldAsk } from "./worldAsks";
import type { WorldLeafObject } from "./worldObject";

/**
 * Files the owner attaches to an answer in Needs you. Each is stored with the
 * terminal upload flow (its size limits and retention), and the answer
 * carries the stored paths as text: the delivered answer and `ask get` both
 * show them, so the asker can open them.
 */

/** Uploads one attached file; resolves to its stored path. */
export type AskAttachmentUpload = (
  file: File,
  onProgress: UploadProgress,
) => Promise<string>;

/** The longest answer the service records (`world.ask.answer`). */
export const ANSWER_MAX_LENGTH = 4000;

/** The line that heads the attached paths in an answer. */
export const ATTACHED_FILES_HEADING = "Attached files:";

/**
 * The answer as the asker receives it: the typed text, then one stored path
 * per line under "Attached files:". Without files it is the text alone.
 */
export function answerWithAttachments(text: string, paths: readonly string[]) {
  const answer = text.trim();
  if (!paths.length) return answer;
  const list = [ATTACHED_FILES_HEADING, ...paths].join("\n");
  return answer ? `${answer}\n\n${list}` : list;
}

/**
 * Where an answer's files are stored: on the asker's host, as Chat stores
 * files. A placed asker's files go through its agent's connection; an asker
 * whose pane is not placed now (its connection restarted, say) through its
 * own connection's current runtime, never another host's, so the paths stay
 * ones it can open. Only an asker World never placed on a connection stores
 * on the World host (its ready local connection, the default first).
 */
export function askAttachmentClient(
  ask: Pick<WorldAsk, "actor">,
  leaf: WorldLeafObject | null,
  connections: readonly ConnectionSummary[] = store.get().connections,
  connect: (id: string, generation: number) => ConnectionClient = (
    id,
    generation,
  ) => bridge.connection(id, generation),
): ConnectionClient | null {
  if (leaf) return leafOwner(leaf);
  const own = ask.actor.connection_id;
  const candidates = connections
    .filter((connection) =>
      own === undefined ? connection.type === "local" : connection.id === own,
    )
    .filter((connection) => connection.state === "ready")
    .sort((left, right) => Number(right.is_default) - Number(left.is_default));
  for (const connection of candidates) {
    const client = connect(connection.id, connection.generation);
    if (client.isCurrent()) return client;
  }
  return null;
}

/** Stores a file for an answer: images as Chat's paste does, others as files. */
export function askAttachmentUpload(
  ask: Pick<WorldAsk, "actor">,
  leaf: WorldLeafObject | null,
): AskAttachmentUpload {
  return async (file, onProgress) => {
    const client = askAttachmentClient(ask, leaf);
    if (!client)
      throw new Error(
        leaf || ask.actor.connection_id !== undefined
          ? "The asker's host is not connected"
          : "The World host is not connected",
      );
    return file.type.startsWith("image/")
      ? uploadTerminalImage(client, file, onProgress)
      : uploadTerminalFile(client, file, onProgress);
  };
}
