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
 * A child on a linked machine dies with its parent too (`orphaned_afar`);
 * its parent there is written `<machine>/tN`. Those are listed whenever the
 * parent's address matches, so the list may name more than will end, never
 * fewer.
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

/** Whether `child`'s recorded parent names the terminal at `address`. */
function childOf(child: CoreMirrorTerminal, address: string): boolean {
  const parent = parentOf(child);
  if (!parent) return false;
  if (!child.remote) return parent === address;
  return parent === address || parent.endsWith(`/${address}`);
}

export function coreKillPlan(
  coreId: string,
  terminals: readonly CoreMirrorTerminal[],
  addresses: readonly string[],
): CoreKillPlan {
  const live = terminals.filter((record) => record.state === "live");
  const byAddress = new Map(
    live.filter((r) => !r.remote).map((record) => [record.address, record]),
  );
  const roots: CoreKillEntry[] = [];
  const ending = new Set<string>();
  for (const address of addresses) {
    const record = byAddress.get(address);
    if (!record || ending.has(address)) continue;
    ending.add(address);
    roots.push(entry(coreId, record));
  }
  const descendants: CoreKillEntry[] = [];
  const visit = (address: string, depth: number) => {
    if (depth > 64) return;
    for (const child of live) {
      const key = child.remote ? `remote:${child.address}` : child.address;
      if (ending.has(key) || child.die_with_parent !== true) continue;
      if (!childOf(child, address)) continue;
      ending.add(key);
      descendants.push(entry(coreId, child, address));
      // A child on another machine ends its own children there.
      if (!child.remote) visit(child.address, depth + 1);
    }
  };
  // Every root is in `ending` first: a root that is also another root's
  // child stays a root and is listed once.
  for (const root of roots) visit(root.address, 0);
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

const key = (e: { address: string; remote?: boolean }) =>
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
  const seen = new Map(confirmed.terminals.map((t) => [key(t), t]));
  for (const ending of [...plan.roots, ...plan.descendants]) {
    const was = seen.get(key(ending));
    if (!was)
      return `${ending.name ?? ending.address} would end too, and you did not confirm it.`;
    if (
      !ending.remote &&
      (was.pid !== ending.pid || (was.occupant ?? null) !== ending.occupant)
    )
      return `${ending.name ?? ending.address} is running a different program now.`;
  }
  return null;
}
