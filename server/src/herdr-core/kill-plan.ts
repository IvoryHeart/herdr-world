import { coreOccupantFingerprint } from "./labels";
import type { CoreMirrorTerminal } from "./mirror";

/**
 * Everything that ends when World kills terminals on one core.
 *
 * Core ends a program's live children with it unless they outlive it
 * (`die_with_parent`, set at start from `parent` and `outlive_parent`), and
 * their children with them, depth first (herdr-core `record_finish` →
 * `Orphaned`). World cannot stop that, so before any kill (an agent, a room
 * close, the bin) it names every terminal that will end, and kills only when
 * that set is still within what the person confirmed.
 *
 * A child on a linked machine dies with its parent too (`orphaned_afar`),
 * and its own children there with it (that core's `record_finish`), so the
 * plan follows every observed record, here and on linked machines, to the
 * end of the chain. Core writes a parent here bare (`t1`) and one on a
 * machine as `<machine>/tN`; a machine that calls this core by another name
 * writes `<that name>/t1`, so a prefix that is no observed machine's counts
 * as this core. The list may name more than will end, never fewer.
 */
export type CoreKillEntry = {
  address: string;
  /** The program occupying it when planned, for the person to read. */
  pid: number | null;
  /**
   * The program's print (core, address, pid, argv): a kept replacement may
   * reuse the pid but runs a shell, so it is not what was confirmed.
   */
  occupant: string | null;
  /** Which terminal's death ends it; absent for the terminals asked for. */
  parent?: string;
  name: string | null;
  /** On a linked machine: core ends it there, World never acts on it. */
  remote: boolean;
};

export type CoreKillPlan = {
  coreId: string;
  /** The terminals asked for, live on this core. */
  roots: CoreKillEntry[];
  /** Everything else that ends with them, in the order core ends it. */
  descendants: CoreKillEntry[];
};

function entry(
  coreId: string,
  record: CoreMirrorTerminal,
  parent?: string,
): CoreKillEntry {
  const name =
    typeof record.name === "string" && record.name ? record.name : null;
  return {
    address: record.address,
    pid: typeof record.pid === "number" ? record.pid : null,
    occupant: coreOccupantFingerprint(coreId, record),
    ...(parent ? { parent } : {}),
    name,
    remote: record.remote,
  };
}

function parentOf(record: CoreMirrorTerminal): string | null {
  return typeof record.parent === "string" && record.parent
    ? record.parent
    : null;
}

/** The observed address `child`'s recorded parent names. */
function parentAddress(
  child: CoreMirrorTerminal,
  machines: ReadonlySet<string>,
): string | null {
  const parent = parentOf(child);
  if (!parent || !child.remote) return parent;
  const slash = parent.indexOf("/");
  if (slash < 0) return parent;
  // `<machine>/tN` on an observed machine; else this core under another name.
  return machines.has(parent.slice(0, slash))
    ? parent
    : parent.slice(slash + 1);
}

const keyOf = (record: CoreMirrorTerminal) =>
  record.remote ? `remote:${record.address}` : record.address;

export function coreKillPlan(
  coreId: string,
  terminals: readonly CoreMirrorTerminal[],
  addresses: readonly string[],
): CoreKillPlan {
  const live = terminals.filter((record) => record.state === "live");
  const byAddress = new Map(
    live.filter((r) => !r.remote).map((record) => [record.address, record]),
  );
  const machines = new Set(
    live.filter((r) => r.remote).map((r) => r.address.split("/")[0]!),
  );
  // Who dies with whom, in the order core holds them.
  const children = new Map<string, CoreMirrorTerminal[]>();
  for (const record of live) {
    if (record.die_with_parent !== true) continue;
    const parent = parentAddress(record, machines);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), record]);
  }
  const roots: CoreKillEntry[] = [];
  const ending = new Set<string>();
  for (const address of addresses) {
    const record = byAddress.get(address);
    if (!record || ending.has(address)) continue;
    ending.add(address);
    roots.push(entry(coreId, record));
  }
  // Depth first, as core ends them, with no depth limit: every record is
  // listed at most once, so the walk ends within the mirror's bound.
  const descendants: CoreKillEntry[] = [];
  const stack = roots.map((root) => ({
    address: root.address,
    next: children.get(root.address) ?? [],
    index: 0,
  }));
  stack.reverse();
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const child = frame.next[frame.index++];
    if (!child) {
      stack.pop();
      continue;
    }
    // A root that is also another root's child stays a root, listed once.
    if (ending.has(keyOf(child))) continue;
    ending.add(keyOf(child));
    descendants.push(entry(coreId, child, frame.address));
    stack.push({
      address: child.address,
      next: children.get(child.address) ?? [],
      index: 0,
    });
  }
  return { coreId, roots, descendants };
}

export type CoreKillConfirmation = {
  coreId: string;
  /** Every terminal the person saw named, with the program they saw. */
  terminals: Array<{
    address: string;
    pid: number | null;
    occupant?: string | null;
    remote?: boolean;
  }>;
};

const confirmedKey = (e: { address: string; remote?: boolean }) =>
  e.remote ? `remote:${e.address}` : e.address;

/**
 * Why a kill planned now may not run under what was confirmed, or null.
 * The confirmed set must include every terminal that would end now, each
 * still running the program that was confirmed; a terminal that has
 * already ended is fine.
 */
export function coreKillRefusal(
  plan: CoreKillPlan,
  confirmed: CoreKillConfirmation,
): string | null {
  if (plan.coreId !== confirmed.coreId)
    return "The host's herdr-core was replaced since you confirmed.";
  const seen = new Map(confirmed.terminals.map((t) => [confirmedKey(t), t]));
  for (const ending of [...plan.roots, ...plan.descendants]) {
    const was = seen.get(confirmedKey(ending));
    if (!was)
      return `${ending.name ?? ending.address} would end too, and you did not confirm it.`;
    // Every dying terminal, a linked machine's too: a kept replacement
    // there ends with the cascade just the same.
    if (was.pid !== ending.pid || (was.occupant ?? null) !== ending.occupant)
      return `${ending.name ?? ending.address} is running a different program now.`;
  }
  return null;
}
