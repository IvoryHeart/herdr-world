import { useMemo, useRef } from "react";
import { useWorldSources } from "../../world/worldSources";
import { chatBlockTokens, type ChatBlockInput } from "./blocks/registry";

export function useChatBlocks(input: Omit<ChatBlockInput, "items" | "links">) {
  const sources = useWorldSources();
  const previous = useRef<ReadonlyMap<string, unknown>>(new Map());
  const { entries, steps, owner, onAskAuthor } = input;
  return useMemo(() => {
    const next = chatBlockTokens(previous.current, {
      entries,
      steps,
      owner,
      onAskAuthor,
      items: sources.items,
      links: sources.links,
    });
    previous.current = next;
    return next;
  }, [
    entries,
    steps,
    sources.items,
    sources.links,
    owner.connectionId,
    owner.generation,
    owner.paneId,
    owner.sessionFingerprint,
    owner.label,
    onAskAuthor,
  ]);
}
