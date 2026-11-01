import { interestKey, type Interest } from "./interest";
import type { GroupView } from "./groupViews";
import type { GroupInterest } from "./interest";

const label = (interest: Interest) =>
  interest === "watching"
    ? "Watched"
    : interest === "focused"
      ? "Focused"
      : "Muted";
export type EffectiveInterest = { value: Interest; description: string };
/** Viewer intent only. No membership, status, attention item or source is changed. */
export function deriveGroupInterest(
  individual: Readonly<Record<string, Interest>>,
  groupIntent: Readonly<Record<string, GroupInterest>>,
  groups: readonly GroupView[],
) {
  const claims = new Map<string, { value: GroupInterest; title: string }[]>();
  for (const group of groups) {
    const value =
      group.stored &&
      Object.prototype.hasOwnProperty.call(groupIntent, group.id) &&
      groupIntent[group.id];
    if (!value || (group.kind !== "team" && group.kind !== "pod")) continue;
    const title = `${group.kind === "pod" ? "Pod" : "Team"} · ${group.name}`;
    for (const terminal of group.terminals) {
      const key = interestKey(terminal.connectionId, terminal.terminalId);
      const previous = claims.get(key) ?? [];
      previous.push({ value, title });
      claims.set(key, previous);
    }
  }
  const result = new Map<string, EffectiveInterest>();
  for (const key of new Set([...claims.keys(), ...Object.keys(individual)])) {
    const inherited = claims.get(key) ?? [];
    const explicit = individual[key];
    const winner =
      inherited.find((claim) => claim.value === "focused") ?? inherited[0];
    const value = explicit ?? winner?.value ?? "watching";
    const via = explicit
      ? "individual override"
      : winner
        ? `via ${winner.title}`
        : "Default (from groups)";
    const overridden = inherited
      .filter((claim) => claim.value !== value)
      .map((claim) => `${label(claim.value)} on ${claim.title}`);
    result.set(key, {
      value,
      description: `${label(value)} · ${via}${overridden.length ? ` (${overridden.join(", ")} overridden)` : ""}`,
    });
  }
  return result;
}
