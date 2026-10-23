import { tabCardKey } from "../../../shared/terminalColor";
import { harnessReadiness, openHarnessLogin } from "../agent/harness-readiness";
import { agentKinds, launchAgent } from "../agent/launch";
import { profileLaunch } from "../agent/profile-launch";
import { discoverSkills } from "../agent/skills";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import type { ConnectionRpcContext } from "./context";

/** The launcher on one connection: harness readiness, login, catalog and start (launcher.*). */
export async function handleLauncherRpc(
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
    moveWorkspaceIds,
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
      const kinds = await agentKinds((rpc, rpcParams) =>
        herdr.call(rpc, rpcParams, 10_000),
      );
      const readiness = await harnessReadiness({
        kinds,
        host: sshHost(),
        windows: sshHost()
          ? connection.remotePlatform === "windows"
          : process.platform === "win32",
        run: runProcessWithCodeTimeout,
        shQuote,
      });
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
      const p = (params ?? {}) as Record<string, unknown>;
      const call = (rpc: string, rpcParams: Record<string, unknown>) =>
        herdr.call(rpc, rpcParams, 10_000);
      const workspaceId = String(p.workspace_id ?? "");
      let cwd = "";
      if (workspaceId) {
        const listed = (await call("pane.list", {}).catch(() => null)) as {
          panes?: Record<string, unknown>[];
        } | null;
        const pane = listed?.panes?.find((x) => x.workspace_id === workspaceId);
        cwd = String(pane?.foreground_cwd || pane?.cwd || "");
      }
      const host = {
        host: sshHost(),
        windows: sshHost()
          ? connection.remotePlatform === "windows"
          : process.platform === "win32",
        run: runProcessWithCodeTimeout,
        shQuote,
      };
      const kinds = await agentKinds(call);
      const [skills, readiness] = await Promise.all([
        discoverSkills({ cwd, ...host }).catch(() => []),
        harnessReadiness({ kinds, ...host }).catch(() => []),
      ]);
      sendReply({ id, result: { kinds, skills, readiness } }, method);
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
