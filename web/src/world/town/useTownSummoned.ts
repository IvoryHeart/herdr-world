import { useEffect, useMemo, useState } from "react";

type AgentIndex = {
  get(key: string): { agent: { semanticStatus: string } } | undefined;
};

/**
 * An agent the user opens walks back to its desk and stays there until its
 * status changes; then Town places it by status again. Opening it does not
 * mark its work as seen: Mark reviewed still does that.
 */
export function useTownSummoned(agentByKey: AgentIndex) {
  const [summoned, setSummoned] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    setSummoned((current) => {
      let next: Map<string, string> | null = null;
      for (const [key, status] of current)
        if (agentByKey.get(key)?.agent.semanticStatus !== status)
          (next ??= new Map(current)).delete(key);
      return next ?? current;
    });
  }, [agentByKey]);
  const summonedKeys = useMemo(() => new Set(summoned.keys()), [summoned]);
  const summon = (key: string) => {
    const status = agentByKey.get(key)?.agent.semanticStatus;
    if (status)
      setSummoned((current) =>
        current.get(key) === status
          ? current
          : new Map(current).set(key, status),
      );
  };
  return { summonedKeys, summon };
}
