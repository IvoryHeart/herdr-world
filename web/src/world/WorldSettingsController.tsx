import { useCallback, useEffect, useRef, useState } from "react";

import type { BridgeRuntime } from "../bridge";
import { WorldSettingsDialog } from "./WorldSettingsDialog";
import type { OfficeLongRoomTitleMode, OfficeRoomAlignment } from "./officeGeometry";
import {
  EMPTY_OFFICE_OBSERVABILITY,
  fetchOfficeObservability,
} from "./officeObservability";
import type { OfficeObservability } from "./officeObservability";
import {
  hasStoredWorldSettings,
  readWorldLongRoomTitleMode,
  readWorldRoomAlignment,
  readWorldSettings,
  updateWorldObservabilityConfiguration,
} from "./worldSettings";

export type WorldSettingsController = {
  observability: OfficeObservability;
  roomAlignment: OfficeRoomAlignment;
  longRoomTitleMode: OfficeLongRoomTitleMode;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  markSaved: () => void;
};

type UseWorldSettingsControllerOptions = {
  active: boolean;
  runtimes: readonly BridgeRuntime[];
  onBeforeOpen?: () => void;
};

export function useWorldSettingsController({
  active,
  runtimes,
  onBeforeOpen,
}: UseWorldSettingsControllerOptions): WorldSettingsController {
  const [observability, setObservability] = useState<OfficeObservability>(
    EMPTY_OFFICE_OBSERVABILITY,
  );
  const [roomAlignment, setRoomAlignment] = useState(readWorldRoomAlignment);
  const [longRoomTitleMode, setLongRoomTitleMode] = useState(readWorldLongRoomTitleMode);
  const [isOpen, setOpen] = useState(false);
  const [observabilityRevision, setObservabilityRevision] = useState(0);
  const appliedSettingsRef = useRef(new Map<string, string>());
  const settingsSyncRef = useRef(new Map<string, Promise<void>>());

  const open = useCallback(() => {
    onBeforeOpen?.();
    setOpen(true);
  }, [onBeforeOpen]);
  const close = useCallback(() => setOpen(false), []);
  const markSaved = useCallback(() => {
    setObservabilityRevision((revision) => revision + 1);
    setRoomAlignment(readWorldRoomAlignment());
    setLongRoomTitleMode(readWorldLongRoomTitleMode());
  }, []);

  const synchronizeStoredSettings = useCallback(async (
    currentRuntimes: readonly BridgeRuntime[],
  ) => {
    const pending: Promise<void>[] = [];
    for (const runtime of currentRuntimes) {
      const inFlight = settingsSyncRef.current.get(runtime.id);
      if (inFlight) {
        pending.push(inFlight);
        continue;
      }
      if (
        runtime.capabilityState !== "ready" ||
        !runtime.canConnect ||
        !hasStoredWorldSettings(runtime.id)
      ) {
        continue;
      }
      const settings = readWorldSettings(runtime.id);
      if (!settings) {
        continue;
      }
      const value = settings.prometheusUrl ?? "";
      const marker = `${runtime.generationKey}:${value}`;
      if (appliedSettingsRef.current.get(runtime.id) === marker) {
        continue;
      }
      appliedSettingsRef.current.set(runtime.id, marker);
      const sync: Promise<void> = updateWorldObservabilityConfiguration(
        runtime,
        settings.prometheusUrl,
      )
        .then(() => undefined)
        .catch(() => {
          appliedSettingsRef.current.delete(runtime.id);
        });
      settingsSyncRef.current.set(runtime.id, sync);
      void sync.finally(() => {
        if (settingsSyncRef.current.get(runtime.id) === sync) {
          settingsSyncRef.current.delete(runtime.id);
        }
      });
      pending.push(sync);
    }
    await Promise.all(pending);
  }, []);

  useEffect(() => {
    void synchronizeStoredSettings(runtimes);
  }, [runtimes, synchronizeStoredSettings]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let disposed = false;
    const refresh = async () => {
      await synchronizeStoredSettings(runtimes);
      if (disposed) {
        return;
      }
      const next = await fetchOfficeObservability(runtimes).catch(() => ({
        ...EMPTY_OFFICE_OBSERVABILITY,
        health: "degraded" as const,
      }));
      if (!disposed) {
        setObservability(next);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [active, observabilityRevision, runtimes, synchronizeStoredSettings]);

  return {
    observability,
    roomAlignment,
    longRoomTitleMode,
    isOpen,
    open,
    close,
    markSaved,
  };
}

export function WorldSettingsOverlay({
  controller,
}: {
  controller: WorldSettingsController;
}) {
  return controller.isOpen ? (
    <WorldSettingsDialog onClose={controller.close} onSaved={controller.markSaved} />
  ) : null;
}
