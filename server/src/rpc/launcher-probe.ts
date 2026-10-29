import { harnessReadiness } from "../agent/harness-readiness";
import { agentKinds } from "../agent/launch";
import { discoverSkills } from "../agent/skills";
import { CONNECTION_CHANGED_DURING_REQUEST } from "../connections/protocol";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import type { ConnectionRpcContext } from "./context";

/** Capture the admitted host once; discovery must not retarget a replacement. */
export async function probeLauncher(
  rpc: ConnectionRpcContext,
  includeSkills: boolean,
  run = runProcessWithCodeTimeout,
) {
  const current = () => {
    if (!rpc.requestIsCurrent())
      throw new Error(CONNECTION_CHANGED_DURING_REQUEST);
  };
  current();
  const { connection } = rpc;
  const { herdr } = connection;
  const host = connection.sshHost();
  const options = {
    host,
    windows: host
      ? connection.remotePlatform === "windows"
      : process.platform === "win32",
    run,
    shQuote,
  };
  const call = (method: string, params: Record<string, unknown>) =>
    herdr.call(method, params, 10_000);
  const kinds = await agentKinds(call);
  current();
  let cwd = "";
  const workspaceId = String(rpc.params?.workspace_id ?? "");
  if (includeSkills && workspaceId) {
    const listed = (await call("pane.list", {}).catch(() => null)) as {
      panes?: Record<string, unknown>[];
    } | null;
    current();
    const pane = listed?.panes?.find((p) => p.workspace_id === workspaceId);
    cwd = String(pane?.foreground_cwd || pane?.cwd || "");
  }
  current();
  const [readiness, skills] = await Promise.all([
    harnessReadiness({ kinds, ...options }),
    includeSkills
      ? discoverSkills({ cwd, ...options }).catch(() => [])
      : Promise.resolve([]),
  ]);
  current();
  return { kinds, readiness, skills };
}
