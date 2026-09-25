import { useReviewAnnotationDraft } from "./useReviewAnnotationDraft";
import {
  annotationDraftStorageKey,
  compileReviewFeedback,
  createReviewAnnotation,
  moveReviewAnnotation,
  parseReviewAnnotation,
  removeDeliveredReviewAnnotations,
  reanchorDiffReviewAnnotations,
  reanchorFileReviewAnnotations,
  reviewAgentPanes,
  type NewReviewAnnotation,
  type ReviewAnnotation,
} from "./annotations";
import { worldLocalStorage } from "./browserStorage";
import { useLayoutPreferences } from "./layoutPreferences";
import {
  shortcutMatches,
  shortcutTitle,
  useShortcutPreferences,
} from "./shortcutPreferences";
import { SHORTCUT_NUMBERS } from "./shortcutBindings";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileDiff,
  FolderTree,
  History,
  Info,
  LoaderCircle,
  MessageSquareText,
  Minimize2,
  MoreHorizontal,
  PanelTop,
  SquarePen,
  SquareStack,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ITheme } from "@xterm/xterm";
import { APP_VERSION } from "./version";
import { WorkspaceInspectorPortal } from "./components/WorkspaceInspectorPortal";
import {
  type AccentColor,
  normalizeAccentColor,
  normalizeTerminalFontScale,
  normalizeThemePreference,
  normalizeUiScale,
  normalizeZenMode,
  serializeZenMode,
  UI_SCALE_DEFAULT,
  type ResolvedTheme,
  resolveSystemTheme,
  SYSTEM_THEME_QUERY,
  type ThemePreference,
} from "./appearance";
import { AgentIcon } from "./components/AgentIcon";
import { paneHasAgentHistory } from "./components/agentSession";
import { CloseButton } from "./components/CloseButton";
import { focusIfUnchanged } from "./components/dialogFocus";
import { CommandCombobox } from "./components/CommandCombobox";
import { CONFIG_MENU_ID, ConfigMenu } from "./components/ConfigMenu";
import { ConnectionSwitcher } from "./components/ConnectionSwitcher";
import {
  type ActiveDiffSelection,
  clearDiffViewerResourceCache,
  prefetchDiffViewerWorkspace,
} from "./components/DiffViewerPanel";
import { clearDiffContentResourceState } from "./components/diffContentState";
import {
  clearFileExplorerResourceCache,
  prefetchFileExplorerWorkspace,
  requestFilePreview,
} from "./components/fileExplorerResources";
import { type ActiveFilePreviewSelection } from "./components/FilePreviewContent";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { GlobalTooltip } from "./components/GlobalTooltip";
import { MobileTabSheet } from "./components/MobileTabSheet";
import { requestClosePane, requestCloseTab, TabBar } from "./components/TabBar";
import type { WindowArrangementControl } from "./components/TabBar";
import { TabTerminalPaneLayout } from "./TabTerminalPaneLayout";
import { useVisibleTabLayoutState } from "./visibleTabLayout";
import type { TerminalWorkspaceFileRequest } from "./components/TerminalView";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { isIosDevice } from "./downloadFile";
import { lazyWithReload } from "./lazyWithReload";
import {
  LEGACY_MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
  MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
  MOBILE_TERMINAL_SIDE_SHORTCUTS_STORAGE_KEY,
  type MobileTerminalShortcutRows,
  type MobileTerminalSideShortcuts,
  parseMobileTerminalShortcutRows,
  parseMobileTerminalSideShortcuts,
  serializeMobileTerminalShortcutRows,
  serializeMobileTerminalSideShortcuts,
} from "./mobileTerminalShortcuts";
import {
  CUSTOM_TERMINAL_THEMES_STORAGE_KEY,
  type CustomTerminalTheme,
  parseCustomTerminalThemes,
  parseTerminalThemeSelection,
  resolveTerminalTheme,
  serializeCustomTerminalThemes,
  serializeTerminalThemeSelection,
  TERMINAL_THEME_SELECTION_STORAGE_KEY,
  type TerminalThemeSelection,
} from "./terminalThemes";
import {
  activePaneIdForSnapshot,
  type PaneJumpEntry,
  paneJumpEntries,
  paneSearchEntries,
  paneJumpTargetId,
} from "./paneJump";
import {
  isTaskNotificationTarget,
  type Notice,
  noticeAutoDismissDelay,
  shallowEqual,
  store,
  TASK_NOTIFICATION_ACTIVATE_EVENT,
  type TaskNotificationTarget,
  taskNotificationTargetFromNotice,
  useStoreSelector,
  WORKTREE_REMOVED_EVENT,
  type WorktreeRemovedTarget,
} from "./store";
import { paneShortcutAction } from "./paneShortcuts";
import { pluginActionShortcut } from "./pluginActionShortcuts";
import {
  adjacentTabId,
  closeShortcutTarget,
  tabShortcutAction,
} from "./tabShortcuts";
import { copyTextFromUserGesture } from "./terminalClipboard";
import { terminalPasteRequest } from "./terminalPaste";
import {
  activateTerminalComposerDraftScope,
  readTerminalComposerDraft,
  subscribeTerminalComposerDraft,
  terminalComposerDraftKey,
} from "./terminalComposer";
import { terminalMountKey } from "./terminalConnection";
import type { FileExplorerEntry, GitDiffEntry, Pane } from "./types";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "./useConnectionClient";
import { agentClass } from "./utils";
import {
  INSPECTOR_MIN_BOTTOM,
  INSPECTOR_MIN_RIGHT,
  type InspectorDock,
  type InspectorView,
  inspectorMaximumSize,
  isWorkspaceInspectorShortcut,
  normalizeInspectorViews,
  readInspectorPreferences,
  readResourceFileSelection,
  relativePathWithinCheckout,
  resolveWorkspaceForScope,
  resourceOwnerKey,
  resourceScopeForWorkspace,
  resourceStateKey,
  sameResourceOwner,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  type ResourceScope,
  WORKSPACE_ANNOTATION_REQUEST_EVENT,
  type WorkspaceAnnotationRequest,
  type WorkspaceInspectorRequest,
  type WorkspaceInspectorContext,
  type WorkspaceInspectorState,
  WORLD_OBSERVABILITY_SETTINGS_EVENT,
  writeInspectorPreferences,
  writeResourceFileSelection,
} from "./workspaceResource";
import "./styles/layout/app.css";
import "./styles/layout/topbar.css";
import "./styles/layout/sidebar.css";
import "./styles/layout/toast.css";
import "./styles/layout/mobile-nav.css";
import type { WorldTerminalPresentation } from "./world/worldTerminalPresentation";

const WorkspaceInspectorHost = lazyWithReload("workspace-inspector", () =>
  import("./components/WorkspaceInspectorHost").then((module) => ({
    default: module.WorkspaceInspectorHost,
  })),
);

const WorldTerminalPortalList = lazyWithReload(
  "world-terminal-portals",
  () => import("./world/WorldTerminalPortalList"),
);
const ViewportDebugOverlay = lazyWithReload(
  "viewport-debug-overlay",
  () => import("./components/ViewportDebugOverlay"),
);

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 560;
const DEFAULT_SIDEBAR = 284;
const THEME_KEY = "theme";
const ACCENT_COLOR_KEY = "accentColor";
const UI_SCALE_KEY = "uiScale";
const TERMINAL_FONT_SCALE_KEY = "terminalFontScale";
const ZEN_MODE_KEY = "zenMode";
const LazyTerminalView = lazyWithReload("terminal-view", () =>
  import("./components/TerminalView").then((module) => ({
    default: module.TerminalView,
  })),
);

// xterm.js is heavy; keep the overlay's own copy out of the initial bundle the
// same way LazyTerminalView does, since most sessions never open a popup.
const LazyPopupOverlay = lazyWithReload("popup-overlay", () =>
  import("./components/PopupOverlay").then((module) => ({
    default: module.PopupOverlay,
  })),
);

function PopupOverlay({
  terminalTheme,
  terminalFontScale,
}: {
  terminalTheme: ITheme;
  terminalFontScale: number;
}) {
  // Gate the dynamic import on popup presence, not just its content, so a
  // session that never opens one never fetches xterm.js for it.
  const hasPopup = useStoreSelector((s) => s.popup !== null);
  if (!hasPopup) return null;
  return (
    <Suspense fallback={null}>
      <LazyPopupOverlay
        terminalTheme={terminalTheme}
        terminalFontScale={terminalFontScale}
      />
    </Suspense>
  );
}

type TerminalViewProps = {
  paneId?: string;
  terminalTheme: ITheme;
  terminalFontScale: number;
  showMobileKeys?: boolean;
  mobileShortcuts?: MobileTerminalShortcutRows;
  mobileSideShortcuts?: MobileTerminalSideShortcuts;
  composerOpen?: boolean;
  onComposerOpenChange?: (open: boolean) => void;
  agentHistoryOpen?: boolean;
  onAgentHistoryOpenChange?: (open: boolean) => void;
  onOpenWorkspaceFile?: (request: TerminalWorkspaceFileRequest) => void;
};

function TerminalLoadingFallback({
  label = "Loading terminal",
}: {
  label?: string;
}) {
  return (
    <div className="terminal-loading" role="status">
      <span className="terminal-loading-dot" />
      {label}
    </div>
  );
}

function TerminalView(props: TerminalViewProps) {
  return (
    <Suspense fallback={<TerminalLoadingFallback />}>
      <LazyTerminalView {...props} />
    </Suspense>
  );
}

function NoticeDetail({ notice }: { notice: Notice }) {
  if (!notice.detail) return null;
  if (notice.detailMode === "output") {
    return (
      <div className="toast-output">
        {notice.detailTitle ? (
          <div className="toast-output-title">{notice.detailTitle}</div>
        ) : null}
        <pre>{notice.detail}</pre>
      </div>
    );
  }
  return <p>{notice.detail}</p>;
}

function ToastMark({
  kind,
  loading = false,
}: {
  kind: Notice["kind"];
  loading?: boolean;
}) {
  const Mark = loading
    ? LoaderCircle
    : kind === "success"
      ? CheckCircle2
      : kind === "error"
        ? CircleAlert
        : Info;

  return (
    <span className="toast-mark" aria-hidden="true">
      <Mark size={16} strokeWidth={2.1} />
    </span>
  );
}

export type Theme = ThemePreference;
type MobileView = "workspaces" | "session" | "annotations" | InspectorView;
type OpenInspectorOptions = {
  entry?: FileExplorerEntry;
  path?: string;
  fragment?: string;
  initialDirectory?: string;
  originPaneId?: string;
  focusInspector?: boolean;
  availableViews?: InspectorView[];
};

function normalizeSidebarWidth(value: number): number {
  return Number.isFinite(value) && value >= MIN_SIDEBAR && value <= MAX_SIDEBAR
    ? value
    : DEFAULT_SIDEBAR;
}

function loadSidebarWidth(): number {
  return normalizeSidebarWidth(
    Number(worldLocalStorage.getItem("sidebarWidth")),
  );
}

function loadTheme(): Theme {
  return normalizeThemePreference(worldLocalStorage.getItem(THEME_KEY));
}

function loadSystemTheme(): ResolvedTheme {
  return resolveSystemTheme(window.matchMedia(SYSTEM_THEME_QUERY));
}

function loadAccentColor(): AccentColor {
  return normalizeAccentColor(worldLocalStorage.getItem(ACCENT_COLOR_KEY));
}

function loadUiScale(): number {
  return normalizeUiScale(worldLocalStorage.getItem(UI_SCALE_KEY));
}

function loadTerminalFontScale(): number {
  return normalizeTerminalFontScale(
    worldLocalStorage.getItem(TERMINAL_FONT_SCALE_KEY),
    worldLocalStorage.getItem(UI_SCALE_KEY),
  );
}

function loadZenMode(): boolean {
  return normalizeZenMode(worldLocalStorage.getItem(ZEN_MODE_KEY));
}

function loadTerminalThemeSelection(): TerminalThemeSelection {
  return parseTerminalThemeSelection(
    worldLocalStorage.getItem(TERMINAL_THEME_SELECTION_STORAGE_KEY),
  );
}

function loadCustomTerminalThemes(): CustomTerminalTheme[] {
  return parseCustomTerminalThemes(
    worldLocalStorage.getItem(CUSTOM_TERMINAL_THEMES_STORAGE_KEY),
  );
}

function loadMobileTerminalShortcuts(): MobileTerminalShortcutRows {
  const current = worldLocalStorage.getItem(
    MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
  );
  if (current !== null) return parseMobileTerminalShortcutRows(current);
  const legacy = worldLocalStorage.getItem(
    LEGACY_MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
  );
  const migrated = parseMobileTerminalShortcutRows(legacy);
  if (legacy !== null) {
    worldLocalStorage.setItem(
      MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
      serializeMobileTerminalShortcutRows(migrated),
    );
  }
  return migrated;
}

function loadMobileTerminalSideShortcuts(): MobileTerminalSideShortcuts {
  return parseMobileTerminalSideShortcuts(
    worldLocalStorage.getItem(MOBILE_TERMINAL_SIDE_SHORTCUTS_STORAGE_KEY),
  );
}

function emptyActiveDiffSelection(): ActiveDiffSelection {
  return {
    entry: null,
    file: null,
    loading: false,
    error: null,
    entries: [],
    files: {},
    fileErrors: {},
    summaryLoading: false,
  };
}

function emptyActiveFilePreviewSelection(): ActiveFilePreviewSelection {
  return {
    entry: null,
    preview: null,
    loading: false,
    error: null,
  };
}

const viewportDebugEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debugViewport");

// Mobile browsers can over-report keyboard occlusion by including an input
// accessory or browser-control strip. Keep enough visual viewport lift to
// expose the composer, but trim the platform-specific overshoot.
const usesIosKeyboardViewportLift =
  typeof navigator !== "undefined" && isIosDevice(navigator);
// ?kbdTrim=<px> overrides the default for device-specific experiments.
const defaultKeyboardInsetTrim = usesIosKeyboardViewportLift ? 30 : 0;
const keyboardInsetTrim =
  typeof window !== "undefined"
    ? Math.max(
        0,
        Number.parseInt(
          new URLSearchParams(window.location.search).get("kbdTrim") ??
            String(defaultKeyboardInsetTrim),
          10,
        ) || 0,
      )
    : 0;

function useVisualViewportCssVars(uiScale: number) {
  useEffect(() => {
    const root = document.documentElement;
    // CSS zoom scales every computed px length, so emit viewport geometry in
    // pre-zoom units to keep the rendered shell matching the real viewport.
    const geometryScale = uiScale / 100;
    let pollTimer: number | undefined;
    let settleTimers: number[] = [];

    const measure = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboardInset = Math.max(
        0,
        window.innerHeight - height - offsetTop,
      );
      const keyboardOpen = keyboardInset > 24;
      root.classList.toggle("keyboard-open", keyboardOpen);
      root.style.setProperty(
        "--app-viewport-height",
        `${Math.round(height / geometryScale)}px`,
      );
      // Keep the app surface at the full layout height, even while the
      // keyboard is open. iOS can over-report the keyboard occlusion (the
      // floating keyboard accessory bar counts as covered area), so sizing
      // the app to the visual viewport leaves an unpainted strip above the
      // keyboard. Instead the app stays full-height and content is lifted
      // with padding-bottom in the mobile styles.
      root.style.setProperty(
        "--app-height",
        `calc(${Math.round(window.innerHeight / geometryScale)}px + env(safe-area-inset-bottom, 0px))`,
      );
      root.style.setProperty(
        "--app-viewport-offset-top",
        `${Math.round(offsetTop / geometryScale)}px`,
      );
      root.style.setProperty(
        "--keyboard-inset-bottom",
        `${Math.round(keyboardInset / geometryScale)}px`,
      );
      // Both platforms need the visual viewport lift here; without it some
      // Android browsers place the composer behind the software keyboard.
      const contentInset = Math.max(0, keyboardInset - keyboardInsetTrim);
      root.style.setProperty(
        "--keyboard-inset-content",
        `${Math.round(contentInset / geometryScale)}px`,
      );
      root.style.setProperty(
        "--keyboard-inset-composer-gap",
        `${Math.round(
          (usesIosKeyboardViewportLift
            ? Math.max(0, keyboardInset - contentInset)
            : 0) / geometryScale,
        )}px`,
      );
      return keyboardOpen;
    };

    const stopPolling = () => {
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    // Third-party iOS keyboards can change height (toolbars, candidate rows)
    // without firing visualViewport events, leaving the app sized for a
    // stale keyboard inset and exposing a blank strip above the keyboard.
    // Poll the geometry while the keyboard is open so those changes apply.
    const syncPolling = (keyboardOpen: boolean) => {
      if (keyboardOpen && pollTimer === undefined) {
        pollTimer = window.setInterval(() => {
          if (!measure()) stopPolling();
        }, 500);
      } else if (!keyboardOpen) {
        stopPolling();
      }
    };

    const update = () => {
      syncPolling(measure());
    };

    // iOS reports keyboard geometry in stages during the show/hide animation,
    // so re-measure after it settles to catch the final values.
    const updateWhenSettled = () => {
      update();
      for (const timer of settleTimers) window.clearTimeout(timer);
      settleTimers = [250, 600].map((delay) =>
        window.setTimeout(update, delay),
      );
    };

    update();
    window.visualViewport?.addEventListener("resize", updateWhenSettled);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", updateWhenSettled);
    window.addEventListener("focusin", updateWhenSettled);
    window.addEventListener("focusout", updateWhenSettled);
    return () => {
      stopPolling();
      for (const timer of settleTimers) window.clearTimeout(timer);
      window.visualViewport?.removeEventListener("resize", updateWhenSettled);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", updateWhenSettled);
      window.removeEventListener("focusin", updateWhenSettled);
      window.removeEventListener("focusout", updateWhenSettled);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-viewport-offset-top");
      root.style.removeProperty("--keyboard-inset-bottom");
      root.style.removeProperty("--keyboard-inset-content");
      root.style.removeProperty("--keyboard-inset-composer-gap");
    };
  }, [uiScale]);
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm")) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target.closest(".file-preview-code .cm-editor")) return false;
  return target.isContentEditable;
}

function blurActiveInput(event: React.PointerEvent<HTMLButtonElement>) {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const button = event.currentTarget;
  window.setTimeout(() => button.blur(), 0);
}

function tabShortcutIndex(e: KeyboardEvent) {
  const number = SHORTCUT_NUMBERS.find((n) => shortcutMatches(e, `tab.${n}`));
  return number === undefined ? null : number - 1;
}

function PaneJumpOverlay({
  entries,
  selectedIndex,
  search,
  onSearchChange,
  onSelectIndex,
  onCommit,
  onClose,
}: {
  entries: PaneJumpEntry[];
  selectedIndex: number;
  search: string | null;
  onSearchChange: (value: string) => void;
  onSelectIndex: (index: number) => void;
  onCommit: (index: number) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searching = search !== null;
  const selectedPaneId = entries[selectedIndex]?.paneId;

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, selectedPaneId]);
  useEffect(() => {
    if (searching) searchInputRef.current?.focus();
  }, [searching]);

  if (entries.length === 0 && !searching) return null;
  const listId = "pane-jump-list";
  return (
    <div className="pane-jump-backdrop">
      <div
        className="pane-jump-popover"
        role="listbox"
        aria-label="Recent panes"
      >
        <div className="pane-jump-head">
          <strong>{searching ? "Find Pane" : "Switch Pane"}</strong>
          <span>
            {searching
              ? "Filters every open pane. Use Up / Down and Enter"
              : "K to search; Enter or release modifier to switch"}
          </span>
        </div>
        {searching ? (
          <input
            ref={searchInputRef}
            className="pane-jump-search"
            type="text"
            value={search}
            spellCheck={false}
            autoComplete="off"
            placeholder="Workspace, tab, directory, or agent"
            role="combobox"
            aria-label="Search panes"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={
              selectedPaneId
                ? `${listId}-${encodeURIComponent(selectedPaneId)}`
                : undefined
            }
            onChange={(event) => onSearchChange(event.target.value)}
            onBlur={() => onClose()}
          />
        ) : null}
        {entries.length === 0 ? (
          <p className="pane-jump-empty" role="status">
            No panes match this search.
          </p>
        ) : null}
        <div
          className="pane-jump-list"
          id={listId}
          role="listbox"
          aria-label={searching ? "Matching panes" : "Recent panes"}
        >
          {entries.map((entry, index) => (
            <button
              key={entry.paneId}
              id={`${listId}-${encodeURIComponent(entry.paneId)}`}
              ref={index === selectedIndex ? selectedItemRef : undefined}
              type="button"
              tabIndex={-1}
              className={`pane-jump-item ${
                index === selectedIndex ? "is-selected" : ""
              } ${entry.current ? "is-current" : ""}`}
              role="option"
              aria-selected={index === selectedIndex}
              onPointerEnter={() => onSelectIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onCommit(index)}
            >
              {entry.agent ? (
                <span className="pane-jump-agent-identity">
                  <AgentIcon agent={entry.agent} compact />
                  <span
                    className={`pane-jump-status status-${entry.agentStatus ?? "unknown"}`}
                  />
                </span>
              ) : null}
              <span className="pane-jump-text">
                <span className="pane-jump-title-line">
                  <strong>{entry.title}</strong>
                  {entry.current ? (
                    <span className="pane-jump-current-badge">Current</span>
                  ) : null}
                  {entry.agentStatus ? (
                    <span
                      className={`${agentClass(entry.agentStatus)} pane-jump-agent-status`}
                    >
                      {entry.agentStatus}
                    </span>
                  ) : null}
                </span>
                <span className="pane-jump-subtitle">
                  {entry.agent ? (
                    <>
                      <span className="pane-jump-agent-name">
                        {entry.agent}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  <span className="pane-jump-tab" title={entry.tabLabel}>
                    {entry.tabLabel}
                  </span>
                  <span className="pane-jump-id" title={entry.paneId}>
                    {" · "}
                    {entry.paneLabel}
                  </span>
                  {entry.cwd ? (
                    <span className="pane-jump-cwd" title={entry.cwd}>
                      {" · "}
                      {entry.cwd}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function appShouldHandleGlobalShortcut(
  operationalShortcutsEnabled: boolean,
  event: Pick<KeyboardEvent, "defaultPrevented" | "isComposing" | "keyCode">,
) {
  return (
    operationalShortcutsEnabled &&
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

export function terminalPresentationTarget(
  spacesOperational: boolean,
  inspector: Pick<
    WorkspaceInspectorState,
    "open" | "view" | "originPaneId"
  > | null,
  floating: boolean,
): "spaces" | "inspector" | "floating" | null {
  if (spacesOperational) return "spaces";
  if (floating) return "floating";
  if (
    inspector?.open &&
    inspector.view === "terminal" &&
    inspector.originPaneId
  ) {
    return "inspector";
  }
  return null;
}

export type SpacesTabWindow = { tabId: string; portal: Element | null };

function SpacesTabTerminal({
  tabId,
  workspaceId,
  panes,
  selectedPaneId,
  connectionId,
  connectionGeneration,
  terminalTheme,
  terminalFontScale,
  mobileShortcuts,
  mobileSideShortcuts,
  composerOpen,
  onComposerOpenChange,
  agentHistoryOpen,
  onAgentHistoryOpenChange,
  onOpenWorkspaceFile,
  onFocusTabWindow,
}: {
  tabId: string;
  workspaceId: string;
  panes: readonly Pane[];
  selectedPaneId: string | null;
  connectionId: string;
  connectionGeneration: number;
  terminalTheme: ITheme;
  terminalFontScale: number;
  mobileShortcuts: MobileTerminalShortcutRows;
  mobileSideShortcuts: MobileTerminalSideShortcuts;
  composerOpen: boolean;
  onComposerOpenChange(open: boolean): void;
  agentHistoryOpen: boolean;
  onAgentHistoryOpenChange(open: boolean): void;
  onOpenWorkspaceFile(request: TerminalWorkspaceFileRequest): void;
  onFocusTabWindow?: (tabId: string, paneId: string | null) => void;
}) {
  const { layout, error } = useVisibleTabLayoutState(workspaceId, tabId);
  return (
    <TabTerminalPaneLayout
      layout={layout}
      unavailableMessage={error ?? undefined}
      panes={panes}
      selectedPaneId={selectedPaneId}
      onFocusPane={(paneId) => {
        onFocusTabWindow?.(tabId, paneId);
        void store.focusPane(paneId);
      }}
      connectionId={connectionId}
      connectionGeneration={connectionGeneration}
      terminalTheme={terminalTheme}
      terminalFontScale={terminalFontScale}
      mobileShortcuts={mobileShortcuts}
      mobileSideShortcuts={mobileSideShortcuts}
      composerOpen={composerOpen}
      onComposerOpenChange={onComposerOpenChange}
      agentHistoryOpen={agentHistoryOpen}
      onAgentHistoryOpenChange={onAgentHistoryOpenChange}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

export type WorkspaceSurfaceSelection = {
  connectionId: string;
  runtimeGeneration: number;
  workspaceId: string;
  paneId?: string;
};

export type WorkspaceSurfaceInspectorControl = {
  view: InspectorView;
  availableViews: readonly InspectorView[];
  onViewChange(view: InspectorView): void;
};

export default function App({
  operationalShortcutsEnabled = true,
  inspectorPortal = null,
  topbarPortal = null,
  primaryViewControl = null,
  workspaceSurface = null,
  workspaceSurfaceVisible = true,
  workspaceSurfaceInspector = null,
  onWorkspaceSurfaceSelect,
  worldTerminalPresentations = [],
  spacesTabWindows,
  arrangementControl,
  onFocusSpacesTabWindow,
  onSpacesWindowLayerReady,
  onInspectorVisibilityChange,
  onInspectorViewChange,
  onTerminalPopOut,
  inspectorContext = null,
}: {
  operationalShortcutsEnabled?: boolean;
  inspectorPortal?: Element | null;
  topbarPortal?: Element | null;
  primaryViewControl?: ReactNode;
  workspaceSurface?: ReactNode;
  workspaceSurfaceVisible?: boolean;
  workspaceSurfaceInspector?: WorkspaceSurfaceInspectorControl | null;
  onWorkspaceSurfaceSelect?: (
    selection: WorkspaceSurfaceSelection,
  ) => void | Promise<unknown>;
  worldTerminalPresentations?: readonly WorldTerminalPresentation[];
  spacesTabWindows?: readonly SpacesTabWindow[];
  arrangementControl?: WindowArrangementControl;
  onFocusSpacesTabWindow?: (tabId: string, paneId: string | null) => void;
  onSpacesWindowLayerReady?: (element: HTMLDivElement | null) => void;
  onInspectorVisibilityChange?: (open: boolean) => void;
  onInspectorViewChange?: (view: InspectorView) => void;
  onTerminalPopOut?: () => void;
  inspectorContext?: WorkspaceInspectorContext | null;
} = {}) {
  const hasWorkspaceSurface =
    workspaceSurface !== null && workspaceSurfaceVisible;
  useShortcutPreferences();
  const s = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      connectionGeneration: state.connectionGeneration,
      serverRuntimeGeneration: state.serverRuntimeGeneration,
      lastRefresh: state.lastRefresh,
      layout: state.layout,
      notice: state.notice,
      panes: state.panes,
      pendingFocusWorkspaceId: state.pendingFocusWorkspaceId,
      recentPaneIds: state.recentPaneIds,
      selectedPaneId: state.selectedPaneId,
      status: state.status,
      tabs: state.tabs,
      updateInfo: state.updateInfo,
      updateInstalling: state.updateInstalling,
      workspaces: state.workspaces,
    }),
    shallowEqual,
  );
  const connectionClient = useConnectionClient();
  const { mobile, preferences: layoutPreferences } = useLayoutPreferences();
  useEffect(() => {
    activateTerminalComposerDraftScope(
      s.activeConnectionId,
      s.connectionGeneration,
    );
  }, [s.activeConnectionId, s.connectionGeneration]);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [mobileView, setMobileView] = useState<MobileView>("session");
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    loadSystemTheme(),
  );
  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;
  const [accentColor, setAccentColor] = useState<AccentColor>(() =>
    loadAccentColor(),
  );
  const [uiScale, setUiScale] = useState<number>(() => loadUiScale());
  useVisualViewportCssVars(uiScale);
  const [terminalFontScale, setTerminalFontScale] = useState<number>(() =>
    loadTerminalFontScale(),
  );
  const [mobileTerminalShortcuts, setMobileTerminalShortcuts] =
    useState<MobileTerminalShortcutRows>(loadMobileTerminalShortcuts);
  const [mobileTerminalSideShortcuts, setMobileTerminalSideShortcuts] =
    useState<MobileTerminalSideShortcuts>(loadMobileTerminalSideShortcuts);
  const [terminalThemeSelection, setTerminalThemeSelection] =
    useState<TerminalThemeSelection>(loadTerminalThemeSelection);
  const [customTerminalThemes, setCustomTerminalThemes] = useState<
    CustomTerminalTheme[]
  >(loadCustomTerminalThemes);
  const terminalTheme = useMemo(
    () =>
      resolveTerminalTheme(
        resolvedTheme,
        terminalThemeSelection,
        customTerminalThemes,
      ),
    [resolvedTheme, terminalThemeSelection, customTerminalThemes],
  );
  const [zenMode, setZenMode] = useState(loadZenMode);
  const [sidebarHidden, setSidebarHidden] = useState(loadZenMode);
  // What the sidebar was doing before Zen hid it, restored when Zen ends.
  const sidebarBeforeZenRef = useRef(false);
  const [mobileControlsCollapsed, setMobileControlsCollapsed] = useState(false);
  const [mobileTabSheetOpen, setMobileTabSheetOpen] = useState(false);
  const terminalComposerScopeKey = JSON.stringify([
    s.activeConnectionId,
    s.connectionGeneration,
  ]);
  const [openTerminalComposerScopeKey, setOpenTerminalComposerScopeKey] =
    useState<string | null>(null);
  const [terminalComposerHasDraft, setTerminalComposerHasDraft] =
    useState(false);
  const [paneJumpOpen, setPaneJumpOpen] = useState(false);
  const [paneJumpIndex, setPaneJumpIndex] = useState(0);
  const [paneJumpSearch, setPaneJumpSearch] = useState<string | null>(null);
  const paneJumpModifierRef = useRef<"ctrlKey" | "altKey" | "metaKey" | null>(
    null,
  );
  const paneJumpIndexRef = useRef(0);
  const paneJumpReturnFocusRef = useRef<HTMLElement | null>(null);
  const [inspectorState, setInspectorState] =
    useState<WorkspaceInspectorState | null>(null);
  const inspectorStateRef = useRef<WorkspaceInspectorState | null>(null);
  const resourceUiKey = connectionClientScopeKey(
    connectionClient,
    "resource-ui",
  );
  const {
    annotations,
    scope: annotationScope,
    scopeRef: annotationScopeRef,
    sessionRef: annotationSessionRef,
    read: readAnnotationDraft,
    select: selectAnnotationDraft,
    update: updateAnnotationDraft,
  } = useReviewAnnotationDraft(resourceUiKey);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [annotationsFloating, setAnnotationsFloating] = useState(
    () => worldLocalStorage.getItem("annotationPanelMode") !== "fixed",
  );
  const annotationsDocked = annotationsOpen && (mobile || !annotationsFloating);
  const toggleAnnotationsFloating = () => {
    const next = !annotationsFloating;
    setAnnotationsFloating(next);
    try {
      worldLocalStorage.setItem(
        "annotationPanelMode",
        next ? "floating" : "fixed",
      );
    } catch {
      store.notify({
        kind: "error",
        message: "Annotation layout could not be saved",
        detail: "The layout applies until this page reloads.",
      });
    }
  };
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(
    null,
  );
  const [annotationPreferredPaneId, setAnnotationPreferredPaneId] = useState<
    string | undefined
  >();
  const [deliveredPaneId, setDeliveredPaneId] = useState<string | null>(null);
  const [annotationDeliveryBusy, setAnnotationDeliveryBusy] = useState(false);
  const annotationAwaitingFocusRef = useRef<ResourceScope | null>(null);
  const inspectorFocusRequestRef = useRef<{
    state: WorkspaceInspectorState;
    source: Element | null;
  } | null>(null);
  const finishInspectorFocus = useCallback(() => {
    const request = inspectorFocusRequestRef.current;
    if (!request) return;
    if (inspectorStateRef.current !== request.state || !request.state.open) {
      inspectorFocusRequestRef.current = null;
      return;
    }
    const target = document.querySelector<HTMLElement>(
      '.workspace-inspector-tabs [role="tab"][aria-selected="true"]',
    );
    if (focusIfUnchanged(target, request.source)) {
      inspectorFocusRequestRef.current = null;
    }
  }, []);
  const inspectorReturnFocusRef = useRef<HTMLElement | null>(null);
  const pendingInspectorRequestRef = useRef<WorkspaceInspectorRequest | null>(
    null,
  );
  const inspectorStageRef = useRef<HTMLDivElement | null>(null);
  const [inspectorTerminalPortal, setInspectorTerminalPortal] =
    useState<HTMLDivElement | null>(null);
  const inspectorResizeFrameRef = useRef<number | null>(null);
  const [activeDiff, setActiveDiff] = useState<ActiveDiffSelection>(
    emptyActiveDiffSelection,
  );
  const [activeFilePreview, setActiveFilePreview] =
    useState<ActiveFilePreviewSelection>(emptyActiveFilePreviewSelection);
  const fileQuickOpenRequestRef = useRef(0);
  const resourceRuntimeKeyRef = useRef(resourceUiKey);
  const focusedWorkspace = s.workspaces.find((w) => w.focused);
  const activeSpacesTabId =
    focusedWorkspace?.active_tab_id ??
    s.tabs.find(
      (tab) =>
        tab.workspace_id === focusedWorkspace?.workspace_id && tab.focused,
    )?.tab_id ??
    s.tabs.find((tab) => tab.workspace_id === focusedWorkspace?.workspace_id)
      ?.tab_id ??
    null;
  const visibleSpacesTabWindows = (spacesTabWindows ?? []).filter(
    (window, index, entries) =>
      Boolean(window.portal) &&
      entries.findIndex((entry) => entry.tabId === window.tabId) === index &&
      s.tabs.some(
        (tab) =>
          tab.tab_id === window.tabId &&
          tab.workspace_id === focusedWorkspace?.workspace_id,
      ),
  );
  const focusedWorkspaceTabCount = focusedWorkspace
    ? s.tabs.filter((tab) => tab.workspace_id === focusedWorkspace.workspace_id)
        .length
    : 0;
  useEffect(() => {
    // Drop mobile-only controls when their context disappears so they cannot
    // stay active invisibly or resurface when the mobile layout returns.
    if (!mobile || !focusedWorkspace) setMobileTabSheetOpen(false);
    if (!mobile) setOpenTerminalComposerScopeKey(null);
  }, [mobile, focusedWorkspace]);
  useEffect(() => {
    setOpenTerminalComposerScopeKey(null);
  }, [terminalComposerScopeKey]);
  const activePaneId = activePaneIdForSnapshot(s);
  const activePane = activePaneId
    ? s.panes.find((pane) => pane.pane_id === activePaneId)
    : undefined;
  const activeTerminalComposerDraftKey =
    activePaneId && activePane?.terminal_id
      ? terminalComposerDraftKey(
          s.activeConnectionId,
          s.connectionGeneration,
          activePaneId,
        )
      : null;
  const terminalComposerOpen =
    mobile &&
    !mobileTabSheetOpen &&
    openTerminalComposerScopeKey === terminalComposerScopeKey &&
    activeTerminalComposerDraftKey !== null;
  const setTerminalComposerOpen = useCallback(
    (open: boolean) => {
      setOpenTerminalComposerScopeKey(open ? terminalComposerScopeKey : null);
    },
    [terminalComposerScopeKey],
  );
  useEffect(() => {
    if (!activeTerminalComposerDraftKey) {
      setTerminalComposerHasDraft(false);
      return;
    }
    const update = (draft: string) => setTerminalComposerHasDraft(draft !== "");
    update(readTerminalComposerDraft(activeTerminalComposerDraftKey));
    return subscribeTerminalComposerDraft(
      activeTerminalComposerDraftKey,
      update,
    );
  }, [activeTerminalComposerDraftKey]);
  const paneJumpOptions = useMemo(() => {
    const snapshot = {
      layout: s.layout,
      panes: s.panes,
      recentPaneIds: s.recentPaneIds,
      tabs: s.tabs,
      workspaces: s.workspaces,
    };
    return paneJumpSearch === null
      ? paneJumpEntries(snapshot, activePaneId)
      : paneSearchEntries(snapshot, paneJumpSearch, activePaneId);
  }, [
    activePaneId,
    paneJumpSearch,
    s.layout,
    s.panes,
    s.recentPaneIds,
    s.tabs,
    s.workspaces,
  ]);
  const activePaneHasAgent = paneHasAgentHistory(activePane);
  const historyInspectorOpen =
    inspectorState?.open === true && inspectorState.view === "history";
  const agentHistoryOpen =
    historyInspectorOpen &&
    (!inspectorState.originPaneId ||
      inspectorState.originPaneId === activePane?.pane_id);
  const inspectorOriginPane = inspectorState?.originPaneId
    ? s.panes.find((pane) => pane.pane_id === inspectorState.originPaneId)
    : undefined;
  const inspectorHistoryPaneCandidate =
    inspectorOriginPane ??
    (inspectorState?.view === "history" && inspectorState.originPaneId
      ? undefined
      : activePane);
  const inspectorWorkspace = inspectorState
    ? resolveWorkspaceForScope(inspectorState.scope, s.workspaces)
    : undefined;
  const inspectorHistoryPane =
    inspectorHistoryPaneCandidate?.workspace_id ===
    inspectorWorkspace?.workspace_id
      ? inspectorHistoryPaneCandidate
      : undefined;
  const inspectorTerminalPane =
    inspectorState?.view === "terminal" &&
    inspectorOriginPane?.workspace_id === inspectorWorkspace?.workspace_id
      ? inspectorOriginPane
      : undefined;
  const inspectorFloatingTerminal = inspectorTerminalPane
    ? worldTerminalPresentations.some(
        (presentation) =>
          presentation.connectionId === s.activeConnectionId &&
          presentation.runtimeGeneration === s.serverRuntimeGeneration &&
          presentation.paneId === inspectorTerminalPane.pane_id &&
          presentation.terminalId === inspectorTerminalPane.terminal_id &&
          Boolean(presentation.portal),
      )
    : false;
  const terminalPresentation = terminalPresentationTarget(
    operationalShortcutsEnabled,
    inspectorState,
    Boolean(inspectorFloatingTerminal),
  );
  const worldPresentationsForView =
    terminalPresentation === "spaces" ? [] : worldTerminalPresentations;
  const presentedTerminalPane =
    terminalPresentation === "inspector" ? inspectorTerminalPane : undefined;
  const presentedTerminalPortal =
    terminalPresentation === "inspector" ? inspectorTerminalPortal : null;
  const inspectorResourceStateKey = inspectorState
    ? resourceStateKey(inspectorState.scope)
    : null;
  const annotationStorageKey = annotationScope
    ? annotationDraftStorageKey(annotationScope)
    : null;
  const annotationWorkspace = annotationScope
    ? resolveWorkspaceForScope(annotationScope, s.workspaces)
    : undefined;
  const annotationAgentPanes = useMemo(
    () =>
      reviewAgentPanes(
        s.panes,
        annotationWorkspace?.workspace_id ?? "",
        annotationPreferredPaneId,
      ),
    [annotationPreferredPaneId, annotationWorkspace?.workspace_id, s.panes],
  );
  const commitAnnotations = useCallback(
    (
      update:
        | ReviewAnnotation[]
        | ((current: ReviewAnnotation[]) => ReviewAnnotation[]),
    ) => {
      if (!annotationScope) return;
      updateAnnotationDraft(annotationScope, update);
    },
    [annotationScope, updateAnnotationDraft],
  );
  const setAnnotationDraftScope = useCallback(
    (scope: ResourceScope, open = false, preferredPaneId?: string) => {
      const changed = selectAnnotationDraft(scope);
      setAnnotationsOpen(open);
      if (changed) {
        setFocusedAnnotationId(null);
        setAnnotationPreferredPaneId(preferredPaneId);
        setDeliveredPaneId(null);
        setAnnotationDeliveryBusy(false);
      } else if (preferredPaneId !== undefined) {
        setAnnotationPreferredPaneId(preferredPaneId);
      }
    },
    [selectAnnotationDraft],
  );

  const commitInspectorState = useCallback(
    (next: WorkspaceInspectorState | null) => {
      inspectorStateRef.current = next;
      setInspectorState(next);
    },
    [],
  );
  const updateInspectorState = useCallback(
    (
      update: (
        current: WorkspaceInspectorState | null,
      ) => WorkspaceInspectorState | null,
    ) => {
      const next = update(inspectorStateRef.current);
      inspectorStateRef.current = next;
      setInspectorState(next);
    },
    [],
  );
  const activateTerminalSurface = useCallback(() => {
    updateInspectorState((current) =>
      current ? { ...current, open: false } : current,
    );
    setAnnotationsOpen(false);
    setMobileView("session");
    if (!mobile) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            ".pane-layout-cell.is-active .xterm-helper-textarea, .pane-switcher-layout .xterm-helper-textarea, .workspace-terminal-surface > .terminal-shell .xterm-helper-textarea",
          )
          ?.focus();
      });
    }
  }, [mobile, updateInspectorState]);
  const toggleSidebar = useCallback(() => {
    setMobileView("session");
    setSidebarHidden((value) => !value);
  }, []);
  // Entering Zen hides the sidebar; leaving Zen puts it back as it was. In
  // between, the sidebar toggles on its own without disturbing Zen.
  const applyZenMode = useCallback(
    (next: boolean) => {
      if (next === zenMode) return;
      if (next) sidebarBeforeZenRef.current = sidebarHidden;
      setSidebarHidden(next ? true : sidebarBeforeZenRef.current);
      setZenMode(next);
    },
    [sidebarHidden, zenMode],
  );
  const toggleZenMode = useCallback(
    () => applyZenMode(!zenMode),
    [applyZenMode, zenMode],
  );
  const openWorkspaces = useCallback(() => {
    setSidebarHidden(false);
    if (mobile) {
      setMobileView("workspaces");
      return;
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".workspace-tree-panel")?.focus();
    });
  }, [mobile]);
  const loadInspectorFilePreview = useCallback(
    (workspaceId: string, entry: FileExplorerEntry, fragment?: string) => {
      const requestId = fileQuickOpenRequestRef.current + 1;
      fileQuickOpenRequestRef.current = requestId;
      setActiveFilePreview({
        entry,
        fragment,
        preview: null,
        loading: true,
        error: null,
      });
      void requestFilePreview(workspaceId, entry.path, {
        client: connectionClient,
        refresh: true,
      })
        .then((preview) => {
          if (
            !connectionClient.isCurrent() ||
            fileQuickOpenRequestRef.current !== requestId
          ) {
            return;
          }
          setActiveFilePreview({
            entry,
            fragment,
            preview,
            loading: false,
            error: null,
          });
        })
        .catch((error) => {
          if (
            !connectionClient.isCurrent() ||
            fileQuickOpenRequestRef.current !== requestId
          ) {
            return;
          }
          setActiveFilePreview({
            entry,
            fragment,
            preview: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [connectionClient],
  );
  const openInspector = useCallback(
    (
      view: InspectorView,
      workspaceId?: string,
      options: OpenInspectorOptions = {},
    ) => {
      const snapshot = store.get();
      const availableViews = normalizeInspectorViews(options.availableViews);
      const admittedView = availableViews.includes(view)
        ? view
        : availableViews[0];
      const workspace = workspaceId
        ? snapshot.workspaces.find(
            (candidate) => candidate.workspace_id === workspaceId,
          )
        : snapshot.workspaces.find((candidate) => candidate.focused);
      if (!workspace) {
        store.notify({
          kind: "error",
          message: `Cannot open ${
            view === "files"
              ? "Files"
              : view === "changes"
                ? "Changes"
                : "History"
          }`,
          detail: "The target workspace is no longer open.",
        });
        return;
      }

      const focusInspector = options.focusInspector ?? true;
      inspectorReturnFocusRef.current =
        focusInspector && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const scope = resourceScopeForWorkspace(
        connectionClient.connectionId,
        workspace,
      );
      if (
        !annotationScopeRef.current ||
        annotationScopeRef.current.workspaceId !== scope.workspaceId ||
        !sameResourceOwner(annotationScopeRef.current, scope)
      ) {
        setAnnotationDraftScope(scope, annotationsOpen);
      }
      const current = inspectorStateRef.current;
      const sameOwner = !!current && sameResourceOwner(current.scope, scope);
      const stageWidth = inspectorStageRef.current?.clientWidth ?? 0;
      const preferences = readInspectorPreferences(worldLocalStorage, scope, {
        rightSize: stageWidth > 0 ? stageWidth * 0.42 : undefined,
      });
      const dock = sameOwner ? current.dock : preferences.dock;
      const preferredSize = sameOwner
        ? current.size
        : dock === "right"
          ? preferences.rightSize
          : preferences.bottomSize;
      const stageHeight = inspectorStageRef.current?.clientHeight ?? 0;
      const clampToDock =
        (dock === "right" && stageWidth >= 1000) ||
        (dock === "bottom" && stageHeight > 0);
      const size = clampToDock
        ? Math.min(
            preferredSize,
            inspectorMaximumSize(dock, stageWidth, stageHeight),
          )
        : preferredSize;
      const originPane = options.originPaneId
        ? snapshot.panes.find((pane) => pane.pane_id === options.originPaneId)
        : snapshot.panes.find(
            (pane) =>
              pane.workspace_id === workspace.workspace_id && pane.focused,
          );
      const returnTabId =
        originPane?.tab_id ?? workspace.active_tab_id ?? current?.returnTabId;
      const nextState: WorkspaceInspectorState = {
        scope,
        open: true,
        view: admittedView,
        ...(options.availableViews ? { availableViews } : {}),
        dock,
        size,
        expanded: sameOwner ? current.expanded : preferences.expanded,
        returnTabId,
        originPaneId: options.originPaneId,
        initialDirectory: options.initialDirectory,
      };

      if (!workspace.focused) void store.focusWorkspace(workspace.workspace_id);
      if (!sameOwner) {
        fileQuickOpenRequestRef.current += 1;
        setActiveDiff(emptyActiveDiffSelection());
        setActiveFilePreview(emptyActiveFilePreviewSelection());
      }
      inspectorFocusRequestRef.current = focusInspector
        ? { state: nextState, source: document.activeElement }
        : null;
      commitInspectorState(nextState);
      writeInspectorPreferences(worldLocalStorage, nextState);
      if (mobile) setMobileView(admittedView);
      if (focusInspector) requestAnimationFrame(finishInspectorFocus);

      const selectedPath =
        options.path ??
        (admittedView === "files" && options.initialDirectory === undefined
          ? readResourceFileSelection(worldLocalStorage, scope)
          : undefined);
      if (admittedView === "files" && !selectedPath) {
        fileQuickOpenRequestRef.current += 1;
        setActiveFilePreview(emptyActiveFilePreviewSelection());
      }
      if (admittedView !== "files" || !selectedPath) return;
      const entry =
        options.entry ??
        ({
          name: selectedPath.split("/").filter(Boolean).pop() ?? selectedPath,
          path: selectedPath,
          type: "file",
          size: 0,
          mtime_ms: 0,
          hidden:
            selectedPath.split("/").filter(Boolean).pop()?.startsWith(".") ??
            false,
        } satisfies FileExplorerEntry);
      loadInspectorFilePreview(workspace.workspace_id, entry, options.fragment);
    },
    [
      commitInspectorState,
      connectionClient.connectionId,
      finishInspectorFocus,
      loadInspectorFilePreview,
      mobile,
      annotationsOpen,
      annotationScopeRef,
      setAnnotationDraftScope,
    ],
  );
  const openAnnotations = useCallback(
    (workspaceId?: string, preferredPaneId?: string) => {
      const snapshot = store.get();
      const workspace = workspaceId
        ? snapshot.workspaces.find(
            (candidate) => candidate.workspace_id === workspaceId,
          )
        : snapshot.workspaces.find((candidate) => candidate.focused);
      if (!workspace) return;
      const scope = resourceScopeForWorkspace(
        connectionClient.connectionId,
        workspace,
      );
      setAnnotationDraftScope(scope, true, preferredPaneId);
      annotationAwaitingFocusRef.current = workspace.focused ? null : scope;
      if (!workspace.focused) void store.focusWorkspace(workspace.workspace_id);
      if (mobile) setMobileView("annotations");
    },
    [connectionClient.connectionId, mobile, setAnnotationDraftScope],
  );
  const toggleAnnotations = useCallback(() => {
    if (annotationsOpen && (!mobile || mobileView === "annotations")) {
      setAnnotationsOpen(false);
      if (mobile)
        setMobileView(
          inspectorStateRef.current?.open
            ? inspectorStateRef.current.view
            : "session",
        );
      return;
    }
    openAnnotations();
  }, [annotationsOpen, mobile, mobileView, openAnnotations]);
  const reanchorFileAnnotations = useCallback(
    (path: string, text: string) => {
      if (!inspectorState || !connectionClient.isCurrent()) return;
      updateAnnotationDraft(inspectorState.scope, (current) =>
        reanchorFileReviewAnnotations(current, path, text),
      );
    },
    [connectionClient, inspectorState, updateAnnotationDraft],
  );
  const reanchorDiffAnnotations = useCallback(
    (path: string, kind: GitDiffEntry["kind"], patch: string) => {
      if (!inspectorState || !connectionClient.isCurrent()) return;
      updateAnnotationDraft(inspectorState.scope, (current) =>
        reanchorDiffReviewAnnotations(current, path, kind, patch),
      );
    },
    [connectionClient, inspectorState, updateAnnotationDraft],
  );
  const addAnnotation = useCallback(
    (input: NewReviewAnnotation) => {
      if (!inspectorState || !connectionClient.isCurrent()) return;
      const annotation = createReviewAnnotation(input);
      setAnnotationDraftScope(inspectorState.scope, true);
      updateAnnotationDraft(inspectorState.scope, (current) => [
        ...current,
        annotation,
      ]);
      setFocusedAnnotationId(annotation.id);
      setAnnotationsOpen(true);
      if (mobile) setMobileView("annotations");
    },
    [
      connectionClient,
      inspectorState,
      mobile,
      setAnnotationDraftScope,
      updateAnnotationDraft,
    ],
  );
  const closeAnnotations = useCallback(() => {
    setAnnotationsOpen(false);
    if (mobile) {
      setMobileView(
        inspectorStateRef.current?.open
          ? inspectorStateRef.current.view
          : "session",
      );
      return;
    }
    document
      .querySelector<HTMLElement>(
        ".pane-layout-cell.is-active .xterm-helper-textarea, .pane-switcher-layout .xterm-helper-textarea, .workspace-terminal-surface > .terminal-shell .xterm-helper-textarea",
      )
      ?.focus();
  }, [mobile]);
  const clearAnnotations = useCallback(() => {
    commitAnnotations([]);
    setFocusedAnnotationId(null);
    closeAnnotations();
  }, [closeAnnotations, commitAnnotations]);
  const copyFeedback = useCallback(
    async (fallback = false) => {
      const message = compileReviewFeedback(annotations);
      if (!message) {
        store.notify({
          kind: "error",
          message: "Add text to a review comment before delivery",
        });
        return;
      }
      const deliverySession = annotationSessionRef.current;
      setAnnotationDeliveryBusy(true);
      try {
        await copyTextFromUserGesture(message);
        store.notify({
          kind: "success",
          message: fallback
            ? "No agent pane found; feedback copied"
            : "Review feedback copied",
          detail: `${annotations.length} comment${annotations.length === 1 ? "" : "s"}`,
          autoDismissMs: 3000,
        });
      } catch (error) {
        store.notify({
          kind: "error",
          message: "Failed to copy review feedback",
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (annotationSessionRef.current === deliverySession)
          setAnnotationDeliveryBusy(false);
      }
    },
    [annotations, annotationSessionRef],
  );
  const sendFeedback = useCallback(
    async (paneId: string | null) => {
      const target = annotationAgentPanes.find(
        (pane) => pane.pane_id === paneId,
      );
      if (!target) {
        await copyFeedback(true);
        return;
      }
      const message = compileReviewFeedback(annotations);
      if (!message) {
        store.notify({
          kind: "error",
          message: "Add text to a review comment before delivery",
        });
        return;
      }
      const deliverySession = annotationSessionRef.current;
      setAnnotationDeliveryBusy(true);
      try {
        const request = terminalPasteRequest(target.pane_id, message);
        await connectionClient.call(request.method, request.params);
        if (!connectionClient.isCurrent()) return;
        const draftActive =
          deliverySession !== null &&
          annotationSessionRef.current === deliverySession;
        if (draftActive) {
          setDeliveredPaneId(target.pane_id);
          commitAnnotations((current) =>
            removeDeliveredReviewAnnotations(current, annotations),
          );
        }
        store.notify({
          kind: "success",
          message: "Feedback pre-filled in the agent pane",
          detail: draftActive
            ? "Review the message there, then press Enter to submit it."
            : "Original draft retained because its workspace was left or unloaded, or its connection changed. Review the message in the agent pane, then press Enter.",
          autoDismissMs: 6000,
        });
      } catch (error) {
        if (!connectionClient.isCurrent()) return;
        store.notify({
          kind: "error",
          message: "Failed to pre-fill review feedback",
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (annotationSessionRef.current === deliverySession)
          setAnnotationDeliveryBusy(false);
      }
    },
    [
      annotationAgentPanes,
      annotationSessionRef,
      annotations,
      commitAnnotations,
      connectionClient,
      copyFeedback,
    ],
  );
  const goToDeliveredAgent = useCallback(() => {
    if (!deliveredPaneId || !connectionClient.isCurrent()) return;
    const pane = store
      .get()
      .panes.find((candidate) => candidate.pane_id === deliveredPaneId);
    if (!pane || pane.workspace_id !== annotationWorkspace?.workspace_id)
      return;
    activateTerminalSurface();
    void store.focusPane(deliveredPaneId);
  }, [
    activateTerminalSurface,
    annotationWorkspace?.workspace_id,
    connectionClient,
    deliveredPaneId,
  ]);
  const openFileExplorer = useCallback(
    (workspaceId?: string, focusInspector = true) =>
      openInspector("files", workspaceId, { focusInspector }),
    [openInspector],
  );
  const openFileExplorerFile = useCallback(
    (
      workspaceId: string,
      entry: FileExplorerEntry,
      originPaneId?: string,
      fragment?: string,
    ) =>
      openInspector("files", workspaceId, {
        entry,
        path: entry.path,
        originPaneId,
        fragment,
      }),
    [openInspector],
  );
  const openDiffViewer = useCallback(
    (workspaceId?: string, focusInspector = true) =>
      openInspector("changes", workspaceId, { focusInspector }),
    [openInspector],
  );
  const closeInspector = useCallback(() => {
    const current = inspectorStateRef.current;
    if (!current) return;
    const returnFocus = inspectorReturnFocusRef.current;
    inspectorReturnFocusRef.current = null;
    commitInspectorState({ ...current, open: false });
    setMobileView("session");
    const snapshot = store.get();
    const returnTab = current.returnTabId
      ? snapshot.tabs.find((tab) => tab.tab_id === current.returnTabId)
      : undefined;
    const workspace = resolveWorkspaceForScope(
      current.scope,
      snapshot.workspaces,
    );
    const tabId = returnTab?.tab_id ?? workspace?.active_tab_id;
    const restoreControlFocus = () => {
      if (!returnFocus?.isConnected) return;
      requestAnimationFrame(() => returnFocus.focus());
    };
    if (tabId) {
      void Promise.resolve(store.focusTab(tabId)).finally(restoreControlFocus);
    } else {
      restoreControlFocus();
    }
  }, [commitInspectorState]);
  const setAgentHistoryInspectorOpen = useCallback(
    (open: boolean, pane?: Pane) => {
      const current = inspectorStateRef.current;
      if (!open) {
        if (current?.open && current.view === "history") closeInspector();
        return;
      }
      const snapshot = store.get();
      const paneId = pane?.pane_id ?? activePaneIdForSnapshot(snapshot);
      const targetPane = paneId
        ? snapshot.panes.find((candidate) => candidate.pane_id === paneId)
        : undefined;
      if (
        !paneHasAgentHistory(targetPane) ||
        !snapshot.workspaces.some(
          (workspace) => workspace.workspace_id === targetPane.workspace_id,
        )
      ) {
        store.notify({
          kind: "error",
          message: "Cannot open History",
          detail: "Select an active agent pane first.",
        });
        return;
      }
      openInspector("history", targetPane.workspace_id, {
        originPaneId: targetPane.pane_id,
      });
    },
    [closeInspector, openInspector],
  );
  const toggleWorkspaceInspector = useCallback(() => {
    const current = inspectorStateRef.current;
    if (current?.open) {
      closeInspector();
      return;
    }
    const snapshot = store.get();
    const workspace = snapshot.workspaces.find(
      (candidate) => candidate.focused,
    );
    if (!workspace) return;
    const scope = resourceScopeForWorkspace(
      connectionClient.connectionId,
      workspace,
    );
    const sameOwner = !!current && sameResourceOwner(current.scope, scope);
    const view = sameOwner
      ? current.view
      : readInspectorPreferences(worldLocalStorage, scope).view;
    const historyPaneId =
      sameOwner && current.originPaneId
        ? current.originPaneId
        : activePaneIdForSnapshot(snapshot);
    const historyPane = historyPaneId
      ? snapshot.panes.find((pane) => pane.pane_id === historyPaneId)
      : undefined;
    if (
      view === "history" &&
      (!paneHasAgentHistory(historyPane) ||
        historyPane?.workspace_id !== workspace.workspace_id)
    ) {
      openInspector("files", workspace.workspace_id);
      return;
    }
    openInspector(view, workspace.workspace_id, {
      originPaneId: view === "history" ? historyPane?.pane_id : undefined,
    });
  }, [closeInspector, connectionClient.connectionId, openInspector]);
  const setInspectorExpanded = useCallback(
    (expanded: boolean) => {
      const current = inspectorStateRef.current;
      if (!current) return;
      const next = { ...current, expanded };
      if (inspectorFocusRequestRef.current?.state === current)
        inspectorFocusRequestRef.current.state = next;
      commitInspectorState(next);
      writeInspectorPreferences(worldLocalStorage, next);
    },
    [commitInspectorState],
  );
  const keepInspectorForWorkspace = useCallback(
    (workspaceId: string, originPane?: Pane) => {
      const current = inspectorStateRef.current;
      if (!current?.open) {
        activateTerminalSurface();
        return;
      }
      const snapshot = store.get();
      const explicitPane = originPane
        ? snapshot.panes.find(
            (candidate) => candidate.pane_id === originPane.pane_id,
          )
        : undefined;
      const activePaneId = activePaneIdForSnapshot(snapshot);
      const workspacePanes = snapshot.panes.filter(
        (pane) => pane.workspace_id === workspaceId,
      );
      const routedPane =
        explicitPane ??
        workspacePanes.find((pane) => pane.pane_id === activePaneId) ??
        workspacePanes.find((pane) => pane.focused);
      const historyPane = paneHasAgentHistory(routedPane)
        ? routedPane
        : workspacePanes.find(paneHasAgentHistory);
      const view =
        current.view === "history" && !historyPane ? "files" : current.view;
      openInspector(view, workspaceId, {
        focusInspector: false,
        originPaneId:
          explicitPane?.pane_id ??
          (view === "history" ? historyPane?.pane_id : undefined),
      });
    },
    [activateTerminalSurface, openInspector],
  );
  const toggleFileExplorer = useCallback(() => {
    const snapshot = store.get();
    const workspace = snapshot.workspaces.find(
      (candidate) => candidate.focused,
    );
    if (!workspace) return;
    const scope = resourceScopeForWorkspace(
      connectionClient.connectionId,
      workspace,
    );
    const current = inspectorStateRef.current;
    if (
      current?.open &&
      current.view === "files" &&
      sameResourceOwner(current.scope, scope)
    ) {
      closeInspector();
      return;
    }
    openFileExplorer(workspace.workspace_id, false);
  }, [closeInspector, connectionClient.connectionId, openFileExplorer]);
  const toggleDiffViewer = useCallback(() => {
    const snapshot = store.get();
    const workspace = snapshot.workspaces.find(
      (candidate) => candidate.focused,
    );
    if (!workspace) return;
    const scope = resourceScopeForWorkspace(
      connectionClient.connectionId,
      workspace,
    );
    const current = inspectorStateRef.current;
    if (
      current?.open &&
      current.view === "changes" &&
      sameResourceOwner(current.scope, scope)
    ) {
      closeInspector();
      return;
    }
    openDiffViewer(workspace.workspace_id, false);
  }, [closeInspector, connectionClient.connectionId, openDiffViewer]);
  const handleDiffSelectionChange = useCallback(
    (stateKey: string, selection: ActiveDiffSelection) => {
      const current = inspectorStateRef.current;
      if (!current || resourceStateKey(current.scope) !== stateKey) return;
      setActiveDiff(selection);
    },
    [],
  );
  const handleFilePreviewChange = useCallback(
    (stateKey: string, selection: ActiveFilePreviewSelection) => {
      const current = inspectorStateRef.current;
      if (!current || resourceStateKey(current.scope) !== stateKey) return;
      setActiveFilePreview(selection);
    },
    [],
  );
  const openDiffFileInExplorer = useCallback(
    (entry: ActiveDiffSelection["entry"]) => {
      const current = inspectorStateRef.current;
      if (!entry || !current) return;
      const workspace = resolveWorkspaceForScope(
        current.scope,
        store.get().workspaces,
      );
      if (!workspace) return;
      const name = entry.path.split("/").filter(Boolean).pop() ?? entry.path;
      openFileExplorerFile(workspace.workspace_id, {
        name,
        path: entry.path,
        type: "file",
        size: 0,
        mtime_ms: 0,
        hidden: name.startsWith("."),
      });
    },
    [openFileExplorerFile],
  );
  const browseFilesForPane = useCallback(
    (pane: Pane) => {
      const workspace = store
        .get()
        .workspaces.find(
          (candidate) => candidate.workspace_id === pane.workspace_id,
        );
      if (!workspace) return;
      const root = workspace.worktree?.checkout_path ?? workspace.cwd;
      const initialDirectory = root
        ? relativePathWithinCheckout(root, pane.foreground_cwd ?? pane.cwd)
        : undefined;
      openInspector("files", workspace.workspace_id, {
        originPaneId: pane.pane_id,
        initialDirectory,
      });
    },
    [openInspector],
  );
  const reviewChangesForPane = useCallback(
    (pane: Pane) =>
      openInspector("changes", pane.workspace_id, {
        originPaneId: pane.pane_id,
      }),
    [openInspector],
  );
  const handleTerminalWorkspaceFile = useCallback(
    (request: TerminalWorkspaceFileRequest) => {
      if (
        request.connectionId !== connectionClient.connectionId ||
        request.connectionGeneration !== connectionClient.generation ||
        !connectionClient.isCurrent()
      ) {
        return;
      }
      const name =
        request.path.split("/").filter(Boolean).pop() ?? request.path;
      openFileExplorerFile(
        request.workspaceId,
        {
          name,
          path: request.path,
          type: "file",
          size: 0,
          mtime_ms: 0,
          hidden: name.startsWith("."),
        },
        request.paneId,
      );
    },
    [connectionClient, openFileExplorerFile],
  );
  const openNotificationTarget = useCallback(
    (target: TaskNotificationTarget) => {
      if (!inspectorStateRef.current?.open) activateTerminalSurface();
      setSidebarHidden(false);
      void store.focusTaskNotificationTarget(target);
    },
    [activateTerminalSurface],
  );
  const handleNoticeAction = useCallback(
    (notice: Notice) => {
      if (notice.actionClipboardText !== undefined) {
        const text = notice.actionClipboardText;
        store.clearNotice();
        void copyTextFromUserGesture(text).then(
          () =>
            store.notify({
              kind: "success",
              message: "Copied to clipboard",
              autoDismissMs: 5000,
            }),
          (error) =>
            store.notify({
              kind: "error",
              message: "Terminal copy failed",
              detail: error instanceof Error ? error.message : String(error),
            }),
        );
        return;
      }
      const target = taskNotificationTargetFromNotice(notice);
      store.clearNotice();
      if (target) openNotificationTarget(target);
    },
    [openNotificationTarget],
  );
  useEffect(() => {
    const handleSystemNotification = (event: Event) => {
      const target = (event as CustomEvent<unknown>).detail;
      if (!isTaskNotificationTarget(target)) return;
      openNotificationTarget(target);
      const notice = store.get().notice;
      if (
        notice?.actionConnectionId === target.connectionId &&
        notice.actionRuntimeGeneration === target.runtimeGeneration &&
        notice.actionPaneId === target.paneId
      ) {
        store.clearNotice();
      }
    };
    window.addEventListener(
      TASK_NOTIFICATION_ACTIVATE_EVENT,
      handleSystemNotification,
    );
    return () =>
      window.removeEventListener(
        TASK_NOTIFICATION_ACTIVATE_EVENT,
        handleSystemNotification,
      );
  }, [openNotificationTarget]);
  useEffect(() => {
    const handleInspectorRequest = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceInspectorRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== connectionClient.connectionId ||
        detail.generation !== connectionClient.generation ||
        !connectionClient.isCurrent()
      ) {
        return;
      }
      const workspace = store
        .get()
        .workspaces.find(
          (candidate) => candidate.workspace_id === detail.workspaceId,
        );
      if (!workspace) {
        pendingInspectorRequestRef.current = detail;
        return;
      }
      pendingInspectorRequestRef.current = null;
      openInspector(detail.view, detail.workspaceId, {
        originPaneId: detail.originPaneId,
        availableViews: detail.availableViews,
      });
    };
    window.addEventListener(
      WORKSPACE_INSPECTOR_REQUEST_EVENT,
      handleInspectorRequest,
    );
    return () =>
      window.removeEventListener(
        WORKSPACE_INSPECTOR_REQUEST_EVENT,
        handleInspectorRequest,
      );
  }, [connectionClient, openInspector]);
  useEffect(() => {
    const handleInspectorClose = () => closeInspector();
    window.addEventListener(
      WORKSPACE_INSPECTOR_CLOSE_EVENT,
      handleInspectorClose,
    );
    return () =>
      window.removeEventListener(
        WORKSPACE_INSPECTOR_CLOSE_EVENT,
        handleInspectorClose,
      );
  }, [closeInspector]);
  useEffect(() => {
    onInspectorVisibilityChange?.(inspectorState?.open === true);
  }, [inspectorState?.open, onInspectorVisibilityChange]);
  useEffect(() => {
    const handleAnnotationRequest = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceAnnotationRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== connectionClient.connectionId ||
        detail.generation !== connectionClient.generation ||
        !connectionClient.isCurrent()
      )
        return;
      const annotation = parseReviewAnnotation(detail.annotation);
      const workspace = store
        .get()
        .workspaces.find(
          (candidate) => candidate.workspace_id === detail.workspaceId,
        );
      if (
        !annotation ||
        !workspace ||
        (annotation.source === "terminal" &&
          !store
            .get()
            .panes.some(
              (pane) =>
                pane.pane_id === annotation.paneId &&
                pane.workspace_id === detail.workspaceId,
            ))
      )
        return;
      const scope = resourceScopeForWorkspace(
        connectionClient.connectionId,
        workspace,
      );
      const preferredPaneId =
        annotation.source === "terminal" ? annotation.paneId : undefined;
      setAnnotationDraftScope(scope, true, preferredPaneId);
      updateAnnotationDraft(scope, (current) =>
        current.some((item) => item.id === annotation.id)
          ? current
          : [...current, annotation],
      );
      setFocusedAnnotationId(annotation.id);
      annotationAwaitingFocusRef.current = workspace.focused ? null : scope;
      if (!workspace.focused) void store.focusWorkspace(workspace.workspace_id);
      if (mobile) setMobileView("annotations");
    };
    window.addEventListener(
      WORKSPACE_ANNOTATION_REQUEST_EVENT,
      handleAnnotationRequest,
    );
    return () =>
      window.removeEventListener(
        WORKSPACE_ANNOTATION_REQUEST_EVENT,
        handleAnnotationRequest,
      );
  }, [
    connectionClient,
    mobile,
    setAnnotationDraftScope,
    updateAnnotationDraft,
  ]);
  useEffect(() => {
    const pending = pendingInspectorRequestRef.current;
    if (!pending) return;
    if (
      pending.connectionId !== connectionClient.connectionId ||
      pending.generation !== connectionClient.generation
    ) {
      pendingInspectorRequestRef.current = null;
      return;
    }
    if (
      !s.workspaces.some(
        (workspace) => workspace.workspace_id === pending.workspaceId,
      )
    ) {
      return;
    }
    pendingInspectorRequestRef.current = null;
    openInspector(pending.view, pending.workspaceId, {
      originPaneId: pending.originPaneId,
      availableViews: pending.availableViews,
    });
  }, [connectionClient, openInspector, s.workspaces]);
  useEffect(() => {
    const handleWorktreeRemoved = (event: Event) => {
      const detail = (event as CustomEvent<WorktreeRemovedTarget>).detail;
      if (
        !detail ||
        detail.connectionId !== connectionClient.connectionId ||
        detail.generation !== connectionClient.generation ||
        !connectionClient.isCurrent()
      ) {
        return;
      }
      const scope = resourceScopeForWorkspace(
        detail.connectionId,
        detail.workspace,
      );
      const resourceKey = resourceOwnerKey(scope);
      clearFileExplorerResourceCache(
        connectionClient,
        resourceKey,
        worldLocalStorage,
      );
      clearDiffContentResourceState(resourceStateKey(scope));
      clearDiffViewerResourceCache(
        connectionClient,
        resourceKey,
        worldLocalStorage,
      );
      writeResourceFileSelection(worldLocalStorage, scope, null);
      const current = inspectorStateRef.current;
      if (!current || !sameResourceOwner(current.scope, scope)) return;
      fileQuickOpenRequestRef.current += 1;
      inspectorReturnFocusRef.current = null;
      commitInspectorState(null);
      setActiveDiff(emptyActiveDiffSelection());
      setActiveFilePreview(emptyActiveFilePreviewSelection());
      setMobileView("session");
    };
    window.addEventListener(WORKTREE_REMOVED_EVENT, handleWorktreeRemoved);
    return () =>
      window.removeEventListener(WORKTREE_REMOVED_EVENT, handleWorktreeRemoved);
  }, [commitInspectorState, connectionClient]);
  const closePaneJump = useCallback((restoreFocus = false) => {
    const target = paneJumpReturnFocusRef.current;
    const source = document.activeElement;
    paneJumpReturnFocusRef.current = null;
    paneJumpModifierRef.current = null;
    setPaneJumpSearch(null);
    setPaneJumpOpen(false);
    if (restoreFocus && target) {
      requestAnimationFrame(() => {
        if (target.isConnected) focusIfUnchanged(target, source);
      });
    }
  }, []);
  const selectPaneJumpIndex = useCallback(
    (index: number) => {
      const length = paneJumpOptions.length;
      const next = length > 0 ? ((index % length) + length) % length : 0;
      paneJumpIndexRef.current = next;
      setPaneJumpIndex(next);
    },
    [paneJumpOptions.length],
  );
  const commitPaneJump = useCallback(
    (index = paneJumpIndexRef.current) => {
      const targetPaneId = paneJumpTargetId(paneJumpOptions, index);
      closePaneJump(!targetPaneId);
      if (!targetPaneId) return;
      if (!inspectorStateRef.current?.open) setMobileView("session");
      void store.focusPane(targetPaneId);
    },
    [closePaneJump, paneJumpOptions],
  );
  const movePaneJumpSelection = useCallback(
    (delta: number) => {
      selectPaneJumpIndex(paneJumpIndexRef.current + delta);
    },
    [selectPaneJumpIndex],
  );
  const defaultPaneJumpIndex = useCallback(() => {
    const previousPaneIndex = paneJumpOptions.findIndex(
      (entry) => !entry.current,
    );
    return previousPaneIndex >= 0 ? previousPaneIndex : 0;
  }, [paneJumpOptions]);
  // Typed search drops the held modifier: releasing it must keep the list open
  // instead of committing the recent switcher.
  const openPaneJumpSearch = useCallback(() => {
    if (store.get().panes.length === 0) return;
    paneJumpReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    paneJumpModifierRef.current = null;
    paneJumpIndexRef.current = 0;
    setPaneJumpIndex(0);
    setPaneJumpSearch("");
    setPaneJumpOpen(true);
  }, []);
  const changePaneJumpSearch = useCallback((value: string) => {
    paneJumpIndexRef.current = 0;
    setPaneJumpIndex(0);
    setPaneJumpSearch(value);
  }, []);

  useLayoutEffect(() => {
    if (resourceRuntimeKeyRef.current === resourceUiKey) return;
    resourceRuntimeKeyRef.current = resourceUiKey;
    fileQuickOpenRequestRef.current += 1;
    pendingInspectorRequestRef.current = null;
    inspectorReturnFocusRef.current = null;
    commitInspectorState(null);
    setActiveDiff(emptyActiveDiffSelection());
    setActiveFilePreview(emptyActiveFilePreviewSelection());
    annotationAwaitingFocusRef.current = null;
    setAnnotationPreferredPaneId(undefined);
    setAnnotationDeliveryBusy(false);
    setDeliveredPaneId(null);
    setAnnotationsOpen(false);
    setFocusedAnnotationId(null);
    paneJumpReturnFocusRef.current = null;
    setPaneJumpOpen(false);
    setPaneJumpIndex(0);
    setPaneJumpSearch(null);
    setMobileView("session");
  }, [commitInspectorState, resourceUiKey]);

  useEffect(() => {
    store.init();
  }, []);
  useEffect(() => {
    if (mobile && mobileView === "annotations")
      setMobileControlsCollapsed(false);
  }, [mobile, mobileView]);
  useEffect(() => {
    if (!mobile) return;
    const current = inspectorStateRef.current;
    if (!annotationsOpen)
      setMobileView(current?.open ? current.view : "session");
  }, [annotationsOpen, mobile]);
  useLayoutEffect(() => {
    if (!annotationScope || annotationWorkspace) return;
    selectAnnotationDraft(null);
    annotationAwaitingFocusRef.current = null;
    setAnnotationsOpen(false);
    setFocusedAnnotationId(null);
    setAnnotationPreferredPaneId(undefined);
    setDeliveredPaneId(null);
    setAnnotationDeliveryBusy(false);
    if (mobileView === "annotations") setMobileView("session");
  }, [annotationScope, annotationWorkspace, mobileView, selectAnnotationDraft]);
  useEffect(() => {
    if (!focusedWorkspace) return;
    const scope = resourceScopeForWorkspace(
      connectionClient.connectionId,
      focusedWorkspace,
    );
    const pending = annotationAwaitingFocusRef.current;
    if (
      pending &&
      (pending.workspaceId !== scope.workspaceId ||
        !sameResourceOwner(pending, scope)) &&
      s.pendingFocusWorkspaceId === pending.workspaceId
    )
      return;
    annotationAwaitingFocusRef.current = null;
    const current = annotationScopeRef.current;
    const sameOwner = current && sameResourceOwner(current, scope);
    if (sameOwner && current.workspaceId === scope.workspaceId) return;
    setAnnotationDraftScope(scope, !!sameOwner && annotationsOpen);
  }, [
    annotationsOpen,
    annotationScopeRef,
    connectionClient.connectionId,
    focusedWorkspace,
    s.pendingFocusWorkspaceId,
    resourceUiKey,
    setAnnotationDraftScope,
  ]);
  useEffect(() => {
    if (!annotationScope || !annotationWorkspace) return;
    commitAnnotations((current) =>
      current.map((annotation) => {
        if (annotation.source !== "terminal") return annotation;
        const stale = !s.panes.some(
          (pane) => pane.pane_id === annotation.paneId,
        );
        return stale === !!annotation.stale
          ? annotation
          : { ...annotation, stale };
      }),
    );
  }, [annotationScope, annotationWorkspace, commitAnnotations, s.panes]);
  useLayoutEffect(() => {
    const current = inspectorStateRef.current;
    if (!current?.open || !focusedWorkspace || s.pendingFocusWorkspaceId) {
      return;
    }
    const routedWorkspace = resolveWorkspaceForScope(
      current.scope,
      s.workspaces,
    );
    if (routedWorkspace?.workspace_id === focusedWorkspace.workspace_id) return;
    keepInspectorForWorkspace(focusedWorkspace.workspace_id);
  }, [
    focusedWorkspace,
    keepInspectorForWorkspace,
    s.pendingFocusWorkspaceId,
    s.workspaces,
  ]);
  // The Spaces Inspector is one workspace resource surface. Its pane context
  // follows the active tab, including sibling focus inside a split.
  useLayoutEffect(() => {
    if (!operationalShortcutsEnabled || hasWorkspaceSurface) return;
    const current = inspectorStateRef.current;
    const workspace = current?.open
      ? resolveWorkspaceForScope(current.scope, s.workspaces)
      : undefined;
    if (!current?.open || !workspace || s.pendingFocusWorkspaceId) return;
    const tabId =
      workspace.active_tab_id ??
      s.tabs.find(
        (tab) => tab.workspace_id === workspace.workspace_id && tab.focused,
      )?.tab_id;
    const tabPanes = s.panes.filter(
      (pane) =>
        pane.workspace_id === workspace.workspace_id && pane.tab_id === tabId,
    );
    const layoutFocusedPaneId =
      s.layout?.tab_id === tabId ? s.layout?.focused_pane_id : null;
    const pane =
      tabPanes.find((candidate) => candidate.pane_id === s.selectedPaneId) ??
      tabPanes.find((candidate) => candidate.pane_id === layoutFocusedPaneId) ??
      tabPanes.find((candidate) => candidate.focused) ??
      tabPanes[0];
    if (!pane || pane.pane_id === current.originPaneId) return;
    commitInspectorState({ ...current, originPaneId: pane.pane_id });
  }, [
    commitInspectorState,
    hasWorkspaceSurface,
    operationalShortcutsEnabled,
    s,
  ]);
  // Search keeps the current pane listed for context, but focusing it is a
  // no-op, so selection lands on the first entry a jump can actually reach.
  useEffect(() => {
    if (!paneJumpOpen || paneJumpSearch === null) return;
    if (!paneJumpOptions[paneJumpIndexRef.current]?.current) return;
    const target = paneJumpOptions.findIndex((entry) => !entry.current);
    if (target >= 0) selectPaneJumpIndex(target);
  }, [paneJumpOpen, paneJumpOptions, paneJumpSearch, selectPaneJumpIndex]);
  useEffect(() => {
    if (paneJumpOpen && paneJumpSearch === null && paneJumpOptions.length === 0)
      closePaneJump();
    if (paneJumpIndexRef.current >= paneJumpOptions.length) {
      selectPaneJumpIndex(paneJumpOptions.length - 1);
    }
  }, [
    closePaneJump,
    paneJumpOpen,
    paneJumpOptions.length,
    paneJumpSearch,
    selectPaneJumpIndex,
  ]);
  useLayoutEffect(() => {
    const current = inspectorStateRef.current;
    if (!current) return;
    const workspace = resolveWorkspaceForScope(current.scope, s.workspaces);
    if (!workspace) {
      if (s.status === "connected" && s.lastRefresh > 0) {
        fileQuickOpenRequestRef.current += 1;
        inspectorReturnFocusRef.current = null;
        commitInspectorState(null);
        setActiveDiff(emptyActiveDiffSelection());
        setActiveFilePreview(emptyActiveFilePreviewSelection());
        setMobileView("session");
      }
      return;
    }
    if (workspace.workspace_id === current.scope.workspaceId) return;
    const scope = resourceScopeForWorkspace(
      connectionClient.connectionId,
      workspace,
    );
    commitInspectorState({ ...current, scope });
    if (current.view === "files" && activeFilePreview.entry) {
      loadInspectorFilePreview(workspace.workspace_id, activeFilePreview.entry);
    }
  }, [
    activeFilePreview.entry,
    commitInspectorState,
    connectionClient,
    loadInspectorFilePreview,
    s.lastRefresh,
    s.status,
    s.workspaces,
  ]);
  useEffect(() => {
    const current = inspectorStateRef.current;
    if (!current || !activeFilePreview.entry?.path) return;
    writeResourceFileSelection(
      worldLocalStorage,
      current.scope,
      activeFilePreview.entry.path,
    );
  }, [activeFilePreview.entry?.path, inspectorResourceStateKey]);
  useEffect(() => {
    if (!focusedWorkspace) return;
    const scope = resourceScopeForWorkspace(
      connectionClient.connectionId,
      focusedWorkspace,
    );
    const resourceKey = resourceOwnerKey(scope);
    if (
      !inspectorState?.open ||
      !sameResourceOwner(inspectorState.scope, scope)
    ) {
      void prefetchFileExplorerWorkspace(
        focusedWorkspace.workspace_id,
        connectionClient,
        resourceKey,
      );
    }
    if (
      !inspectorState?.open ||
      !sameResourceOwner(inspectorState.scope, scope)
    ) {
      void prefetchDiffViewerWorkspace(
        focusedWorkspace.workspace_id,
        connectionClient,
        resourceKey,
      );
    }
  }, [connectionClient, focusedWorkspace, inspectorState]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (!appShouldHandleGlobalShortcut(operationalShortcutsEnabled, e))
        return;
      if (
        document.querySelector(
          ".modal-backdrop, .command-popover, .context-menu",
        ) ||
        document.getElementById(CONFIG_MENU_ID)
      )
        return;
      if (paneJumpOpen) {
        const paneJumpNavigationKey =
          e.key === "Tab" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowUp" ||
          e.key === "Enter" ||
          e.key === "Escape";
        const paneJumpSearchShortcut = shortcutMatches(e, "panes.search");
        if (paneJumpSearch !== null) {
          if (paneJumpSearchShortcut || paneJumpNavigationKey) {
            e.preventDefault();
            e.stopPropagation();
            if (paneJumpSearchShortcut && e.repeat) return;
            if (paneJumpSearchShortcut || e.key === "Escape")
              closePaneJump(true);
            else if (e.key === "Tab")
              movePaneJumpSelection(e.shiftKey ? -1 : 1);
            else if (e.key === "ArrowDown") movePaneJumpSelection(1);
            else if (e.key === "ArrowUp") movePaneJumpSelection(-1);
            else commitPaneJump();
          }
          return;
        }
        if (
          paneJumpSearchShortcut ||
          e.code === "KeyK" ||
          e.key.toLowerCase() === "k"
        ) {
          e.preventDefault();
          e.stopPropagation();
          openPaneJumpSearch();
          return;
        }
        if (paneJumpNavigationKey) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Tab") {
            movePaneJumpSelection(e.shiftKey ? -1 : 1);
          } else if (e.key === "ArrowDown") {
            movePaneJumpSelection(1);
          } else if (e.key === "ArrowUp") {
            movePaneJumpSelection(-1);
          } else if (e.key === "Enter") {
            commitPaneJump();
          } else if (e.key === "Escape") {
            closePaneJump();
          }
          return;
        }
        if (
          !["Control", "Shift", "Alt", "Meta"].includes(e.key) &&
          !shortcutMatches(e, "panes.recent")
        ) {
          closePaneJump();
        }
      }
      const paneJumpShortcut = shortcutMatches(e, "panes.recent");
      if (paneJumpShortcut) {
        if (isEditableElement(e.target)) return;
        if (paneJumpOptions.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (!paneJumpOpen && !e.repeat) {
          paneJumpModifierRef.current = e.ctrlKey
            ? "ctrlKey"
            : e.altKey
              ? "altKey"
              : e.metaKey
                ? "metaKey"
                : null;
          selectPaneJumpIndex(defaultPaneJumpIndex());
          setPaneJumpOpen(true);
        } else if (paneJumpOpen) {
          movePaneJumpSelection(e.shiftKey ? -1 : 1);
        }
        return;
      }
      if (e.key === "Escape") {
        if (
          document.getElementById(CONFIG_MENU_ID) ||
          document.querySelector(
            ".context-menu, .command-popover, .modal-backdrop",
          )
        ) {
          return;
        }
        const current = store.get();
        const canDismissUpdate =
          current.updateInfo?.update_available && !current.updateInstalling;
        if (current.notice || canDismissUpdate) {
          e.preventDefault();
          e.stopPropagation();
          if (current.notice) store.clearNotice();
          if (canDismissUpdate) store.dismissUpdate();
          return;
        }
        return;
      }
      if (shortcutMatches(e, "panes.search")) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        openPaneJumpSearch();
        return;
      }
      const tabAction = tabShortcutAction(e);
      if (tabAction) {
        e.preventDefault();
        e.stopPropagation();
        if (
          isEditableElement(e.target) ||
          document.querySelector(".modal-backdrop")
        ) {
          return;
        }
        if (e.repeat && (tabAction === "create" || tabAction === "close")) {
          return;
        }

        const current = store.get();
        const focusedWorkspace = current.workspaces.find(
          (workspace) => workspace.focused,
        );
        if (!focusedWorkspace) return;
        if (tabAction === "create") {
          void store.createTab(focusedWorkspace.workspace_id, {
            numberedLabel: true,
          });
          return;
        }

        const tabs = current.tabs
          .filter((tab) => tab.workspace_id === focusedWorkspace.workspace_id)
          .sort((a, b) => a.number - b.number);
        const tabIds = new Set(tabs.map((tab) => tab.tab_id));
        const activeTabId = [
          focusedWorkspace.active_tab_id,
          current.layout?.tab_id,
          tabs.find((tab) => tab.focused)?.tab_id,
        ].find((tabId): tabId is string => !!tabId && tabIds.has(tabId));
        if (tabAction === "close") {
          const target = closeShortcutTarget(
            activeTabId,
            current.panes,
            activePaneIdForSnapshot(current),
          );
          if (target?.type === "pane") requestClosePane(target.id);
          else if (target?.type === "tab") requestCloseTab(target.id);
          return;
        }

        const targetTabId = adjacentTabId(tabs, activeTabId, tabAction);
        if (!targetTabId || targetTabId === activeTabId) return;
        store.focusTab(targetTabId);
        return;
      }
      const pluginAction = pluginActionShortcut(e);
      if (pluginAction) {
        e.preventDefault();
        e.stopPropagation();
        // Typing into the popup's own terminal never reaches here, since
        // isEditableElement stops at the xterm textarea.
        if (
          isEditableElement(e.target) ||
          document.querySelector(".modal-backdrop")
        ) {
          return;
        }
        if (e.repeat) return;
        const current = store.get();
        const layoutActivePaneId = activePaneIdForSnapshot(current);
        const activePane = current.panes.find(
          (pane) => pane.pane_id === layoutActivePaneId,
        );
        // Hide-or-open is resolved against Herdr, not this client's popup
        // state, which a Space switch can leave stale. See togglePluginPopup.
        void store.togglePluginPopup(
          pluginAction.pluginId,
          pluginAction.actionId,
          {
            workspace_id: activePane?.workspace_id,
            focused_pane_cwd: activePane?.foreground_cwd ?? activePane?.cwd,
          },
        );
        return;
      }
      const paneAction = paneShortcutAction(e);
      if (paneAction) {
        e.preventDefault();
        e.stopPropagation();
        if (
          isEditableElement(e.target) ||
          document.querySelector(".modal-backdrop")
        ) {
          return;
        }
        if (e.repeat && paneAction.type !== "focus") return;

        const current = store.get();
        const focusedWorkspace = current.workspaces.find((w) => w.focused);
        const activeTab =
          current.tabs.find(
            (tab) => tab.tab_id === focusedWorkspace?.active_tab_id,
          ) ?? current.tabs.find((tab) => tab.focused);
        // Resolve the selection only while it belongs to the visible layout,
        // then fall back to tab-local panes like the command menu does.
        const layoutActivePaneId = activePaneIdForSnapshot(current);
        const activePane =
          current.panes.find((pane) => pane.pane_id === layoutActivePaneId) ??
          current.panes.find(
            (pane) => pane.tab_id === activeTab?.tab_id && pane.focused,
          ) ??
          current.panes.find((pane) => pane.tab_id === activeTab?.tab_id);
        if (!activePane) return;
        if (paneAction.type === "split") {
          void store.splitPane(activePane.pane_id, paneAction.direction);
        } else if (paneAction.type === "zoom") {
          void store.zoomPane(activePane.pane_id);
        } else {
          void store.focusPaneDirection(
            activePane.pane_id,
            paneAction.direction,
          );
        }
        return;
      }
      const tabIndex = tabShortcutIndex(e);
      if (tabIndex !== null) {
        if (isEditableElement(e.target)) return;
        const current = store.get();
        const focusedWorkspace = current.workspaces.find((w) => w.focused);
        const tabs = current.tabs
          .filter((tab) => tab.workspace_id === focusedWorkspace?.workspace_id)
          .sort((a, b) => a.number - b.number);
        const targetTab = tabs[tabIndex];
        if (!targetTab) return;
        e.preventDefault();
        e.stopPropagation();
        store.focusTab(targetTab.tab_id);
        return;
      }
      if (isWorkspaceInspectorShortcut(e)) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        toggleWorkspaceInspector();
        return;
      }
      if (shortcutMatches(e, "inspector.expand")) {
        if (mobile || isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        const current = inspectorStateRef.current;
        if (!current?.open) toggleWorkspaceInspector();
        setInspectorExpanded(!current?.open || !current.expanded);
        return;
      }
      if (shortcutMatches(e, "annotations.toggle")) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) toggleAnnotations();
        return;
      }
      const fileExplorerShortcut = shortcutMatches(e, "files.toggle");
      if (fileExplorerShortcut) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFileExplorer();
        return;
      }
      const workspacesShortcut = shortcutMatches(e, "workspaces.open");
      if (workspacesShortcut) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        openWorkspaces();
        return;
      }
      const diffViewerShortcut = shortcutMatches(e, "diff.toggle");
      if (diffViewerShortcut) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        toggleDiffViewer();
        return;
      }
      if (shortcutMatches(e, "zen.toggle")) {
        if (isEditableElement(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        toggleZenMode();
        return;
      }
      if (!shortcutMatches(e, "sidebar.toggle") || isEditableElement(e.target))
        return;
      e.preventDefault();
      toggleSidebar();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!operationalShortcutsEnabled) return;
      const modifier = paneJumpModifierRef.current;
      if (paneJumpOpen && modifier && !e[modifier]) {
        e.preventDefault();
        e.stopPropagation();
        commitPaneJump();
      }
    };
    const onBlur = () => {
      if (paneJumpOpen) closePaneJump();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onBlur);
    };
  }, [
    closePaneJump,
    commitPaneJump,
    defaultPaneJumpIndex,
    movePaneJumpSelection,
    mobile,
    openPaneJumpSearch,
    openWorkspaces,
    operationalShortcutsEnabled,
    paneJumpOpen,
    paneJumpOptions.length,
    paneJumpSearch,
    selectPaneJumpIndex,
    setInspectorExpanded,
    toggleAnnotations,
    toggleDiffViewer,
    toggleFileExplorer,
    toggleSidebar,
    toggleWorkspaceInspector,
    toggleZenMode,
  ]);
  useEffect(() => {
    const media = window.matchMedia(SYSTEM_THEME_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(resolveSystemTheme(event));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    worldLocalStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.accent = accentColor;
    worldLocalStorage.setItem(ACCENT_COLOR_KEY, accentColor);
    document.documentElement.style.zoom =
      uiScale === UI_SCALE_DEFAULT ? "" : String(uiScale / 100);
    if (uiScale === UI_SCALE_DEFAULT) {
      document.documentElement.style.removeProperty("--ui-scale");
      document.documentElement.style.removeProperty(
        "--config-sheet-max-height",
      );
      document.documentElement.style.removeProperty(
        "--config-sheet-expanded-max-height",
      );
    } else {
      const scale = uiScale / 100;
      document.documentElement.style.setProperty("--ui-scale", String(scale));
      document.documentElement.style.setProperty(
        "--config-sheet-max-height",
        `min(calc(78dvh / ${scale}), calc(640px / ${scale}))`,
      );
      document.documentElement.style.setProperty(
        "--config-sheet-expanded-max-height",
        `calc(90dvh / ${scale})`,
      );
    }
    // Radix positions popovers using getBoundingClientRect. Some engines
    // return pre-zoom layout px instead of visual viewport px under CSS
    // zoom, which breaks the static 1/zoom portal compensation. Measure the
    // actual ratio and compensate with it so anchoring works either way.
    const zoomProbe = document.createElement("div");
    zoomProbe.style.cssText =
      "position:fixed;top:100px;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden";
    document.body.append(zoomProbe);
    const zoomRectRatio = zoomProbe.getBoundingClientRect().top / 100;
    zoomProbe.remove();
    if (zoomRectRatio > 0) {
      document.documentElement.style.setProperty(
        "--popover-portal-zoom",
        String(1 / zoomRectRatio),
      );
      document.documentElement.style.setProperty(
        "--popover-content-zoom",
        String(zoomRectRatio),
      );
    } else {
      document.documentElement.style.removeProperty("--popover-portal-zoom");
      document.documentElement.style.removeProperty("--popover-content-zoom");
    }
    worldLocalStorage.setItem(UI_SCALE_KEY, String(uiScale));
  }, [accentColor, resolvedTheme, theme, uiScale]);
  useEffect(() => {
    worldLocalStorage.setItem(
      TERMINAL_FONT_SCALE_KEY,
      String(terminalFontScale),
    );
  }, [terminalFontScale]);
  useEffect(() => {
    worldLocalStorage.setItem(ZEN_MODE_KEY, serializeZenMode(zenMode));
  }, [zenMode]);
  useEffect(() => {
    worldLocalStorage.setItem(
      MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
      serializeMobileTerminalShortcutRows(mobileTerminalShortcuts),
    );
  }, [mobileTerminalShortcuts]);
  useEffect(() => {
    worldLocalStorage.setItem(
      MOBILE_TERMINAL_SIDE_SHORTCUTS_STORAGE_KEY,
      serializeMobileTerminalSideShortcuts(mobileTerminalSideShortcuts),
    );
  }, [mobileTerminalSideShortcuts]);
  useEffect(() => {
    worldLocalStorage.setItem(
      TERMINAL_THEME_SELECTION_STORAGE_KEY,
      serializeTerminalThemeSelection(terminalThemeSelection),
    );
  }, [terminalThemeSelection]);
  useEffect(() => {
    worldLocalStorage.setItem(
      CUSTOM_TERMINAL_THEMES_STORAGE_KEY,
      serializeCustomTerminalThemes(customTerminalThemes),
    );
  }, [customTerminalThemes]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY) {
        setMobileTerminalShortcuts(
          parseMobileTerminalShortcutRows(event.newValue),
        );
      } else if (event.key === MOBILE_TERMINAL_SIDE_SHORTCUTS_STORAGE_KEY) {
        setMobileTerminalSideShortcuts(
          parseMobileTerminalSideShortcuts(event.newValue),
        );
      } else if (event.key === TERMINAL_THEME_SELECTION_STORAGE_KEY) {
        setTerminalThemeSelection(parseTerminalThemeSelection(event.newValue));
      } else if (event.key === CUSTOM_TERMINAL_THEMES_STORAGE_KEY) {
        setCustomTerminalThemes(parseCustomTerminalThemes(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const notice = s.notice;
  useEffect(() => {
    if (!notice) return;
    const dismissDelay = noticeAutoDismissDelay(notice);
    if (dismissDelay === null) return;
    const noticeId = notice.id;
    const timer = window.setTimeout(() => {
      if (store.get().notice?.id === noticeId) store.clearNotice();
    }, dismissDelay);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const normalizedWidth = normalizeSidebarWidth(sidebarWidth);
    if (normalizedWidth !== sidebarWidth) {
      setSidebarWidth(normalizedWidth);
      return;
    }
    worldLocalStorage.setItem("sidebarWidth", String(normalizedWidth));
  }, [sidebarWidth]);

  const setInspectorView = (view: InspectorView) => {
    const current = inspectorStateRef.current;
    if (!current) return;
    if (
      current.availableViews &&
      !normalizeInspectorViews(current.availableViews).includes(view)
    ) {
      return;
    }
    if (view === "history" && !paneHasAgentHistory(inspectorHistoryPane)) {
      return;
    }
    const next = {
      ...current,
      open: true,
      view,
      originPaneId:
        view === "history"
          ? inspectorHistoryPane?.pane_id
          : current.originPaneId,
    };
    commitInspectorState(next);
    writeInspectorPreferences(worldLocalStorage, next);
    onInspectorViewChange?.(view);
    if (mobile) setMobileView(view);
  };
  const setInspectorDock = (dock: InspectorDock) => {
    const current = inspectorStateRef.current;
    if (!current || current.dock === dock) return;
    const preferences = readInspectorPreferences(
      worldLocalStorage,
      current.scope,
    );
    const next = {
      ...current,
      dock,
      size: dock === "right" ? preferences.rightSize : preferences.bottomSize,
      expanded: false,
    };
    commitInspectorState(next);
    writeInspectorPreferences(worldLocalStorage, next);
  };
  const clearInspectorDetail = () => {
    const current = inspectorStateRef.current;
    if (current?.view === "files") {
      fileQuickOpenRequestRef.current += 1;
      setActiveFilePreview(emptyActiveFilePreviewSelection());
    } else {
      setActiveDiff(emptyActiveDiffSelection());
    }
  };
  const resizeInspectorWithKeyboard = (e: React.KeyboardEvent) => {
    const current = inspectorStateRef.current;
    const stage = inspectorStageRef.current;
    if (!current || !stage || current.expanded) return;
    const increase =
      current.dock === "right" ? e.key === "ArrowLeft" : e.key === "ArrowUp";
    const decrease =
      current.dock === "right" ? e.key === "ArrowRight" : e.key === "ArrowDown";
    if (!increase && !decrease) return;
    e.preventDefault();
    const bounds = stage.getBoundingClientRect();
    const minimum =
      (current.dock === "right" ? INSPECTOR_MIN_RIGHT : INSPECTOR_MIN_BOTTOM) /
      (annotationsDocked ? 2 : 1);
    const maximum = inspectorMaximumSize(
      current.dock,
      bounds.width,
      bounds.height,
      annotationsDocked,
    );
    const next = {
      ...current,
      size: Math.min(
        maximum,
        Math.max(
          minimum,
          Math.min(current.size, maximum) + (increase ? 24 : -24),
        ),
      ),
    };
    commitInspectorState(next);
    writeInspectorPreferences(worldLocalStorage, next);
  };
  const startInspectorResize = (e: React.PointerEvent) => {
    const current = inspectorStateRef.current;
    const stage = inspectorStageRef.current;
    if (!current || !stage || current.expanded) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const dock = current.dock;
    const bounds = stage.getBoundingClientRect();
    const maxSize = inspectorMaximumSize(
      dock,
      bounds.width,
      bounds.height,
      annotationsDocked,
    );
    const startSize = Math.min(current.size, maxSize);
    let finalSize = startSize;
    const onMove = (event: PointerEvent) => {
      finalSize = Math.min(
        maxSize,
        Math.max(
          (dock === "right" ? INSPECTOR_MIN_RIGHT : INSPECTOR_MIN_BOTTOM) /
            (annotationsDocked ? 2 : 1),
          startSize +
            (dock === "right"
              ? startX - event.clientX
              : startY - event.clientY),
        ),
      );
      if (inspectorResizeFrameRef.current !== null) return;
      inspectorResizeFrameRef.current = requestAnimationFrame(() => {
        inspectorResizeFrameRef.current = null;
        updateInspectorState((value) =>
          value ? { ...value, size: finalSize } : value,
        );
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (inspectorResizeFrameRef.current !== null) {
        cancelAnimationFrame(inspectorResizeFrameRef.current);
        inspectorResizeFrameRef.current = null;
      }
      const latest = inspectorStateRef.current;
      if (!latest) return;
      const next = { ...latest, size: finalSize };
      commitInspectorState(next);
      writeInspectorPreferences(worldLocalStorage, next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(
        MAX_SIDEBAR,
        Math.max(MIN_SIDEBAR, startW + (ev.clientX - startX)),
      );
      setSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const inspectorSlot = inspectorState ? (
    <div
      className={`workspace-inspector-slot ${
        inspectorState.open ? "" : "is-closed"
      }`}
      style={
        inspectorPortal || inspectorState.expanded
          ? undefined
          : inspectorState.dock === "right"
            ? { width: inspectorState.size }
            : { height: inspectorState.size }
      }
    >
      <Suspense
        fallback={<TerminalLoadingFallback label="Loading Inspector" />}
      >
        <WorkspaceInspectorHost
          key={`${resourceUiKey}:${resourceOwnerKey(inspectorState.scope)}`}
          state={inspectorState}
          onReady={finishInspectorFocus}
          annotations={readAnnotationDraft(inspectorState.scope)}
          onCreateAnnotation={addAnnotation}
          onReanchorFileAnnotations={reanchorFileAnnotations}
          onReanchorDiffAnnotations={reanchorDiffAnnotations}
          onEditAnnotation={(id) => {
            if (!connectionClient.isCurrent()) return;
            setAnnotationDraftScope(inspectorState.scope, true);
            setFocusedAnnotationId(id);
            setAnnotationsOpen(true);
            if (mobile) setMobileView("annotations");
          }}
          visible={
            inspectorPortal
              ? true
              : !mobile || mobileView === inspectorState.view
          }
          workspace={inspectorWorkspace}
          historyPane={inspectorHistoryPane}
          fileSelection={activeFilePreview}
          previewRequestRef={fileQuickOpenRequestRef}
          diffSelection={activeDiff}
          connectionClient={connectionClient}
          onFileSelectionChange={(selection) =>
            handleFilePreviewChange(
              resourceStateKey(inspectorState.scope),
              selection,
            )
          }
          onDiffSelectionChange={(selection) =>
            handleDiffSelectionChange(
              resourceStateKey(inspectorState.scope),
              selection,
            )
          }
          onRefreshFile={() => {
            if (inspectorWorkspace && activeFilePreview.entry)
              loadInspectorFilePreview(
                inspectorWorkspace.workspace_id,
                activeFilePreview.entry,
                activeFilePreview.fragment,
              );
          }}
          onOpenDiffFile={openDiffFileInExplorer}
          onOpenDocument={(path, fragment) => {
            if (inspectorWorkspace)
              openFileExplorerFile(
                inspectorWorkspace.workspace_id,
                {
                  name: path.split("/").pop() ?? path,
                  path,
                  type: "file",
                  size: 0,
                  mtime_ms: 0,
                  hidden: false,
                },
                undefined,
                fragment,
              );
          }}
          onTerminalPortalChange={setInspectorTerminalPortal}
          onTerminalPopOut={onTerminalPopOut}
          terminalDetached={Boolean(inspectorFloatingTerminal)}
          onFocusTabWindow={
            terminalPresentation === "spaces" && activeSpacesTabId
              ? () => {
                  const pane =
                    s.panes.find(
                      (candidate) =>
                        candidate.pane_id === activePaneId &&
                        candidate.tab_id === activeSpacesTabId,
                    ) ??
                    s.panes.find(
                      (candidate) =>
                        candidate.tab_id === activeSpacesTabId &&
                        candidate.focused,
                    ) ??
                    s.panes.find(
                      (candidate) => candidate.tab_id === activeSpacesTabId,
                    );
                  const source = document.activeElement;
                  onFocusSpacesTabWindow?.(
                    activeSpacesTabId,
                    pane?.pane_id ?? null,
                  );
                  if (!pane) return;
                  void store.focusPane(pane.pane_id).then(() => {
                    window.requestAnimationFrame(() => {
                      const target =
                        visibleSpacesTabWindows.find(
                          (window) => window.tabId === activeSpacesTabId,
                        )?.portal ?? inspectorStageRef.current;
                      const input =
                        target?.querySelector<HTMLElement>(
                          ".pane-layout-cell.is-active .xterm-helper-textarea, .pane-layout-single .xterm-helper-textarea, .pane-switcher-layout .xterm-helper-textarea",
                        ) ?? null;
                      focusIfUnchanged(input, source);
                    });
                  });
                }
              : undefined
          }
          onViewChange={setInspectorView}
          onDockChange={setInspectorDock}
          onExpandedChange={setInspectorExpanded}
          onClose={closeInspector}
          onBack={clearInspectorDetail}
          context={inspectorContext}
        />
      </Suspense>
    </div>
  ) : null;
  const desktopSidebarHidden = !mobile && (sidebarHidden || zenMode);
  const workspaceSurfaceMobileView =
    workspaceSurfaceInspector?.view === "terminal"
      ? "session"
      : workspaceSurfaceInspector?.view;
  const mobileNavigationView =
    mobileView === "annotations" || mobileView === "workspaces"
      ? mobileView
      : (workspaceSurfaceMobileView ?? mobileView);
  const workspaceSurfaceInspectorSupports = (view: InspectorView) =>
    workspaceSurfaceInspector?.availableViews.includes(view) ?? false;
  const selectWorkspaceSurfaceInspectorView = (view: InspectorView) => {
    if (!workspaceSurfaceInspectorSupports(view)) return false;
    setAnnotationsOpen(false);
    setMobileView("session");
    workspaceSurfaceInspector!.onViewChange(view);
    return true;
  };
  const topbar = (
    <header className={`topbar ${zenMode && !mobile ? "is-zen" : ""}`}>
      <div className="topbar-start">
        <div className="brand">
          <img
            className="logo"
            src="/herdr-world-logo.svg"
            width={24}
            height={24}
            alt=""
          />
          <span className="brand-title">Herdr World</span>
          <span className="brand-version" title={`Version ${APP_VERSION}`}>
            v{APP_VERSION}
          </span>
        </div>
        <ConnectionSwitcher />
        {primaryViewControl}
      </div>
      <div className="topbar-actions">
        <div className="topbar-command-group">
          <CommandCombobox
            key={`${resourceUiKey}:commands`}
            operationalShortcutsEnabled={operationalShortcutsEnabled}
            onOpenFileExplorer={openFileExplorer}
            onOpenFile={openFileExplorerFile}
            onOpenDiffViewer={openDiffViewer}
          />
          <ConfigMenu
            key={`${resourceUiKey}:config`}
            theme={theme}
            accentColor={accentColor}
            mobileTerminalShortcuts={mobileTerminalShortcuts}
            mobileTerminalSideShortcuts={mobileTerminalSideShortcuts}
            terminalThemeSelection={terminalThemeSelection}
            customTerminalThemes={customTerminalThemes}
            onThemeChange={setTheme}
            onAccentColorChange={setAccentColor}
            uiScale={uiScale}
            onUiScaleChange={setUiScale}
            terminalFontScale={terminalFontScale}
            onTerminalFontScaleChange={setTerminalFontScale}
            zenMode={zenMode}
            onZenModeChange={applyZenMode}
            onMobileTerminalShortcutsChange={setMobileTerminalShortcuts}
            onMobileTerminalSideShortcutsChange={setMobileTerminalSideShortcuts}
            onTerminalThemeSelectionChange={setTerminalThemeSelection}
            onCustomTerminalThemesChange={setCustomTerminalThemes}
            onOpenOfficeMetrics={() =>
              window.dispatchEvent(
                new Event(WORLD_OBSERVABILITY_SETTINGS_EVENT),
              )
            }
          />
        </div>
      </div>
    </header>
  );
  return (
    <div
      className={`app ${desktopSidebarHidden ? "sidebar-hidden" : ""} ${
        zenMode && !mobile ? "zen" : ""
      } ${mobileControlsCollapsed ? "mobile-controls-collapsed" : ""}`}
    >
      {topbarPortal ? createPortal(topbar, topbarPortal) : topbar}
      {zenMode && !mobile ? (
        <button
          type="button"
          className="zen-island"
          title={shortcutTitle("Exit Zen mode", "zen.toggle")}
          aria-label={shortcutTitle("Exit Zen mode", "zen.toggle")}
          onClick={() => applyZenMode(false)}
        >
          <Minimize2 size={13} />
          <span>Exit Zen</span>
        </button>
      ) : null}

      <nav
        className="mobile-nav"
        aria-label="Workspace view switcher"
        aria-hidden={mobileControlsCollapsed}
      >
        <button
          type="button"
          className={
            mobileNavigationView === "session" &&
            (workspaceSurfaceInspector !== null || !agentHistoryOpen)
              ? "active"
              : ""
          }
          title="Session"
          aria-label="Show terminal session"
          tabIndex={mobileControlsCollapsed ? -1 : 0}
          disabled={
            workspaceSurfaceInspector !== null &&
            !workspaceSurfaceInspectorSupports("terminal")
          }
          onClick={() => {
            if (!selectWorkspaceSurfaceInspectorView("terminal")) {
              activateTerminalSurface();
            }
          }}
        >
          <SquareTerminal size={16} />
          <span className="mobile-nav-label">Session</span>
        </button>
        <button
          type="button"
          className={mobileNavigationView === "files" ? "active" : ""}
          title={shortcutTitle("Files", "files.toggle")}
          aria-label="Show workspace files"
          tabIndex={mobileControlsCollapsed ? -1 : 0}
          disabled={
            workspaceSurfaceInspector !== null &&
            !workspaceSurfaceInspectorSupports("files")
          }
          onClick={() => {
            if (!selectWorkspaceSurfaceInspectorView("files")) {
              openFileExplorer();
            }
          }}
        >
          <FolderTree size={16} />
          <span className="mobile-nav-label">Files</span>
        </button>
        <button
          type="button"
          className={mobileNavigationView === "changes" ? "active" : ""}
          title={shortcutTitle("Changes", "diff.toggle")}
          aria-label="Show workspace changes"
          tabIndex={mobileControlsCollapsed ? -1 : 0}
          disabled={
            workspaceSurfaceInspector !== null &&
            !workspaceSurfaceInspectorSupports("changes")
          }
          onClick={() => {
            if (!selectWorkspaceSurfaceInspectorView("changes")) {
              openDiffViewer();
            }
          }}
        >
          <FileDiff size={16} />
          <span className="mobile-nav-label">Changes</span>
        </button>
        <button
          type="button"
          className={mobileNavigationView === "annotations" ? "active" : ""}
          title={shortcutTitle("Annotations", "annotations.toggle")}
          aria-label="Show review annotations"
          aria-pressed={annotationsOpen}
          tabIndex={mobileControlsCollapsed ? -1 : 0}
          onClick={toggleAnnotations}
        >
          <MessageSquareText size={16} />
          <span className="mobile-nav-label">
            {annotations.length > 0
              ? `Annotations ${annotations.length}`
              : "Annotations"}
          </span>
        </button>
        <button
          type="button"
          className={mobileNavigationView === "history" ? "active" : ""}
          title={
            workspaceSurfaceInspector
              ? workspaceSurfaceInspectorSupports("history")
                ? "History"
                : "History is unavailable for this selection"
              : activePaneHasAgent || historyInspectorOpen
                ? "History"
                : "Select an agent pane to view History"
          }
          aria-label="Show agent message history"
          aria-pressed={
            workspaceSurfaceInspector
              ? mobileNavigationView === "history"
              : historyInspectorOpen
          }
          tabIndex={mobileControlsCollapsed ? -1 : 0}
          disabled={
            workspaceSurfaceInspector
              ? !workspaceSurfaceInspectorSupports("history")
              : !activePaneHasAgent && !historyInspectorOpen
          }
          onClick={() => {
            if (selectWorkspaceSurfaceInspectorView("history")) return;
            if (historyInspectorOpen && mobileView !== "history") {
              setMobileView("history");
            } else {
              setAgentHistoryInspectorOpen(!historyInspectorOpen);
            }
          }}
        >
          <History size={16} />
          <span className="mobile-nav-label">History</span>
        </button>
      </nav>
      <MobileTabSheet
        open={mobile && mobileTabSheetOpen}
        onClose={() => setMobileTabSheetOpen(false)}
        onShowSession={activateTerminalSurface}
      />
      <button
        type="button"
        className={`mobile-workspace-shortcut ${
          mobileView === "workspaces" ? "is-active" : ""
        }`}
        title={shortcutTitle("Workspaces", "workspaces.open")}
        aria-label={
          mobileView === "workspaces" ? "Hide workspaces" : "Show workspaces"
        }
        aria-pressed={mobileView === "workspaces"}
        aria-hidden={mobileControlsCollapsed}
        tabIndex={mobileControlsCollapsed ? -1 : 0}
        onPointerDown={blurActiveInput}
        onClick={
          mobileView === "workspaces" ? activateTerminalSurface : openWorkspaces
        }
      >
        <PanelTop size={17} />
      </button>
      <div className="mobile-terminal-controls">
        <nav
          className="mobile-nav mobile-terminal-tools"
          aria-label={
            activeTerminalComposerDraftKey
              ? "Tabs and terminal composer"
              : "Tabs"
          }
          aria-hidden={mobileControlsCollapsed}
        >
          <button
            type="button"
            className={mobileTabSheetOpen ? "active" : ""}
            title="Tabs"
            aria-label="Show tabs"
            aria-pressed={mobileTabSheetOpen}
            tabIndex={mobileControlsCollapsed ? -1 : 0}
            disabled={!focusedWorkspace}
            onPointerDown={blurActiveInput}
            onClick={() => setMobileTabSheetOpen((open) => !open)}
          >
            <SquareStack size={16} />
            {focusedWorkspaceTabCount > 0 ? (
              <span className="mobile-nav-badge" aria-hidden="true">
                {focusedWorkspaceTabCount}
              </span>
            ) : null}
            <span className="mobile-nav-label">Tabs</span>
          </button>
          {activeTerminalComposerDraftKey ? (
            <button
              type="button"
              className={terminalComposerOpen ? "active" : ""}
              title={
                terminalComposerOpen
                  ? "Close terminal composer"
                  : "Open terminal composer"
              }
              aria-label={`${
                terminalComposerOpen
                  ? "Close terminal composer"
                  : "Open terminal composer"
              }${terminalComposerHasDraft ? ", unsent draft" : ""}`}
              aria-pressed={terminalComposerOpen}
              tabIndex={mobileControlsCollapsed ? -1 : 0}
              onPointerDown={blurActiveInput}
              onClick={() => {
                const open = !terminalComposerOpen;
                if (open) {
                  setMobileTabSheetOpen(false);
                  activateTerminalSurface();
                }
                setTerminalComposerOpen(open);
              }}
            >
              <SquarePen size={16} />
              {terminalComposerHasDraft && !terminalComposerOpen ? (
                <span
                  className="mobile-composer-draft-dot"
                  aria-hidden="true"
                />
              ) : null}
              <span className="mobile-nav-label">Composer</span>
            </button>
          ) : null}
        </nav>
        <button
          type="button"
          className="mobile-controls-toggle"
          aria-label={
            mobileControlsCollapsed
              ? "Show mobile controls"
              : "Hide mobile controls"
          }
          title={
            mobileControlsCollapsed
              ? "Show mobile controls"
              : "Hide mobile controls"
          }
          aria-pressed={mobileControlsCollapsed}
          onPointerDown={blurActiveInput}
          onClick={() => setMobileControlsCollapsed((value) => !value)}
        >
          {mobileControlsCollapsed ? (
            <MoreHorizontal size={17} />
          ) : (
            <X size={17} />
          )}
        </button>
      </div>

      {s.updateInfo?.update_available || s.notice
        ? createPortal(
            <div className="toast-viewport" aria-live="polite">
              {s.updateInfo?.update_available ? (
                <div
                  className={`toast toast-info ${
                    s.updateInstalling ? "toast-loading" : ""
                  }`}
                  role="status"
                >
                  <ToastMark kind="info" loading={s.updateInstalling} />
                  <div className="toast-content">
                    <strong>
                      Herdr World {s.updateInfo.latest_version} is available
                    </strong>
                    <p>
                      Current {s.updateInfo.current_version}
                      {s.updateInfo.can_auto_update
                        ? " · ready to update and restart"
                        : s.updateInfo.reason
                          ? ` · ${s.updateInfo.reason}`
                          : ""}
                    </p>
                    <div className="toast-actions">
                      {s.updateInfo.can_auto_update ? (
                        <button
                          type="button"
                          className="toast-action primary"
                          onClick={() => store.installUpdate()}
                          disabled={s.updateInstalling}
                        >
                          {s.updateInstalling
                            ? "Updating..."
                            : "Update & restart"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="toast-action"
                        onClick={() => store.dismissUpdate()}
                        disabled={s.updateInstalling}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <CloseButton
                    variant="toast"
                    label="Dismiss update notification"
                    onClick={() => store.dismissUpdate()}
                    disabled={s.updateInstalling}
                  />
                </div>
              ) : null}
              {s.notice ? (
                <div
                  className={`toast toast-${s.notice.kind} ${
                    s.notice.loading ? "toast-loading" : ""
                  }`}
                  role={s.notice.kind === "error" ? "alert" : "status"}
                >
                  <ToastMark kind={s.notice.kind} loading={s.notice.loading} />
                  <div className="toast-content">
                    <strong>{s.notice.message}</strong>
                    <NoticeDetail notice={s.notice} />
                    {s.notice.actionLabel &&
                    (s.notice.actionPaneId ||
                      s.notice.actionWorkspaceId ||
                      s.notice.actionClipboardText !== undefined) ? (
                      <div className="toast-actions">
                        <button
                          type="button"
                          className="toast-action primary"
                          onClick={() => handleNoticeAction(s.notice!)}
                        >
                          {s.notice.actionLabel}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <CloseButton
                    variant="toast"
                    label="Dismiss notification"
                    onClick={() => store.clearNotice()}
                  />
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      <div
        className={`body mobile-view-${mobileView} ${
          workspaceSurfaceInspector ? "has-workspace-surface-inspector" : ""
        }`}
        style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}
      >
        <div
          className="sidebar"
          id="workspace-navigator"
          style={!mobile ? { width: sidebarWidth } : undefined}
        >
          <div className="sidebar-content">
            <WorkspaceTree
              agentsFirst={
                (mobile
                  ? layoutPreferences.mobileSidebarOrder
                  : layoutPreferences.desktopSidebarOrder) === "agents-first"
              }
              focusOnSelect={!onWorkspaceSurfaceSelect}
              key={`${resourceUiKey}:workspaces`}
              onSelect={(workspace) => {
                if (onWorkspaceSurfaceSelect) {
                  if (s.serverRuntimeGeneration === null) return;
                  void onWorkspaceSurfaceSelect({
                    connectionId: s.activeConnectionId,
                    runtimeGeneration: s.serverRuntimeGeneration,
                    workspaceId: workspace.workspace_id,
                  });
                } else {
                  keepInspectorForWorkspace(workspace.workspace_id);
                }
              }}
              onBrowseFiles={(workspace) =>
                openFileExplorer(workspace.workspace_id)
              }
              onReviewChanges={(workspace) =>
                openDiffViewer(workspace.workspace_id)
              }
              onSelectAgent={(pane) => {
                if (onWorkspaceSurfaceSelect) {
                  if (s.serverRuntimeGeneration === null) return;
                  void onWorkspaceSurfaceSelect({
                    connectionId: s.activeConnectionId,
                    runtimeGeneration: s.serverRuntimeGeneration,
                    workspaceId: pane.workspace_id,
                    paneId: pane.pane_id,
                  });
                } else {
                  keepInspectorForWorkspace(pane.workspace_id, pane);
                }
              }}
              onBrowseFilesForAgent={browseFilesForPane}
              onReviewChangesForAgent={reviewChangesForPane}
              onViewAgentHistory={(pane) =>
                setAgentHistoryInspectorOpen(true, pane)
              }
            />
          </div>
        </div>
        <div
          className="resizer"
          onPointerDown={startResize}
          title="Drag to resize sidebar"
        >
          {!mobile ? (
            <button
              type="button"
              className="sidebar-visibility-toggle sidebar-hide"
              aria-label="Hide workspace navigator"
              aria-controls="workspace-navigator"
              aria-expanded="true"
              title="Hide workspace navigator"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={toggleSidebar}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {desktopSidebarHidden && !zenMode ? (
          <button
            type="button"
            className="sidebar-visibility-toggle sidebar-show"
            aria-label="Show workspace navigator"
            aria-controls="workspace-navigator"
            aria-expanded="false"
            title="Show workspace navigator"
            onClick={toggleSidebar}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ) : null}
        <main className="main">
          <TabBar
            key={`${resourceUiKey}:tabs`}
            mobile={mobile}
            inspectorOpen={
              !hasWorkspaceSurface && inspectorState?.open === true
            }
            showInspector={!hasWorkspaceSurface}
            annotationsOpen={annotationsOpen}
            annotationCount={annotations.length}
            onToggleInspector={toggleWorkspaceInspector}
            onToggleAnnotations={toggleAnnotations}
            onFocusSurface={onWorkspaceSurfaceSelect}
            arrangementControl={arrangementControl}
          />
          <div
            className={`workspace-surfaces ${annotationsDocked ? "has-annotations" : ""}`}
          >
            <div
              ref={inspectorPortal ? undefined : inspectorStageRef}
              className={`workspace-stage ${
                !hasWorkspaceSurface && inspectorState?.open
                  ? `has-inspector inspector-dock-${inspectorState.dock}`
                  : ""
              } ${
                !hasWorkspaceSurface &&
                inspectorState?.open &&
                inspectorState.expanded
                  ? "is-inspector-expanded"
                  : ""
              }`}
            >
              <div
                className={`workspace-terminal-surface ${onSpacesWindowLayerReady ? "has-window-layer" : ""}`}
              >
                {workspaceSurface !== null ? (
                  <div
                    className={`workspace-surface-owner ${hasWorkspaceSurface ? "is-active" : "is-inactive"}`}
                  >
                    {workspaceSurface}
                  </div>
                ) : null}
                {onSpacesWindowLayerReady &&
                !hasWorkspaceSurface &&
                terminalPresentation === "spaces" ? (
                  <div
                    className="spaces-window-layer"
                    ref={onSpacesWindowLayerReady}
                  />
                ) : null}
                {!hasWorkspaceSurface &&
                terminalPresentation === "spaces" &&
                (!focusedWorkspace || !activeSpacesTabId) ? (
                  <TerminalView
                    terminalTheme={terminalTheme}
                    terminalFontScale={terminalFontScale}
                    mobileShortcuts={mobileTerminalShortcuts}
                    mobileSideShortcuts={mobileTerminalSideShortcuts}
                    composerOpen={terminalComposerOpen}
                    onComposerOpenChange={setTerminalComposerOpen}
                    agentHistoryOpen={agentHistoryOpen}
                    onAgentHistoryOpenChange={setAgentHistoryInspectorOpen}
                    onOpenWorkspaceFile={handleTerminalWorkspaceFile}
                  />
                ) : null}
                {!hasWorkspaceSurface &&
                terminalPresentation === "spaces" &&
                visibleSpacesTabWindows.length === 0 &&
                focusedWorkspace &&
                activeSpacesTabId ? (
                  <SpacesTabTerminal
                    tabId={activeSpacesTabId}
                    workspaceId={focusedWorkspace.workspace_id}
                    panes={s.panes}
                    selectedPaneId={s.selectedPaneId}
                    connectionId={s.activeConnectionId}
                    connectionGeneration={s.connectionGeneration}
                    terminalTheme={terminalTheme}
                    terminalFontScale={terminalFontScale}
                    mobileShortcuts={mobileTerminalShortcuts}
                    mobileSideShortcuts={mobileTerminalSideShortcuts}
                    composerOpen={terminalComposerOpen}
                    onComposerOpenChange={setTerminalComposerOpen}
                    agentHistoryOpen={agentHistoryOpen}
                    onAgentHistoryOpenChange={setAgentHistoryInspectorOpen}
                    onOpenWorkspaceFile={handleTerminalWorkspaceFile}
                    onFocusTabWindow={onFocusSpacesTabWindow}
                  />
                ) : null}
              </div>
              {!hasWorkspaceSurface &&
              !inspectorPortal &&
              inspectorState?.open &&
              !inspectorState.expanded ? (
                <div
                  className="workspace-inspector-resizer"
                  role="separator"
                  aria-label={`Resize ${inspectorState.dock} Inspector`}
                  aria-orientation={
                    inspectorState.dock === "right" ? "vertical" : "horizontal"
                  }
                  tabIndex={0}
                  onKeyDown={resizeInspectorWithKeyboard}
                  onPointerDown={startInspectorResize}
                />
              ) : null}
              {!hasWorkspaceSurface && !inspectorPortal ? inspectorSlot : null}
            </div>
            <AnnotationPanel
              key={annotationStorageKey}
              open={annotationsOpen && !!annotationScope}
              annotations={annotations}
              floating={annotationsFloating && !mobile && !!annotationScope}
              onToggleFloating={mobile ? undefined : toggleAnnotationsFloating}
              agentPanes={annotationAgentPanes}
              preferredPaneId={annotationPreferredPaneId}
              busy={annotationDeliveryBusy}
              focusedAnnotationId={focusedAnnotationId}
              onClose={closeAnnotations}
              onUpdateComment={(id, comment) =>
                commitAnnotations((current) =>
                  current.map((annotation) =>
                    annotation.id === id
                      ? { ...annotation, comment }
                      : annotation,
                  ),
                )
              }
              onDelete={(id) => {
                commitAnnotations((current) =>
                  current.filter((annotation) => annotation.id !== id),
                );
                if (focusedAnnotationId === id) setFocusedAnnotationId(null);
              }}
              onMove={(id, delta) =>
                commitAnnotations((current) =>
                  moveReviewAnnotation(current, id, delta),
                )
              }
              onGoToAgent={
                deliveredPaneId &&
                annotationAgentPanes.some(
                  (pane) => pane.pane_id === deliveredPaneId,
                )
                  ? goToDeliveredAgent
                  : undefined
              }
              onClear={clearAnnotations}
              onCopy={() => void copyFeedback()}
              onSend={(paneId) => void sendFeedback(paneId)}
            />
          </div>
        </main>
      </div>
      <GlobalTooltip />
      {viewportDebugEnabled ? (
        <Suspense fallback={null}>
          <ViewportDebugOverlay />
        </Suspense>
      ) : null}
      <PopupOverlay
        terminalTheme={terminalTheme}
        terminalFontScale={terminalFontScale}
      />
      {paneJumpOpen ? (
        <PaneJumpOverlay
          entries={paneJumpOptions}
          selectedIndex={paneJumpIndex}
          search={paneJumpSearch}
          onSearchChange={changePaneJumpSearch}
          onSelectIndex={selectPaneJumpIndex}
          onCommit={commitPaneJump}
          onClose={closePaneJump}
        />
      ) : null}
      <WorkspaceInspectorPortal
        target={inspectorPortal}
        stageRef={inspectorStageRef}
        dock={inspectorState?.dock ?? "right"}
        expanded={inspectorState?.expanded ?? false}
      >
        {inspectorSlot}
      </WorkspaceInspectorPortal>
      {!hasWorkspaceSurface &&
      terminalPresentation === "spaces" &&
      focusedWorkspace
        ? visibleSpacesTabWindows.map((window) =>
            createPortal(
              <SpacesTabTerminal
                key={window.tabId}
                tabId={window.tabId}
                workspaceId={focusedWorkspace.workspace_id}
                panes={s.panes}
                selectedPaneId={s.selectedPaneId}
                connectionId={s.activeConnectionId}
                connectionGeneration={s.connectionGeneration}
                terminalTheme={terminalTheme}
                terminalFontScale={terminalFontScale}
                mobileShortcuts={mobileTerminalShortcuts}
                mobileSideShortcuts={mobileTerminalSideShortcuts}
                composerOpen={terminalComposerOpen}
                onComposerOpenChange={setTerminalComposerOpen}
                agentHistoryOpen={agentHistoryOpen}
                onAgentHistoryOpenChange={setAgentHistoryInspectorOpen}
                onOpenWorkspaceFile={handleTerminalWorkspaceFile}
                onFocusTabWindow={onFocusSpacesTabWindow}
              />,
              window.portal!,
              window.tabId,
            ),
          )
        : null}
      {terminalPresentation === "inspector" &&
      presentedTerminalPortal &&
      presentedTerminalPane
        ? createPortal(
            <TerminalView
              key={terminalMountKey(
                {
                  connectionId: s.activeConnectionId,
                  generation: s.connectionGeneration,
                },
                presentedTerminalPane.pane_id,
                presentedTerminalPane.terminal_id,
              )}
              paneId={presentedTerminalPane.pane_id}
              terminalTheme={terminalTheme}
              terminalFontScale={terminalFontScale}
              mobileShortcuts={mobileTerminalShortcuts}
              mobileSideShortcuts={mobileTerminalSideShortcuts}
              composerOpen={terminalComposerOpen}
              onComposerOpenChange={setTerminalComposerOpen}
              onOpenWorkspaceFile={handleTerminalWorkspaceFile}
            />,
            presentedTerminalPortal,
          )
        : null}
      {worldPresentationsForView.length ? (
        <Suspense fallback={null}>
          <WorldTerminalPortalList
            presentations={worldPresentationsForView}
            panes={s.panes}
            activeConnectionId={s.activeConnectionId}
            connectionGeneration={s.connectionGeneration}
            runtimeGeneration={s.serverRuntimeGeneration}
            terminalTheme={terminalTheme}
            terminalFontScale={terminalFontScale}
            mobileShortcuts={mobileTerminalShortcuts}
            mobileSideShortcuts={mobileTerminalSideShortcuts}
            onOpenWorkspaceFile={handleTerminalWorkspaceFile}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
