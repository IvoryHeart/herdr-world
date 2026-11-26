/**
 * World commands for World's own settings (openspec world-one-object, step
 * 2): an explicit change of "Group runtimes" names the setting, the value the
 * caller saw and the value asked for. Settings are World's own store, so the
 * commit is the observation: the command is recorded in the World ledger's
 * change history before the setting is written, settles as `stored` (or
 * `failed`) when the settings write returns, is published under a new
 * revision, and its one record then holds the value before, the value after
 * and the outcome. A choice only sets a value, so it
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

/**
 * `accepted` is recorded before the setting is written; `stored`, `failed`
 * or `uncertain` replaces it in place once the write settles.
 */
type SettingCommandState = "accepted" | "stored" | "failed" | "uncertain";

export type SettingCommandRecord = SettingCommandInput & {
  state: SettingCommandState;
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
  const reason = record.detail ? `: ${record.detail}` : "";
  switch (record.state) {
    case "accepted":
      return `Changing ${change}`;
    case "stored":
      return change;
    case "failed":
      return `${change} failed${reason}`;
    case "uncertain":
      return `${change} uncertain${reason}`;
  }
}

const NOT_RECORDED = "World could not record the change, so it made none";
const INTERRUPTED = "World stopped before the change settled";

/**
 * Record, then commit: the command's one history record is written as
 * `accepted` before the setting is, and replaced in place by its outcome. A
 * command whose acceptance cannot be recorded changes nothing. An outcome
 * that cannot be recorded (or a restart between the write and its record)
 * leaves the record `accepted`; the next command, or the next start
 * (`recover`), settles it first: from the outcome still held, or after a
 * restart from the value the settings hold. Commands run one at a time.
 */
export function createSettingCommands(deps: {
  now(): number;
  /** The value the settings hold now. */
  read(key: string): Promise<unknown>;
  /** Write the setting; resolves with the value before and after. */
  write(
    key: string,
    value: RuntimeGrouping,
  ): Promise<{ before: unknown; value: unknown }>;
  /** Publish World's own values under a new revision to every browser. */
  publish(): void;
  /** Create, or replace in place, the command's one history record. */
  record(record: SettingCommandRecord): Promise<void>;
  /** History records still `accepted`. */
  unsettled(): readonly SettingCommandRecord[];
  log(message: string): void;
}) {
  /** Outcomes known here whose record is not written yet, by command ID. */
  const outcomes = new Map<string, SettingCommandRecord>();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>) => {
    const next = queue.then(run);
    queue = next.catch(() => undefined);
    return next;
  };

  async function settle() {
    for (const accepted of deps.unsettled()) {
      let outcome = outcomes.get(accepted.id);
      if (!outcome) {
        const current = await deps.read(accepted.entity.key);
        outcome =
          current === accepted.value
            ? { ...accepted, state: "stored", observed: current }
            : {
                ...accepted,
                state: "uncertain",
                observed: current ?? null,
                detail: INTERRUPTED,
              };
      }
      try {
        await deps.record(outcome);
        outcomes.delete(accepted.id);
      } catch (error) {
        outcomes.set(accepted.id, outcome);
        deps.log(`World setting history not settled: ${error}`);
      }
    }
  }

  async function submit(
    input: SettingCommandInput,
  ): Promise<SettingCommandRecord> {
    await settle().catch((error) =>
      deps.log(`World setting history not settled: ${error}`),
    );
    const at = deps.now();
    let before: unknown;
    try {
      before = (await deps.read(input.entity.key)) ?? null;
    } catch {
      before = input.expected;
    }
    const accepted: SettingCommandRecord = {
      ...input,
      state: "accepted",
      before,
      at,
    };
    try {
      await deps.record(accepted);
    } catch (error) {
      deps.log(`World setting history not recorded: ${error}`);
      return { ...accepted, state: "failed", detail: NOT_RECORDED };
    }
    let outcome: SettingCommandRecord;
    try {
      const written = await deps.write(input.entity.key, input.value);
      outcome = {
        ...accepted,
        state: "stored",
        before: written.before ?? null,
        observed: written.value,
      };
    } catch (error) {
      outcome = {
        ...accepted,
        state: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (outcome.state === "stored") deps.publish();
    try {
      await deps.record(outcome);
    } catch (error) {
      outcomes.set(outcome.id, outcome);
      deps.log(`World setting history not settled: ${error}`);
    }
    return outcome;
  }

  return {
    submit: (input: SettingCommandInput) => serial(() => submit(input)),
    /** Settle records a restart left `accepted`. */
    recover: () => serial(settle),
  };
}

export type SettingCommands = ReturnType<typeof createSettingCommands>;
