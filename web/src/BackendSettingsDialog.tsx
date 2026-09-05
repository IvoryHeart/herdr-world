import { hexToHsva, hsvaToHex } from "@uiw/color-convert";
import type { HsvaColor } from "@uiw/color-convert";
import Wheel from "@uiw/react-color-wheel";
import {
  Building2,
  Network,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
  StickyNote,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import {
  duplicateBackend,
  fallbackBackendColor,
  normalizeBridgeBaseUrl,
  normalizeBackendColor,
  SAME_ORIGIN_BRIDGE_ID,
  SAME_ORIGIN_BRIDGE_COLOR,
  sameOriginHostLabel,
  suggestBackendColor,
  useBridge,
} from "./bridge";
import type { BridgeBackendProfile } from "./bridge";
import { BridgeDestinationSettings } from "./BridgeDestinationSettings";
import { RemoteAccessSettings } from "./RemoteAccessSettings";
import { allowBridgeDestinations, fetchRemoteAccess } from "./remoteAccess";
import {
  DEFAULT_CONTENT_INSET_BOTTOM_PX,
  DEFAULT_CONTENT_INSET_TOP_PX,
  DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
  MAX_CONTENT_INSET_BOTTOM_PX,
  MAX_CONTENT_INSET_TOP_PX,
  MAX_MOBILE_CONTROLS_SCALE_PERCENT,
  MIN_CONTENT_INSET_BOTTOM_PX,
  MIN_CONTENT_INSET_TOP_PX,
  MIN_MOBILE_CONTROLS_SCALE_PERCENT,
  parseContentInsetBottomPx,
  parseContentInsetTopPx,
  parseMobileControlsScalePercent,
} from "./displayPrefs";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  parseTerminalFontSizePx,
} from "./terminalPrefs";
import {
  MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS,
} from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTerminalTapTarget,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import type { NavigationSyncMode } from "./navigationPrefs";
import { TERMINAL_INPUT_BATCH_DELAY_OPTIONS_MS } from "./terminalInputTransport";
import type { TerminalInputTransport } from "./terminalInputTransport";
import { TERMINAL_OUTPUT_COALESCE_OPTIONS_MS } from "./terminalOutputCoalescing";
import { trapFocusWithin, useFocusReturn } from "./overlayFocus";

type Props = {
  showMobileTerminalSettings: boolean;
  showRemoteAccess: boolean;
  onOpenWorldSettings: () => void;
  notesEnabled: boolean;
  onNotesEnabled: (enabled: boolean) => void;
  navigationSyncMode: NavigationSyncMode;
  onNavigationSyncMode: (mode: NavigationSyncMode) => void;
  agentFeaturesInTabs: boolean;
  onAgentFeaturesInTabs: (enabled: boolean) => void;
  combineMatchingWorkspaceNames: boolean;
  onCombineMatchingWorkspaceNames: (enabled: boolean) => void;
  multiHostSpaceSelection: boolean;
  onMultiHostSpaceSelection: (enabled: boolean) => void;
  terminalFontSizePx: number;
  onTerminalFontSizePx: (value: number) => void;
  terminalScreenReaderText: boolean;
  onTerminalScreenReaderText: (enabled: boolean) => void;
  terminalInputTransport: TerminalInputTransport;
  onTerminalInputTransport: (transport: TerminalInputTransport) => void;
  terminalInputBatchDelayMs: number;
  onTerminalInputBatchDelayMs: (delayMs: number) => void;
  terminalOutputCoalesceMs: number;
  onTerminalOutputCoalesceMs: (delayMs: number) => void;
  contentInsetTopPx: number;
  onContentInsetTopPx: (value: number) => void;
  contentInsetBottomPx: number;
  onContentInsetBottomPx: (value: number) => void;
  mobileControlsScalePercent: number;
  onMobileControlsScalePercent: (value: number) => void;
  mobileTerminalTapTarget: MobileTerminalTapTarget;
  onMobileTerminalTapTarget: (target: MobileTerminalTapTarget) => void;
  mobileLongPressBehavior: MobileLongPressBehavior;
  onMobileLongPressBehavior: (behavior: MobileLongPressBehavior) => void;
  mobileTouchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs;
  onMobileTouchSelectionEndpointTimeoutMs: (
    timeoutMs: MobileTouchSelectionEndpointTimeoutMs,
  ) => void;
  mobileCommandExpandingInput: boolean;
  onMobileCommandExpandingInput: (enabled: boolean) => void;
  mobileCommandEnterNewline: boolean;
  onMobileCommandEnterNewline: (enabled: boolean) => void;
  showMobileKeyboardHideRefit: boolean;
  mobileKeyboardHideRefit: boolean;
  onMobileKeyboardHideRefit: (enabled: boolean) => void;
  onClose: () => void;
};

type FormState = {
  id: string | null;
  name: string;
  baseUrl: string;
  color: string;
};

type SelectionMode = "same-origin" | "new" | "backend";
type SettingsArea = "network" | "features" | "display" | "terminal" | "mobile";
type NetworkArea = "connections" | "allow";
const relativeHttpUrl = (path: string) => path;

export function BackendSettingsDialog({
  showMobileTerminalSettings,
  showRemoteAccess,
  onOpenWorldSettings,
  notesEnabled,
  onNotesEnabled,
  navigationSyncMode,
  onNavigationSyncMode,
  agentFeaturesInTabs,
  onAgentFeaturesInTabs,
  combineMatchingWorkspaceNames,
  onCombineMatchingWorkspaceNames,
  multiHostSpaceSelection,
  onMultiHostSpaceSelection,
  terminalFontSizePx,
  onTerminalFontSizePx,
  terminalScreenReaderText,
  onTerminalScreenReaderText,
  terminalInputTransport,
  onTerminalInputTransport,
  terminalInputBatchDelayMs,
  onTerminalInputBatchDelayMs,
  terminalOutputCoalesceMs,
  onTerminalOutputCoalesceMs,
  contentInsetTopPx,
  onContentInsetTopPx,
  contentInsetBottomPx,
  onContentInsetBottomPx,
  mobileControlsScalePercent,
  onMobileControlsScalePercent,
  mobileTerminalTapTarget,
  onMobileTerminalTapTarget,
  mobileLongPressBehavior,
  onMobileLongPressBehavior,
  mobileTouchSelectionEndpointTimeoutMs,
  onMobileTouchSelectionEndpointTimeoutMs,
  mobileCommandExpandingInput,
  onMobileCommandExpandingInput,
  mobileCommandEnterNewline,
  onMobileCommandEnterNewline,
  showMobileKeyboardHideRefit,
  mobileKeyboardHideRefit,
  onMobileKeyboardHideRefit,
  onClose,
}: Props) {
  const bridge = useBridge();
  const localHttpUrl = bridge.getRuntime(SAME_ORIGIN_BRIDGE_ID)?.httpUrl ?? relativeHttpUrl;
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [form, setForm] = useState<FormState>(() => newBackendForm(bridge.store.backends));
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(
    initialSelectionMode(bridge.lastSelectedBridgeId, bridge.sameOriginAvailable),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BridgeBackendProfile | null>(null);
  const [activeArea, setActiveArea] = useState<SettingsArea>("network");
  const [networkArea, setNetworkArea] = useState<NetworkArea>("connections");
  useFocusReturn();

  const selectedBackend = useMemo(
    () => bridge.store.backends.find((backend) => backend.id === form.id) ?? null,
    [bridge.store.backends, form.id],
  );
  const sameOriginEnabled = bridge.store.enabledBridgeIds.includes(SAME_ORIGIN_BRIDGE_ID);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (activeArea === "mobile" && !showMobileTerminalSettings) {
      setActiveArea("terminal");
    }
  }, [activeArea, showMobileTerminalSettings]);

  useEffect(() => {
    if (selectionMode !== "backend" || form.id || bridge.store.backends.length === 0) {
      return;
    }
    const lastBackend = bridge.lastSelectedBridgeId
      ? bridge.store.backends.find((backend) => backend.id === bridge.lastSelectedBridgeId)
      : undefined;
    const backend = lastBackend ?? bridge.store.backends[0];
    setForm(backendFormFromProfile(backend));
  }, [bridge.lastSelectedBridgeId, bridge.store.backends, form.id, selectionMode]);

  const selectSameOrigin = () => {
    setSelectionMode("same-origin");
    setForm(newBackendForm(bridge.store.backends));
    setMessage(null);
    setDuplicate(null);
  };

  const startNew = () => {
    setSelectionMode("new");
    setForm(newBackendForm(bridge.store.backends));
    setMessage(null);
    setDuplicate(null);
  };

  const editBackend = (backend: BridgeBackendProfile) => {
    setSelectionMode("backend");
    setForm(backendFormFromProfile(backend));
    setMessage(null);
    setDuplicate(null);
  };

  const validateDuplicate = () => {
    try {
      const found = duplicateBackend(bridge.store.backends, form.baseUrl, form.id ?? undefined);
      setDuplicate(found);
      return found;
    } catch {
      setDuplicate(null);
      return null;
    }
  };

  const testBackend = async () => {
    setBusy(true);
    setMessage(null);
    setDuplicate(null);
    try {
      const baseUrl = normalizeBridgeBaseUrl(form.baseUrl);
      const found = duplicateBackend(bridge.store.backends, baseUrl, form.id ?? undefined);
      setDuplicate(found);
      if (showRemoteAccess) {
        try {
          const access = await fetchRemoteAccess(localHttpUrl);
          if (!access.remote_access.allowed_bridge_origins.includes(new URL(baseUrl).origin)) {
            setMessage("Connect first. Herdr World needs to allow this address and reload the page.");
            return;
          }
        } catch {
          // Standalone and development launches may not expose writable local management.
        }
      }
      await bridge.probeBackend(baseUrl);
      setMessage(found ? `Reachable; already saved as ${found.name}.` : "Connection successful.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setBusy(false);
    }
  };

  const saveBackend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const baseUrl = normalizeBridgeBaseUrl(form.baseUrl);
      const found = duplicateBackend(bridge.store.backends, baseUrl, form.id ?? undefined);
      if (found) {
        setDuplicate(found);
        setMessage(`This URL is already saved as ${found.name}.`);
        return;
      }
      const profile = form.id
        ? await bridge.updateBackend(form.id, { name: form.name, baseUrl, color: form.color })
        : await bridge.addBackend({ name: form.name, baseUrl, color: form.color }, true);
      setSelectionMode("backend");
      setForm(backendFormFromProfile(profile));
      let permissionChanged = false;
      let permissionWarning: string | null = null;
      if (showRemoteAccess) {
        try {
          const result = await allowBridgeDestinations(localHttpUrl, [new URL(baseUrl).origin]);
          permissionChanged = result.changed;
        } catch (error) {
          permissionWarning = error instanceof Error
            ? error.message
            : "Browser connection permission could not be applied.";
        }
      }
      if (permissionChanged) {
        setMessage("Connection saved. Reloading Herdr World to connect…");
        window.setTimeout(() => window.location.reload(), 0);
        return;
      }
      let probeWarning: string | null = null;
      try {
        await bridge.probeBackend(baseUrl);
      } catch (error) {
        probeWarning = error instanceof Error ? error.message : "The Herdr address could not be reached.";
      }
      setMessage(
        permissionWarning
          ? `Connection saved. ${permissionWarning}`
          : probeWarning
            ? `Connection saved. ${probeWarning}`
            : "Connection saved.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save connection");
    } finally {
      setBusy(false);
    }
  };

  const deleteBackend = () => {
    if (!form.id) {
      return;
    }
    bridge.deleteBackend(form.id);
    startNew();
  };

  const canDelete = Boolean(form.id);
  const editingBackend = selectionMode !== "same-origin";
  const sameOriginUrl = sameOriginDisplayUrl();
  const sameOriginLabel = sameOriginHostLabel();
  const showSameOrigin = bridge.sameOriginAvailable;
  const sameOriginStatus = connectionStatus(
    sameOriginEnabled,
    bridge.getRuntime(SAME_ORIGIN_BRIDGE_ID)?.capabilityState,
  );
  const selectedConnectionStatus = selectedBackend
    ? connectionStatus(
        bridge.store.enabledBridgeIds.includes(selectedBackend.id),
        bridge.getRuntime(selectedBackend.id)?.capabilityState,
      )
    : null;
  const areas: { id: SettingsArea; label: string; icon: typeof Network }[] = [
    { id: "network", label: "Network", icon: Network },
    { id: "features", label: "Features", icon: StickyNote },
    { id: "display", label: "Display", icon: SlidersHorizontal },
    { id: "terminal", label: "Terminal", icon: SquareTerminal },
    ...(showMobileTerminalSettings
      ? [{ id: "mobile" as const, label: "Mobile", icon: Smartphone }]
      : []),
  ];

  return (
    <div className="overlay-root">
      <button className="overlay-scrim" type="button" aria-label="Close settings" onClick={onClose} />
      <form
        className="modal backend-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          trapFocusWithin(event);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (activeArea !== "network" || networkArea !== "connections" || !editingBackend) {
            return;
          }
          void saveBackend();
        }}
      >
        <button
          className="modal-close icon-btn"
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <X size={15} />
        </button>
        <div id={titleId} className="modal-title">Settings</div>
        <div className="backend-layout">
          <div className="settings-area-list" role="tablist" aria-label="Settings areas">
            {areas.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className="settings-area-tab"
                type="button"
                role="tab"
                data-active={activeArea === id ? "true" : undefined}
                aria-selected={activeArea === id}
                onClick={() => setActiveArea(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
            <button
              className="settings-area-tab"
              type="button"
              role="tab"
              aria-label="Office settings"
              aria-selected={false}
              onClick={onOpenWorldSettings}
            >
              <Building2 size={15} />
              <span>Office</span>
            </button>
          </div>

          <div className="settings-panel" role="tabpanel">
            {activeArea === "network" ? (
              <>
                <div className="settings-label">Network</div>
                <p className="settings-help">
                  Connect this Herdr World to other Herdr instances, or allow connections to this
                  one.
                </p>
                {showRemoteAccess ? (
                  <div
                    className="segmented-control network-area-tabs"
                    role="tablist"
                    aria-label="Network settings"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={networkArea === "connections"}
                      data-on={networkArea === "connections" ? "true" : undefined}
                      onClick={() => setNetworkArea("connections")}
                    >
                      Connections
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={networkArea === "allow"}
                      data-on={networkArea === "allow" ? "true" : undefined}
                      onClick={() => setNetworkArea("allow")}
                    >
                      Allow connections
                    </button>
                  </div>
                ) : null}

                {networkArea === "connections" ? (
                  <>
                    <div className="settings-label">Connections</div>
                    <p className="settings-help">
                      Connect this Herdr World to another Herdr. Connections are saved in this browser.
                    </p>
                    <div className="bridge-settings-grid">
                      <div className="backend-list" role="list" aria-label="Connections">
                        {showSameOrigin ? (
                          <BackendToggleRow
                            active={selectionMode === "same-origin"}
                            color={SAME_ORIGIN_BRIDGE_COLOR}
                            enabled={sameOriginEnabled}
                            title={sameOriginLabel}
                            subtitle={sameOriginUrl}
                            status={sameOriginStatus}
                            toggleLabel={`${sameOriginEnabled ? "Disconnect from" : "Connect to"} ${sameOriginLabel}`}
                            onSelect={selectSameOrigin}
                            onToggle={() => bridge.setBridgeEnabled(SAME_ORIGIN_BRIDGE_ID, !sameOriginEnabled)}
                          />
                        ) : null}
                        {bridge.store.backends.map((backend) => {
                          const enabled = bridge.store.enabledBridgeIds.includes(backend.id);
                          const status = connectionStatus(
                            enabled,
                            bridge.getRuntime(backend.id)?.capabilityState,
                          );
                          return (
                            <BackendToggleRow
                              key={backend.id}
                              active={backend.id === form.id}
                              color={backend.color ?? fallbackBackendColor(backend.id)}
                              enabled={enabled}
                              title={backend.name}
                              subtitle={backend.baseUrl}
                              status={status}
                              toggleLabel={`${enabled ? "Disconnect from" : "Connect to"} ${backend.name}`}
                              onSelect={() => editBackend(backend)}
                              onToggle={() => bridge.setBridgeEnabled(backend.id, !enabled)}
                            />
                          );
                        })}
                        <button
                          className="backend-row-action"
                          type="button"
                          data-active={selectionMode === "new" ? "true" : undefined}
                          onClick={startNew}
                        >
                          <Plus size={14} />
                          <span>
                            <strong>Add connection</strong>
                            <small>Connect to another Herdr</small>
                          </span>
                        </button>
                      </div>
                      <div className="backend-form">
                        {selectionMode === "same-origin" ? (
                          <div className="backend-static">
                            <strong>{sameOriginLabel}</strong>
                            <span>{sameOriginStatus}. This Herdr served the page you are using.</span>
                          </div>
                        ) : (
                          <>
                            <label className="field-label">
                              <span>Herdr address</span>
                              <input
                                className="field"
                                value={form.baseUrl}
                                placeholder="http://herdr.example:8787"
                                autoComplete="off"
                                spellCheck={false}
                                onBlur={validateDuplicate}
                                onChange={(event) =>
                                  setForm((current) => ({ ...current, baseUrl: event.target.value }))
                                }
                              />
                            </label>
                            <details className="remote-access-advanced connection-customize">
                              <summary>Customize connection</summary>
                              <div className="remote-access-advanced-content connection-customize-content">
                                <label className="field-label">
                                  <span>Name</span>
                                  <input
                                    className="field"
                                    value={form.name}
                                    placeholder="Ubuntu VM"
                                    autoComplete="off"
                                    onChange={(event) =>
                                      setForm((current) => ({ ...current, name: event.target.value }))
                                    }
                                  />
                                </label>
                                <label className="field-label">
                                  <span>Color</span>
                                  <BackendColorControl
                                    value={form.color}
                                    defaultValue={
                                      form.id
                                        ? fallbackBackendColor(form.id)
                                        : suggestBackendColor(bridge.store.backends)
                                    }
                                    onChange={(color) => setForm((current) => ({ ...current, color }))}
                                  />
                                </label>
                                {selectedBackend?.lastConnectedAt ? (
                                  <div className="backend-note">
                                    Last connected {formatDate(selectedBackend.lastConnectedAt)}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          </>
                        )}
                        {selectedConnectionStatus ? (
                          <div
                            className="connection-state"
                            data-state={selectedConnectionStatus.toLowerCase()}
                          >
                            {selectedConnectionStatus}
                          </div>
                        ) : null}
                        {duplicate ? (
                          <div className="backend-warning">
                            This address is already saved as {duplicate.name}.
                          </div>
                        ) : null}
                        {message ? <div className="modal-message">{message}</div> : null}
                      </div>
                    </div>
                    {editingBackend ? (
                      <div className="modal-actions">
                        {canDelete ? (
                          <button type="button" className="btn btn-danger" disabled={busy} onClick={deleteBackend}>
                            Delete connection
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !form.baseUrl.trim()}
                          onClick={testBackend}
                        >
                          Test connection
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy || !form.baseUrl.trim()}
                          onClick={() => void saveBackend()}
                        >
                          {form.id ? "Save changes" : "Connect"}
                        </button>
                      </div>
                    ) : null}
                    {showRemoteAccess ? (
                      <BridgeDestinationSettings
                        httpUrl={localHttpUrl}
                        backends={bridge.store.backends}
                      />
                    ) : null}
                  </>
                ) : null}

                {networkArea === "allow" && showRemoteAccess ? (
                  <RemoteAccessSettings httpUrl={localHttpUrl} />
                ) : null}
              </>
            ) : null}

            {activeArea === "features" ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Client features</div>
                <div className="settings-row">
                  <span>Notes</span>
                  <div className="segmented-control" role="group" aria-label="Notes feature">
                    <button
                      type="button"
                      data-on={!notesEnabled}
                      aria-pressed={!notesEnabled}
                      onClick={() => onNotesEnabled(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={notesEnabled}
                      aria-pressed={notesEnabled}
                      onClick={() => onNotesEnabled(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeArea === "display" ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Sidebar</div>
                <div className="settings-row">
                  <span title="Choose whether this browser follows pane selections from other clients">
                    Sync navigation
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Navigation synchronization"
                  >
                    <button
                      type="button"
                      data-on={navigationSyncMode === "independent"}
                      aria-pressed={navigationSyncMode === "independent"}
                      onClick={() => onNavigationSyncMode("independent")}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={navigationSyncMode === "shared"}
                      aria-pressed={navigationSyncMode === "shared"}
                      onClick={() => onNavigationSyncMode("shared")}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Agent features in Tabs</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Agent features in Tabs"
                  >
                    <button
                      type="button"
                      data-on={!agentFeaturesInTabs}
                      aria-pressed={!agentFeaturesInTabs}
                      onClick={() => onAgentFeaturesInTabs(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={agentFeaturesInTabs}
                      aria-pressed={agentFeaturesInTabs}
                      onClick={() => onAgentFeaturesInTabs(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span title="Combine same-named workspaces across hosts when grouping by Workspace">
                    Combine matching workspace names
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Combine matching workspace names"
                  >
                    <button
                      type="button"
                      data-on={!combineMatchingWorkspaceNames}
                      aria-pressed={!combineMatchingWorkspaceNames}
                      onClick={() => onCombineMatchingWorkspaceNames(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={combineMatchingWorkspaceNames}
                      aria-pressed={combineMatchingWorkspaceNames}
                      onClick={() => onCombineMatchingWorkspaceNames(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Multi-host Space selection</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Multi-host Space selection"
                  >
                    <button
                      type="button"
                      data-on={!multiHostSpaceSelection}
                      aria-pressed={!multiHostSpaceSelection}
                      onClick={() => onMultiHostSpaceSelection(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={multiHostSpaceSelection}
                      aria-pressed={multiHostSpaceSelection}
                      onClick={() => onMultiHostSpaceSelection(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-label">Display spacing</div>
                <div className="settings-row">
                  <span>Top padding</span>
                  <NumberSettingControl
                    ariaLabel="Top padding"
                    value={contentInsetTopPx}
                    min={MIN_CONTENT_INSET_TOP_PX}
                    max={MAX_CONTENT_INSET_TOP_PX}
                    unit="px"
                    defaultValue={DEFAULT_CONTENT_INSET_TOP_PX}
                    onChange={(value) => onContentInsetTopPx(parseContentInsetTopPx(value))}
                  />
                </div>
                <div className="settings-row">
                  <span>Bottom padding</span>
                  <NumberSettingControl
                    ariaLabel="Bottom padding"
                    value={contentInsetBottomPx}
                    min={MIN_CONTENT_INSET_BOTTOM_PX}
                    max={MAX_CONTENT_INSET_BOTTOM_PX}
                    unit="px"
                    defaultValue={DEFAULT_CONTENT_INSET_BOTTOM_PX}
                    onChange={(value) => onContentInsetBottomPx(parseContentInsetBottomPx(value))}
                  />
                </div>
                {showMobileTerminalSettings ? (
                  <div className="settings-row settings-slider-row">
                    <span>Mobile input controls size</span>
                    <SliderSettingControl
                      ariaLabel="Mobile input controls size"
                      value={mobileControlsScalePercent}
                      min={MIN_MOBILE_CONTROLS_SCALE_PERCENT}
                      max={MAX_MOBILE_CONTROLS_SCALE_PERCENT}
                      step={5}
                      unit="%"
                      defaultValue={DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT}
                      onChange={(value) =>
                        onMobileControlsScalePercent(parseMobileControlsScalePercent(value))
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeArea === "terminal" ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Terminal appearance</div>
                <div className="settings-row">
                  <span>Font size</span>
                  <NumberSettingControl
                    ariaLabel="Terminal font size"
                    value={terminalFontSizePx}
                    min={MIN_TERMINAL_FONT_SIZE_PX}
                    max={MAX_TERMINAL_FONT_SIZE_PX}
                    unit="px"
                    defaultValue={DEFAULT_TERMINAL_FONT_SIZE_PX}
                    onChange={(value) => onTerminalFontSizePx(parseTerminalFontSizePx(value))}
                  />
                </div>
                <div className="settings-label">Accessibility</div>
                <div className="settings-row">
                  <span title="Expose only the bounded visible terminal viewport as screen-reader text">
                    Screen-reader text
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Terminal screen-reader text"
                  >
                    <button
                      type="button"
                      data-on={!terminalScreenReaderText}
                      aria-pressed={!terminalScreenReaderText}
                      onClick={() => onTerminalScreenReaderText(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={terminalScreenReaderText}
                      aria-pressed={terminalScreenReaderText}
                      onClick={() => onTerminalScreenReaderText(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-label">Terminal transport</div>
                <div className="settings-row">
                  <span>Input payloads</span>
                  <div className="segmented-control" role="group" aria-label="Terminal input payloads">
                    <button
                      type="button"
                      data-on={terminalInputTransport === "json"}
                      aria-pressed={terminalInputTransport === "json"}
                      onClick={() => onTerminalInputTransport("json")}
                    >
                      JSON
                    </button>
                    <button
                      type="button"
                      data-on={terminalInputTransport === "binary"}
                      aria-pressed={terminalInputTransport === "binary"}
                      onClick={() => onTerminalInputTransport("binary")}
                    >
                      Binary
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Input batching (ms)</span>
                  <div className="segmented-control" role="group" aria-label="Terminal input batching">
                    {TERMINAL_INPUT_BATCH_DELAY_OPTIONS_MS.map((delayMs) => (
                      <button
                        key={delayMs}
                        type="button"
                        data-on={terminalInputBatchDelayMs === delayMs}
                        aria-pressed={terminalInputBatchDelayMs === delayMs}
                        onClick={() => onTerminalInputBatchDelayMs(delayMs)}
                      >
                        {delayMs === 0 ? "Off" : delayMs}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <span>Output batching (ms)</span>
                  <div className="segmented-control" role="group" aria-label="Terminal output batching">
                    {TERMINAL_OUTPUT_COALESCE_OPTIONS_MS.map((delayMs) => (
                      <button
                        key={delayMs}
                        type="button"
                        data-on={terminalOutputCoalesceMs === delayMs}
                        aria-pressed={terminalOutputCoalesceMs === delayMs}
                        onClick={() => onTerminalOutputCoalesceMs(delayMs)}
                      >
                        {delayMs === 0 ? "Off" : delayMs}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {activeArea === "mobile" && showMobileTerminalSettings ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Mobile terminal</div>
                <div className="settings-row">
                  <span>Terminal tap</span>
                  <div className="segmented-control" role="group" aria-label="Terminal tap target">
                    <button
                      type="button"
                      data-on={mobileTerminalTapTarget === "command-input"}
                      aria-pressed={mobileTerminalTapTarget === "command-input"}
                      onClick={() => onMobileTerminalTapTarget("command-input")}
                    >
                      Text input
                    </button>
                    <button
                      type="button"
                      data-on={mobileTerminalTapTarget === "terminal"}
                      aria-pressed={mobileTerminalTapTarget === "terminal"}
                      onClick={() => onMobileTerminalTapTarget("terminal")}
                    >
                      Terminal
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Long-press behavior</span>
                  <div className="segmented-control" role="group" aria-label="Long-press behavior">
                    <button
                      type="button"
                      data-on={mobileLongPressBehavior === "off"}
                      aria-pressed={mobileLongPressBehavior === "off"}
                      onClick={() => onMobileLongPressBehavior("off")}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={mobileLongPressBehavior === "copy"}
                      aria-pressed={mobileLongPressBehavior === "copy"}
                      onClick={() => onMobileLongPressBehavior("copy")}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      data-on={mobileLongPressBehavior === "loupe"}
                      aria-pressed={mobileLongPressBehavior === "loupe"}
                      onClick={() => onMobileLongPressBehavior("loupe")}
                    >
                      Loupe
                    </button>
                  </div>
                </div>
                {mobileLongPressBehavior === "loupe" ? (
                  <div className="settings-row">
                    <span>Loupe wait (ms)</span>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Loupe endpoint wait"
                    >
                      {MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS.map((timeoutMs) => (
                        <button
                          key={timeoutMs}
                          type="button"
                          data-on={mobileTouchSelectionEndpointTimeoutMs === timeoutMs}
                          aria-pressed={mobileTouchSelectionEndpointTimeoutMs === timeoutMs}
                          onClick={() => onMobileTouchSelectionEndpointTimeoutMs(timeoutMs)}
                        >
                          {timeoutMs}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="settings-row">
                  <span>Expanding command input</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Expanding command input"
                  >
                    <button
                      type="button"
                      data-on={!mobileCommandExpandingInput}
                      aria-pressed={!mobileCommandExpandingInput}
                      onClick={() => onMobileCommandExpandingInput(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={mobileCommandExpandingInput}
                      aria-pressed={mobileCommandExpandingInput}
                      onClick={() => onMobileCommandExpandingInput(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                {mobileCommandExpandingInput ? (
                  <div className="settings-row">
                    <span>Enter inserts newline</span>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Enter inserts newline"
                    >
                      <button
                        type="button"
                        data-on={!mobileCommandEnterNewline}
                        aria-pressed={!mobileCommandEnterNewline}
                        onClick={() => onMobileCommandEnterNewline(false)}
                      >
                        Off
                      </button>
                      <button
                        type="button"
                        data-on={mobileCommandEnterNewline}
                        aria-pressed={mobileCommandEnterNewline}
                        onClick={() => onMobileCommandEnterNewline(true)}
                      >
                        On
                      </button>
                    </div>
                  </div>
                ) : null}
                {showMobileKeyboardHideRefit ? (
                  <div className="settings-row">
                    <span>Resize after keyboard closes</span>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Resize after keyboard closes"
                    >
                      <button
                        type="button"
                        data-on={!mobileKeyboardHideRefit}
                        aria-pressed={!mobileKeyboardHideRefit}
                        onClick={() => onMobileKeyboardHideRefit(false)}
                      >
                        Off
                      </button>
                      <button
                        type="button"
                        data-on={mobileKeyboardHideRefit}
                        aria-pressed={mobileKeyboardHideRefit}
                        onClick={() => onMobileKeyboardHideRefit(true)}
                      >
                        On
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}

function BackendColorControl({
  value,
  defaultValue,
  onChange,
}: {
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
}) {
  const fallbackColor = normalizeBackendColor(defaultValue) ?? SAME_ORIGIN_BRIDGE_COLOR;
  const color = normalizeBackendColor(value) ?? fallbackColor;
  const [hsva, setHsva] = useState<HsvaColor>(() => hexToHsva(color));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(color.toUpperCase());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const skipDraftBlurCommitRef = useRef(false);
  const popoverId = useId();
  const shadeColor = hsvaToHex({ ...hsva, v: 100, a: 1 });

  useEffect(() => {
    setDraft(color.toUpperCase());
  }, [color]);

  useEffect(() => {
    setHsva((current) => (hsvaToHex({ ...current, a: 1 }) === color ? current : hexToHsva(color)));
  }, [color]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const setColor = (nextColor: string) => {
    const normalized = normalizeBackendColor(nextColor);
    if (!normalized) {
      return;
    }
    setHsva(hexToHsva(normalized));
    onChange(normalized);
  };

  const setHsvaColor = (nextHsva: HsvaColor) => {
    const opaqueHsva = { ...nextHsva, a: 1 };
    const normalized = normalizeBackendColor(hsvaToHex(opaqueHsva));
    if (!normalized) {
      return;
    }
    setHsva(opaqueHsva);
    onChange(normalized);
  };

  const commitDraft = (nextDraft: string) => {
    const normalized = normalizeHexDraft(nextDraft);
    if (normalized) {
      setColor(normalized);
      return;
    }
    setDraft(color.toUpperCase());
  };

  const handleWheelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextHsva: HsvaColor | null = null;
    const hueStep = event.shiftKey ? 15 : 5;
    const saturationStep = event.shiftKey ? 10 : 5;
    if (event.key === "ArrowLeft") {
      nextHsva = { ...hsva, h: wrapHue(hsva.h - hueStep) };
    } else if (event.key === "ArrowRight") {
      nextHsva = { ...hsva, h: wrapHue(hsva.h + hueStep) };
    } else if (event.key === "ArrowDown") {
      nextHsva = { ...hsva, s: clampPercent(hsva.s - saturationStep) };
    } else if (event.key === "ArrowUp") {
      nextHsva = { ...hsva, s: clampPercent(hsva.s + saturationStep) };
    }
    if (!nextHsva) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setHsvaColor(nextHsva);
  };

  return (
    <div
      className="backend-color-control"
      ref={rootRef}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        className="backend-color-swatch"
        ref={buttonRef}
        type="button"
        aria-label="Connection color"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-haspopup="true"
        style={{ "--bridge-color": color } as CSSProperties}
        onClick={() => setOpen((current) => !current)}
      />
      <input
        className="backend-color-value mono"
        value={draft}
        aria-label="Connection color hex value"
        spellCheck={false}
        autoCapitalize="none"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={(event) => {
          if (skipDraftBlurCommitRef.current) {
            skipDraftBlurCommitRef.current = false;
            return;
          }
          commitDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            skipDraftBlurCommitRef.current = true;
            setDraft(color.toUpperCase());
            event.currentTarget.blur();
          }
        }}
      />
      {open ? (
        <div
          className="backend-color-popover"
          id={popoverId}
          role="group"
          aria-label="Connection color picker"
        >
          <Wheel
            aria-label="Connection color hue and saturation"
            color={hsva}
            width={176}
            height={176}
            onKeyDown={handleWheelKeyDown}
            onChange={(nextColor) => setHsvaColor(nextColor.hsva)}
          />
          <input
            className="backend-color-shade"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsva.v)}
            aria-label="Connection color brightness"
            style={{ "--shade-color": shadeColor } as CSSProperties}
            onChange={(event) => setHsvaColor({ ...hsva, v: event.currentTarget.valueAsNumber })}
          />
          <div className="backend-color-actions">
            <span className="backend-color-preview" style={{ "--bridge-color": color } as CSSProperties} />
            <button
              className="settings-reset icon-btn"
              type="button"
              aria-label="Reset connection color"
              title="Reset"
              disabled={color === fallbackColor}
              onClick={() => setColor(fallbackColor)}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberSettingControl({
  ariaLabel,
  value,
  min,
  max,
  unit,
  defaultValue,
  onChange,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-value-control">
      <DraftNumberInput
        ariaLabel={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={1}
        onCommit={onChange}
      />
      <span className="settings-unit">{unit}</span>
      <ResetSettingButton
        disabled={value === defaultValue}
        label={`Reset ${ariaLabel.toLowerCase()}`}
        onClick={() => onChange(defaultValue)}
      />
    </div>
  );
}

function SliderSettingControl({
  ariaLabel,
  value,
  min,
  max,
  step,
  unit,
  defaultValue,
  onChange,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-slider-control">
      <input
        className="settings-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <div className="settings-value-control">
        <DraftNumberInput
          ariaLabel={`${ariaLabel} percent`}
          value={value}
          min={min}
          max={max}
          step={step}
          onCommit={onChange}
        />
        <span className="settings-unit">{unit}</span>
        <ResetSettingButton
          disabled={value === defaultValue}
          label={`Reset ${ariaLabel.toLowerCase()}`}
          onClick={() => onChange(defaultValue)}
        />
      </div>
    </div>
  );
}

function DraftNumberInput({
  ariaLabel,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const skipDraftBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) {
      const clamped = Math.min(max, Math.max(min, next));
      setDraft(String(clamped));
      onCommit(clamped);
      return;
    }
    setDraft(String(value));
  };

  return (
    <input
      className="settings-number-field"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-label={ariaLabel}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (skipDraftBlurCommitRef.current) {
          skipDraftBlurCommitRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          skipDraftBlurCommitRef.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ResetSettingButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="settings-reset icon-btn"
      type="button"
      aria-label={label}
      title="Reset"
      disabled={disabled}
      onClick={onClick}
    >
      <RotateCcw size={13} />
    </button>
  );
}

function BackendToggleRow({
  active,
  color,
  enabled,
  status,
  title,
  subtitle,
  toggleLabel,
  onSelect,
  onToggle,
}: {
  active: boolean;
  color: string;
  enabled: boolean;
  status: string;
  title: string;
  subtitle: string;
  toggleLabel: string;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="backend-row" data-active={active ? "true" : undefined} role="listitem">
      <button className="backend-row-main" type="button" onClick={onSelect}>
        <span
          className="backend-row-dot"
          style={{ "--bridge-color": color } as CSSProperties}
          aria-hidden="true"
        />
        <span className="backend-row-text">
          <strong>{title}</strong>
          <small>
            <span className="connection-status" data-state={status.toLowerCase()}>{status}</span>
            <span aria-hidden="true"> · </span>
            {subtitle}
          </small>
        </span>
      </button>
      <button
        className="backend-toggle"
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-on={enabled ? "true" : undefined}
        onClick={onToggle}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

function connectionStatus(
  enabled: boolean,
  capabilityState: "idle" | "probing" | "ready" | "error" | "offline" | "incompatible" | undefined,
) {
  if (!enabled) return "Off";
  if (capabilityState === "ready") return "Connected";
  if (!capabilityState || capabilityState === "idle" || capabilityState === "probing") {
    return "Connecting";
  }
  return "Offline";
}

function newBackendForm(backends: readonly BridgeBackendProfile[]): FormState {
  return {
    id: null,
    name: "",
    baseUrl: "",
    color: suggestBackendColor(backends),
  };
}

function backendFormFromProfile(backend: BridgeBackendProfile): FormState {
  return {
    id: backend.id,
    name: backend.name,
    baseUrl: backend.baseUrl,
    color: backend.color ?? fallbackBackendColor(backend.id),
  };
}

function normalizeHexDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return normalizeBackendColor(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
}

function wrapHue(value: number) {
  return ((value % 360) + 360) % 360;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function sameOriginDisplayUrl() {
  const location = globalThis.location;
  if (!location?.origin || location.origin === "null") {
    return sameOriginHostLabel();
  }
  return location.origin;
}

function initialSelectionMode(
  lastSelectedBridgeId: string | null,
  sameOriginAvailable: boolean,
): SelectionMode {
  if (lastSelectedBridgeId && lastSelectedBridgeId !== SAME_ORIGIN_BRIDGE_ID) {
    return "backend";
  }
  return sameOriginAvailable ? "same-origin" : "new";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
