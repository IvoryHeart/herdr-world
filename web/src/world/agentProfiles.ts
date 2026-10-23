import { useEffect, useSyncExternalStore } from "react";
import {
  HARNESS_CHOICES,
  type AgentLook,
  type AgentProfile,
} from "../../../shared/agentProfile";
import type { TownLook } from "./town/townSprites";

/**
 * The browser's view of the service's agent profiles, the launcher's calls
 * and the events that open the launcher and the profile editor from any
 * World view (Town, Board, Spaces, settings).
 */

export type ProfileAssignment = {
  connection_id: string;
  terminal_id: string;
  profile_id: string;
};
export type ProfilesDocument = {
  version: 1;
  revision: number;
  profiles: AgentProfile[];
  assignments: ProfileAssignment[];
};
type State = { document: ProfilesDocument | null; error: string | null };

let state: State = { document: null, error: null };
const listeners = new Set<() => void>();
let users = 0;
let unlisten: (() => void)[] = [];

function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const get = () => state;
/** The profiles last read, for code outside React (Town's renderer). */
export const profilesSnapshot = () => state.document;

async function bridge() {
  return (await import("../api")).bridge;
}

export async function refreshProfiles() {
  try {
    const document = (await (
      await bridge()
    ).call("world.profiles.get")) as ProfilesDocument;
    if (document?.version === 1 && Array.isArray(document.profiles))
      set({ document, error: null });
  } catch (error) {
    set({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Profiles, kept current while any view uses them. */
export function useAgentProfiles() {
  useEffect(() => {
    users += 1;
    if (users === 1)
      void bridge().then((b) => {
        if (!users || unlisten.length) return;
        unlisten = [
          b.onControl((control) => {
            if (
              control.type === "world_profiles_changed" &&
              (control.revision ?? 0) > (state.document?.revision ?? -1)
            )
              void refreshProfiles();
          }),
          b.onStatus((status) => {
            if (status === "connected") void refreshProfiles();
          }),
        ];
        void refreshProfiles();
      });
    return () => {
      users -= 1;
      if (users) return;
      for (const off of unlisten) off();
      unlisten = [];
    };
  }, []);
  return useSyncExternalStore(subscribe, get, get);
}

async function write(method: string, params: Record<string, unknown>) {
  const document = (await (
    await bridge()
  ).call(method, params)) as ProfilesDocument;
  set({ document, error: null });
  return document;
}
export const saveProfile = (profile: AgentProfile) =>
  write("world.profiles.save", { profile });
export const deleteProfile = (id: string) =>
  write("world.profiles.delete", { id });

/** Where a new agent starts: one workspace on one host's current runtime. */
export type LaunchTarget = {
  connectionId: string;
  generation: number;
  workspaceId: string;
  workspaceLabel: string;
};
export type LaunchOutcome = {
  status: "sent" | "started" | "uncertain" | "failed";
  message?: string;
  tab_id?: string;
  pane_id?: string;
  terminal_id?: string;
  agent_name?: string;
};

/**
 * What a launch or login that did not open its terminal leaves in the
 * dialog: the reason and the terminal it created, qualified by the host it
 * ran on, so opening it later never reads another room's host.
 */
export type RetainedOutcome = {
  message: string;
  failed: boolean;
  terminal: { connectionId: string; terminalId: string } | null;
  /** A login's command, for the user to copy and run in that terminal. */
  command?: string;
};
export const retainedOutcome = (
  target: LaunchTarget,
  result: {
    status: string;
    message?: string;
    terminal_id?: string;
    command?: string;
  },
): RetainedOutcome => ({
  message: result.message ?? "",
  failed: result.status === "failed",
  terminal: result.terminal_id
    ? { connectionId: target.connectionId, terminalId: result.terminal_id }
    : null,
  ...(result.command ? { command: result.command } : {}),
});

export type HarnessReadiness = {
  kind: string;
  installed: boolean;
  logged_in: boolean | null;
  method?: string;
  can_log_in: boolean;
};
export type LauncherCatalog = {
  kinds: string[];
  skills: string[];
  readiness: HarnessReadiness[];
};

/** Kinds, skills and harness readiness on a host (for a workspace's folder). */
export async function launcherCatalog(
  target: Pick<LaunchTarget, "connectionId" | "generation"> & {
    workspaceId?: string;
  },
): Promise<LauncherCatalog> {
  const result = (await (
    await bridge()
  )
    .connection(target.connectionId, target.generation)
    .call(
      "launcher.catalog",
      { workspace_id: target.workspaceId ?? "" },
      30_000,
    )) as Partial<LauncherCatalog> | null;
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  return {
    kinds: strings(result?.kinds),
    skills: strings(result?.skills),
    readiness: Array.isArray(result?.readiness) ? result.readiness : [],
  };
}

/** Open a small tab running the harness's own login command. */
export async function openHarnessLogin(target: LaunchTarget, kind: string) {
  return (await (
    await bridge()
  )
    .connection(target.connectionId, target.generation)
    .call(
      "launcher.login",
      { workspace_id: target.workspaceId, kind },
      30_000,
    )) as {
    tab_id: string;
    pane_id: string;
    terminal_id: string;
    /** The line for the user to run in that tab; World types nothing. */
    command: string;
  };
}

export async function launchAgent(
  target: LaunchTarget,
  choice: { profileId?: string; kind?: string; label: string; text: string },
) {
  return (await (
    await bridge()
  )
    .connection(target.connectionId, target.generation)
    .call(
      "launcher.start",
      {
        workspace_id: target.workspaceId,
        profile_id: choice.profileId ?? "",
        kind: choice.kind ?? "",
        label: choice.label,
        text: choice.text,
      },
      150_000,
    )) as LaunchOutcome;
}

export const WORLD_AGENT_LAUNCH_EVENT = "herdr-world:agent-launch";
export const WORLD_AGENT_PROFILES_EVENT = "herdr-world:agent-profiles";

/** Open the launcher for a workspace, optionally with a profile chosen. */
export function requestAgentLaunch(target: Partial<LaunchTarget>) {
  window.dispatchEvent(
    new CustomEvent<Partial<LaunchTarget>>(WORLD_AGENT_LAUNCH_EVENT, {
      detail: target,
    }),
  );
}
/** Open the profile editor (World settings, Town's tailor, Board). */
export function openProfileEditor(profileId?: string) {
  window.dispatchEvent(
    new CustomEvent<string | undefined>(WORLD_AGENT_PROFILES_EVENT, {
      detail: profileId,
    }),
  );
}

const HAIR_STYLE_INDEX = {
  short: 0,
  long: 1,
  cap: 2,
  bun: 3,
  shaved: 4,
} as const;
export function townLookOf(look: AgentLook): TownLook {
  return {
    skin: look.skin,
    hair: look.hair,
    shirt: look.shirt,
    pants: look.pants,
    style: HAIR_STYLE_INDEX[look.hair_style],
    outfit: look.outfit,
    accessory: look.accessory,
  };
}

/** The look of the profile an agent was launched from, if any. */
export function profileLookFor(
  document: ProfilesDocument | null,
  connectionId: string,
  terminalId: string,
): TownLook | null {
  if (!document) return null;
  // The service keeps one assignment per terminal.
  const assignment = document.assignments.find(
    (a) => a.connection_id === connectionId && a.terminal_id === terminalId,
  );
  const profile =
    assignment && document.profiles.find((p) => p.id === assignment.profile_id);
  return profile ? townLookOf(profile.look) : null;
}

export const harnessLabel = (kind: string) =>
  HARNESS_CHOICES[kind]?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);

/** What the user needs to know before starting a harness on this host. */
export function readinessNote(
  kind: string,
  catalog: LauncherCatalog | null,
): { blocked: boolean; text: string; login: boolean } | null {
  if (!catalog) return null;
  if (!catalog.kinds.includes(kind))
    return {
      blocked: true,
      text: "Not supported by this host's Herdr",
      login: false,
    };
  const ready = catalog.readiness.find((r) => r.kind === kind);
  if (!ready) return null;
  if (!ready.installed)
    return { blocked: true, text: "Not installed on this host", login: false };
  if (ready.logged_in === false)
    return { blocked: false, text: "Logged out", login: ready.can_log_in };
  return null;
}
