import { STARTER_PROFILES, type AgentLook } from "./agentProfile";
import { TERMINAL_COLOR_NAMES, type TerminalColorName } from "./terminalColor";

/** Bounded existing sprites; these choices do not modify launcher profiles. */
export const AVATAR_CHOICES = STARTER_PROFILES.map(({ id, name, look }) => ({
  id,
  name,
  look,
}));
export const avatarLook = (id: string | undefined): AgentLook | undefined =>
  AVATAR_CHOICES.find((choice) => choice.id === id)?.look;
export type AppearanceTarget = {
  connection_id: string;
  kind: "tab" | "pane";
  native_id: string;
  witness: string[];
  /** Alias into the one existing colour map, never a second stored colour. */
  color_key?: string;
};
export type AppearanceRecord = AppearanceTarget & {
  status?: string;
  avatar?: string;
};
export type AppearanceRecords = Record<string, AppearanceRecord>;
export type AppearanceFields = {
  color?: TerminalColorName | null;
  status?: string | null;
  avatar?: string | null;
};
export type AppearanceDocument = {
  appearance?: AppearanceRecords;
  layout: { colors?: Record<string, TerminalColorName> };
};
export const APPEARANCE_LIMITS = {
  records: 2048,
  witnesses: 64,
  key: 256,
  status: 160,
} as const;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function fail(): never {
  throw new Error("invalid terminal appearance");
}
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= APPEARANCE_LIMITS.key;
export const appearanceKey = (
  target: Pick<AppearanceTarget, "connection_id" | "kind" | "native_id">,
) => JSON.stringify([target.connection_id, target.kind, target.native_id]);
export const continuingAppearance = (
  a: Pick<AppearanceTarget, "witness">,
  b: Pick<AppearanceTarget, "witness">,
) => a.witness.some((id) => b.witness.includes(id));
export function parseAppearanceTarget(value: unknown): AppearanceTarget {
  if (
    !object(value) ||
    !text(value.connection_id) ||
    !text(value.native_id) ||
    !["tab", "pane"].includes(String(value.kind)) ||
    !Array.isArray(value.witness) ||
    !value.witness.length ||
    value.witness.length > APPEARANCE_LIMITS.witnesses ||
    !value.witness.every(text) ||
    new Set(value.witness).size !== value.witness.length
  )
    fail();
  if (
    value.kind === "tab"
      ? !text(value.color_key)
      : value.color_key !== undefined
  )
    fail();
  return {
    connection_id: value.connection_id,
    kind: value.kind as "tab" | "pane",
    native_id: value.native_id,
    witness: [...value.witness].sort(),
    ...(value.kind === "tab" ? { color_key: value.color_key as string } : {}),
  };
}
export function parseAppearanceFields(
  value: unknown,
  kind: AppearanceTarget["kind"],
): AppearanceFields {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        !(kind === "tab" ? ["color", "status"] : ["avatar"]).includes(key),
    )
  )
    fail();
  if (
    value.color !== undefined &&
    value.color !== null &&
    !(TERMINAL_COLOR_NAMES as readonly unknown[]).includes(value.color)
  )
    fail();
  if (
    value.status !== undefined &&
    value.status !== null &&
    (typeof value.status !== "string" ||
      value.status.length > APPEARANCE_LIMITS.status ||
      /[\u0000-\u001f\u007f-\u009f]/.test(value.status))
  )
    fail();
  if (
    value.avatar !== undefined &&
    value.avatar !== null &&
    !AVATAR_CHOICES.some((choice) => choice.id === value.avatar)
  )
    fail();
  return value as AppearanceFields;
}
export function parseAppearanceRecords(value: unknown): AppearanceRecords {
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).length > APPEARANCE_LIMITS.records)
    fail();
  const records: AppearanceRecords = {};
  for (const [key, entry] of Object.entries(value)) {
    const target = parseAppearanceTarget(entry);
    if (
      !object(entry) ||
      key !== appearanceKey(target) ||
      Object.keys(entry).some(
        (key) =>
          ![
            "connection_id",
            "kind",
            "native_id",
            "witness",
            "color_key",
            "status",
            "avatar",
          ].includes(key),
      )
    )
      fail();
    const fields = parseAppearanceFields(
      Object.fromEntries(
        Object.entries(entry).filter(
          ([key]) => key === "status" || key === "avatar",
        ),
      ),
      target.kind,
    );
    if (fields.status === null || fields.avatar === null) fail();
    records[key] = {
      ...target,
      ...(fields.status ? { status: fields.status } : {}),
      ...(fields.avatar ? { avatar: fields.avatar } : {}),
    };
  }
  return records;
}
export function appearanceFor(
  records: AppearanceRecords | undefined,
  target: AppearanceTarget,
): AppearanceRecord | null {
  const saved = records?.[appearanceKey(target)];
  return saved && continuingAppearance(saved, target) ? saved : null;
}
/** Called only after current-runtime admission; field patches preserve other clients' fields. */
export function applyAppearance(
  document: AppearanceDocument,
  input: AppearanceTarget,
  patch: AppearanceFields,
): void {
  const target = parseAppearanceTarget(input);
  const fields = parseAppearanceFields(patch, target.kind);
  const key = appearanceKey(target);
  const previous = document.appearance?.[key];
  const continued = previous && continuingAppearance(previous, target);
  const colors = (document.layout.colors ??= {});
  if (previous?.color_key && !continued) delete colors[previous.color_key];
  if (
    continued &&
    previous.color_key &&
    target.color_key &&
    previous.color_key !== target.color_key
  ) {
    const old = colors[previous.color_key];
    delete colors[previous.color_key];
    if (old) colors[target.color_key] = old;
  }
  const record: AppearanceRecord = {
    ...target,
    ...(continued && previous.status ? { status: previous.status } : {}),
    ...(continued && previous.avatar ? { avatar: previous.avatar } : {}),
  };
  if (fields.status !== undefined) {
    delete record.status;
    if (fields.status?.trim()) record.status = fields.status.trim();
  }
  if (fields.avatar !== undefined) {
    delete record.avatar;
    if (fields.avatar) record.avatar = fields.avatar;
  }
  if (target.color_key && fields.color !== undefined) {
    if (fields.color === null) delete colors[target.color_key];
    else colors[target.color_key] = fields.color;
  }
  const records = (document.appearance ??= {});
  if (!records[key] && Object.keys(records).length >= APPEARANCE_LIMITS.records)
    fail();
  records[key] = record;
}
/** Hide a bound colour when the current occupant cannot demonstrate continuity. */
export function appearanceColors(
  document: AppearanceDocument,
  targets: readonly AppearanceTarget[],
): Record<string, TerminalColorName> {
  const colors = { ...document.layout.colors };
  const current = new Map(
    targets.map((target) => [appearanceKey(target), target]),
  );
  for (const [key, record] of Object.entries(document.appearance ?? {})) {
    const target = current.get(key);
    if (record.color_key && (!target || !continuingAppearance(record, target)))
      delete colors[record.color_key];
  }
  return colors;
}

/** Service-confirmed move; no inferred ID/name fallback and no duplicate colour. */
export function relocateAppearance(
  document: AppearanceDocument,
  from: AppearanceTarget,
  input: AppearanceTarget,
): void {
  const target = parseAppearanceTarget(input);
  const saved = appearanceFor(document.appearance, from);
  if (
    !saved ||
    target.kind !== from.kind ||
    target.connection_id !== from.connection_id ||
    !continuingAppearance(saved, target)
  )
    return;
  const { status, avatar } = saved;
  delete document.appearance![appearanceKey(from)];
  document.appearance![appearanceKey(target)] = {
    ...target,
    ...(status ? { status } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

/** Service-only compensation when recording a World CLI change fails. */
export function restoreAppearance(
  document: AppearanceDocument,
  key: string,
  record: AppearanceRecord | null,
): void {
  if (record) {
    const parsed = parseAppearanceRecords({ [key]: record });
    (document.appearance ??= {})[key] = parsed[key]!;
  } else if (document.appearance) delete document.appearance[key];
}
