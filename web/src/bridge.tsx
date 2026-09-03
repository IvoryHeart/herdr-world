import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  BridgeAuthenticationError,
  BridgeDiagnosticError,
  bridgeWebSocketProtocols,
  setBridgePasswordPromptHandler,
} from "./bridgeApi";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { normalizeHostProfileId, normalizeHostProfileLabel } from "./hostProfile";
import { addNativeResumeHandler } from "./native";
import { officeDebug } from "./officeDebug";
import {
  parseObservabilityCapability,
  type BridgeObservabilityCapability,
} from "./observability";

export const SAME_ORIGIN_BRIDGE_ID = "same-origin";

export function sameOriginHostLabel(): string {
  const hostname = globalThis.location?.hostname?.trim();
  if (
    !hostname
    || hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]"
  ) {
    return "localhost";
  }
  return hostname;
}

export type BridgeId = string;

export type BridgeBackendProfile = {
  id: string;
  name: string;
  baseUrl: string;
  color?: string;
  lastConnectedAt?: string;
};

export type BridgeBackendStore = {
  version: 2;
  enabledBridgeIds: BridgeId[];
  lastSelectedBridgeId: BridgeId | null;
  backends: BridgeBackendProfile[];
};

export type BridgeMode = "same-origin" | "configured";

export type BridgeCapabilities = {
  bridge_api_version?: number;
  bridge_version?: string;
  herdr_version?: string;
  terminal_protocol?: number;
  configured_label?: string;
  features?: string[];
  commands: string[];
  agent_activity?: {
    version: 1;
  };
  agent_pins?: {
    version: 1;
  };
  notes?: {
    version: 1;
  };
  launcher_presets?: {
    version: 1;
  };
  web_compat?: number;
  min_android_app_compat?: number;
  authentication?: {
    required: boolean;
    session: "bearer";
    local_peer_bypass: boolean;
  };
  observability?: BridgeObservabilityCapability;
};

export type CapabilityState =
  | "idle"
  | "probing"
  | "ready"
  | "error"
  | "offline"
  | "incompatible";

type BridgeProbeState = {
  connectionKey: string;
  capabilityGeneration: number;
  capabilities: BridgeCapabilities | null;
  capabilityState: CapabilityState;
  capabilityError: string | null;
  connectionBlocked: boolean;
};

export type BridgeRuntime = {
  id: BridgeId;
  mode: BridgeMode;
  label: string;
  color: string;
  backend: BridgeBackendProfile | null;
  connectionKey: string;
  capabilityGeneration: number;
  generationKey: string;
  resumeToken: number;
  capabilities: BridgeCapabilities | null;
  capabilityState: CapabilityState;
  capabilityError: string | null;
  canConnect: boolean;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
};

export type BridgeManager = {
  store: BridgeBackendStore;
  storeLoaded: boolean;
  sameOriginAvailable: boolean;
  availableRuntimes: BridgeRuntime[];
  enabledRuntimes: BridgeRuntime[];
  enabledBridgeIds: BridgeId[];
  lastSelectedBridgeId: BridgeId | null;
  getRuntime: (bridgeId: BridgeId | null | undefined) => BridgeRuntime | null;
  setBridgeEnabled: (bridgeId: BridgeId, enabled: boolean) => void;
  setAllBridgesEnabled: (enabled: boolean) => void;
  setLastSelectedBridgeId: (bridgeId: BridgeId | null) => void;
  markBridgeUsed: (bridgeId: BridgeId) => void;
  retryBridgeProbe: (bridgeId: BridgeId) => void;
  addBackend: (input: BackendInput, enable?: boolean) => Promise<BridgeBackendProfile>;
  updateBackend: (id: string, input: BackendInput) => Promise<BridgeBackendProfile>;
  deleteBackend: (id: string) => void;
  probeBackend: (baseUrl: string) => Promise<BridgeCapabilities>;
};

export type BackendInput = {
  name?: string;
  baseUrl: string;
  color?: string;
};

const STORE_KEY = "herdrWeb.bridgeBackends.v2";
const LEGACY_STORE_KEY = "herdrWeb.bridgeBackends.v1";
const NOTE_DRAFT_STORAGE_PREFIX = "herdr-web:note-draft:v1:";
const STORE_VERSION = 2;
const APP_MIN_WEB_COMPAT = 1;
const APP_BRIDGE_API_VERSION = 1;
const APP_TERMINAL_PROTOCOL = 20;
const APP_MIN_HERDR_VERSION = [0, 8, 2] as const;
const MAX_CAPABILITY_STRING_LENGTH = 120;
const MAX_CAPABILITY_LIST_LENGTH = 128;
export const SAME_ORIGIN_BRIDGE_COLOR = "#b4befe";
const BACKEND_COLOR_PALETTE = [
  "#89b4fa",
  "#a6e3a1",
  "#f9e2af",
  "#fab387",
  "#94e2d5",
  "#f38ba8",
  "#cba6f7",
  "#74c7ec",
] as const;

const BridgeContext = createContext<BridgeManager | null>(null);

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<BridgeBackendStore>(() => fallbackStore());
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [probeStates, setProbeStates] = useState<Record<string, BridgeProbeState>>({});
  const [probeRetryTokens, setProbeRetryTokens] = useState<Record<string, number>>({});
  const [resumeToken, setResumeToken] = useState(0);
  const storeEditedRef = useRef(false);
  const [passwordPrompts, setPasswordPrompts] = useState<{
    origin: string;
    resolve: (password: string | null) => void;
  }[]>([]);

  const sameOriginAvailable = defaultBridgeMode() === "same-origin";

  useEffect(() => {
    setBridgePasswordPromptHandler(
      (origin) =>
        new Promise<string | null>((resolve) => {
          setPasswordPrompts((current) => [...current, { origin, resolve }]);
        }),
    );
    return () => setBridgePasswordPromptHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadBackendStore().then((next) => {
      if (!cancelled) {
        setStore((current) => (storeEditedRef.current ? current : next));
        setStoreLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return addNativeResumeHandler(() => {
      setResumeToken((token) => token + 1);
    });
  }, []);

  useEffect(() => {
    if (storeLoaded) {
      void writeBackendStore(store);
    }
  }, [store, storeLoaded]);

  const availableRuntimes = useMemo(
    () =>
      buildAvailableRuntimes({
        backends: store.backends,
        capabilityGenerations: probeRetryTokens,
        probeStates,
        resumeToken,
        sameOriginAvailable,
      }),
    [probeRetryTokens, probeStates, resumeToken, sameOriginAvailable, store.backends],
  );

  const availableRuntimeIds = useMemo(
    () => new Set(availableRuntimes.map((runtime) => runtime.id)),
    [availableRuntimes],
  );

  const enabledBridgeIds = useMemo(
    () => store.enabledBridgeIds.filter((bridgeId) => availableRuntimeIds.has(bridgeId)),
    [availableRuntimeIds, store.enabledBridgeIds],
  );

  const enabledRuntimes = useMemo(
    () => availableRuntimes.filter((runtime) => enabledBridgeIds.includes(runtime.id)),
    [availableRuntimes, enabledBridgeIds],
  );

  useEffect(() => {
    const availableIds = new Set(availableRuntimes.map((runtime) => runtime.id));
    setProbeStates((current) => {
      let changed = false;
      const next: Record<string, BridgeProbeState> = {};
      for (const [bridgeId, state] of Object.entries(current)) {
        if (availableIds.has(bridgeId)) {
          next[bridgeId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [availableRuntimes]);

  const setBridgeEnabled = useCallback((bridgeId: BridgeId, enabled: boolean) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (!isAvailableBridgeId(bridgeId, current.backends, defaultBridgeMode() === "same-origin")) {
        return current;
      }
      if (current.enabledBridgeIds.includes(bridgeId) === enabled) {
        return current;
      }
      const enabledIds = new Set(current.enabledBridgeIds);
      if (enabled) {
        enabledIds.add(bridgeId);
      } else {
        enabledIds.delete(bridgeId);
      }
      const enabledBridgeIds = normalizeEnabledBridgeIds(
        [...enabledIds],
        current.backends,
        defaultBridgeMode() === "same-origin",
      );
      const lastSelectedBridgeId =
        current.lastSelectedBridgeId && enabledBridgeIds.includes(current.lastSelectedBridgeId)
          ? current.lastSelectedBridgeId
          : enabledBridgeIds[0] ?? null;
      return {
        ...current,
        enabledBridgeIds,
        lastSelectedBridgeId,
        backends: current.backends,
      };
    });
  }, []);

  const setAllBridgesEnabled = useCallback((enabled: boolean) => {
    storeEditedRef.current = true;
    setStore((current) => {
      const enabledBridgeIds = enabled
        ? allAvailableBridgeIds(current.backends, defaultBridgeMode() === "same-origin")
        : [];
      const lastSelectedBridgeId = enabled
        ? current.lastSelectedBridgeId && enabledBridgeIds.includes(current.lastSelectedBridgeId)
          ? current.lastSelectedBridgeId
          : enabledBridgeIds[0] ?? null
        : null;
      return {
        ...current,
        enabledBridgeIds,
        lastSelectedBridgeId,
      };
    });
  }, []);

  const setLastSelectedBridgeId = useCallback((bridgeId: BridgeId | null) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (bridgeId === null) {
        return current.lastSelectedBridgeId === null
          ? current
          : { ...current, lastSelectedBridgeId: null };
      }
      if (!current.enabledBridgeIds.includes(bridgeId) || current.lastSelectedBridgeId === bridgeId) {
        return current;
      }
      return {
        ...current,
        lastSelectedBridgeId: bridgeId,
      };
    });
  }, []);

  const markBridgeUsed = useCallback((bridgeId: BridgeId) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (!current.enabledBridgeIds.includes(bridgeId) || current.lastSelectedBridgeId === bridgeId) {
        return current;
      }
      return {
        ...current,
        lastSelectedBridgeId: bridgeId,
      };
    });
  }, []);

  const markBridgeReachable = useCallback((bridgeId: BridgeId) => {
    if (bridgeId === SAME_ORIGIN_BRIDGE_ID) {
      return;
    }
    setStore((current) => {
      if (!current.backends.some((backend) => backend.id === bridgeId)) {
        return current;
      }
      return {
        ...current,
        backends: markBackendConnected(current.backends, bridgeId),
      };
    });
  }, []);

  const retryBridgeProbe = useCallback((bridgeId: BridgeId) => {
    setProbeRetryTokens((current) => ({
      ...current,
      [bridgeId]: (current[bridgeId] ?? 0) + 1,
    }));
  }, []);

  const addBackend = useCallback(async (input: BackendInput, enable = false) => {
    const baseUrl = normalizeBridgeBaseUrl(input.baseUrl);
    const id = createBackendId();
    const profile: BridgeBackendProfile = {
      id,
      name: backendDisplayName(input.name, baseUrl, store.backends),
      baseUrl,
      color: normalizeBackendColor(input.color) ?? suggestBackendColor(store.backends, id),
      lastConnectedAt: undefined,
    };
    storeEditedRef.current = true;
    setStore((current) => {
      const enabledBridgeIds = enable
        ? normalizeEnabledBridgeIds(
            [...current.enabledBridgeIds, profile.id],
            [...current.backends, profile],
            defaultBridgeMode() === "same-origin",
          )
        : current.enabledBridgeIds;
      return {
        version: STORE_VERSION,
        enabledBridgeIds,
        lastSelectedBridgeId: enable ? profile.id : current.lastSelectedBridgeId,
        backends: [...current.backends, profile],
      };
    });
    return profile;
  }, [store.backends]);

  const updateBackend = useCallback(async (id: string, input: BackendInput) => {
    const existing = store.backends.find((backend) => backend.id === id);
    if (!existing) {
      throw new Error("Backend not found");
    }
    storeEditedRef.current = true;
    const baseUrl = normalizeBridgeBaseUrl(input.baseUrl);
    if (baseUrl !== existing.baseUrl) {
      removeNoteDraftsForBridgeConnection(id, configuredBridgeConnectionKey(id, existing.baseUrl));
    }
    const otherBackends = store.backends.filter((backend) => backend.id !== id);
    const updated: BridgeBackendProfile = {
      ...existing,
      name: backendDisplayName(input.name, baseUrl, otherBackends),
      baseUrl,
      color: normalizeBackendColor(input.color) ?? existing.color,
      lastConnectedAt: existing.lastConnectedAt,
    };
    setStore((current) => {
      if (!current.backends.some((backend) => backend.id === id)) {
        return current;
      }
      return {
        ...current,
        backends: current.backends.map((backend) => (backend.id === id ? updated : backend)),
      };
    });
    return updated;
  }, [store.backends, store.enabledBridgeIds]);

  const deleteBackend = useCallback((id: string) => {
    const existing = store.backends.find((backend) => backend.id === id);
    if (existing) {
      removeNoteDraftsForBridgeConnection(id, configuredBridgeConnectionKey(id, existing.baseUrl));
    }
    storeEditedRef.current = true;
    setStore((current) => {
      const backends = current.backends.filter((backend) => backend.id !== id);
      const enabledBridgeIds = current.enabledBridgeIds.filter((bridgeId) => bridgeId !== id);
      const lastSelectedBridgeId =
        current.lastSelectedBridgeId === id ? (enabledBridgeIds[0] ?? null) : current.lastSelectedBridgeId;
      return {
        version: STORE_VERSION,
        enabledBridgeIds,
        lastSelectedBridgeId,
        backends,
      };
    });
  }, [store.backends]);

  const probeBackend = useCallback((baseUrl: string) => probeBridgeBaseUrl(baseUrl), []);

  const getRuntime = useCallback(
    (bridgeId: BridgeId | null | undefined) =>
      bridgeId ? (availableRuntimes.find((runtime) => runtime.id === bridgeId) ?? null) : null,
    [availableRuntimes],
  );

  const value = useMemo<BridgeManager>(
    () => ({
      store,
      storeLoaded,
      sameOriginAvailable,
      availableRuntimes,
      enabledRuntimes,
      enabledBridgeIds,
      lastSelectedBridgeId:
        store.lastSelectedBridgeId && enabledBridgeIds.includes(store.lastSelectedBridgeId)
          ? store.lastSelectedBridgeId
          : (enabledBridgeIds[0] ?? null),
      getRuntime,
      setBridgeEnabled,
      setAllBridgesEnabled,
      setLastSelectedBridgeId,
      markBridgeUsed,
      retryBridgeProbe,
      addBackend,
      updateBackend,
      deleteBackend,
      probeBackend,
    }),
    [
      addBackend,
      availableRuntimes,
      deleteBackend,
      enabledBridgeIds,
      enabledRuntimes,
      getRuntime,
      markBridgeUsed,
      probeBackend,
      retryBridgeProbe,
      sameOriginAvailable,
      setBridgeEnabled,
      setAllBridgesEnabled,
      setLastSelectedBridgeId,
      store,
      storeLoaded,
      updateBackend,
    ],
  );

  return (
    <BridgeContext.Provider value={value}>
      {children}
      {enabledRuntimes.map((runtime) => (
        <BridgeCapabilityProbe
          key={`${runtime.connectionKey}:${runtime.resumeToken}`}
          runtime={runtime}
          onReach={markBridgeReachable}
          onState={(state) =>
            setProbeStates((current) => ({
              ...current,
              [runtime.id]: state,
            }))
          }
        />
      ))}
      {passwordPrompts[0] ? (
        <BridgePasswordPrompt
          origin={passwordPrompts[0].origin}
          onCancel={() => {
            passwordPrompts[0].resolve(null);
            setPasswordPrompts((current) => current.slice(1));
          }}
          onSubmit={(password) => {
            passwordPrompts[0].resolve(password);
            setPasswordPrompts((current) => current.slice(1));
          }}
        />
      ) : null}
    </BridgeContext.Provider>
  );
}

function BridgePasswordPrompt({
  origin,
  onCancel,
  onSubmit,
}: {
  origin: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="overlay-root bridge-auth-overlay">
      <button
        className="overlay-scrim"
        type="button"
        aria-label="Cancel bridge authentication"
        onClick={onCancel}
      />
      <form
        className="modal bridge-auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bridge-auth-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (password) onSubmit(password);
        }}
      >
        <div id="bridge-auth-title" className="modal-title">Bridge password</div>
        <p className="backend-note">
          Enter the password for {origin}. It stays in memory for this browser session only.
        </p>
        <label className="field-label">
          <span>Password</span>
          <input
            ref={inputRef}
            className="field"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!password}>Connect</button>
        </div>
      </form>
    </div>
  );
}

function BridgeCapabilityProbe({
  runtime,
  onReach,
  onState,
}: {
  runtime: BridgeRuntime;
  onReach: (bridgeId: BridgeId) => void;
  onState: (state: BridgeProbeState) => void;
}) {
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const onStateRef = useRef(onState);
  const httpUrlRef = useRef(runtime.httpUrl);

  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  useEffect(() => {
    httpUrlRef.current = runtime.httpUrl;
  }, [runtime.httpUrl]);

  useEffect(() => {
    setCapabilityRetry(0);
  }, [runtime.capabilityGeneration, runtime.connectionKey]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    officeDebug("capability-probe:start", {
      bridgeId: runtime.id,
      connectionKey: runtime.connectionKey,
      capabilityGeneration: runtime.capabilityGeneration,
      retry: capabilityRetry,
    });
    onStateRef.current({
      connectionKey: runtime.connectionKey,
      capabilityGeneration: runtime.capabilityGeneration,
      capabilities: null,
      capabilityState: "probing",
      capabilityError: null,
      connectionBlocked: false,
    });
    void fetchCapabilities(httpUrlRef.current)
      .then((next) => {
        if (cancelled) {
          return;
        }
        const outcome = capabilityProbeSuccess(next);
        officeDebug("capability-probe:success", {
          bridgeId: runtime.id,
          capabilityState: outcome.state,
          retry: capabilityRetry,
          featureCount: next.features?.length ?? 0,
        });
        if (outcome.state === "ready") {
          onReach(runtime.id);
        }
        onStateRef.current({
          connectionKey: runtime.connectionKey,
          capabilityGeneration: runtime.capabilityGeneration,
          capabilities: outcome.capabilities,
          capabilityState: outcome.state,
          capabilityError: outcome.error,
          connectionBlocked: outcome.blocked,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const outcome = capabilityProbeFailure(error);
        officeDebug("capability-probe:failure", {
          bridgeId: runtime.id,
          capabilityState: outcome.state,
          retry: capabilityRetry,
          willRetry: outcome.retry,
          error: outcome.error,
        });
        onStateRef.current({
          connectionKey: runtime.connectionKey,
          capabilityGeneration: runtime.capabilityGeneration,
          capabilities: outcome.capabilities,
          capabilityState: outcome.state,
          capabilityError: outcome.error,
          connectionBlocked: outcome.blocked,
        });
        if (outcome.retry) {
          const retryDelay = capabilityRetryDelayMs(capabilityRetry);
          officeDebug("capability-probe:retry-scheduled", {
            bridgeId: runtime.id,
            retry: capabilityRetry + 1,
            delayMs: retryDelay,
          });
          retryTimer = window.setTimeout(() => {
            setCapabilityRetry((current) => current + 1);
          }, retryDelay);
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    capabilityRetry,
    onReach,
    runtime.capabilityGeneration,
    runtime.connectionKey,
    runtime.id,
  ]);

  return null;
}

export function useBridge() {
  const value = useContext(BridgeContext);
  if (!value) {
    throw new Error("useBridge must be used inside BridgeProvider");
  }
  return value;
}

function buildAvailableRuntimes({
  backends,
  capabilityGenerations,
  probeStates,
  resumeToken,
  sameOriginAvailable,
}: {
  backends: BridgeBackendProfile[];
  capabilityGenerations: Record<string, number>;
  probeStates: Record<string, BridgeProbeState>;
  resumeToken: number;
  sameOriginAvailable: boolean;
}) {
  const runtimes: BridgeRuntime[] = [];
  if (sameOriginAvailable) {
    runtimes.push(
      createBridgeRuntime({
        id: SAME_ORIGIN_BRIDGE_ID,
        mode: "same-origin",
        label: sameOriginHostLabel(),
        backend: null,
        baseUrl: null,
        capabilityGeneration: capabilityGenerations[SAME_ORIGIN_BRIDGE_ID] ?? 0,
        probeState: probeStates[SAME_ORIGIN_BRIDGE_ID],
        resumeToken,
      }),
    );
  }
  for (const backend of backends) {
    runtimes.push(
      createBridgeRuntime({
        id: backend.id,
        mode: "configured",
        label: backend.name,
        backend,
        baseUrl: backend.baseUrl,
        capabilityGeneration: capabilityGenerations[backend.id] ?? 0,
        probeState: probeStates[backend.id],
        resumeToken,
      }),
    );
  }
  return runtimes;
}

function createBridgeRuntime({
  id,
  mode,
  label,
  backend,
  baseUrl,
  capabilityGeneration,
  probeState,
  resumeToken,
}: {
  id: BridgeId;
  mode: BridgeMode;
  label: string;
  backend: BridgeBackendProfile | null;
  baseUrl: string | null;
  capabilityGeneration: number;
  probeState: BridgeProbeState | undefined;
  resumeToken: number;
}): BridgeRuntime {
  const connectionKey =
    mode === "same-origin"
      ? SAME_ORIGIN_BRIDGE_ID
      : configuredBridgeConnectionKey(id, baseUrl ?? "");
  const currentProbeState =
    probeState?.connectionKey === connectionKey &&
    probeState.capabilityGeneration === capabilityGeneration
      ? probeState
      : undefined;
  const httpUrl = (path: string, query?: URLSearchParams) => buildHttpUrl(baseUrl, path, query);
  const wsUrl = (path: string, query?: URLSearchParams) => buildWsUrl(baseUrl, path, query);
  const color =
    backend?.color ?? (mode === "same-origin" ? SAME_ORIGIN_BRIDGE_COLOR : fallbackBackendColor(id));
  return {
    id,
    mode,
    label,
    color,
    backend,
    connectionKey,
    capabilityGeneration,
    generationKey: `${connectionKey}:capability:${capabilityGeneration}`,
    resumeToken,
    capabilities: currentProbeState?.capabilities ?? null,
    capabilityState: currentProbeState?.capabilityState ?? "idle",
    capabilityError: currentProbeState?.capabilityError ?? null,
    canConnect: !currentProbeState?.connectionBlocked,
    httpUrl,
    wsUrl,
  };
}

export async function loadBackendStore(): Promise<BridgeBackendStore> {
  if (isNativeApp()) {
    try {
      const { value } = await Preferences.get({ key: STORE_KEY });
      if (value) {
        return parseBackendStore(JSON.parse(value));
      }
    } catch {
      // Fall through to browser storage and legacy migration.
    }
  }

  const localStore = readBackendStoreKey(STORE_KEY);
  if (localStore) {
    if (isNativeApp()) {
      await writeBackendStore(localStore);
    }
    return localStore;
  }

  const legacyStore = await loadLegacyBackendStore();
  if (legacyStore) {
    await writeBackendStore(legacyStore);
    await removeLegacyBackendStore();
    return legacyStore;
  }

  return fallbackStore();
}

export function readBackendStore(): BridgeBackendStore {
  return readBackendStoreKey(STORE_KEY) ?? fallbackStore();
}

function readBackendStoreKey(key: string): BridgeBackendStore | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) {
      return null;
    }
    return parseBackendStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function loadLegacyBackendStore(): Promise<BridgeBackendStore | null> {
  if (isNativeApp()) {
    try {
      const { value } = await Preferences.get({ key: LEGACY_STORE_KEY });
      if (value) {
        return parseBackendStore(JSON.parse(value));
      }
    } catch {
      // Fall through to localStorage backup.
    }
  }
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_STORE_KEY);
    if (!raw) {
      return null;
    }
    return parseBackendStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function removeLegacyBackendStore() {
  if (isNativeApp()) {
    try {
      await Preferences.remove({ key: LEGACY_STORE_KEY });
    } catch {
      // Browser storage cleanup below remains best effort.
    }
  }
  try {
    globalThis.localStorage?.removeItem(LEGACY_STORE_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export async function writeBackendStore(store: BridgeBackendStore) {
  const value = JSON.stringify(store);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: STORE_KEY, value });
    } catch {
      // Browser storage below remains a best-effort backup.
    }
  }
  try {
    globalThis.localStorage?.setItem(STORE_KEY, value);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function parseBackendStore(value: unknown): BridgeBackendStore {
  if (!isRecord(value) || !Array.isArray(value.backends)) {
    return fallbackStore();
  }
  if (value.version === STORE_VERSION) {
    return parseBackendStoreV2(value);
  }
  if (value.version === 1) {
    return migrateLegacyBackendStore(value);
  }
  return fallbackStore();
}

function parseBackendStoreV2(value: Record<string, unknown>): BridgeBackendStore {
  const rawBackends = Array.isArray(value.backends) ? value.backends : [];
  const backends = parseBackendProfiles(rawBackends);
  const sameOriginAvailable = defaultBridgeMode() === "same-origin";
  const enabledBridgeIds = normalizeEnabledBridgeIds(
    Array.isArray(value.enabledBridgeIds) ? value.enabledBridgeIds : [],
    backends,
    sameOriginAvailable,
  );
  const lastSelectedBridgeId =
    typeof value.lastSelectedBridgeId === "string" &&
    enabledBridgeIds.includes(value.lastSelectedBridgeId)
      ? value.lastSelectedBridgeId
      : (enabledBridgeIds[0] ?? null);
  return { version: STORE_VERSION, enabledBridgeIds, lastSelectedBridgeId, backends };
}

function migrateLegacyBackendStore(value: Record<string, unknown>): BridgeBackendStore {
  const rawBackends = Array.isArray(value.backends) ? value.backends : [];
  const backends = parseBackendProfiles(rawBackends);
  const activeBackendId =
    typeof value.activeBackendId === "string" &&
    backends.some((backend) => backend.id === value.activeBackendId)
      ? value.activeBackendId
      : null;
  const sameOriginAvailable = defaultBridgeMode() === "same-origin";
  const enabledBridgeIds = activeBackendId
    ? [activeBackendId]
    : sameOriginAvailable
      ? [SAME_ORIGIN_BRIDGE_ID]
      : [];
  const lastSelectedBridgeId = enabledBridgeIds[0] ?? null;
  return { version: STORE_VERSION, enabledBridgeIds, lastSelectedBridgeId, backends };
}

function parseBackendProfile(value: unknown): BridgeBackendProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id === SAME_ORIGIN_BRIDGE_ID ||
    typeof value.name !== "string" ||
    typeof value.baseUrl !== "string"
  ) {
    return null;
  }
  try {
    const id = normalizeHostProfileId(value.id);
    if (!id) {
      return null;
    }
    const baseUrl = normalizeBridgeBaseUrl(value.baseUrl);
    return {
      id,
      name: normalizeHostProfileLabel(value.name, displayNameFromUrl(baseUrl)),
      baseUrl,
      color: normalizeBackendColor(value.color) ?? undefined,
      lastConnectedAt: typeof value.lastConnectedAt === "string" ? value.lastConnectedAt : undefined,
    };
  } catch {
    return null;
  }
}

function parseBackendProfiles(values: unknown[]) {
  const backends: BridgeBackendProfile[] = [];
  const profileIds = new Set<string>();
  for (const value of values) {
    const backend = parseBackendProfile(value);
    if (!backend || profileIds.has(backend.id)) {
      continue;
    }
    profileIds.add(backend.id);
    backends.push(backend);
  }
  return backends;
}

function fallbackStore(): BridgeBackendStore {
  const enabledBridgeIds = defaultBridgeMode() === "same-origin" ? [SAME_ORIGIN_BRIDGE_ID] : [];
  return {
    version: STORE_VERSION,
    enabledBridgeIds,
    lastSelectedBridgeId: enabledBridgeIds[0] ?? null,
    backends: [],
  };
}

function normalizeEnabledBridgeIds(
  ids: unknown[],
  backends: readonly BridgeBackendProfile[],
  sameOriginAvailable: boolean,
) {
  const result: BridgeId[] = [];
  const availableIds = new Set(allAvailableBridgeIds(backends, sameOriginAvailable));
  for (const id of ids) {
    if (typeof id === "string" && availableIds.has(id) && !result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}

export function allAvailableBridgeIds(
  backends: readonly BridgeBackendProfile[],
  sameOriginAvailable: boolean,
): BridgeId[] {
  return [
    ...(sameOriginAvailable ? [SAME_ORIGIN_BRIDGE_ID] : []),
    ...backends.map((backend) => backend.id),
  ];
}

function isAvailableBridgeId(
  bridgeId: BridgeId,
  backends: readonly BridgeBackendProfile[],
  sameOriginAvailable: boolean,
) {
  return (
    (sameOriginAvailable && bridgeId === SAME_ORIGIN_BRIDGE_ID) ||
    backends.some((backend) => backend.id === bridgeId)
  );
}

function markBackendConnected(
  backends: readonly BridgeBackendProfile[],
  bridgeId: BridgeId,
): BridgeBackendProfile[] {
  if (bridgeId === SAME_ORIGIN_BRIDGE_ID) {
    return [...backends];
  }
  const connectedAt = new Date().toISOString();
  return backends.map((backend) =>
    backend.id === bridgeId ? { ...backend, lastConnectedAt: connectedAt } : backend,
  );
}

function defaultBridgeMode(): "same-origin" | "disconnected" {
  return isNativeApp() ? "disconnected" : "same-origin";
}

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function normalizeBridgeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a bridge URL");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Bridge URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bridge URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Bridge URL must not include credentials");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Bridge URL must not include a path, query, or fragment");
  }
  validateBridgeHost(url.hostname);
  return url.origin;
}

function validateBridgeHost(hostname: string) {
  const host = stripIpv6Brackets(hostname).toLowerCase();
  if (!host) {
    throw new Error("Bridge URL must include a host");
  }
  if (parseIpv4(host)) {
    return;
  }
  if (isIpv6Literal(host)) {
    return;
  }
  if (!isValidHostname(host)) {
    throw new Error("Bridge hostname is invalid");
  }
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function parseIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => {
    if (!/^\d+$/u.test(part)) {
      return Number.NaN;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return bytes.every(Number.isFinite) ? bytes : null;
}

function isIpv6Literal(host: string) {
  return host.includes(":");
}

function isValidHostname(host: string) {
  if (host.length > 253) {
    return false;
  }
  return host
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

export function buildHttpUrl(
  baseUrl: string | null,
  path: string,
  query?: URLSearchParams,
): string {
  const normalizedPath = normalizeEndpointPath(path);
  const suffix = query && query.toString() ? `?${query.toString()}` : "";
  if (!baseUrl) {
    return `${normalizedPath}${suffix}`;
  }
  const url = new URL(normalizedPath, baseUrl);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

export function buildWsUrl(
  baseUrl: string | null,
  path: string,
  query?: URLSearchParams,
): string {
  const normalizedPath = normalizeEndpointPath(path);
  const suffix = query && query.toString() ? `?${query.toString()}` : "";
  if (!baseUrl) {
    const location = globalThis.location;
    const protocol = location?.protocol === "https:" ? "wss:" : "ws:";
    const host = location?.host || "localhost";
    return `${protocol}//${host}${normalizedPath}${suffix}`;
  }
  const url = new URL(normalizedPath, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

export function configuredBridgeConnectionKey(id: BridgeId, baseUrl: string) {
  return `configured:${id}:${baseUrl}`;
}

export function removeNoteDraftsForBridgeConnection(bridgeId: BridgeId, connectionKey: string) {
  const draftPrefix = `${NOTE_DRAFT_STORAGE_PREFIX}${encodeURIComponent(
    bridgeId,
  )}:${encodeURIComponent(connectionKey)}:`;
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return;
    }
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(draftPrefix)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // Draft cleanup is best-effort; stale keys are isolated by connection key.
  }
}

function normalizeEndpointPath(path: string) {
  if (!path.startsWith("/")) {
    throw new Error("Bridge endpoint path must start with /");
  }
  return path;
}

export async function fetchCapabilities(
  httpUrl: (path: string, query?: URLSearchParams) => string,
): Promise<BridgeCapabilities> {
  const response = await fetchWithTimeout(httpUrl("/api/capabilities"));
  if (!response.ok) {
    throw new BridgeDiagnosticError(capabilityHttpError(response.status));
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new CapabilityContractError("Bridge capability response is malformed");
  }
  return parseCapabilities(value);
}

export async function probeBridgeBaseUrl(baseUrl: string): Promise<BridgeCapabilities> {
  const normalized = normalizeBridgeBaseUrl(baseUrl);
  const capabilities = await fetchCapabilities((path, query) => buildHttpUrl(normalized, path, query));
  const error = compatibilityError(capabilities);
  if (error) {
    throw new Error(error);
  }
  const snapshot = await fetchWithTimeout(buildHttpUrl(normalized, "/api/snapshot"));
  if (!snapshot.ok) {
    throw new BridgeDiagnosticError(capabilityHttpError(snapshot.status));
  }
  let snapshotValue: unknown;
  try {
    snapshotValue = await snapshot.json();
  } catch {
    throw new BridgeDiagnosticError("Bridge snapshot response is malformed");
  }
  if (!isRecord(snapshotValue)) {
    throw new BridgeDiagnosticError("Bridge snapshot response is malformed");
  }

  await probeBridgeWebSocket(normalized, "/ws/events", "Bridge WebSocket upgrade");
  const terminalId = firstTerminalId(snapshotValue);
  if (terminalId) {
    const query = new URLSearchParams({
      terminal_id: terminalId,
      takeover: "false",
      probe: "true",
    });
    await probeBridgeWebSocket(
      normalized,
      "/ws/terminal",
      "Bridge terminal attach",
      query,
      true,
    );
  }
  return capabilities;
}

function firstTerminalId(snapshot: Record<string, unknown>) {
  if (!Array.isArray(snapshot.panes)) return null;
  const pane = snapshot.panes.find(
    (value): value is Record<string, unknown> =>
      isRecord(value) && typeof value.terminal_id === "string" && value.terminal_id.length > 0,
  );
  return pane ? pane.terminal_id as string : null;
}

function probeBridgeWebSocket(
  baseUrl: string,
  path: string,
  label: string,
  query?: URLSearchParams,
  waitForMessage = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(new BridgeDiagnosticError(`${label} is unavailable in this browser`));
      return;
    }
    const url = buildWsUrl(baseUrl, path, query);
    let settled = false;
    const timer = globalThis.setTimeout(() => finish(new BridgeDiagnosticError(
      `${label} timed out; check the bridge's Host, Origin, and password settings`,
    )), 5000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, bridgeWebSocketProtocols(url));
    } catch {
      finish(new BridgeDiagnosticError(`${label} could not be opened; check the bridge address`));
      return;
    }
    socket.onopen = () => {
      if (!waitForMessage) {
        finish();
        socket.close();
      }
    };
    socket.onmessage = (event) => {
      if (!waitForMessage) {
        finish();
        socket.close();
        return;
      }
      const diagnostic = terminalProbeMessageError(label, event.data);
      finish(diagnostic ?? undefined);
      socket.close();
    };
    socket.onerror = () => {
      finish(new BridgeDiagnosticError(
        `${label} failed; check the bridge's Host, Origin, and password settings`,
      ));
    };
    socket.onclose = () => {
      if (!settled) {
        finish(new BridgeDiagnosticError(`${label} closed before it was ready`));
      }
    };
  });
}

function terminalProbeMessageError(label: string, data: unknown): Error | null {
  if (typeof data !== "string") {
    return new BridgeDiagnosticError(`${label} returned a malformed readiness frame`);
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return new BridgeDiagnosticError(`${label} returned a malformed readiness frame`);
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return new BridgeDiagnosticError(`${label} returned an unexpected readiness frame`);
  }
  if (value.type === "attach_ready") {
    return null;
  }
  if (value.type === "closed" && typeof value.reason === "string" && value.reason.trim()) {
    return new BridgeDiagnosticError(`${label} failed: ${value.reason.trim()}`);
  }
  return new BridgeDiagnosticError(`${label} returned an unexpected readiness frame (${value.type})`);
}

function capabilityHttpError(status: number) {
  if (status === 401) return "Password required or rejected by the bridge";
  if (status === 403) return "Host or Origin policy rejected the request; check the bridge's allowed page origin";
  if (status === 404) return "Bridge API is unavailable at this address";
  return `Bridge API request failed (${status})`;
}

export type CapabilityProbeOutcome = {
  blocked: boolean;
  state: CapabilityState;
  capabilities: BridgeCapabilities | null;
  error: string | null;
  retry: boolean;
};

export function capabilityProbeSuccess(
  capabilities: BridgeCapabilities,
): CapabilityProbeOutcome {
  const error = compatibilityError(capabilities);
  if (error) {
    return {
      blocked: true,
      state: "incompatible",
      capabilities: null,
      error,
      retry: false,
    };
  }
  return {
    blocked: false,
    state: "ready",
    capabilities,
    error: null,
    retry: false,
  };
}

export function capabilityProbeFailure(error: unknown): CapabilityProbeOutcome {
  const contractFailure = error instanceof CapabilityContractError;
  const authenticationFailure = error instanceof BridgeAuthenticationError;
  const diagnosticFailure = error instanceof BridgeDiagnosticError;
  return {
    blocked: true,
    state: contractFailure ? "incompatible" : "offline",
    capabilities: null,
    error: contractFailure || authenticationFailure || diagnosticFailure ? error.message : "Bridge unavailable",
    retry: !contractFailure,
  };
}

export function capabilityRetryDelayMs(attempt: number) {
  // A bridge can be reachable a moment after the page starts (for example
  // while Herdr is restarting). Keep the first few probes responsive so the
  // Office does not look inert for the full long-tail backoff window.
  return Math.min(1000 * 2 ** Math.max(0, attempt), 10000);
}

export function parseCapabilities(value: unknown): BridgeCapabilities {
  if (!isRecord(value)) {
    throw new CapabilityContractError("Bridge capability response is malformed");
  }
  const bridgeApiVersion = boundedInteger(value.bridge_api_version);
  const terminalProtocol = boundedInteger(value.terminal_protocol);
  const bridgeVersion = boundedCapabilityString(value.bridge_version);
  const herdrVersion = boundedCapabilityString(value.herdr_version);
  if (
    bridgeApiVersion === null ||
    terminalProtocol === null ||
    bridgeVersion === null ||
    herdrVersion === null ||
    !Array.isArray(value.features) ||
    !Array.isArray(value.commands)
  ) {
    throw new CapabilityContractError("Bridge capability response is malformed");
  }
  return {
    bridge_api_version: bridgeApiVersion,
    bridge_version: bridgeVersion,
    herdr_version: herdrVersion,
    terminal_protocol: terminalProtocol,
    configured_label: optionalCapabilityString(value.configured_label),
    features: boundedStringList(value.features) ?? [],
    commands: boundedStringList(value.commands) ?? [],
    web_compat: typeof value.web_compat === "number" ? value.web_compat : undefined,
    min_android_app_compat:
      typeof value.min_android_app_compat === "number" ? value.min_android_app_compat : undefined,
    ...(isRecord(value.authentication) &&
    typeof value.authentication.required === "boolean" &&
    value.authentication.session === "bearer" &&
    typeof value.authentication.local_peer_bypass === "boolean"
      ? {
          authentication: {
            required: value.authentication.required as boolean,
            session: "bearer" as const,
            local_peer_bypass: value.authentication.local_peer_bypass as boolean,
          },
        }
      : {}),
    agent_activity:
      isRecord(value.agent_activity) && value.agent_activity.version === 1
        ? { version: 1 }
        : undefined,
    agent_pins:
      isRecord(value.agent_pins) && value.agent_pins.version === 1
        ? { version: 1 }
        : undefined,
    notes:
      isRecord(value.notes) && value.notes.version === 1
        ? { version: 1 }
        : undefined,
    launcher_presets:
      isRecord(value.launcher_presets) && value.launcher_presets.version === 1
        ? { version: 1 }
        : undefined,
    ...(value.observability === undefined
      ? {}
      : { observability: parseOptionalObservabilityCapability(value.observability) }),
  };
}

function parseOptionalObservabilityCapability(value: unknown): BridgeObservabilityCapability | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return parseObservabilityCapability(value);
  } catch {
    throw new CapabilityContractError("Bridge observability capability is malformed");
  }
}

function compatibilityError(capabilities: BridgeCapabilities) {
  if (capabilities.bridge_api_version !== APP_BRIDGE_API_VERSION) {
    return `Bridge API ${String(capabilities.bridge_api_version)} is incompatible; expected ${APP_BRIDGE_API_VERSION}`;
  }
  if (capabilities.terminal_protocol !== APP_TERMINAL_PROTOCOL) {
    return `Terminal protocol ${String(capabilities.terminal_protocol)} is incompatible; expected ${APP_TERMINAL_PROTOCOL}`;
  }
  if (!minimumVersionSatisfied(capabilities.herdr_version, APP_MIN_HERDR_VERSION)) {
    return "Herdr version is incompatible; expected 0.8.2 or newer";
  }
  if (
    typeof capabilities.web_compat === "number" &&
    capabilities.web_compat < APP_MIN_WEB_COMPAT
  ) {
    return "Bridge is not compatible with this web app";
  }
  return null;
}

export class CapabilityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityContractError";
  }
}

function boundedInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function boundedCapabilityString(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_CAPABILITY_STRING_LENGTH ||
    hasControlCharacters(value)
  ) {
    return null;
  }
  return value;
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function optionalCapabilityString(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return boundedCapabilityString(value) ?? undefined;
}

function boundedStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .slice(0, MAX_CAPABILITY_LIST_LENGTH)
    .map(boundedCapabilityString)
    .filter((entry): entry is string => entry !== null);
  return [...new Set(strings)];
}

function minimumVersionSatisfied(
  value: string | undefined,
  minimum: readonly [number, number, number],
) {
  if (!value) {
    return false;
  }
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9a-z.-]+)?$/iu.exec(value.trim());
  if (!match) {
    return false;
  }
  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return version[0] > minimum[0] ||
    (version[0] === minimum[0] && version[1] > minimum[1]) ||
    (version[0] === minimum[0] && version[1] === minimum[1] && version[2] >= minimum[2]);
}

function backendDisplayName(
  name: string | undefined,
  baseUrl: string,
  existing: readonly BridgeBackendProfile[],
) {
  const requested = normalizeHostProfileLabel(name, displayNameFromUrl(baseUrl));
  const names = new Set(existing.map((backend) => backend.name));
  if (!names.has(requested)) {
    return requested;
  }
  let index = 2;
  while (names.has(`${requested} ${index}`)) {
    index += 1;
  }
  return `${requested} ${index}`;
}

function displayNameFromUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  return url.host;
}

function createBackendId() {
  let id: string;
  do {
    const cryptoApi = globalThis.crypto;
    id = cryptoApi?.randomUUID
      ? cryptoApi.randomUUID()
      : `backend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (id === SAME_ORIGIN_BRIDGE_ID);
  return id;
}

export function normalizeBackendColor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/iu.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function fallbackBackendColor(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return BACKEND_COLOR_PALETTE[hash % BACKEND_COLOR_PALETTE.length] ?? SAME_ORIGIN_BRIDGE_COLOR;
}

export function suggestBackendColor(
  backends: readonly BridgeBackendProfile[],
  seed = `${Date.now()}`,
) {
  const used = new Set(backends.map((backend) => normalizeBackendColor(backend.color)).filter(Boolean));
  const unused = BACKEND_COLOR_PALETTE.find((color) => !used.has(color));
  return unused ?? fallbackBackendColor(seed);
}

export function duplicateBackend(
  backends: readonly BridgeBackendProfile[],
  baseUrl: string,
  ignoreId?: string,
) {
  const normalized = normalizeBridgeBaseUrl(baseUrl);
  return (
    backends.find((backend) => backend.id !== ignoreId && backend.baseUrl === normalized) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
