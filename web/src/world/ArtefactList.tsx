import {
  ClipboardList,
  File,
  FileText,
  Globe,
  Image,
  Link2,
  type LucideIcon,
  Pin,
} from "lucide-react";
import { useState } from "react";
import {
  ARTEFACT_KIND_LABELS,
  type AgentArtefact,
  type ArtefactKind,
} from "../../../shared/agentArtefacts";
import { useAgentDeskReads } from "./agentQuests";
import { addArtefactToBoard, requestArtefactFile } from "./artefactOpen";
import type { WorldLeafObject } from "./worldObject";
import "./ArtefactList.css";

const KIND_ICONS: Record<ArtefactKind, LucideIcon> = {
  document: FileText,
  report: ClipboardList,
  page: Globe,
  image: Image,
  file: File,
};

/** How many artefacts a card lists before "+N more". */
export const ARTEFACTS_SHOWN = 4;

function artefactTitle(artefact: AgentArtefact) {
  const where =
    artefact.where.type === "file" ? artefact.where.path : artefact.where.url;
  const guess =
    artefact.evidence === "agent_message"
      ? " · mentioned in its reply, so maybe not made by it"
      : "";
  return `${ARTEFACT_KIND_LABELS[artefact.kind]} · ${where}${guess}`;
}

/** What each agent made, by leaf ID: the same desk read Town uses. */
export function useAgentArtefacts(leaves: readonly WorldLeafObject[]) {
  return useAgentDeskReads(leaves).artefacts;
}

/** A Desk row's "N made", or null when the agent made nothing. */
export function artefactsMade(items: readonly AgentArtefact[] | undefined) {
  return items?.length ? `${items.length} made` : null;
}

const NONE: readonly AgentArtefact[] = [];

/**
 * What an agent made (reports, pages, images, published links), newest first,
 * as World derived it from the agent's transcript. Shown the same way on the
 * agent's Desk card and its Town card; neither keeps its own copy.
 */
export function ArtefactList({
  leaf,
  items,
  onOpen,
  limit = ARTEFACTS_SHOWN,
}: {
  leaf: WorldLeafObject;
  items?: readonly AgentArtefact[] | null;
  /**
   * Opens the agent's Inspector, which shows the asked-for file in its Files
   * view; absent where none can open.
   */
  onOpen?: ((nodeId: string) => unknown) | null;
  limit?: number;
}) {
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(
    null,
  );
  const artefacts = items ?? NONE;
  if (!artefacts.length) return null;
  const openFile = (path: string) => {
    if (!onOpen) return;
    requestArtefactFile(leaf.id, path);
    void Promise.resolve(onOpen(leaf.id)).catch(() => undefined);
  };
  const shown = artefacts.slice(0, limit);
  const add = (artefact: AgentArtefact) => {
    setNotice({ id: artefact.id, text: "Adding…" });
    void addArtefactToBoard(leaf, artefact).then(
      (problem) =>
        setNotice({ id: artefact.id, text: problem ?? "Added to Board." }),
      () => setNotice({ id: artefact.id, text: "Could not add it to Board." }),
    );
  };
  return (
    <div className="artefact-list">
      <span className="artefact-list-head">Made</span>
      <ul>
        {shown.map((artefact) => {
          const Icon =
            artefact.where.type === "link" && artefact.kind === "page"
              ? Link2
              : KIND_ICONS[artefact.kind];
          const gone = artefact.exists === false;
          const label = (
            <>
              <Icon size={13} aria-hidden="true" />
              <span className="artefact-title">{artefact.title}</span>
              {gone ? <span className="artefact-gone">deleted</span> : null}
            </>
          );
          return (
            <li
              key={artefact.id}
              className={`artefact-row is-${artefact.kind}${gone ? " is-gone" : ""}${artefact.evidence === "agent_message" ? " is-guess" : ""}`}
              data-artefact-id={artefact.id}
            >
              {artefact.where.type === "link" ? (
                <a
                  className="artefact-open"
                  href={artefact.where.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={artefactTitle(artefact)}
                >
                  {label}
                </a>
              ) : (
                <button
                  type="button"
                  className="artefact-open"
                  disabled={gone || !onOpen}
                  title={
                    gone
                      ? `${artefact.where.path} was deleted`
                      : artefactTitle(artefact)
                  }
                  onClick={() =>
                    artefact.where.type === "file" &&
                    openFile(artefact.where.path)
                  }
                >
                  {label}
                </button>
              )}
              <button
                type="button"
                className="artefact-board"
                disabled={gone}
                aria-label={`Add ${artefact.title} to Board`}
                title="Add to Board"
                onClick={() => add(artefact)}
              >
                <Pin size={12} aria-hidden="true" />
              </button>
              {notice?.id === artefact.id ? (
                <span className="artefact-notice" role="status">
                  {notice.text}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {artefacts.length > shown.length ? (
        <span className="artefact-more">
          +{artefacts.length - shown.length} more
        </span>
      ) : null}
    </div>
  );
}
