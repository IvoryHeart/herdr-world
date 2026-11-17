import { repositoryOf } from "../herdr-core/worktrees";
import { readWorktreeHookState } from "./worktree-hook-state";
import { worktreeCheckoutPath } from "../worktree/create";
import { prepareCoreSend } from "./core-send-action";
import type {
  AssistantActionKind,
  AssistantWorkspace,
} from "../../../shared/assistant";
import { isRecord } from "../agent/session-utils";
import type { CoreHostRuntime } from "../herdr-core/host-runtime";
import { validateWorktreeBranchName } from "../worktree/command-template";
import type { AssistantActionResult, PreparedAssistantAction } from "./actions";
import { AssistantUserError, surfaceAssistantUserError } from "./errors";

/** Creates a worktree room from a core room (herdr-core/worktrees.ts). */
export type AssistantCoreWorktreeCreator = (
  host: CoreHostRuntime,
  request: Parameters<
    typeof import("../herdr-core/worktrees").createCoreWorktree
  >[2],
) => Promise<unknown>;

/**
 * Why Ranger refuses an action on a herdr-core host. Ranger's actions are
 * typed verbs: on core, World only creates worktree rooms for it. Typing
 * into a core agent waits for World's occupant-checked delivery through
 * core's own send; ending terminals needs World's kill confirmation, which
 * names every child core ends with them; starting agents and rooms is
 * World's launcher and room controls.
 */
const CORE_REFUSALS: Record<
  Exclude<AssistantActionKind, "create_worktree" | "send_prompt">,
  string
> = {
  start_agent:
    "Ranger cannot start agents on a herdr-core host; use New agent in that room. Nothing was started.",
  create_workspace:
    "Ranger cannot add rooms on a herdr-core host; use Add room in World. Nothing was created.",
  create_tab:
    "Ranger cannot open tabs on a herdr-core host; use New agent or Terminal in that room. Nothing was created.",
  split_pane:
    "Ranger cannot split herdr-core terminals; core has no panes. Nothing was changed.",
  close_workspace:
    "Ranger cannot close herdr-core rooms: closing ends every terminal and child core ends with them, which World confirms by name. Use Close room. Nothing was ended.",
  close_pane:
    "Ranger cannot end herdr-core terminals: World confirms by name every child core ends with them. Use the bin. Nothing was ended.",
  close_agent:
    "Ranger cannot end herdr-core agents: World confirms by name every child core ends with them. Use the bin. Nothing was ended.",
};

class NotDispatched extends Error {}

function text(value: unknown, max = 200): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("Invalid action parameters");
  return value;
}

/**
 * Ranger's actions on a herdr-core workspace (P4): worktrees and native prompts,
 * previewed and confirmed like a Herdr worktree, created under the turn's
 * lease. Other actions are refused with its reason before anything is
 * read or sent.
 */
export async function prepareCoreAssistantAction(args: {
  kind: AssistantActionKind;
  target: AssistantWorkspace;
  lease: { runtime: CoreHostRuntime; generation: number; isCurrent(): boolean };
  params: Record<string, unknown>;
  signal?: AbortSignal;
  createWorktree?: AssistantCoreWorktreeCreator;
}): Promise<PreparedAssistantAction> {
  const { kind, target, lease, signal } = args;
  if (kind === "send_prompt") return prepareCoreSend(args);
  if (kind !== "create_worktree") {
    const reason = CORE_REFUSALS[kind];
    throw new AssistantUserError(reason ?? "Unsupported action on herdr-core.");
  }
  const host = lease.runtime;
  if (
    !isRecord(args.params) ||
    Object.keys(args.params).some(
      (key) =>
        !["connection_id", "workspace_id", "branch", "label"].includes(key),
    )
  )
    throw new Error("Unsupported action parameters");
  const params = Object.freeze(
    Object.fromEntries(
      Object.entries(args.params).map(([key, value]) => [key, text(value)]),
    ),
  );
  if (
    params.connection_id !== target.connection_id ||
    params.workspace_id !== target.workspace_id
  )
    throw new Error("Action is outside the approved workspace scope");
  let preparing = true;
  const check = () => {
    if (preparing) signal?.throwIfAborted();
    if (!lease.isCurrent() || host.generation !== lease.generation)
      throw new Error("Action connection changed");
  };
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    const result = await operation();
    check();
    return result;
  };
  try {
    if (host.remotePlatform === "windows")
      throw new AssistantUserError(
        "Ranger worktree creation needs a Unix host; this herdr-core runs on Windows.",
      );
    if (!args.createWorktree)
      throw new AssistantUserError("Worktree creation is unavailable.");
    const branch = params.branch!;
    try {
      validateWorktreeBranchName(branch);
    } catch (error) {
      throw new AssistantUserError((error as Error).message);
    }
    const sourceRoot = async () =>
      (
        await read(() =>
          host.files.resolveWorkspaceGitRoot({
            workspace_id: target.workspace_id,
          }),
        )
      ).root;
    const root = await sourceRoot();
    const source = await read(() => repositoryOf(host, root));
    const hookState = () =>
      readWorktreeHookState(
        host,
        read,
        target.connection_id,
        { worktree: { checkout_path: root, repo_root: source.main } },
        root,
      );
    const initial = await hookState();
    const setup = initial.command;
    const previewParams = Object.freeze({
      branch,
      cwd: root,
      runtime: "herdr-core",
      path: initial.directory
        ? worktreeCheckoutPath(initial.directory, branch)
        : "(Herdr's default worktree location)",
      worktree_command: initial.worktreeCommand ?? "git worktree add",
      setup_hook_enabled: String(initial.enabled),
      base: "Latest origin default branch (fetched at confirmation)",
      setup_hook: setup ? setup.slice(0, 2000) : "(none configured)",
      room: "A new World room for the checkout",
    });
    check();
    const preview = Object.freeze({
      kind,
      connection_id: target.connection_id,
      workspace_id: target.workspace_id,
      runtime_generation: lease.generation,
      connection_label: target.connection_label,
      workspace_label: target.label,
      params: previewParams,
      summary:
        "Fetch origin's default branch, create the worktree on the herdr-core host (with the repository's worktree command if one is configured and installed, otherwise with git), open it as a new World room and run its setup hook if enabled. No terminal is started or ended.",
    });
    preparing = false;
    let execution: Promise<AssistantActionResult> | undefined;
    return Object.freeze({
      preview,
      execute(authorized?: () => boolean) {
        execution ??= (async () => {
          let dispatched = false;
          try {
            if ((await sourceRoot()) !== root)
              throw new NotDispatched("Worktree source changed");
            const listed = await read(() =>
              host.resources.listWorktrees({
                workspace_id: target.workspace_id,
              }),
            );
            if ((listed.worktrees ?? []).some((item) => item.branch === branch))
              return {
                status: "failed",
                detail:
                  "A worktree for this branch already exists. No duplicate was created; inspect the existing checkout.",
              };
            if (JSON.stringify(await hookState()) !== JSON.stringify(initial))
              throw new NotDispatched(
                "Worktree settings or setup hook changed",
              );
            check();
            if (authorized && !authorized())
              throw new NotDispatched("Action authorization expired");
            dispatched = true;
            const result = await args.createWorktree!(host, {
              workspaceId: target.workspace_id,
              branch,
              isAuthorized: () => !authorized || authorized(),
              expectedSetup: { command: setup, enabled: initial.enabled },
              expectedWorktree: {
                directory: initial.directory,
                command: initial.worktreeCommand,
              },
            });
            const created = isRecord(result) ? result.workspace_id : undefined;
            if (typeof created !== "string")
              throw new Error("Worktree result unavailable");
            await read(() =>
              host.operations.getWorkspace({ workspace_id: created }),
            );
            const hook =
              isRecord(result) && isRecord(result.setup_hook)
                ? result.setup_hook
                : undefined;
            if (hook?.status === "failed")
              return {
                status: "failed",
                detail:
                  "The worktree and its room were created, but its setup hook failed. Inspect it before retrying.",
              };
            return {
              status: "succeeded",
              detail:
                "The worktree was created on the herdr-core host and opened as a World room.",
            };
          } catch {
            return {
              status: dispatched ? "uncertain" : "failed",
              detail: dispatched
                ? "The worktree creation started, but its final state could not be verified. Inspect the repository before retrying."
                : authorized && !authorized()
                  ? "Action authorization expired before dispatch. Nothing was sent."
                  : "The target changed or the operation is unavailable. Nothing was sent; prepare a new preview.",
            } satisfies AssistantActionResult;
          }
        })();
        return execution;
      },
    });
  } catch (error) {
    surfaceAssistantUserError(
      error,
      "Action preview is unavailable, outside the approved scope, or the target changed.",
    );
  }
}
