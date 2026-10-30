import { AGENT_NAME } from "../../../shared/agentProfile";

export const TERMINAL_SETTINGS_SOURCE = "herdr-world:terminal-settings";
const KEYS = [
  "world_terminal",
  "world_profile",
  "world_profile_name",
  "world_master",
] as const;
export type SettingTokens = Partial<
  Record<(typeof KEYS)[number], string | null>
>;
export type SettingsLease = {
  generation: number;
  isCurrent(): boolean;
  runtime: {
    herdr: {
      call(
        method: string,
        params: Record<string, unknown>,
        timeout?: number,
      ): Promise<unknown>;
    };
  };
};
export type MasterClaim = {
  connection_id: string;
  terminal_id: string;
  revision: number;
};
export type PaneRow = Record<string, unknown>;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
export function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !CONTROLS.test(value) &&
    Array.from(value).length <= 80
  );
}
export function profileTokens(
  terminal: string,
  id: string,
  name: string,
): SettingTokens {
  const cleaned = Array.from(
    name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim(),
  )
    .slice(0, 80)
    .join("")
    .trim();
  if (!AGENT_NAME.test(id) || !validToken(terminal) || !validToken(cleaned))
    throw new Error("invalid terminal profile settings");
  return {
    world_terminal: terminal,
    world_profile: id,
    world_profile_name: cleaned,
  };
}
export function readTerminalSettings(pane: PaneRow): {
  profile_id?: string;
  profile_name?: string;
  master?: number;
} {
  const tokens = pane.tokens as Record<string, unknown> | undefined;
  if (
    !tokens ||
    !validToken(pane.terminal_id) ||
    tokens.world_terminal !== pane.terminal_id
  )
    return {};
  const profile =
    validToken(tokens.world_profile) &&
    AGENT_NAME.test(tokens.world_profile) &&
    validToken(tokens.world_profile_name)
      ? {
          profile_id: tokens.world_profile,
          profile_name: tokens.world_profile_name,
        }
      : {};
  const revision =
    typeof tokens.world_master === "string" &&
    /^[1-9][0-9]*$/.test(tokens.world_master)
      ? Number(tokens.world_master)
      : NaN;
  return {
    ...profile,
    ...(Number.isSafeInteger(revision) ? { master: revision } : {}),
  };
}
export function masterWinner(
  claims: readonly MasterClaim[],
): MasterClaim | null {
  return claims.reduce<MasterClaim | null>(
    (best, claim) =>
      !best ||
      claim.revision > best.revision ||
      (claim.revision === best.revision && claim.terminal_id > best.terminal_id)
        ? claim
        : best,
    null,
  );
}
export function paneOf(value: unknown): PaneRow {
  const result = value as { pane?: PaneRow } | null;
  if (!result?.pane || typeof result.pane !== "object")
    throw new Error("Herdr did not return a terminal");
  return result.pane;
}
export type TokenWrite = SettingTokens | ((pane: PaneRow) => SettingTokens);
export async function writeTerminalTokens(
  lease: SettingsLease,
  paneId: string,
  terminalId: string,
  write: TokenWrite,
  options: { expectedMaster?: number; onRead?: (pane: PaneRow) => void } = {},
): Promise<PaneRow | null> {
  const validate = (tokens: SettingTokens) => {
    for (const [key, value] of Object.entries(tokens))
      if (
        !KEYS.includes(key as (typeof KEYS)[number]) ||
        (value !== null && !validToken(value))
      )
        throw new Error("invalid terminal setting value");
  };
  if (typeof write !== "function") validate(write);
  if (!lease.isCurrent()) throw new Error("terminal settings runtime changed");
  const pane = paneOf(
    await lease.runtime.herdr.call("pane.get", { pane_id: paneId }, 10_000),
  );
  if (!lease.isCurrent()) throw new Error("terminal settings runtime changed");
  if (pane.pane_id !== paneId || pane.terminal_id !== terminalId)
    throw new Error("pane no longer holds the expected terminal");
  options.onRead?.(pane);
  // A stale cleanup must not remove a claim replaced since its observation.
  if (
    options.expectedMaster !== undefined &&
    readTerminalSettings(pane).master !== options.expectedMaster
  )
    return null;
  const tokens = typeof write === "function" ? write(pane) : write;
  validate(tokens);
  if (!Object.keys(tokens).length) return pane;
  await lease.runtime.herdr.call(
    "pane.report_metadata",
    { pane_id: paneId, source: TERMINAL_SETTINGS_SOURCE, tokens },
    10_000,
  );
  if (!lease.isCurrent())
    throw new Error("terminal settings runtime changed during write");
  return { ...pane, tokens: { ...((pane.tokens as object) ?? {}), ...tokens } };
}

/** Wrap the shared Town move path, including CLI moves and rollback moves. */
export function terminalSettingsMoveCall(
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  isCurrent: () => boolean,
) {
  const panes = new Map<string, PaneRow>();
  return async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const before =
      method === "pane.move" ? panes.get(String(params.pane_id)) : undefined;
    const settings = before && readTerminalSettings(before);
    const result = await call(method, params);
    if (method === "pane.list") {
      panes.clear();
      for (const pane of (result as { panes: PaneRow[] }).panes)
        panes.set(String(pane.pane_id), pane);
    }
    if (before && (settings?.profile_id || settings?.master)) {
      const moved = (result as { move_result?: { pane?: PaneRow } }).move_result
        ?.pane;
      if (!moved || moved.terminal_id !== before.terminal_id)
        throw new Error("moved terminal settings could not be verified");
      const tokens: SettingTokens = {
        world_terminal: String(before.terminal_id),
      };
      for (const key of KEYS.slice(1)) {
        const value = (before.tokens as Record<string, unknown>)[key];
        if (validToken(value)) tokens[key] = value;
      }
      const live = paneOf(await call("pane.get", { pane_id: moved.pane_id }));
      if (!isCurrent() || live.terminal_id !== before.terminal_id)
        throw new Error("moved terminal settings runtime changed");
      // Preserve concurrent edits; only re-report keys the move dropped.
      const missing: SettingTokens = {};
      for (const [key, value] of Object.entries(tokens))
        if (
          (live.tokens as Record<string, unknown> | undefined)?.[key] ===
          undefined
        )
          missing[key as keyof SettingTokens] = value;
      if (Object.keys(missing).length)
        await writeTerminalTokens(
          { generation: 0, isCurrent, runtime: { herdr: { call } } },
          String(moved.pane_id),
          String(before.terminal_id),
          missing,
        );
      panes.delete(String(before.pane_id));
      panes.set(String(moved.pane_id), {
        ...live,
        tokens: { ...((live.tokens as object) ?? {}), ...missing },
      });
    }
    return result;
  };
}
