import { CircleDot, GitPullRequest, Link2 } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";
import type { BoardElement } from "../../../../../shared/boardElements";
import { ARTEFACT_KIND_LABELS } from "../../../../../shared/agentArtefacts";
import {
  BOARD_KIND_PRESENTATION,
  baseName,
  classifyLink,
  elementKey,
  projectSource,
} from "./boardElementKinds";
import type { SourcePlace } from "./boardElementRead";

const LINK_WORDS = {
  pull_request: "Pull request",
  issue: "Issue",
  url: "Link",
} as const;

/** The words a screen reader hears for a card. */
export function elementCardLabel(element: BoardElement) {
  return `${BOARD_KIND_PRESENTATION[element.kind].label}: ${element.title}`;
}

/**
 * One element on Board, in Board's paper language beside its sticky notes:
 * memory is a card-index drawer, a log a ruled ledger page, a doc a sheet
 * with a folded corner and a link a luggage tag. The art is CSS only
 * (boardElements.css); content is read when opened, never on the card.
 */
export function BoardElementCard({
  element,
  place,
  selected,
  cardRef,
  onKeyDown,
}: {
  element: BoardElement;
  /** Where a project element reads from; null for inline docs and links. */
  place: SourcePlace | null;
  selected: boolean;
  cardRef: Ref<HTMLDivElement>;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}) {
  const kind = BOARD_KIND_PRESENTATION[element.kind];
  const Icon = kind.icon;
  const project = projectSource(element);
  const offline = project !== null && place?.generation === null;
  const key = elementKey(element.id);
  return (
    <div
      ref={cardRef}
      data-key={key}
      data-element-kind={element.kind}
      role="button"
      tabIndex={0}
      aria-label={elementCardLabel(element)}
      aria-description={offline ? `${place?.hostLabel} is offline` : undefined}
      className={[
        "board-card board-element",
        `board-element-${element.kind}`,
        selected ? "board-selected" : "",
        offline ? "board-element-offline" : "",
      ].join(" ")}
      onKeyDown={onKeyDown}
    >
      {element.kind === "memory" ? (
        <span className="board-element-drawer" aria-hidden="true">
          {kind.label}
        </span>
      ) : null}
      {element.kind === "link" ? (
        <span className="board-element-eyelet" aria-hidden="true" />
      ) : null}
      <div className="board-element-head">
        <Icon size={15} aria-hidden="true" />
        <strong className="board-element-title">{element.title}</strong>
      </div>
      <ElementBody element={element} place={place} />
      {/* An artefact names the room it was made in, link or file. */}
      {(project || element.kind === "artefact") && place ? (
        <div className="board-element-place">
          {offline ? (
            <span className="board-element-offline-mark">offline · </span>
          ) : null}
          {place.workspaceLabel} · {place.hostLabel}
        </div>
      ) : null}
    </div>
  );
}

function ElementBody({
  element,
  place,
}: {
  element: BoardElement;
  place: SourcePlace | null;
}) {
  switch (element.kind) {
    case "memory":
      return (
        <div className="board-element-line">
          {/* A name without an extension is most likely a memory folder. */}
          {baseName(element.source.path).includes(".")
            ? baseName(element.source.path)
            : `${baseName(element.source.path)}/`}
        </div>
      );
    case "log":
      return (
        <>
          {element.source.agent_ref ? (
            <div className="board-element-line board-element-agent">
              {element.source.agent_ref}
            </div>
          ) : null}
          <div className="board-element-line">
            {baseName(element.source.path)}
          </div>
        </>
      );
    case "document":
      return "text" in element.source ? (
        <div className="board-element-excerpt">
          {element.source.text.trim() || "Empty page"}
        </div>
      ) : (
        <div className="board-element-line">
          {baseName(element.source.path)}
        </div>
      );
    case "artefact":
      return (
        <>
          <div className="board-element-line board-element-agent">
            {ARTEFACT_KIND_LABELS[element.source.artefact_kind]} · by{" "}
            {place?.maker ?? element.source.agent}
          </div>
          <div className="board-element-line">
            {"file" in element.source
              ? baseName(element.source.file)
              : (classifyLink(element.source.url).ref ??
                classifyLink(element.source.url).site)}
          </div>
        </>
      );
    case "link": {
      const link = classifyLink(element.source.url);
      const LinkIcon =
        link.kind === "pull_request"
          ? GitPullRequest
          : link.kind === "issue"
            ? CircleDot
            : Link2;
      return (
        <div className="board-element-line board-element-linkline">
          <LinkIcon size={13} aria-hidden="true" />
          <span>
            {LINK_WORDS[link.kind]} · {link.ref ?? link.site}
          </span>
        </div>
      );
    }
  }
}
