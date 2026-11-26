/**
 * World commands for World's own settings (openspec world-one-object, step
 * 2): an explicit change of "Group runtimes" names the setting, the value the
 * caller saw and the value asked for. Settings are World's own store, so the
 * commit is the observation: the command settles as `stored` (or `failed`)
 * when the settings write returns, is published under a new revision, and
 * leaves one record in the World ledger's change history with the value
 * before, the value after and the outcome. A choice only sets a value, so it
 * is accepted even when the value the caller saw is no longer current; the
 * record keeps both.
 *
 * Regrouping because the topology changed is not a command and leaves no
 * history: the grouping is derived (shared/hostGrouping.ts).
 */

import {
  parseRuntimeGrouping,
  RUNTIME_GROUPING_SETTING_KEY,
  type RuntimeGrouping,
} from "../../../shared/hostGrouping";

export type SettingCommandInput = {
  id: string;
  entity: { kind: "setting"; key: typeof RUNTIME_GROUPING_SETTING_KEY };
  field: "value";
  /** The value the caller saw; null when it saw none. */
  expected: RuntimeGrouping | null;
  value: RuntimeGrouping;
};

export type SettingCommandRecord = SettingCommandInput & {
  state: "stored" | "failed";
  /** The value the settings held when the change was written. */
  before: unknown;
  /** The value the settings hold after it; absent when the write failed. */
  observed?: unknown;
  detail?: string;
  at: number;
};

const ID_LIMIT = 64;

/** A world.command for a setting, or null when it names another entity. */
export function parseSettingCommand(
  params: unknown,
): SettingCommandInput | null {
  const input = (params ?? {}) as Record<string, unknown>;
  const entity = (input.entity ?? {}) as Record<string, unknown>;
  if (entity.kind !== "setting") return null;
  const id =
    typeof input.id === "string" &&
    input.id.length > 0 &&
    input.id.length <= ID_LIMIT
      ? input.id
      : null;
  const value = parseRuntimeGrouping(input.value);
  const expected =
    input.expected === null ? null : parseRuntimeGrouping(input.expected);
  if (
    !id ||
    entity.key !== RUNTIME_GROUPING_SETTING_KEY ||
    input.field !== "value" ||
    !value ||
    (input.expected !== null && !expected)
  )
    throw new Error("invalid World setting command");
  return {
    id,
    entity: { kind: "setting", key: RUNTIME_GROUPING_SETTING_KEY },
    field: "value",
    expected,
    value,
  };
}

const NAMES: Record<RuntimeGrouping, string> = {
  machine: "by machine",
  runtime: "by runtime",
};
const named = (value: unknown) => {
  const grouping = parseRuntimeGrouping(value);
  return grouping ? NAMES[grouping] : "unset";
};

/** The change history line for a setting command. */
export function settingCommandSummary(record: SettingCommandRecord) {
  const change = `Group runtimes ${named(record.before)} → ${NAMES[record.value]}`;
  return record.state === "stored"
    ? change
    : `${change} failed${record.detail ? `: ${record.detail}` : ""}`;
}

export function createSettingCommands(deps: {
  now(): number;
  /** Write the setting; resolves with the value before and after. */
  write(
    key: string,
    value: RuntimeGrouping,
  ): Promise<{ before: unknown; value: unknown }>;
  /** Publish World's own values under a new revision to every browser. */
  publish(): void;
  /** Record the settled command in World's change history. */
  record(record: SettingCommandRecord): Promise<void>;
  log(message: string): void;
}) {
  return {
    async submit(input: SettingCommandInput): Promise<SettingCommandRecord> {
      const at = deps.now();
      let record: SettingCommandRecord;
      try {
        const written = await deps.write(input.entity.key, input.value);
        record = {
          ...input,
          state: "stored",
          before: written.before ?? null,
          observed: written.value,
          at,
        };
      } catch (error) {
        record = {
          ...input,
          state: "failed",
          before: input.expected,
          detail: error instanceof Error ? error.message : String(error),
          at,
        };
      }
      if (record.state === "stored") deps.publish();
      try {
        await deps.record(record);
      } catch (error) {
        deps.log(`World setting history not recorded: ${error}`);
      }
      return record;
    },
  };
}

export type SettingCommands = ReturnType<typeof createSettingCommands>;
