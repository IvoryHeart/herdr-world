import { useMemo } from "react";
import { type IdeClient, pageIdeClient } from "../world/code/ideClient";
import { IdeServerList, runningIdeServers } from "../world/code/IdeServers";
import { useIdeStatus } from "../world/code/useIdeStatus";

/** The Remove Connection question: removing stops nothing that runs. */
export function removeConnectionMessage(label: string) {
  return `Remove connection "${label}"? This disconnects Herdr World but does not stop the Herdr server, or any IDE server World started on it.`;
}

/**
 * Under the Remove Connection question: the IDE servers World started on
 * that connection, each with its own Stop. Removing stops none of them;
 * on an SSH host World can no longer reach them afterwards, so this is
 * where to stop the ones no longer needed. Mounted only while the dialog
 * is open.
 */
export function RemoveConnectionIdeServers({
  connectionId,
  client,
}: {
  connectionId: string;
  client?: IdeClient;
}) {
  const ide = useMemo(() => client ?? pageIdeClient(), [client]);
  const { status, error, apply } = useIdeStatus(ide);
  if (!status)
    return (
      <p className="muted" role={error ? "alert" : "status"}>
        {error
          ? `${error}. Any IDE server World started on this connection keeps running; Settings → Integrations lists them.`
          : "Checking for IDE servers World started on this connection…"}
      </p>
    );
  const on = (instance: { connectionId: string }) =>
    instance.connectionId === connectionId;
  const servers = runningIdeServers(status).filter(on);
  if (!servers.length) return null;
  const remote = servers.some((instance) => instance.sshDestination);
  return (
    <div className="remove-connection-ide">
      <p className="modal-body-text">
        {servers.length === 1
          ? "This IDE server World started on it keeps running."
          : `These ${servers.length} IDE servers World started on it keep running.`}
        {remote
          ? " After removal World can't reach them to stop them, so stop any you no longer need now."
          : " Stop any you no longer need."}
      </p>
      <IdeServerList
        status={status}
        only={on}
        inline
        onStop={async (instance) => apply(await ide.stop(instance.id))}
        onForget={async (instance) => apply(await ide.forget(instance.id))}
      />
    </div>
  );
}
