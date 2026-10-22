/**
 * Which terminals know each other, and why. A relation is between two
 * terminals on their connections; each source that says so is one piece of
 * evidence with its own system of record:
 *
 * - `spawned`: a spawner stamped the child pane's Herdr metadata with
 *   `spawned_by` (Herdr is the record while the token lives). World keeps the
 *   last claim it saw in Board's saved document, which stays the record after
 *   a Herdr restart drops the token.
 * - `manual`: the user grouped desks or cards; World's saved document is the
 *   record.
 *
 * Terminal IDs survive pane and tab moves within one Herdr runtime and are
 * issued anew when Herdr restarts (pane IDs are reused), so they are the
 * identity. Evidence is current only while both terminals are in a
 * current (not cached, not stale) snapshot of their connection; otherwise it
 * is kept and shown as stale. The service and the browser share these rules.
 */

/** The child pane's token naming its parent pane. */
export const SPAWNED_BY_TOKEN = "spawned_by";
/** The parent's terminal, which outlives a move of the parent pane. */
export const SPAWNED_BY_TERMINAL_TOKEN = "spawned_by_terminal";
/** Herdr lists tokens without their reporter; claims name the convention. */
export const SPAWN_TOKEN_SOURCE = "herdr:spawned_by";

export type TerminalRef = { connection_id: string; terminal_id: string };

/** A spawn claim World last saw on a child pane. */
export type SpawnClaim = {
  child: TerminalRef;
  parent: TerminalRef;
  /** Where the claim came from: the token convention, or a harness. */
  source: string;
  /** The connection's runtime generation when World saw it. */
  generation: number;
  observed_at: number;
};

/** Desks or cards the user grouped; the first member is the one joined. */
export type RelationGroup = {
  id: string;
  members: TerminalRef[];
  created_at: number;
};

export type RelationsDocument = {
  spawns: SpawnClaim[];
  groups: RelationGroup[];
};

export const RELATION_LIMITS = Object.freeze({
  spawns: 1_000,
  groups: 500,
  members: 32,
});

/** One connection as a snapshot shows it. */
export type RelationObservation = {
  connection_id: string;
  generation: number;
  /** A live snapshot of the current runtime, not cached topology. */
  current: boolean;
  panes: readonly {
    pane_id: string;
    terminal_id: string;
    tokens?: unknown;
  }[];
};

export type RelationEvidence = {
  kind: "spawned" | "manual";
  /** Who holds the record now. */
  sor: "herdr" | "world";
  /** The claim's source for `spawned`, or the group ID for `manual`. */
  source: string;
  observed_at: number | null;
  current: boolean;
};

export type Relation = {
  key: string;
  a: TerminalRef;
  b: TerminalRef;
  /** For a spawn, `a` is the parent. */
  evidence: RelationEvidence[];
  /** How many pieces of evidence hold now; 0 means stale. */
  strength: number;
};

export const terminalKey = (ref: TerminalRef) =>
  `${ref.connection_id}\u0000${ref.terminal_id}`;
const pairKey = (a: TerminalRef, b: TerminalRef) => {
  const [x, y] = [terminalKey(a), terminalKey(b)].sort();
  return `${x}\u0001${y}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The parent a child pane's tokens name, resolved on its connection. */
export function spawnTokenParent(
  observation: RelationObservation,
  pane: RelationObservation["panes"][number],
): TerminalRef | null {
  if (!isRecord(pane.tokens)) return null;
  const byTerminal = pane.tokens[SPAWNED_BY_TERMINAL_TOKEN];
  const byPane = pane.tokens[SPAWNED_BY_TOKEN];
  // The terminal is the identity: Herdr reuses pane IDs after a restart, so
  // the pane ID is read only when no terminal was stamped.
  const found =
    typeof byTerminal === "string"
      ? observation.panes.find((entry) => entry.terminal_id === byTerminal)
      : typeof byPane === "string" &&
        observation.panes.find((entry) => entry.pane_id === byPane);
  if (!found || found.terminal_id === pane.terminal_id) return null;
  return {
    connection_id: observation.connection_id,
    terminal_id: found.terminal_id,
  };
}

/** Every current spawn token, as claims World should keep. */
export function observedSpawnClaims(
  observations: readonly RelationObservation[],
  now: number,
): SpawnClaim[] {
  const claims: SpawnClaim[] = [];
  for (const observation of observations) {
    if (!observation.current) continue;
    for (const pane of observation.panes) {
      const parent = spawnTokenParent(observation, pane);
      if (!parent) continue;
      claims.push({
        child: {
          connection_id: observation.connection_id,
          terminal_id: pane.terminal_id,
        },
        parent,
        source: SPAWN_TOKEN_SOURCE,
        generation: observation.generation,
        observed_at: now,
      });
    }
  }
  return claims;
}

/**
 * The claims to save: one per child, replaced when a token now names another
 * parent or the runtime generation changed. Unchanged claims are not
 * rewritten, so observing does not churn the saved document.
 */
export function spawnClaimsToRecord(
  saved: readonly SpawnClaim[],
  observed: readonly SpawnClaim[],
): SpawnClaim[] {
  const byChild = new Map(
    saved.map((claim) => [terminalKey(claim.child), claim]),
  );
  return observed.filter((claim) => {
    const known = byChild.get(terminalKey(claim.child));
    return (
      !known ||
      terminalKey(known.parent) !== terminalKey(claim.parent) ||
      known.generation !== claim.generation
    );
  });
}

/** Every relation, with its evidence; stale ones are kept. */
export function relationsOf(
  document: RelationsDocument,
  observations: readonly RelationObservation[],
): Relation[] {
  const live = new Set<string>();
  const tokenParents = new Map<string, TerminalRef>();
  for (const observation of observations) {
    if (!observation.current) continue;
    for (const pane of observation.panes) {
      const ref = {
        connection_id: observation.connection_id,
        terminal_id: pane.terminal_id,
      };
      live.add(terminalKey(ref));
      const parent = spawnTokenParent(observation, pane);
      if (parent) tokenParents.set(terminalKey(ref), parent);
    }
  }
  const bothLive = (a: TerminalRef, b: TerminalRef) =>
    live.has(terminalKey(a)) && live.has(terminalKey(b));
  const relations = new Map<string, Relation>();
  const add = (a: TerminalRef, b: TerminalRef, evidence: RelationEvidence) => {
    const key = pairKey(a, b);
    let relation = relations.get(key);
    if (!relation) {
      relation = { key, a, b, evidence: [], strength: 0 };
      relations.set(key, relation);
    }
    relation.evidence.push(evidence);
    if (evidence.current) relation.strength += 1;
  };

  const claimed = new Set<string>();
  for (const claim of document.spawns) {
    const childKey = terminalKey(claim.child);
    claimed.add(childKey);
    const token = tokenParents.get(childKey);
    // A live token naming another parent supersedes the saved claim.
    if (token && terminalKey(token) !== terminalKey(claim.parent)) continue;
    add(claim.parent, claim.child, {
      kind: "spawned",
      sor: token ? "herdr" : "world",
      source: claim.source,
      observed_at: claim.observed_at,
      current: bothLive(claim.parent, claim.child),
    });
  }
  for (const [childKey, parent] of tokenParents) {
    if (
      claimed.has(childKey) &&
      relations.has(pairKey(parent, refOf(childKey)))
    )
      continue;
    const child = refOf(childKey);
    add(parent, child, {
      kind: "spawned",
      sor: "herdr",
      source: SPAWN_TOKEN_SOURCE,
      observed_at: null,
      current: bothLive(parent, child),
    });
  }
  for (const group of document.groups) {
    // A star around its first live member, so a closed lead does not leave
    // the rest unrelated.
    const hub =
      group.members.find((member) => live.has(terminalKey(member))) ??
      group.members[0];
    if (!hub) continue;
    for (const member of group.members)
      if (member !== hub)
        add(hub, member, {
          kind: "manual",
          sor: "world",
          source: group.id,
          observed_at: group.created_at,
          current: bothLive(hub, member),
        });
  }
  return [...relations.values()];
}

function refOf(key: string): TerminalRef {
  const at = key.indexOf("\u0000");
  return { connection_id: key.slice(0, at), terminal_id: key.slice(at + 1) };
}

/** Each terminal's spawning parent, from its strongest spawn evidence. */
export function spawnParents(
  relations: readonly Relation[],
): Map<string, TerminalRef> {
  const parents = new Map<string, TerminalRef>();
  for (const relation of relations)
    if (relation.evidence.some((entry) => entry.kind === "spawned"))
      parents.set(terminalKey(relation.b), relation.a);
  return parents;
}

/**
 * Teams: terminals joined by any relation, as one label per terminal (the
 * smallest member key). Stale relations still join, so a team is shown whole
 * while one side is offline.
 */
export function relationTeams(
  relations: readonly Relation[],
): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const [x, y] = [find(a), find(b)].sort();
    parent.set(y!, x!);
  };
  for (const relation of relations)
    union(terminalKey(relation.a), terminalKey(relation.b));
  const teams = new Map<string, string>();
  for (const key of parent.keys()) teams.set(key, find(key));
  return teams;
}

/* ---------- Manual groups ---------- */

const sameRef = (a: TerminalRef, b: TerminalRef) =>
  a.connection_id === b.connection_id && a.terminal_id === b.terminal_id;

/** Take terminals out of every group; groups left with one member go. */
export function leaveGroups(
  groups: readonly RelationGroup[],
  members: readonly TerminalRef[],
): RelationGroup[] {
  return groups
    .map((group) => ({
      ...group,
      members: group.members.filter(
        (member) => !members.some((leaving) => sameRef(leaving, member)),
      ),
    }))
    .filter((group) => group.members.length > 1);
}

/**
 * Join `members` to the group of `target` (a terminal already in a group),
 * or start a group led by `target`. A terminal is in one group at a time, so
 * joining leaves any other.
 */
export function joinGroup(
  groups: readonly RelationGroup[],
  members: readonly TerminalRef[],
  target: readonly TerminalRef[],
  id: string,
  now: number,
): RelationGroup[] {
  const joining = members.filter(
    (member, index) =>
      !target.some((entry) => sameRef(entry, member)) &&
      members.findIndex((entry) => sameRef(entry, member)) === index,
  );
  if (!joining.length || !target.length) return [...groups];
  const host = groups.find((group) =>
    group.members.some((member) =>
      target.some((entry) => sameRef(entry, member)),
    ),
  );
  const rest = leaveGroups(
    groups.filter((group) => group !== host),
    joining,
  );
  const base = host
    ? host.members.filter(
        (member) => !joining.some((entry) => sameRef(entry, member)),
      )
    : [...target];
  if (!host && groups.some((group) => group.id === id))
    throw new Error(`group ${id} already exists`);
  const group: RelationGroup = host
    ? { ...host, members: [...base, ...joining] }
    : {
        id,
        members: [
          ...base.filter(
            (member, index) =>
              base.findIndex((entry) => sameRef(entry, member)) === index,
          ),
          ...joining,
        ],
        created_at: now,
      };
  if (group.members.length > RELATION_LIMITS.members)
    throw new Error(
      `a group holds at most ${RELATION_LIMITS.members} terminals`,
    );
  return [...rest, group];
}
