import { createHash } from "node:crypto";
import { harnessName, harnessOfArgv } from "./harness";

/**
 * Who a reply is for (delivery.ts): the program a person addressed in a
 * herdr-core terminal, as a token the browser or a durable ask keeps.
 */

type Occupant = {
  address: string;
  pid?: unknown;
  argv?: unknown;
  state?: unknown;
  remote?: unknown;
  template?: unknown;
  foreground?: unknown;
  reported?: unknown;
  status?: unknown;
};

export function foregroundOf(record: Occupant): [number, string] | null {
  const value = record.foreground as
    | { pid?: unknown; name?: unknown }
    | null
    | undefined;
  return value &&
    typeof value.pid === "number" &&
    typeof value.name === "string"
    ? [value.pid, value.name]
    : null;
}

/**
 * The program a person addresses: core's identity, the address, the pid,
 * argv and template of the program core started there (the first part)
 * and the process in its foreground (the second, "-" while core has not
 * read one). A kept replacement changes the pid and argv; a reused pid
 * keeps neither the argv nor the foreground; an agent that exits to the
 * shell wrapping it changes the foreground. Labels, the address and the
 * name survive all of these, so they are not part of it. Null when nothing
 * live runs there.
 */
export function coreRecipientToken(
  coreId: string,
  record: Occupant | undefined | null,
  occupancy: number | null = null,
): string | null {
  if (
    !record ||
    record.remote ||
    record.state !== "live" ||
    typeof record.pid !== "number" ||
    !Array.isArray(record.argv)
  )
    return null;
  const program = createHash("sha256")
    .update(
      JSON.stringify([
        "core-recipient-v1",
        coreId,
        record.address,
        record.pid,
        record.argv,
        record.template ?? null,
        record.reported === true,
        occupancy,
      ]),
    )
    .digest("hex");
  const foreground = foregroundOf(record);
  return `${program}.${
    foreground
      ? createHash("sha256")
          .update(JSON.stringify([program, ...foreground]))
          .digest("hex")
          .slice(0, 32)
      : "-"
  }`;
}

/** A recipient token's shape, as the browser sends it back. */
export const CORE_RECIPIENT = /^[a-f0-9]{64}\.(?:[a-f0-9]{32}|-)$/;

/**
 * Whether `token` still names the program at `record`'s address: "ended"
 * when nothing runs there any more, "changed" when another program (or
 * none yet, while core replaces a lost one) occupies it or a different
 * process holds its foreground. Missing foreground evidence at binding or
 * dispatch refuses: absence of evidence never authorizes input.
 */
export function coreRecipientChange(
  token: string,
  coreId: string,
  record: Occupant | undefined | null,
  occupancy: number | null = null,
): "ended" | "changed" | null {
  if (!record || record.remote || record.state !== "live") return "ended";
  const fg = record.foreground as { name?: unknown; argv?: unknown } | null;
  const expected =
    harnessOfArgv(record.argv) ??
    harnessName((record.status as { app?: unknown } | null)?.app);
  if (
    expected &&
    expected !== (harnessOfArgv(fg?.argv) ?? harnessName(fg?.name))
  )
    return "changed";
  const now = coreRecipientToken(coreId, record, occupancy);
  if (!now) return "changed";
  const [program, foreground] = token.split(".");
  const [nowProgram, nowForeground] = now.split(".");
  if (program !== nowProgram) return "changed";
  const known = foreground !== "-" && nowForeground !== "-";
  return known && foreground === nowForeground ? null : "changed";
}
