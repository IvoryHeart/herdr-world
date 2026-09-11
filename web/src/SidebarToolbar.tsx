import { AlertTriangle, ArrowRight, ChevronDown, Plus } from "lucide-react";
import { useLayoutEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { BridgeId, BridgeRuntime } from "./bridge";
import { focusNextTo } from "./overlayFocus";
import type { HostConnectionState } from "./runtimeClient";

export type ToolbarPrimaryView = "spaces" | "office" | "tree" | "graph";
type SidebarView = "agents" | "tabs" | "notes";
type Scope = "space" | "all";
type HostScope = "selected" | "all";
type BridgeView = { runtime: BridgeRuntime; connectionState: HostConnectionState };
type HostPickerProps = {
  bridgeViews: readonly BridgeView[];
  selectedBridgeId: BridgeId | null;
  hostScope: HostScope;
  onHostScope: (scope: HostScope) => void;
  onSelectBridge: (id: BridgeId) => void;
  onAddHost: (trigger: HTMLElement) => void;
};

type Props = HostPickerProps & {
  primaryView: string;
  activeWorldTheme: { id: string };
  scope: Scope;
  sidebarView: SidebarView;
  notesEnabled: boolean;
  onPrimaryView: (view: ToolbarPrimaryView) => void;
  onScope: (scope: Scope) => void;
  onSidebarView: (view: SidebarView) => void;
  viewRef?: RefObject<HTMLSelectElement | null>;
  onOpenCurrentView?: () => void;
};

export function SidebarToolbar({ primaryView, activeWorldTheme, scope, sidebarView,
  notesEnabled, onPrimaryView, onScope, onSidebarView, viewRef, onOpenCurrentView, ...hosts }: Props) {
  const viewId = useId();
  const view = primaryView === "spaces" ? "spaces" : activeWorldTheme.id;
  const viewLabel = view === "graph" ? "Graph" : view === "tree" ? "Tree" : "Office";
  return (
    <div className="sidebar-toolbar" data-terminal-autofocus="false">
      <div className="sidebar-toolbar-row sidebar-toolbar-row-primary" data-toolbar-row="view-hosts">
        <div className="toolbar-select toolbar-view-select">
          <label htmlFor={viewId}>View</label>
          <div className="toolbar-view-control">
            <select id={viewId} ref={viewRef} aria-label="View" value={view} onChange={(event) => {
              if (event.target.value !== view) onPrimaryView(event.target.value as ToolbarPrimaryView);
            }}>
              <option value="office">Office</option>
              <option value="tree">Tree</option>
              <option value="graph">Graph</option>
              <option value="spaces">Spaces</option>
            </select>
            {onOpenCurrentView ? <button type="button" className="toolbar-open-view"
              aria-label={`Open ${viewLabel} view`}
              title={`Open ${viewLabel} view`} onClick={onOpenCurrentView}>
              <ArrowRight size={16} aria-hidden="true" />
            </button> : null}
          </div>
        </div>
        <HostPicker {...hosts} />
      </div>
      <div className="sidebar-toolbar-row sidebar-toolbar-row-list" data-toolbar-row="list-scope">
        <div className="sidebar-mode" role="group" aria-label="Sidebar view">
          {(["agents", "tabs", ...(notesEnabled ? ["notes" as const] : [])] as SidebarView[]).map((mode) => (
            <button key={mode} type="button" data-on={sidebarView === mode}
              aria-pressed={sidebarView === mode} onClick={() => onSidebarView(mode)}>
              {mode === "agents" ? "Agents" : mode === "tabs" ? "Tabs" : "Notes"}
            </button>
          ))}
        </div>
        <select className="toolbar-scope-select" aria-label="Space scope" value={scope}
          onChange={(event) => onScope(event.target.value as Scope)}>
          <option value="space">Current space</option>
          <option value="all">All spaces</option>
        </select>
      </div>
    </div>
  );
}

function HostPicker({ bridgeViews, selectedBridgeId, hostScope, onHostScope,
  onSelectBridge, onAddHost }: HostPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openAtEnd = useRef(false);
  const typeahead = useRef({ text: "", time: 0 });
  const menuId = useId();
  const summaryId = useId();
  const hostLabel = (runtime: BridgeRuntime) => {
    const duplicate = bridgeViews.some((view) => view.runtime.id !== runtime.id && view.runtime.label === runtime.label);
    return duplicate ? `${runtime.label} (${runtime.backend?.baseUrl ?? "This Herdr"})` : runtime.label;
  };
  const selected = bridgeViews.find((view) => view.runtime.id === selectedBridgeId);
  const attention = bridgeViews.filter((view) => ["offline", "incompatible", "degraded"].includes(view.connectionState));
  const label = hostScope === "all" ? "All hosts" : (selected ? hostLabel(selected.runtime) : "No enabled hosts");
  const stateLabel = hostScope === "selected" && selected ? `, ${selected.connectionState}` : "";
  const summary = `${attention.length} ${attention.length === 1 ? "host needs" : "hosts need"} attention`;
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const dismiss = (restore = true) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const available = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const selectedItem = available.find((item) => item.getAttribute("aria-checked") === "true");
    (openAtEnd.current ? available.at(-1) : selectedItem ?? available[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const available = items();
    const index = available.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); dismiss();
    } else if (event.key === "Tab") {
      event.preventDefault();
      focusNextTo(triggerRef.current, menuRef.current, event.shiftKey);
      dismiss(false);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); available[index]?.click();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
        : event.key === "ArrowDown" ? (index + 1) % available.length
        : (index - 1 + available.length) % available.length;
      available[next]?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const char = event.key.toLocaleLowerCase();
      const previous = Date.now() - typeahead.current.time < 600 ? typeahead.current.text : "";
      const text = previous === char ? char : previous + char;
      typeahead.current = { text, time: Date.now() };
      const ordered = [...available.slice(index + 1), ...available.slice(0, index + 1)];
      const match = ordered.find((item) => (item.getAttribute("aria-label") ?? item.textContent ?? "").trim().toLocaleLowerCase().startsWith(text));
      if (match) { event.preventDefault(); match.focus(); }
    }
  };

  return (
    <div ref={pickerRef} className="host-picker" role="group" aria-label="Host">
      <span className="toolbar-control-label">Hosts</span>
      <button ref={triggerRef} className="host-picker-trigger" type="button"
        aria-label={`Hosts: ${label}${stateLabel}`} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined} aria-describedby={attention.length ? summaryId : undefined}
        data-connection={hostScope === "selected" ? selected?.connectionState : undefined}
        onClick={() => { openAtEnd.current = false; typeahead.current.text = ""; setOpen((value) => !value); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); openAtEnd.current = event.key === "ArrowUp";
            typeahead.current.text = ""; setOpen(true);
          }
        }}>
        {selected && hostScope === "selected" ? <span className="bridge-chip-dot" aria-hidden="true"
          style={{ "--bridge-color": selected.runtime.color } as CSSProperties} /> : null}
        <span className="host-picker-value" data-scope={hostScope}>{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {attention.length ? <span id={summaryId} className="host-picker-summary"
        title={attention.map((view) => `${view.runtime.label}: ${view.connectionState}`).join("; ")}>
        <AlertTriangle size={12} aria-hidden="true" />
        {hostScope === "selected" && selected && ["offline", "incompatible", "degraded"].includes(selected.connectionState)
          ? `${selected.connectionState} · ${attention.length} ${attention.length === 1 ? "needs" : "need"} attention` : summary}
      </span> : null}
      {open ? <div ref={menuRef} id={menuId} className="host-picker-menu" role="menu"
        aria-label="Hosts" onKeyDown={onMenuKeyDown}>
        <button type="button" role="menuitemradio" tabIndex={-1} data-host-choice="all"
          aria-checked={hostScope === "all"} disabled={!bridgeViews.length}
          onClick={() => { onHostScope("all"); dismiss(); }}>
          <span>All hosts</span>{hostScope === "all" ? <span aria-hidden="true">✓</span> : null}
        </button>
        {bridgeViews.map((view) => <button key={view.runtime.id} type="button" role="menuitemradio"
          tabIndex={-1} data-host-id={view.runtime.id} data-connection={view.connectionState}
          aria-label={`${hostLabel(view.runtime)}, ${view.connectionState}`}
          aria-checked={hostScope === "selected" && selectedBridgeId === view.runtime.id}
          onClick={() => { onSelectBridge(view.runtime.id); onHostScope("selected"); dismiss(); }}>
          <span className="bridge-chip-dot" aria-hidden="true" style={{ "--bridge-color": view.runtime.color } as CSSProperties} />
          <span className="host-picker-option-label" title={hostLabel(view.runtime)}>{hostLabel(view.runtime)}</span><small>{view.connectionState}</small>
          {hostScope === "selected" && selectedBridgeId === view.runtime.id ? <span aria-hidden="true">✓</span> : null}
        </button>)}
        <div className="host-picker-separator" role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} data-add-host="true" onClick={() => {
          const trigger = triggerRef.current;
          dismiss();
          if (trigger) onAddHost(trigger);
        }}><Plus size={14} aria-hidden="true" /><span>Add Host</span></button>
      </div> : null}
    </div>
  );
}
