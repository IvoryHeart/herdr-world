import { ExternalLink, Package } from "lucide-react";
import { useEffect } from "react";
import {
  ARTEFACT_KIND_LABELS,
  type ShelvedArtefact,
} from "../../../../shared/agentArtefacts";
import {
  artefactShelfState,
  requestArtefactShelf,
  useArtefactShelves,
} from "../../world/memory/artefactShelfClient";
import { madeSummary } from "../../world/memory/artefactShelfModel";
import { memoryHosts, useMemoryStore } from "../../world/memory/memoryClient";
import { openMemoryLibrary } from "../../world/memory/memoryEvents";
import "./chatMade.css";

const NONE: readonly ShelvedArtefact[] = [];

/**
 * What this Chat's agent made (#1327), from its host's Library shelf: the
 * same records the Library lists, never a copy of Chat's own. `changed`
 * (the conversation's latest change) asks for the shelf again, at most
 * once a minute.
 */
export function useChatMade(
  connectionId: string,
  paneId: string | undefined,
  changed: unknown,
): readonly ShelvedArtefact[] {
  useMemoryStore();
  useArtefactShelves();
  const host = memoryHosts().find((one) => one.connection_id === connectionId);
  const hostKey = host
    ? `${host.connection_id}:${host.connection_generation}`
    : "";
  useEffect(() => {
    if (host && paneId) void requestArtefactShelf(host);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostKey, paneId, changed]);
  if (!host || !paneId) return NONE;
  const shelf = artefactShelfState(host)?.shelf;
  if (!shelf) return NONE;
  return shelf.artefacts.filter(
    (artefact) =>
      artefact.made_by.pane_id === paneId && artefact.gone_maker === null,
  );
}

const openIn = (artefact: ShelvedArtefact, artefactId?: string) =>
  openMemoryLibrary({
    connectionId: artefact.made_by.connection_id,
    agentId: artefact.made_by.pane_id,
    wing: "artefacts",
    ...(artefactId ? { artefactId } : {}),
  });

/** Chat's "Made" summary: the count and latest ones, opening the Library. */
export function ChatMadeSummary({
  artefacts,
}: {
  artefacts: readonly ShelvedArtefact[];
}) {
  const summary = madeSummary(artefacts);
  if (!summary) return null;
  return (
    <button
      type="button"
      className="chat-made-summary"
      title="Open what it made in the Library"
      onClick={() => openIn(artefacts[0]!)}
    >
      <Package size={13} aria-hidden="true" />
      <b>Made {summary.count}</b>
      <span>{summary.latest.join(", ")}</span>
    </button>
  );
}

/** Each artefact as a small card at the time it was made, in its turn. */
export function chatMadeCards(artefacts: readonly ShelvedArtefact[]) {
  return artefacts.flatMap((artefact) =>
    artefact.made_at
      ? [
          {
            key: `made:${artefact.id}`,
            at: artefact.made_at,
            node: (
              <div
                className={`chat-made-card${artefact.exists === false ? " is-gone" : ""}`}
                data-artefact-id={artefact.id}
              >
                <span className="chat-made-kind">
                  {ARTEFACT_KIND_LABELS[artefact.kind]}
                </span>
                <span className="chat-made-title" title={artefact.title}>
                  {artefact.title}
                </span>
                <button
                  type="button"
                  onClick={() => openIn(artefact, artefact.id)}
                  aria-label={`Open ${artefact.title} in the Library`}
                >
                  Open <ExternalLink size={12} aria-hidden="true" />
                </button>
              </div>
            ),
          },
        ]
      : [],
  );
}
