import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";

import type { BridgeId, BridgeRuntime } from "../bridge";
import type { BridgeConnectionState } from "../runtimeConnection";
import { runtimeAdmissionReady } from "../runtimeClient";
import { terminalSessionDescriptor } from "../terminalSessions";
import type { TerminalSessionDescriptor } from "../terminalSessions";
import type { PaneInfo } from "../types";
import { officeDebug } from "../officeDebug";
import { WorldConversationBubble } from "./WorldConversationBubble";
import type { WorldConversationBubblePanel } from "./WorldConversationLayer";
import type { HerdrOfficeProjection, OfficeAgent } from "./herdrOfficeProjection";

export type WorldConversationTargetInput = {
  kind: "agent" | "desk" | "pane";
  targetKey: string;
  agentKey: string | null;
  bridgeId: BridgeId;
  paneId: string;
  generationKey: string;
};

export type WorldConversationTarget = WorldConversationTargetInput & {
  windowId: string;
};

type WorldConversationView = {
  windowId: string;
  agent: OfficeAgent | null;
  targetLabel: string;
  hostLabel: string;
  pane: PaneInfo;
  runtime: BridgeRuntime;
  session: TerminalSessionDescriptor;
  targetKey: string;
};

type BubblePreferences = Pick<
  ComponentProps<typeof WorldConversationBubble>,
  | "agentActivityTransitions"
  | "touchInput"
  | "terminalFontSizePx"
  | "terminalScreenReaderText"
  | "mobileControlsScalePercent"
  | "mobileTapTarget"
  | "mobileLongPressBehavior"
  | "mobileTouchSelectionEndpointTimeoutMs"
  | "mobileCommandExpandingInput"
  | "mobileCommandEnterNewline"
  | "terminalInputTransport"
  | "terminalInputBatchDelayMs"
  | "terminalOutputCoalesceMs"
>;

type UseWorldConversationControllerOptions = BubblePreferences & {
  active: boolean;
  compact: boolean;
  projection: HerdrOfficeProjection;
  getRuntime: (bridgeId: BridgeId | null | undefined) => BridgeRuntime | null;
  connectionStates: Readonly<Partial<Record<BridgeId, BridgeConnectionState>>>;
  onSelectBridge: (bridgeId: BridgeId) => void;
  onSelectKey: (key: string | null) => void;
  onStatus: (message: string | null) => void;
  onOpenInSpaces: (windowId: string, bridgeId: BridgeId, pane: PaneInfo) => void;
};

export type WorldConversationController = {
  panels: readonly WorldConversationBubblePanel[];
  open: (target: WorldConversationTargetInput) => void;
  close: (windowId: string) => void;
  clear: () => void;
  focus: (windowId: string) => void;
};

const MAX_WORLD_CONVERSATIONS = 5;
const WORLD_CONVERSATIONS_STORAGE_KEY = "herdrWeb.worldConversations.v1";

export function worldConversationWindowId(bridgeId: BridgeId, paneId: string) {
  return `${bridgeId}:${paneId}`;
}

export function readWorldConversationTargets(): WorldConversationTarget[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(WORLD_CONVERSATIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const targets = parsed.flatMap((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const record = value as Record<string, unknown>;
      if (
        (record.kind !== "agent" && record.kind !== "desk" && record.kind !== "pane") ||
        typeof record.targetKey !== "string" ||
        typeof record.bridgeId !== "string" ||
        typeof record.paneId !== "string" ||
        typeof record.generationKey !== "string" ||
        (record.agentKey !== null && typeof record.agentKey !== "string")
      ) {
        return [];
      }
      return [{
        windowId: worldConversationWindowId(record.bridgeId, record.paneId),
        kind: record.kind,
        targetKey: record.targetKey,
        agentKey: record.agentKey as string | null,
        bridgeId: record.bridgeId,
        paneId: record.paneId,
        generationKey: record.generationKey,
      } satisfies WorldConversationTarget];
    });
    return targets.slice(0, MAX_WORLD_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function worldConversationAdmissionPending(
  runtime: BridgeRuntime | null,
  state: BridgeConnectionState | null | undefined,
  generationKey: string,
) {
  return Boolean(
    runtime &&
      runtime.generationKey === generationKey &&
      (runtime.capabilityState === "idle" ||
        runtime.capabilityState === "probing" ||
        !state ||
        state.connectionKey !== generationKey ||
        state.loadState === "loading" ||
        (state.snapshot === null && state.loadState !== "error")),
  );
}

function writeWorldConversationTargets(targets: readonly WorldConversationTarget[]) {
  try {
    globalThis.sessionStorage?.setItem(
      WORLD_CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(targets.map((target) => ({
        kind: target.kind,
        targetKey: target.targetKey,
        agentKey: target.agentKey,
        bridgeId: target.bridgeId,
        paneId: target.paneId,
        generationKey: target.generationKey,
      }))),
    );
  } catch {
    // Session storage can be unavailable in private or locked-down contexts.
  }
}

function worldConversationObservationPending(
  runtime: BridgeRuntime | null,
  state: BridgeConnectionState | null | undefined,
) {
  return Boolean(
    !runtime ||
      !state ||
      runtime.capabilityState === "idle" ||
      runtime.capabilityState === "probing" ||
      state.connectionKey !== runtime.generationKey ||
      state.loadState !== "ready" ||
      state.snapshot === null,
  );
}

export function useWorldConversationController({
  active,
  compact,
  projection,
  getRuntime,
  connectionStates,
  onSelectBridge,
  onSelectKey,
  onStatus,
  onOpenInSpaces,
  agentActivityTransitions,
  touchInput,
  terminalFontSizePx,
  terminalScreenReaderText,
  mobileControlsScalePercent,
  mobileTapTarget,
  mobileLongPressBehavior,
  mobileTouchSelectionEndpointTimeoutMs,
  mobileCommandExpandingInput,
  mobileCommandEnterNewline,
  terminalInputTransport,
  terminalInputBatchDelayMs,
  terminalOutputCoalesceMs,
}: UseWorldConversationControllerOptions): WorldConversationController {
  const [targets, setTargets] = useState<WorldConversationTarget[]>(readWorldConversationTargets);
  const cacheRef = useRef<Map<string, WorldConversationView>>(new Map());

  useEffect(() => {
    writeWorldConversationTargets(targets);
  }, [targets]);

  const open = useCallback((target: WorldConversationTargetInput) => {
    const windowId = worldConversationWindowId(target.bridgeId, target.paneId);
    const nextTarget = { ...target, windowId };
    const existing = targets.some(({ windowId: id }) => id === windowId);
    if (!existing && !compact && targets.length >= MAX_WORLD_CONVERSATIONS) {
      onStatus("Five World terminals are open. Close one before opening another.");
      return;
    }
    onSelectBridge(target.bridgeId);
    onSelectKey(target.agentKey ?? target.targetKey);
    onStatus(null);
    setTargets((current) => {
      const index = current.findIndex(({ windowId: id }) => id === windowId);
      if (index < 0) {
        return compact ? [nextTarget] : [...current, nextTarget];
      }
      return current.map((currentTarget, currentIndex) =>
        currentIndex === index ? nextTarget : currentTarget,
      );
    });
  }, [compact, onSelectBridge, onSelectKey, onStatus, targets]);

  const close = useCallback((windowId: string) => {
    cacheRef.current.delete(windowId);
    setTargets((current) => current.filter(({ windowId: id }) => id !== windowId));
  }, []);

  const clear = useCallback(() => {
    setTargets([]);
    cacheRef.current.clear();
  }, []);

  const focus = useCallback((windowId: string) => {
    const target = targets.find(({ windowId: id }) => id === windowId);
    if (!target) {
      return;
    }
    onSelectKey(target.agentKey ?? target.targetKey);
    onSelectBridge(target.bridgeId);
    onStatus(null);
  }, [onSelectBridge, onSelectKey, onStatus, targets]);

  const conversations = useMemo(() => {
    if (!active) {
      return [] as WorldConversationView[];
    }
    return targets.flatMap((target) => {
      const agentEntry = target.agentKey
        ? projection.roster.find(({ agent }) => agent.key === target.agentKey) ?? null
        : null;
      const deskEntry = target.kind === "desk"
        ? projection.deskRoster.find(({ desk }) => desk.key === target.targetKey) ?? null
        : null;
      const runtime = getRuntime(target.bridgeId);
      const state = runtime && connectionStates[runtime.id]?.connectionKey === runtime.generationKey
        ? connectionStates[runtime.id]
        : null;
      const pane = state?.snapshot?.panes.find(({ pane_id }) => pane_id === target.paneId) ?? null;
      const agent = agentEntry?.agent ?? null;
      const runtimeMatchesTarget = Boolean(
        runtime && runtime.generationKey === target.generationKey,
      );
      const observationPending = worldConversationObservationPending(runtime, state);
      const paneStillObserved = Boolean(
        state?.snapshot?.panes.some(({ pane_id }) => pane_id === target.paneId),
      );
      if (
        runtimeMatchesTarget &&
        runtime &&
        state &&
        pane &&
        runtimeAdmissionReady(runtime, state, ["snapshot", "terminal_attach"])
      ) {
        const session = terminalSessionDescriptor(runtime, pane, state, ["snapshot"]);
        if (session?.attachEnabled) {
          const next: WorldConversationView = {
            windowId: target.windowId,
            agent,
            targetLabel:
              agent?.displayLabel ??
              pane.display_agent ??
              pane.label ??
              pane.title ??
              pane.terminal_title ??
              "Shell",
            hostLabel: agentEntry?.hostLabel ?? deskEntry?.hostLabel ?? runtime.label,
            pane,
            runtime,
            session,
            targetKey: target.targetKey,
          };
          cacheRef.current.set(target.windowId, next);
          return [next];
        }
      }

      const cached = cacheRef.current.get(target.windowId);
      if (
        runtimeMatchesTarget &&
        cached?.targetKey === target.targetKey &&
        (observationPending || paneStillObserved)
      ) {
        return [{
          ...cached,
          agent: agent ?? cached.agent,
          targetLabel: agent?.displayLabel ?? cached.targetLabel,
          hostLabel: agentEntry?.hostLabel ?? deskEntry?.hostLabel ?? cached.hostLabel,
        }];
      }
      return [];
    });
  }, [active, connectionStates, getRuntime, projection, targets]);

  useEffect(() => {
    officeDebug("conversation:views", {
      visible: conversations.length,
      targets: targets.length,
      windows: conversations.map(({ windowId, targetKey, session }) => ({
        windowId,
        targetKey,
        sessionKey: session.sessionKey,
      })),
      activeSurface: active ? "world" : "spaces",
    });
  }, [active, conversations, targets.length]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const targetsToClose = new Set<string>();
    const targetsToRebind = new Map<string, string>();
    for (const target of targets) {
      const runtime = getRuntime(target.bridgeId);
      const state = runtime ? connectionStates[runtime.id] : null;
      if (worldConversationObservationPending(runtime, state)) {
        continue;
      }
      const paneStillObserved = Boolean(
        state?.snapshot?.panes.some(({ pane_id }) => pane_id === target.paneId),
      );
      if (paneStillObserved && runtime && runtime.generationKey !== target.generationKey) {
        targetsToRebind.set(target.windowId, runtime.generationKey);
        continue;
      }
      if (paneStillObserved) {
        continue;
      }
      targetsToClose.add(target.windowId);
      officeDebug("conversation:cleanup-check", {
        windowId: target.windowId,
        targetKey: target.targetKey,
        activeSurface: "world",
        reason: "pane-absent-from-admitted-snapshot",
      });
    }
    if (targetsToClose.size === 0 && targetsToRebind.size === 0) {
      return;
    }
    for (const windowId of targetsToClose) {
      cacheRef.current.delete(windowId);
    }
    for (const windowId of targetsToRebind.keys()) {
      cacheRef.current.delete(windowId);
    }
    setTargets((current) =>
      current.flatMap((target) => {
        if (targetsToClose.has(target.windowId)) {
          return [];
        }
        const generationKey = targetsToRebind.get(target.windowId);
        return generationKey ? [{ ...target, generationKey }] : [target];
      }),
    );
  }, [active, connectionStates, getRuntime, targets]);

  const panels = useMemo<WorldConversationBubblePanel[]>(
    () => conversations.map((conversation) => ({
      id: conversation.windowId,
      targetKey: conversation.targetKey,
      selectedKey: conversation.agent?.key ?? conversation.targetKey,
      content: (
        <WorldConversationBubble
          key={`${conversation.windowId}:${conversation.session.sessionKey}`}
          agent={conversation.agent}
          targetLabel={conversation.targetLabel}
          hostLabel={conversation.hostLabel}
          pane={conversation.pane}
          runtime={conversation.runtime}
          session={conversation.session}
          onClose={() => close(conversation.windowId)}
          onOpenInSpaces={() =>
            onOpenInSpaces(
              conversation.windowId,
              conversation.runtime.id,
              conversation.pane,
            )
          }
          agentActivityTransitions={agentActivityTransitions}
          terminalScreenReaderText={terminalScreenReaderText}
          touchInput={touchInput}
          terminalFontSizePx={terminalFontSizePx}
          mobileControlsScalePercent={mobileControlsScalePercent}
          mobileTapTarget={mobileTapTarget}
          mobileLongPressBehavior={mobileLongPressBehavior}
          mobileTouchSelectionEndpointTimeoutMs={mobileTouchSelectionEndpointTimeoutMs}
          mobileCommandExpandingInput={mobileCommandExpandingInput}
          mobileCommandEnterNewline={mobileCommandEnterNewline}
          terminalInputTransport={terminalInputTransport}
          terminalInputBatchDelayMs={terminalInputBatchDelayMs}
          terminalOutputCoalesceMs={terminalOutputCoalesceMs}
        />
      ),
    })),
    [
      agentActivityTransitions,
      close,
      conversations,
      mobileCommandEnterNewline,
      mobileCommandExpandingInput,
      mobileControlsScalePercent,
      mobileLongPressBehavior,
      mobileTapTarget,
      mobileTouchSelectionEndpointTimeoutMs,
      onOpenInSpaces,
      terminalFontSizePx,
      terminalInputBatchDelayMs,
      terminalInputTransport,
      terminalOutputCoalesceMs,
      terminalScreenReaderText,
      touchInput,
    ],
  );

  return { panels, open, close, clear, focus };
}
