import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionClient } from "../../api";
import type { KeyResult } from "./types";

/** After a slash command, rereads that catch the menu it opens. */
const COMMAND_REREADS_MS = [700, 1800];
/**
 * After a key, rereads that catch a redraw later than the service's own
 * wait (a composer key has none): a changed menu does not change what the
 * conversation watch reports.
 */
const KEY_REREADS_MS = [300, 900];

/**
 * Keys Chat presses in the agent's pane: a command menu's keys and field
 * text, checked against that menu, and the composer's key controls, checked
 * against the session. Each goes to the session Chat shows (`scope` names the
 * connection, runtime, pane and session); a new scope drops any notice and
 * pending reread.
 */
export function useChatKeys({
  client,
  paneId,
  sessionFingerprint,
  scope,
  reload,
}: {
  client: ConnectionClient;
  paneId: string;
  sessionFingerprint: string | null;
  scope: string;
  reload: () => void;
}) {
  const [pressing, setPressing] = useState(false);
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(
    null,
  );
  const timers = useRef(new Set<number>());
  useEffect(() => {
    setNotice(null);
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, [scope]);

  const rereadLater = useCallback(
    (delays: readonly number[]) => {
      for (const ms of delays) {
        const timer = window.setTimeout(() => {
          timers.current.delete(timer);
          reload();
        }, ms);
        timers.current.add(timer);
      }
    },
    [reload],
  );

  /** Press `key`, or type `text`, and return why nothing was sent. */
  const press = useCallback(
    async (
      key: string,
      options: { menu?: string; text?: string } = {},
    ): Promise<string> => {
      if (!sessionFingerprint || !client.isCurrent())
        return "The conversation changed. Nothing was sent.";
      setPressing(true);
      try {
        const result = (await client.call("agent_conversation.press", {
          pane_id: paneId,
          key,
          session_fingerprint: sessionFingerprint,
          ...(options.menu !== undefined
            ? { menu_fingerprint: options.menu }
            : {}),
          ...(options.text !== undefined ? { text: options.text } : {}),
        })) as KeyResult;
        return result.status === "sent" ? "" : result.message;
      } catch (reason) {
        return reason instanceof Error ? reason.message : String(reason);
      } finally {
        setPressing(false);
        reload();
        rereadLater(KEY_REREADS_MS);
      }
    },
    [client, paneId, reload, rereadLater, sessionFingerprint],
  );

  const pressMenu = useCallback(
    (menu: string, key: string, text?: string) => {
      setNotice(null);
      void press(key, { menu, ...(text !== undefined ? { text } : {}) }).then(
        (refused) => {
          if (refused) setNotice({ scope, text: refused });
        },
      );
    },
    [press, scope],
  );

  // A slash command's menu opens after the command lands; Herdr has no
  // event for it, so Chat rereads twice.
  const afterCommand = useCallback(
    () => rereadLater(COMMAND_REREADS_MS),
    [rereadLater],
  );

  return {
    pressing,
    notice: notice?.scope === scope ? notice.text : "",
    press,
    pressMenu,
    afterCommand,
  };
}
