import { useCallback, useEffect, useRef, useState } from "react";
import { type IdeClient, type IdeStatus, pageIdeClient } from "./ideClient";

/**
 * The service's IDE status, reloaded whenever it announces a change (a
 * server became ready or failed, a provider was enabled). The newest
 * request wins; a late reply never overwrites a newer one.
 */
export function useIdeStatus(client: IdeClient) {
  const [status, setStatus] = useState<IdeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const live = useRef(true);

  const apply = useCallback((next: IdeStatus) => {
    sequence.current++;
    if (live.current) {
      setStatus(next);
      setError(null);
    }
  }, []);

  const reload = useCallback(
    async (refresh = false) => {
      const request = ++sequence.current;
      try {
        const next = await client.status(refresh);
        if (live.current && request === sequence.current) {
          setStatus(next);
          setError(null);
        }
      } catch (cause) {
        if (live.current && request === sequence.current)
          setError(
            `Couldn't read IDE integrations: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
      }
    },
    [client],
  );

  useEffect(() => {
    live.current = true;
    void reload();
    const stop = client.subscribe(() => void reload());
    return () => {
      live.current = false;
      stop();
    };
  }, [client, reload]);

  return { status, error, reload, apply };
}

/**
 * How many IDE servers World started on one connection still run, read
 * once when asked (null while unknown or not asked): removing the
 * connection stops them, and its confirmation says so first.
 */
export function useIdeServersOn(
  connectionId: string | null,
  client: IdeClient = pageIdeClient(),
) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!connectionId) return;
    let live = true;
    client.status().then(
      (status) => {
        if (live)
          setCount(
            status.instances.filter(
              (instance) =>
                instance.connectionId === connectionId &&
                instance.state !== "failed",
            ).length,
          );
      },
      // Unknown: the confirmation goes without the IDE note.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, connectionId]);
  return count;
}
