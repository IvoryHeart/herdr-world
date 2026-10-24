import { moveWorkspaceIds } from "../world/move-workspace-ids";
import { stampLaunchParent } from "../herdr/spawn-stamp";
import { tabCardKey } from "../../../shared/terminalColor";
import { openHarnessLogin } from "../agent/harness-readiness";
import { launchAgent } from "../agent/launch";
import { profileLaunch } from "../agent/profile-launch";
import type { ConnectionRpcContext } from "./context";
import { probeLauncher } from "./launcher-probe";

/** The launcher on one connection: harness readiness, login, catalog and start (launcher.*). */
export function handleLauncherRpc(
  rpc: ConnectionRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (
    !(
      method === "launcher.readiness" ||
      method === "launcher.login" ||
      method === "launcher.catalog" ||
      method === "launcher.start"
    )
  )
    return false;
  return dispatchLauncherRpc(rpc);
}

async function dispatchLauncherRpc(
  rpc: ConnectionRpcContext,
): Promise<false | void> {
  const {
    id,
    method,
    params,
    requestIsCurrent,
    route,
    sendError,
    sendReply,
    connection,
  } = rpc;
  const {
    board,
    logger,
    profiles,
    publishBoardChanged,
    publishProfilesChanged,
    publishWorldInvalidation,
  } = rpc.services;
  const { herdr, sshHost } = connection;
  // The launcher: kinds and skills on this host, and a new agent in a new
  // tab, from a profile or a quick pick of a kind (agent/launch.ts).
  // Installed and logged in, per supported harness, from each harness's own
  // status command (agent/harness-readiness.ts). Onboarding uses it too.
  if (method === "launcher.readiness") {
    try {
      const { readiness } = await probeLauncher(rpc, false);
      sendReply({ id, result: { readiness } }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "launcher.login") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = await openHarnessLogin(
        (rpc, rpcParams) => herdr.call(rpc, rpcParams, 10_000),
        {
          workspace_id: String(p.workspace_id ?? ""),
          kind: String(p.kind ?? ""),
          windows: sshHost()
            ? connection.remotePlatform === "windows"
            : process.platform === "win32",
          isCurrent: requestIsCurrent,
        },
      );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    } finally {
      if (route.scope === "connection" && route.isCurrent())
        publishWorldInvalidation(route.connectionId, route.generation);
    }
    return;
  }
  if (method === "launcher.catalog") {
    try {
      const result = await probeLauncher(rpc, true);
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "launcher.start") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const profileId = typeof p.profile_id === "string" ? p.profile_id : "";
      const profile = profileId ? profiles().profile(profileId) : null;
      if (profileId && !profile)
        throw new Error("That profile no longer exists.");
      const call = (rpc: string, rpcParams: Record<string, unknown>) =>
        herdr.call(rpc, rpcParams, 70_000);
      const result = await launchAgent(call, {
        workspace_id: String(p.workspace_id ?? ""),
        ...profileLaunch(profile ?? null, {
          kind: String(p.kind ?? ""),
          label: String(p.label ?? "")
            .trim()
            .slice(0, 64),
          text: String(p.text ?? "").slice(0, 16_000),
        }),
        isCurrent: requestIsCurrent,
      });
      if (profile && result.terminal_id && route.scope === "connection") {
        try {
          publishProfilesChanged(
            profiles().assign({
              connection_id: route.connectionId,
              terminal_id: result.terminal_id,
              profile_id: profile.id,
            }).revision,
          );
          if (profile.color && result.tab_id) {
            const workspaceIds = await moveWorkspaceIds(call, {
              workspace_id: String(p.workspace_id ?? ""),
            });
            publishBoardChanged(
              board().patch([
                {
                  op: "card.color",
                  key: tabCardKey(
                    route.connectionId,
                    result.tab_id,
                    workspaceIds,
                  ),
                  color: profile.color,
                },
              ]).revision,
            );
          }
        } catch (error) {
          logger.warn("A launched agent kept no profile record", {
            detail: String(error),
          });
        }
      }
      // A Board note's agent spawned this one: stamp it so World groups them.
      if (result.pane_id && requestIsCurrent())
        await stampLaunchParent(
          (rpc, rpcParams) => herdr.call(rpc, rpcParams, 10_000),
          p,
          result.pane_id,
          logger,
        );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    } finally {
      if (route.scope === "connection" && route.isCurrent())
        publishWorldInvalidation(route.connectionId, route.generation);
    }
    return;
  }
  return false;
}
