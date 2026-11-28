import { useCreationProgress } from "../creationRequests";
import { paneAgentListing } from "../agentName";
import { useCloseGlobalMenuForDialog } from "./useCloseGlobalMenuForDialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsUpDown,
  FileDiff,
  FileText,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Keyboard,
  LayoutGrid,
  Maximize2,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PanelTop,
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { COMMAND_BOX_OPEN_EVENT, commandBoxKey } from "../commandBoxKey";
import { renameRoom } from "../world/roomRenameClose";
import { useViewSearchShortcut } from "../world/viewSearchShortcut";
import { type FinderSearch, useFinderBoxClosed } from "../world/worldFinder";
import { findPages } from "./commandFindPages";
import { luckyWorktreeBranchName } from "../luckyName";
import { normalizeSearchText } from "../searchText";
import { SHORTCUT_NUMBERS } from "../shortcutBindings";
import {
  shortcutLabel,
  shortcutMatches,
  shortcutTitle,
  useShortcutPreferences,
} from "../shortcutPreferences";
import {
  endpointCreationReason,
  OperationalContext,
  type OperationalContext as OwnerContext,
  shallowEqual,
  useOperationalStore,
  useStoreSelector,
} from "../store";
import {
  clearTerminalComposerDrafts,
  terminalComposerCloseWarning,
  terminalComposerDraftPaneIds,
} from "../terminalComposer";
import type { FileExplorerEntry, Pane, Tab, Workspace } from "../types";
import { shortId } from "../utils";
import { canCreateWorktree, worktreeCreationSource } from "../worktree";
import { ActionItem, runSecondaryKey } from "./CommandActionItem";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { ConfirmDialog, TextInputDialog } from "./ModalDialogs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  offeredArrangementChoices,
  type WindowArrangementControl,
} from "./WindowArrangementMenu";
import { WorktreeHooksDialog } from "./WorktreeHooksDialog";
import { LazyWorktreeLifecycleDialog } from "./LazyWorktreeLifecycleDialog";
import { WorktreeLocationDialog } from "./WorktreeLocationDialog";
import { WorktreeOpenDialog } from "./WorktreeOpenDialog";
import { worktreeCommandActions } from "./worktreeCommandActions";
import {
  rankCommand,
  useCommandBoxRegistry,
} from "../settings/commandBoxRegistry";
import { useSettingsCommandGroups } from "../settings/commandBoxSettings";

type TextAction =
  | { type: "rename-workspace"; workspace: Workspace }
  | { type: "rename-tab"; tab: Tab }
  | { type: "create-worktree"; workspace: Workspace };

export type ActionDefinition = {
  key: string;
  icon: React.ReactNode;
  title: string;
  detail?: string;
  shortcut?: string;
  keywords?: string[];
  danger?: boolean;
  disabledReason?: string | null;
  /** How well it matches the search, where something else matched it. */
  score?: number;
  /** Shown at the row's end, such as a found agent's runtime and status. */
  trailing?: React.ReactNode;
  /**
   * A second way to choose it: Shift+Enter, or the row's button (World's
   * finds: open its terminal instead of going to it in the current view).
   */
  secondary?: { label: string; run: () => void };
  /**
   * Runs with the box left open: always (paging through finds), or when the
   * function says so as it is chosen (a find the view only showed, so
   * choosing it again opens it).
   */
  stay?: boolean | (() => boolean);
  run: () => void;
};

export type ActionGroupDefinition = {
  heading: string;
  actions: ActionDefinition[];
  /** A page of a longer list of finds, alike rows distinct (commandFindPages). */
  page?: { from: number; size: number; total: number };
};

export type CommandExtension = {
  context?: OwnerContext;
  captureKey: string | null;
  groups: readonly ActionGroupDefinition[];
  /**
   * What a search finds besides actions: World's agents, rooms and
   * terminals on every runtime. The shell gives it to the box in every view,
   * Spaces included (#1329).
   */
  find?: (search: string, from: number) => ActionGroupDefinition | null;
  /**
   * A visual view's own select for a World node, as clicking it there does:
   * what choosing a find does there. The box itself never calls it.
   */
  showNode?: (nodeId: string) => void;
  /**
   * The search the box shares with the current view (world/worldFinder.ts):
   * the text it resumes with, each change as it is typed, and its closing.
   */
  finderSearch?: FinderSearch;
  placeholder?: string;
};

const EMPTY_COMMAND_EXTENSION: CommandExtension = {
  captureKey: null,
  groups: [],
};

function tabName(tab?: Tab) {
  if (!tab) return "";
  return tab.label && tab.label !== String(tab.number)
    ? tab.label
    : `Tab ${tab.number}`;
}

function workspaceName(workspace?: Workspace) {
  return workspace?.label || workspace?.workspace_id || "";
}

export { normalizeSearchText };

export function commandFilter(
  value: string,
  search: string,
  keywords?: string[],
) {
  const query = normalizeSearchText(search);
  if (!query) return 1;

  const haystack = normalizeSearchText(value);
  const keywordText = normalizeSearchText((keywords ?? []).join(" "));
  const combined = [haystack, keywordText].filter(Boolean).join(" ");

  if (haystack === query) return 1;
  if (haystack.includes(query)) return 0.95;
  if (keywordText.includes(query)) return 0.9;

  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length === 0) return 1;
  if (tokens.every((token) => combined.includes(token))) return 0.75;
  if (tokens.some((token) => combined.includes(token))) return 0.35;

  return 0;
}

function actionSearchValue(action: ActionDefinition) {
  return [action.title, action.detail, action.shortcut]
    .filter(Boolean)
    .join(" ");
}

function actionDisplaySignature(action: ActionDefinition) {
  return normalizeSearchText(
    [
      action.title,
      action.detail,
      action.shortcut,
      action.danger ? "danger" : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function actionCommandValue(action: ActionDefinition) {
  return [action.title, action.detail, action.shortcut, action.key]
    .filter(Boolean)
    .join(" ");
}

function rankAction(action: ActionDefinition, search: string) {
  if (action.score !== undefined) return action.score;
  const filtered = commandFilter(
    actionSearchValue(action),
    search,
    action.keywords,
  );
  return rankCommand(action, search, filtered);
}

function pathLeaf(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function commandPathQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return "";
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) return "";
  if (
    normalized.includes("/") ||
    normalized.startsWith(".") ||
    /\.[^/]+$/.test(normalized)
  ) {
    return normalized;
  }
  return "";
}

type CommandNumberShortcutModifiers = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

type CommandNumberShortcutEvent = CommandNumberShortcutModifiers &
  Pick<KeyboardEvent, "preventDefault" | "repeat" | "stopPropagation">;

export function commandNumberShortcutIndex(
  event: CommandNumberShortcutModifiers,
) {
  const number = SHORTCUT_NUMBERS.find((n) =>
    shortcutMatches(event, `command.${n}`),
  );
  return number === undefined ? null : number - 1;
}

export function commandNumberedActions<T>(
  groups: readonly { actions: readonly T[] }[],
) {
  return groups.flatMap((group) => group.actions).slice(0, 9);
}

export function commandNumberShortcutTarget<T>(
  event: CommandNumberShortcutModifiers,
  actions: readonly T[],
) {
  const index = commandNumberShortcutIndex(event);
  return index === null ? null : (actions[index] ?? null);
}

export function runCommandNumberShortcut<T>(
  event: CommandNumberShortcutEvent,
  actions: readonly T[],
  runAction: (action: T) => void,
) {
  if (event.repeat) return false;
  const action = commandNumberShortcutTarget(event, actions);
  if (action === null) return false;
  event.preventDefault();
  event.stopPropagation();
  runAction(action);
  return true;
}

export function CommandCombobox(
  props: Parameters<typeof OwnedCommandCombobox>[0],
) {
  return (
    <OperationalContext.Provider value={props.extension?.context ?? null}>
      <OwnedCommandCombobox {...props} />
    </OperationalContext.Provider>
  );
}

function OwnedCommandCombobox({
  operationalShortcutsEnabled = true,
  onOpenFileExplorer,
  onOpenFile,
  onOpenDiffViewer,
  onSelectTab,
  arrangementControl,
  extension = EMPTY_COMMAND_EXTENSION,
  find,
  finderSearch,
  onShowShortcuts,
}: {
  operationalShortcutsEnabled?: boolean;
  onOpenFileExplorer?: (workspaceId?: string) => void;
  onOpenFile?: (workspaceId: string, entry: FileExplorerEntry) => void;
  onOpenDiffViewer?: (workspaceId?: string) => void;
  onSelectTab?: (tabId: string) => void | Promise<unknown>;
  arrangementControl?: WindowArrangementControl;
  extension?: CommandExtension;
  /** World's finds (CommandExtension.find), in every view. */
  find?: CommandExtension["find"];
  /** The search shared with the current view (CommandExtension.finderSearch). */
  finderSearch?: FinderSearch;
  onShowShortcuts?: () => void;
}) {
  useCreationProgress();
  const store = useOperationalStore();
  useShortcutPreferences();
  const s = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      connectionGeneration: state.connectionGeneration,
      layout: state.layout,
      panes: state.panes,
      selectedPaneId: state.selectedPaneId,
      tabs: state.tabs,
      workspaces: state.workspaces,
      endpointAvailability: state.endpointAvailability,
    }),
    shallowEqual,
  );
  const [open, setOpen] = useState(false);
  const [capturedExtension, setCapturedExtension] =
    useState<CommandExtension | null>(null);
  useCloseGlobalMenuForDialog(open, setOpen);
  const [search, setSearch] = useState("");
  const [findFrom, setFindFrom] = useState(0);
  const [selectedActionValue, setSelectedActionValue] = useState("");
  const [selectedActionSearch, setSelectedActionSearch] = useState("");
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [openWorktreeWorkspaceId, setOpenWorktreeWorkspaceId] = useState<
    string | null
  >(null);
  const [worktreeHooksWorkspaceId, setWorktreeHooksWorkspaceId] = useState<
    string | null
  >(null);
  const [locationWorkspaceId, setLocationWorkspaceId] = useState<string | null>(
    null,
  );
  const [lifecycleWorkspaceId, setLifecycleWorkspaceId] = useState<
    string | null
  >(null);
  const [textAction, setTextAction] = useState<TextAction | null>(null);
  const [pendingCloseWorkspace, setPendingCloseWorkspace] =
    useState<Workspace | null>(null);
  const [pendingCloseTab, setPendingCloseTab] = useState<Tab | null>(null);
  const [pendingClosePane, setPendingClosePane] = useState<Pane | null>(null);
  const [pendingRemoveWorktree, setPendingRemoveWorktree] =
    useState<Workspace | null>(null);

  useEffect(() => {
    if (operationalShortcutsEnabled) return;
    setOpen(false);
    setSearch("");
    setSelectedActionValue("");
    setSelectedActionSearch("");
    setCreateWorkspaceOpen(false);
    setOpenWorktreeWorkspaceId(null);
    setWorktreeHooksWorkspaceId(null);
    setLifecycleWorkspaceId(null);
    setTextAction(null);
    setPendingCloseWorkspace(null);
    setPendingCloseTab(null);
    setPendingClosePane(null);
    setPendingRemoveWorktree(null);
  }, [operationalShortcutsEnabled]);

  useEffect(() => {
    setOpen(false);
    setCreateWorkspaceOpen(false);
    setOpenWorktreeWorkspaceId(null);
    setWorktreeHooksWorkspaceId(null);
    setLifecycleWorkspaceId(null);
    setTextAction(null);
    setPendingCloseWorkspace(null);
    setPendingCloseTab(null);
    setPendingClosePane(null);
    setPendingRemoveWorktree(null);
  }, [extension.captureKey, s.activeConnectionId, s.connectionGeneration]);

  const composerDraftWarningFor = (paneIds: string[]) =>
    terminalComposerCloseWarning(
      terminalComposerDraftPaneIds(
        s.activeConnectionId,
        s.connectionGeneration,
        paneIds,
      ).length,
    );
  const clearComposerDraftsFor = (paneIds: string[]) =>
    clearTerminalComposerDrafts(
      s.activeConnectionId,
      s.connectionGeneration,
      paneIds,
    );

  const focusedWorkspace = s.workspaces.find((w) => w.focused);
  const activeTab =
    s.tabs.find((t) => t.tab_id === focusedWorkspace?.active_tab_id) ??
    s.tabs.find((t) => t.focused);
  const activePane =
    s.panes.find((p) => p.pane_id === s.selectedPaneId) ??
    s.panes.find((p) => p.pane_id === s.layout?.focused_pane_id) ??
    s.panes.find((p) => p.tab_id === activeTab?.tab_id && p.focused) ??
    s.panes.find((p) => p.tab_id === activeTab?.tab_id);
  const focusedWorkspaceTabs = useMemo(
    () =>
      s.tabs.filter(
        (tab) => tab.workspace_id === focusedWorkspace?.workspace_id,
      ),
    [focusedWorkspace?.workspace_id, s.tabs],
  );
  const activeAgent =
    activePane && activePane.agent && activePane.agent_status !== "unknown"
      ? activePane
      : null;
  const mainWorktreeWorkspaces = useMemo(
    () =>
      s.workspaces
        .filter(canCreateWorktree)
        .sort((a, b) => a.number - b.number),
    [s.workspaces],
  );
  const focusedWorktreeSource = useMemo(
    () =>
      focusedWorkspace
        ? worktreeCreationSource(s.workspaces, focusedWorkspace)
        : undefined,
    [focusedWorkspace, s.workspaces],
  );
  useEffect(() => {
    if (!operationalShortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      // The pane switcher owns K even when its held modifiers match this
      // shortcut. Both handlers run on window, so listener order cannot decide.
      if (
        e.defaultPrevented ||
        document.querySelector(".modal-backdrop, .pane-jump-backdrop")
      )
        return;
      if (!commandBoxKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (open) {
        setOpen(false);
        setSearch("");
      } else openBox();
    };
    const onOpen = (event: Event) => {
      const resume =
        event instanceof CustomEvent && event.detail?.resume === true;
      if (!open) openBox(resume);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(COMMAND_BOX_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(COMMAND_BOX_OPEN_EVENT, onOpen);
    };
  }, [extension, open, operationalShortcutsEnabled]);
  // `/` and Ctrl+F (`view.search`) open the same box, outside text and
  // terminals (viewSearchShortcut.ts); inside it they type.
  useViewSearchShortcut(() => {
    if (!open) openBox();
  }, operationalShortcutsEnabled);

  /**
   * Open the box, empty, or with the search the current view still shows when
   * `resume` (its search chip). A search chosen before stays in the view until
   * something new is typed.
   */
  function openBox(resume = false) {
    setCapturedExtension(extension);
    setSearch(resume ? (finderSearch?.seed() ?? "") : "");
    setFindFrom(0);
    setOpen(true);
  }
  useFinderBoxClosed(open, finderSearch);

  const run = (fn: () => void) => {
    setOpen(false);
    setSearch("");
    if (!operationalShortcutsEnabled) return;
    fn();
  };
  // Choosing a row closes the box unless the row stays. A click left the
  // input; it gets focus back, so Enter chooses again from the same list.
  const choose = (action: ActionDefinition) => {
    if (action.disabledReason) return;
    const { stay } = action;
    if (!(typeof stay === "function" ? stay() : stay)) return run(action.run);
    action.run();
    document.querySelector<HTMLElement>(".command-popover input")?.focus();
  };

  const submitTextAction = (value: string) => {
    if (!operationalShortcutsEnabled) return;
    const action = textAction;
    const trimmed = value.trim();
    if (!action) return;
    if (!trimmed) {
      setTextAction(null);
      return;
    }
    if (action.type === "rename-workspace") {
      void renameRoom(
        store.room(action.workspace.workspace_id),
        action.workspace.label,
        trimmed,
      );
    } else if (action.type === "rename-tab") {
      store.renameTab(action.tab.tab_id, trimmed);
    } else if (action.type === "create-worktree") {
      store.createWorktree(action.workspace.workspace_id, trimmed);
    }
    setTextAction(null);
  };

  const textDialogProps =
    textAction?.type === "rename-workspace"
      ? {
          title: "Rename Workspace",
          label: "Name",
          initialValue: workspaceName(textAction.workspace),
          submitLabel: "Rename",
        }
      : textAction?.type === "rename-tab"
        ? {
            title: "Rename Tab",
            label: "Name",
            initialValue: tabName(textAction.tab),
            submitLabel: "Rename",
          }
        : textAction?.type === "create-worktree"
          ? {
              title: "New Worktree",
              label: "Branch",
              initialValue: luckyWorktreeBranchName,
              placeholder: "my-branch",
              submitLabel: "Create",
            }
          : null;

  const allWorkspaces = [...s.workspaces].sort((a, b) => a.number - b.number);
  const otherWorkspaces = focusedWorkspace
    ? allWorkspaces.filter(
        (workspace) => workspace.workspace_id !== focusedWorkspace.workspace_id,
      )
    : allWorkspaces;

  const currentActions: ActionDefinition[] = [];
  if (focusedWorkspace && focusedWorktreeSource) {
    currentActions.push({
      key: "current-new-worktree",
      icon: <GitBranch size={15} />,
      title: "New worktree",
      detail:
        focusedWorktreeSource.worktree?.checkout_path ??
        workspaceName(focusedWorktreeSource),
      keywords: [
        "create worktree",
        "add worktree",
        "branch",
        "new branch",
        workspaceName(focusedWorkspace),
        workspaceName(focusedWorktreeSource),
      ],
      run: () =>
        setTextAction({
          type: "create-worktree",
          workspace: focusedWorktreeSource,
        }),
    });
  }
  if (focusedWorkspace) {
    currentActions.push({
      key: "current-file-explorer",
      icon: <FolderOpen size={15} />,
      title: "Open file explorer",
      detail:
        focusedWorkspace.worktree?.checkout_path ??
        focusedWorkspace.cwd ??
        workspaceName(focusedWorkspace),
      keywords: [
        "files",
        "file browser",
        "file tree",
        "explorer",
        "browse repository",
      ],
      run: () => onOpenFileExplorer?.(focusedWorkspace.workspace_id),
    });
    currentActions.push({
      key: "current-diff-viewer",
      icon: <FileDiff size={15} />,
      title: "Open Diff Viewer",
      detail:
        focusedWorkspace.worktree?.checkout_path ??
        focusedWorkspace.cwd ??
        workspaceName(focusedWorkspace),
      keywords: [
        "diff",
        "diff viewer",
        "changes",
        "git diff",
        "changed files",
        "source control",
      ],
      run: () => onOpenDiffViewer?.(focusedWorkspace.workspace_id),
    });
  }
  if (focusedWorkspace) {
    currentActions.push(
      ...worktreeCommandActions(focusedWorkspace, workspaceName, {
        worktree: setOpenWorktreeWorkspaceId,
        location: setLocationWorkspaceId,
        lifecycle: setLifecycleWorkspaceId,
        hooks: setWorktreeHooksWorkspaceId,
        remove: setPendingRemoveWorktree,
      }),
    );
  }
  if (activeTab && focusedWorkspace) {
    currentActions.push({
      key: "current-create-tab",
      icon: <PanelTop size={15} />,
      title: "Create tab",
      detail: workspaceName(focusedWorkspace),
      keywords: ["new tab", "add tab", "open tab"],
      disabledReason: endpointCreationReason(
        store.get(),
        "tab.create",
        focusedWorkspace.workspace_id,
      ),
      run: () => store.createTab(focusedWorkspace.workspace_id),
    });
  }
  if (activePane) {
    currentActions.push({
      key: "current-toggle-pane-zoom",
      icon: <Maximize2 size={15} />,
      title: "Toggle pane zoom",
      detail: shortId(activePane.pane_id),
      keywords: ["maximize pane", "unmaximize pane", "zoom pane", "full pane"],
      run: () => store.zoomPane(activePane.pane_id),
    });
  }

  const directPathQuery = commandPathQuery(search);
  const fileActions: ActionDefinition[] =
    focusedWorkspace && onOpenFile && directPathQuery
      ? [
          {
            key: `quick-open-path-${focusedWorkspace.workspace_id}-${directPathQuery}`,
            icon: <FileText size={15} />,
            title: `Open path: ${pathLeaf(directPathQuery)}`,
            detail: directPathQuery,
            keywords: [
              "quick open",
              "open file",
              "open path",
              "file explorer",
              "preview file",
              directPathQuery,
              pathLeaf(directPathQuery),
            ],
            run: () =>
              onOpenFile(focusedWorkspace.workspace_id, {
                name: pathLeaf(directPathQuery),
                path: directPathQuery,
                type: "file",
                size: 0,
                mtime_ms: 0,
                hidden: pathLeaf(directPathQuery).startsWith("."),
              }),
          },
        ]
      : [];

  const workspaceActions: ActionDefinition[] = [
    {
      key: "create-workspace",
      icon: <FolderPlus size={15} />,
      title: "Create workspace",
      detail: "Open a new Herdr workspace",
      keywords: ["new workspace", "add workspace", "open workspace"],
      run: () => setCreateWorkspaceOpen(true),
    },
    ...(focusedWorkspace
      ? [
          {
            key: "rename-workspace",
            icon: <PanelTop size={15} />,
            title: "Rename workspace",
            detail: workspaceName(focusedWorkspace),
            keywords: ["edit workspace", "workspace name"],
            run: () =>
              setTextAction({
                type: "rename-workspace",
                workspace: focusedWorkspace,
              }),
          },
          {
            key: "close-workspace",
            icon: <X size={15} />,
            title: "Close workspace",
            detail: workspaceName(focusedWorkspace),
            keywords: [
              "delete workspace",
              "remove workspace",
              "close current workspace",
            ],
            danger: true,
            run: () => setPendingCloseWorkspace(focusedWorkspace),
          },
        ]
      : []),
    ...otherWorkspaces.map((workspace) => ({
      key: `focus-workspace-${workspace.workspace_id}`,
      icon: <PanelTop size={15} />,
      title: `Focus workspace: ${workspaceName(workspace)}`,
      detail: workspace.workspace_id,
      keywords: [
        "switch workspace",
        "open workspace",
        workspaceName(workspace),
      ],
      run: () => store.focusWorkspace(workspace.workspace_id),
    })),
  ];

  const worktreeActions: ActionDefinition[] = [];
  for (const workspace of mainWorktreeWorkspaces.filter(
    (workspace) =>
      workspace.workspace_id !== focusedWorktreeSource?.workspace_id,
  )) {
    worktreeActions.push({
      key: `new-worktree-${workspace.workspace_id}`,
      icon: <GitBranch size={15} />,
      title:
        workspace.workspace_id === focusedWorkspace?.workspace_id
          ? "New worktree"
          : `New worktree: ${workspaceName(workspace)}`,
      detail: workspace.worktree?.checkout_path,
      keywords: [
        "create worktree",
        "add worktree",
        "new branch",
        "branch",
        workspaceName(workspace),
        workspace.worktree?.repo_name ?? "",
      ],
      run: () =>
        setTextAction({
          type: "create-worktree",
          workspace,
        }),
    });
  }
  for (const workspace of allWorkspaces.filter(
    (workspace) =>
      workspace.worktree &&
      workspace.workspace_id !== focusedWorkspace?.workspace_id,
  )) {
    worktreeActions.push({
      key: `open-worktree-${workspace.workspace_id}`,
      icon: <FolderOpen size={15} />,
      title:
        workspace.workspace_id === focusedWorkspace?.workspace_id
          ? "Open worktree"
          : `Open worktree: ${workspaceName(workspace)}`,
      detail: workspace.worktree?.checkout_path,
      keywords: [
        "existing worktree",
        "open existing",
        "checkout",
        "branch",
        workspaceName(workspace),
        workspace.worktree?.repo_name ?? "",
      ],
      run: () => setOpenWorktreeWorkspaceId(workspace.workspace_id),
    });
    worktreeActions.push({
      key: `worktree-hooks-${workspace.workspace_id}`,
      icon: <GitBranch size={15} />,
      title:
        workspace.workspace_id === focusedWorkspace?.workspace_id
          ? "Worktree hooks"
          : `Worktree hooks: ${workspaceName(workspace)}`,
      detail: workspace.worktree?.repo_name,
      keywords: [
        "hook config",
        "hooks config",
        "paseo",
        "setup teardown",
        workspaceName(workspace),
      ],
      run: () => setWorktreeHooksWorkspaceId(workspace.workspace_id),
    });
  }
  const tabActions: ActionDefinition[] = [];
  if (focusedWorkspace) {
    tabActions.push({
      key: "create-tab",
      icon: <PanelTop size={15} />,
      title: "Create tab",
      detail: workspaceName(focusedWorkspace),
      keywords: ["new tab", "add tab", "open tab"],
      disabledReason: endpointCreationReason(
        store.get(),
        "tab.create",
        focusedWorkspace.workspace_id,
      ),
      run: () => store.createTab(focusedWorkspace.workspace_id),
    });
    for (const workspace of otherWorkspaces) {
      tabActions.push({
        key: `create-tab-${workspace.workspace_id}`,
        icon: <PanelTop size={15} />,
        title: `Create tab: ${workspaceName(workspace)}`,
        detail: workspace.workspace_id,
        keywords: ["new tab", "add tab", "open tab", workspaceName(workspace)],
        disabledReason: endpointCreationReason(
          store.get(),
          "tab.create",
          workspace.workspace_id,
        ),
        run: () => store.createTab(workspace.workspace_id),
      });
    }
  }
  if (activeTab) {
    tabActions.push(
      {
        key: "rename-tab",
        icon: <PanelTop size={15} />,
        title: "Rename tab",
        detail: tabName(activeTab),
        keywords: ["edit tab", "tab name"],
        run: () => setTextAction({ type: "rename-tab", tab: activeTab }),
      },
      {
        key: "close-active-tab",
        icon: <X size={15} />,
        title: "Close active tab",
        detail: tabName(activeTab),
        keywords: ["delete tab", "remove tab"],
        danger: true,
        run: () => {
          if (store.guardTabClose(activeTab.tab_id))
            setPendingCloseTab(activeTab);
        },
      },
    );
  }
  for (const tab of focusedWorkspaceTabs) {
    tabActions.push({
      key: `focus-tab-${tab.tab_id}`,
      icon: <PanelTop size={15} />,
      title: `Focus tab: ${tabName(tab)}`,
      detail: tab.tab_id,
      keywords: ["switch tab", "open tab", "go tab", tabName(tab)],
      run: () =>
        onSelectTab && !extension.context
          ? onSelectTab(tab.tab_id)
          : store.focusTab(tab.tab_id),
    });
  }
  for (const tab of focusedWorkspaceTabs.filter(
    (tab) => tab.tab_id !== activeTab?.tab_id,
  )) {
    tabActions.push({
      key: `close-tab-${tab.tab_id}`,
      icon: <X size={15} />,
      title: `Close tab: ${tabName(tab)}`,
      detail: tab.tab_id,
      keywords: ["delete tab", "remove tab", tabName(tab)],
      danger: true,
      run: () => {
        if (store.guardTabClose(tab.tab_id)) setPendingCloseTab(tab);
      },
    });
  }

  const paneActions: ActionDefinition[] = activePane
    ? [
        {
          key: "focus-pane-left",
          icon: <ArrowLeft size={15} />,
          title: "Focus pane left",
          detail: shortId(activePane.pane_id),
          keywords: ["switch pane left", "select pane left"],
          run: () => store.focusPaneDirection(activePane.pane_id, "left"),
        },
        {
          key: "focus-pane-right",
          icon: <ArrowRight size={15} />,
          title: "Focus pane right",
          detail: shortId(activePane.pane_id),
          keywords: ["switch pane right", "select pane right"],
          run: () => store.focusPaneDirection(activePane.pane_id, "right"),
        },
        {
          key: "focus-pane-up",
          icon: <ArrowUp size={15} />,
          title: "Focus pane up",
          detail: shortId(activePane.pane_id),
          keywords: ["switch pane up", "select pane up"],
          run: () => store.focusPaneDirection(activePane.pane_id, "up"),
        },
        {
          key: "focus-pane-down",
          icon: <ArrowDown size={15} />,
          title: "Focus pane down",
          detail: shortId(activePane.pane_id),
          keywords: ["switch pane down", "select pane down"],
          run: () => store.focusPaneDirection(activePane.pane_id, "down"),
        },
        {
          key: "split-pane-right",
          icon: <SplitSquareHorizontal size={15} />,
          title: "Split pane right",
          detail: shortId(activePane.pane_id),
          keywords: ["new pane right", "create pane right", "vertical split"],
          run: () => store.splitPane(activePane.pane_id, "right"),
        },
        {
          key: "split-pane-down",
          icon: <SplitSquareVertical size={15} />,
          title: "Split pane down",
          detail: shortId(activePane.pane_id),
          keywords: ["new pane down", "create pane down", "horizontal split"],
          run: () => store.splitPane(activePane.pane_id, "down"),
        },
        {
          key: "move-pane-left",
          icon: <MoveLeft size={15} />,
          title: "Move pane left",
          detail: shortId(activePane.pane_id),
          keywords: ["swap pane left", "rearrange pane"],
          run: () => store.movePane(activePane.pane_id, "left"),
        },
        {
          key: "move-pane-right",
          icon: <MoveRight size={15} />,
          title: "Move pane right",
          detail: shortId(activePane.pane_id),
          keywords: ["swap pane right", "rearrange pane"],
          run: () => store.movePane(activePane.pane_id, "right"),
        },
        {
          key: "move-pane-up",
          icon: <MoveUp size={15} />,
          title: "Move pane up",
          detail: shortId(activePane.pane_id),
          keywords: ["swap pane up", "rearrange pane"],
          run: () => store.movePane(activePane.pane_id, "up"),
        },
        {
          key: "move-pane-down",
          icon: <MoveDown size={15} />,
          title: "Move pane down",
          detail: shortId(activePane.pane_id),
          keywords: ["swap pane down", "rearrange pane"],
          run: () => store.movePane(activePane.pane_id, "down"),
        },
        {
          key: "toggle-pane-zoom",
          icon: <Maximize2 size={15} />,
          title: "Toggle pane zoom",
          detail: shortId(activePane.pane_id),
          keywords: [
            "maximize pane",
            "unmaximize pane",
            "zoom pane",
            "full pane",
          ],
          run: () => store.zoomPane(activePane.pane_id),
        },
        {
          key: "close-pane",
          icon: <X size={15} />,
          title: "Close pane",
          detail: shortId(activePane.pane_id),
          keywords: ["delete pane", "remove pane"],
          danger: true,
          run: () => {
            if (store.guardPaneClose(activePane.pane_id)) {
              setPendingClosePane(activePane);
            }
          },
        },
      ]
    : [];

  const agentActions: ActionDefinition[] = [];
  if (activeAgent) {
    agentActions.push({
      key: "close-active-agent-pane",
      icon: <X size={15} />,
      title: "Close active agent pane",
      detail: paneAgentListing(activeAgent),
      keywords: ["close agent", "delete agent", "remove agent", "close pane"],
      danger: true,
      run: () => {
        if (store.guardPaneClose(activeAgent.pane_id)) {
          setPendingClosePane(activeAgent);
        }
      },
    });
  }
  // Finding an agent is World's (#1329): its finds list every runtime's
  // agents, so this connection's own list is not repeated here.

  const settingsGroups = useSettingsCommandGroups(search);
  const helpActions: ActionDefinition[] = onShowShortcuts
    ? [
        {
          key: "show-shortcut-cheatsheet",
          icon: <Keyboard size={15} />,
          title: "Show shortcut cheat sheet",
          detail: "Read-only overview of keyboard shortcuts",
          shortcut: shortcutLabel("shortcuts.show"),
          keywords: ["keyboard", "shortcuts", "keybindings", "hotkeys", "help"],
          run: onShowShortcuts,
        },
      ]
    : [];

  const arrangementActions: ActionDefinition[] = arrangementControl
    ? offeredArrangementChoices(arrangementControl).map(
        ({ command, label, description, shortcutId }) => {
          const shortcut = shortcutId
            ? shortcutLabel(shortcutId)
            : "Unassigned";
          return {
            key: `arrangement-${command}`,
            icon: <LayoutGrid size={15} />,
            title:
              command === "fit-right" || command === "fit-left"
                ? label
                : command === "close-all"
                  ? "Close all terminal windows"
                  : command === "open-all"
                    ? "Open all terminal windows"
                    : command === "restore"
                      ? "Restore window positions"
                      : `Arrange windows: ${label}`,
            detail: description,
            shortcut: shortcut === "Unassigned" ? undefined : shortcut,
            keywords: ["layout", "tile", "windows", label],
            disabledReason: arrangementControl.disabledReasons[command],
            run: () => arrangementControl.onSelect(command),
          };
        },
      )
    : [];
  const findGroups = findPages(find, search, findFrom, setFindFrom);
  const actionGroups: ActionGroupDefinition[] = [
    ...(!extension.groups.length || extension.context
      ? [
          {
            heading: "Current",
            actions: extension.groups.length
              ? currentActions.filter(
                  (action) =>
                    ![
                      "current-file-explorer",
                      "current-diff-viewer",
                      "current-agent-history",
                    ].includes(action.key),
                )
              : currentActions,
          },
          {
            heading: "Files",
            actions: extension.groups.length ? [] : fileActions,
          },
          { heading: "Workspaces", actions: workspaceActions },
          { heading: "Worktrees", actions: worktreeActions },
          { heading: "Tabs", actions: tabActions },
          // Closing the active agent is a pane action; finding agents is
          // World's "In World" group.
          { heading: "Panes", actions: [...paneActions, ...agentActions] },
        ]
      : [
          {
            heading: "Workspaces",
            actions: workspaceActions.filter(
              (action) => action.key === "create-workspace",
            ),
          },
        ]),
    { heading: "Arrange windows", actions: arrangementActions },
    ...findGroups,
    ...(open && capturedExtension ? capturedExtension : extension).groups.map(
      (group) => ({
        ...group,
        actions: group.actions.map((action) =>
          open &&
          capturedExtension &&
          capturedExtension.captureKey !== extension.captureKey &&
          (group.heading === "Visual selection" || action.key === "visual-pin")
            ? {
                ...action,
                disabledReason: "Selection changed. Reopen Actions.",
              }
            : action,
        ),
      }),
    ),
    // Settings (#1035): settings and commands from the one
    // registry and its search.
    ...settingsGroups,
    { heading: "Help", actions: helpActions },
  ].filter((group) => group.actions.length > 0);

  // Settings (#1035): the box's commands join the one registry.
  useCommandBoxRegistry(
    actionGroups,
    [...findGroups, ...settingsGroups],
    operationalShortcutsEnabled,
    run,
  );

  const normalizedSearch = normalizeSearchText(search);
  const rankedActions = normalizedSearch
    ? (() => {
        const seen = new Set<string>();
        // Paging rows stay with the results they page; alike finds stay apart.
        return actionGroups
          .flatMap((group) =>
            group.actions.map((action) => ({
              action,
              group: group.heading,
              score: rankAction(action, search),
              distinct: Boolean(group.page),
            })),
          )
          .filter((entry) => entry.score > 0 && entry.action.stay !== true)
          .sort(
            (a, b) =>
              b.score - a.score ||
              a.group.localeCompare(b.group) ||
              a.action.title.localeCompare(b.action.title),
          )
          .filter((entry) => {
            if (entry.distinct) return true;
            const signature = actionDisplaySignature(entry.action);
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
          })
          .slice(0, 3);
      })()
    : [];
  const topActionKeys = new Set(rankedActions.map((entry) => entry.action.key));
  const displayedSignatures = new Set(
    rankedActions.map((entry) => actionDisplaySignature(entry.action)),
  );
  const displayedActionGroups: ActionGroupDefinition[] = [
    ...(rankedActions.length > 0
      ? [
          {
            heading: rankedActions.length === 1 ? "Top result" : "Top results",
            actions: rankedActions.map((entry) => entry.action),
          },
        ]
      : []),
    ...actionGroups
      .map((group) => ({
        ...group,
        actions: group.actions.filter((action) => {
          if (topActionKeys.has(action.key)) return false;
          if (!normalizedSearch) return true;
          if (rankAction(action, search) <= 0) return false;
          if (group.page) return true; // Alike finds are different things.
          const signature = actionDisplaySignature(action);
          if (displayedSignatures.has(signature)) return false;
          displayedSignatures.add(signature);
          return true;
        }),
      }))
      .filter((group) => group.actions.length > 0),
  ];
  const numberedActions = commandNumberedActions(displayedActionGroups);
  const numberShortcutIndexByKey = new Map(
    numberedActions.map((action, index) => [action.key, index]),
  );
  const firstDisplayedActionValue = displayedActionGroups[0]?.actions[0]
    ? actionCommandValue(displayedActionGroups[0].actions[0])
    : "";
  const displayedActionValues = new Set(
    displayedActionGroups.flatMap((group) =>
      group.actions.map((action) => actionCommandValue(action)),
    ),
  );
  const commandSelectedValue =
    selectedActionSearch === normalizedSearch &&
    selectedActionValue &&
    displayedActionValues.has(selectedActionValue)
      ? selectedActionValue
      : firstDisplayedActionValue;

  useEffect(() => {
    if (!open) {
      setSelectedActionValue("");
      setSelectedActionSearch("");
      return;
    }
    setSelectedActionValue(firstDisplayedActionValue);
    setSelectedActionSearch(normalizedSearch);
  }, [firstDisplayedActionValue, normalizedSearch, open]);

  const setCommandOpen = (next: boolean) => {
    if (next && !operationalShortcutsEnabled) return;
    if (next && !open) openBox();
    else setOpen(next);
    if (!next) setSearch("");
  };

  return (
    <>
      <Popover
        open={operationalShortcutsEnabled && open}
        onOpenChange={setCommandOpen}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!operationalShortcutsEnabled}
            className={`topbar-button command-trigger ${open ? "is-active" : ""}`}
            aria-label="Find or act"
            title={shortcutTitle("Find or act", "command.menu")}
          >
            <Keyboard size={15} />
            <span>Actions</span>
            <ChevronsUpDown size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="command-popover"
          align="end"
          onCloseAutoFocus={(event) => {
            if (document.querySelector(".modal-backdrop:not([hidden])"))
              event.preventDefault();
          }}
          onKeyDownCapture={(event) => {
            if (!operationalShortcutsEnabled) return;
            const selected = displayedActionGroups
              .flatMap((group) => group.actions)
              .find(
                (action) => actionCommandValue(action) === commandSelectedValue,
              );
            if (!runSecondaryKey(event, selected, run))
              runCommandNumberShortcut(event, numberedActions, choose);
          }}
        >
          <Command
            loop
            shouldFilter={false}
            value={commandSelectedValue}
            onValueChange={(value) => {
              setSelectedActionValue(value);
              setSelectedActionSearch(normalizedSearch);
            }}
          >
            <CommandInput
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                setFindFrom(0);
                finderSearch?.change(value);
              }}
              placeholder={
                extension.placeholder ?? "Search actions or enter file path..."
              }
            />
            <CommandList>
              <CommandEmpty>No actions found.</CommandEmpty>
              {displayedActionGroups.map((group) => (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.actions.map((action) => (
                    <ActionItem
                      key={action.key}
                      value={actionCommandValue(action)}
                      icon={action.icon}
                      title={action.title}
                      detail={action.detail}
                      shortcut={action.shortcut}
                      numberShortcutIndex={numberShortcutIndexByKey.get(
                        action.key,
                      )}
                      keywords={action.keywords}
                      danger={action.danger}
                      disabledReason={action.disabledReason}
                      trailing={action.trailing}
                      secondary={
                        action.secondary && !action.disabledReason
                          ? {
                              label: action.secondary.label,
                              run: () => {
                                if (operationalShortcutsEnabled)
                                  run(action.secondary!.run);
                              },
                            }
                          : undefined
                      }
                      onSelect={() => choose(action)}
                    />
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <CreateWorkspaceDialog
        open={operationalShortcutsEnabled && createWorkspaceOpen}
        onClose={() => setCreateWorkspaceOpen(false)}
      />
      <WorktreeOpenDialog
        open={operationalShortcutsEnabled && !!openWorktreeWorkspaceId}
        workspaceId={openWorktreeWorkspaceId}
        onClose={() => setOpenWorktreeWorkspaceId(null)}
      />
      <WorktreeHooksDialog
        open={operationalShortcutsEnabled && !!worktreeHooksWorkspaceId}
        workspaceId={worktreeHooksWorkspaceId ?? undefined}
        onClose={() => setWorktreeHooksWorkspaceId(null)}
      />
      <WorktreeLocationDialog
        open={!!locationWorkspaceId}
        workspaceId={locationWorkspaceId}
        onClose={() => setLocationWorkspaceId(null)}
      />
      <LazyWorktreeLifecycleDialog
        open={operationalShortcutsEnabled && !!lifecycleWorkspaceId}
        workspaceId={lifecycleWorkspaceId}
        onClose={() => setLifecycleWorkspaceId(null)}
      />
      <ConfirmDialog
        open={operationalShortcutsEnabled && !!pendingCloseWorkspace}
        title="Close Workspace"
        message={
          pendingCloseWorkspace
            ? `Close workspace "${workspaceName(pendingCloseWorkspace)}"?${composerDraftWarningFor(
                s.panes
                  .filter(
                    (pane) =>
                      pane.workspace_id === pendingCloseWorkspace.workspace_id,
                  )
                  .map((pane) => pane.pane_id),
              )}`
            : "Close this workspace?"
        }
        confirmLabel="Close"
        danger
        onClose={() => setPendingCloseWorkspace(null)}
        onConfirm={() => {
          if (operationalShortcutsEnabled && pendingCloseWorkspace) {
            clearComposerDraftsFor(
              s.panes
                .filter(
                  (pane) =>
                    pane.workspace_id === pendingCloseWorkspace.workspace_id,
                )
                .map((pane) => pane.pane_id),
            );
            store.closeWorkspace(pendingCloseWorkspace.workspace_id);
          }
        }}
      />
      <ConfirmDialog
        open={operationalShortcutsEnabled && !!pendingCloseTab}
        title="Close Tab"
        message={
          pendingCloseTab
            ? `Close "${tabName(pendingCloseTab)}"?${composerDraftWarningFor(
                s.panes
                  .filter((pane) => pane.tab_id === pendingCloseTab.tab_id)
                  .map((pane) => pane.pane_id),
              )}`
            : "Close this tab?"
        }
        confirmLabel="Close"
        danger
        onClose={() => setPendingCloseTab(null)}
        onConfirm={() => {
          if (operationalShortcutsEnabled && pendingCloseTab) {
            clearComposerDraftsFor(
              s.panes
                .filter((pane) => pane.tab_id === pendingCloseTab.tab_id)
                .map((pane) => pane.pane_id),
            );
            store.closeTab(pendingCloseTab.tab_id);
          }
        }}
      />
      <ConfirmDialog
        open={operationalShortcutsEnabled && !!pendingClosePane}
        title="Close Pane"
        message={
          pendingClosePane
            ? `Close pane "${shortId(pendingClosePane.pane_id)}"?${composerDraftWarningFor(
                [pendingClosePane.pane_id],
              )}`
            : "Close this pane?"
        }
        confirmLabel="Close"
        danger
        onClose={() => setPendingClosePane(null)}
        onConfirm={() => {
          if (operationalShortcutsEnabled && pendingClosePane) {
            clearComposerDraftsFor([pendingClosePane.pane_id]);
            store.closePane(pendingClosePane.pane_id);
          }
        }}
      />
      <ConfirmDialog
        open={operationalShortcutsEnabled && !!pendingRemoveWorktree}
        title="Remove Worktree"
        message={
          pendingRemoveWorktree
            ? `Remove worktree "${workspaceName(pendingRemoveWorktree)}"?`
            : "Remove this worktree?"
        }
        confirmLabel="Remove"
        danger
        onClose={() => setPendingRemoveWorktree(null)}
        onConfirm={() => {
          if (operationalShortcutsEnabled && pendingRemoveWorktree) {
            store.removeWorktree(pendingRemoveWorktree.workspace_id, false);
          }
        }}
      />
      {textDialogProps ? (
        <TextInputDialog
          open={operationalShortcutsEnabled && !!textAction}
          {...textDialogProps}
          onClose={() => setTextAction(null)}
          onSubmit={submitTextAction}
        />
      ) : null}
    </>
  );
}
