import {
  ChevronLeft,
  ClipboardList,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  ARTEFACT_KIND_LABELS,
  type ArtefactKind,
  type ShelvedArtefact,
} from "../../../../shared/agentArtefacts";
import type { MemoryTarget } from "../../../../shared/memory";
import { bridge } from "../../api";
import { ImagePreview } from "../../components/ImagePreview";
import { MarkdownPreview } from "../../components/markdown";
import { PdfPreview } from "../../components/PdfPreview";
import type { FilePreview } from "../../types";
import { workspaceFileUrl } from "../../workspaceFileUrl";
import { artefactShelfClient } from "./artefactShelfClient";
import {
  artefactMaker,
  artefactPlace,
  artefactProject,
  artefactReadable,
} from "./artefactShelfModel";
import { memoryErrorText } from "./memoryClient";
import { memoryFixtureOn } from "./memoryFixture";
import { formatAge, shortPath } from "./memoryModel";
import "./libraryArtefacts.css";

/**
 * The Library's "Made by agents" wing (#1327): the reports, documents,
 * pages, images and links agents made, as rows on a shelf and, once picked,
 * in the Library's reader. Contents are read through the artefact's own host
 * when shown and leave with the reader; World stores only the references.
 */

const KIND_ICONS: Record<ArtefactKind, LucideIcon> = {
  document: FileText,
  report: ClipboardList,
  page: Globe,
  image: Image,
  file: File,
};

const iconOf = (artefact: ShelvedArtefact) =>
  artefact.where.type === "link" ? Link2 : KIND_ICONS[artefact.kind];

/** How a picked artefact reaches its host: a room to read it, and Files. */
export type ArtefactRoute = {
  workspace(artefact: ShelvedArtefact): string | null;
  /** Opens the file in an agent's Files on its host; null when none can. */
  openInFiles(artefact: ShelvedArtefact): (() => void) | null;
};

type Shared = {
  names: Readonly<Record<string, string>>;
  project(id: string | null): string | null;
};

function facts(artefact: ShelvedArtefact, { names, project }: Shared) {
  return [
    ARTEFACT_KIND_LABELS[artefact.kind],
    artefactMaker(artefact, names) + (artefact.gone_maker ? " (gone)" : ""),
    artefactProject(artefact, project),
    artefact.made_at
      ? formatAge(Date.now() - Date.parse(artefact.made_at))
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Marks({ artefact }: { artefact: ShelvedArtefact }) {
  if (artefact.exists !== false && artefact.evidence !== "agent_message")
    return null;
  return (
    <span className="library-artefact-marks">
      {artefact.exists === false ? (
        <span className="library-artefact-mark is-gone">deleted</span>
      ) : null}
      {artefact.evidence === "agent_message" ? (
        <span
          className="library-artefact-mark"
          title="Mentioned in its reply, so maybe not made by it"
        >
          guess
        </span>
      ) : null}
    </span>
  );
}

export function ArtefactShelfList({
  artefacts,
  selected,
  onOpen,
  empty,
  ...shared
}: Shared & {
  artefacts: readonly ShelvedArtefact[];
  selected: string | null;
  onOpen(artefact: ShelvedArtefact): void;
  empty: string;
}) {
  if (!artefacts.length) return <p className="memory-empty-state">{empty}</p>;
  return (
    <ul
      className="memory-matches library-artefacts"
      aria-label="Made by agents"
    >
      {artefacts.map((artefact) => {
        const Icon = iconOf(artefact);
        return (
          <li key={artefact.id}>
            <button
              type="button"
              className={`library-artefact is-${artefact.kind}${artefact.exists === false ? " is-gone" : ""}`}
              aria-current={selected === artefact.id || undefined}
              data-artefact-id={artefact.id}
              title={artefactPlace(artefact)}
              onClick={() => onOpen(artefact)}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="library-artefact-title">{artefact.title}</span>
              <Marks artefact={artefact} />
              <span className="library-artefact-facts">
                {facts(artefact, shared)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type Read =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: FilePreview }
  | { status: "failed"; error: string };

export function ArtefactReader({
  target,
  artefact,
  route,
  onBack,
  ...shared
}: Shared & {
  target: MemoryTarget;
  artefact: ShelvedArtefact;
  route: ArtefactRoute;
  onBack(): void;
}) {
  const shape = artefactReadable(artefact);
  const file = artefact.where.type === "file" ? artefact.where.path : null;
  const workspace = route.workspace(artefact);
  const [read, setRead] = useState<Read>({ status: "idle" });
  useEffect(() => {
    if (!file || !shape || shape === "pdf" || artefact.exists === false) {
      setRead({ status: "idle" });
      return;
    }
    let live = true;
    setRead({ status: "loading" });
    artefactShelfClient()
      .read(target, workspace, file)
      .then(
        (preview) => live && setRead({ status: "ready", preview }),
        (error: unknown) =>
          live && setRead({ status: "failed", error: memoryErrorText(error) }),
      );
    return () => {
      live = false;
    };
  }, [target, file, shape, workspace, artefact.exists]);
  const openFiles =
    file && artefact.exists !== false && route.openInFiles(artefact);
  const name = file ? (file.split("/").pop() ?? file) : artefact.title;
  return (
    <div
      className="memory-book library-artefact-reader"
      aria-label={`Made: ${artefact.title}`}
    >
      <div className="memory-pane-head">
        <button type="button" className="ghost memory-back" onClick={onBack}>
          <ChevronLeft size={15} aria-hidden="true" /> Shelves
        </button>
        <h3 title={artefactPlace(artefact)}>{artefact.title}</h3>
      </div>
      <div className="memory-book-meta">
        <span>{facts(artefact, shared)}</span>
        <Marks artefact={artefact} />
      </div>
      <p className="memory-book-where" title={artefactPlace(artefact)}>
        {file ? shortPath(file, 4) : artefactPlace(artefact)}
      </p>
      <div className="memory-actions">
        {openFiles ? (
          <button type="button" className="memory-primary" onClick={openFiles}>
            <FolderOpen size={14} aria-hidden="true" /> Open in Files
          </button>
        ) : null}
        {artefact.where.type === "link" ? (
          <a
            className="button memory-primary library-artefact-link"
            href={artefact.where.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" /> Open link
          </a>
        ) : null}
      </div>
      {artefact.evidence === "agent_message" ? (
        <p className="memory-hint">
          The agent mentioned this in its reply, so it may not have made it.
        </p>
      ) : null}
      <div className="library-artefact-body">
        {artefact.exists === false ? (
          <p className="memory-hint">This file was deleted.</p>
        ) : !file ? null : shape === "pdf" ? (
          workspace && !memoryFixtureOn() ? (
            <PdfPreview
              name={name}
              url={workspaceFileUrl(
                bridge.connection(
                  target.connection_id,
                  target.connection_generation,
                ),
                workspace,
                file,
                { inline: true },
              )}
            />
          ) : (
            <p className="memory-hint">Open it in Files to read it.</p>
          )
        ) : !shape ? (
          <p className="memory-hint">
            World can't show this kind of file here. Open it in Files.
          </p>
        ) : read.status === "loading" || read.status === "idle" ? (
          <p className="memory-hint" aria-busy="true">
            Reading…
          </p>
        ) : read.status === "failed" ? (
          <p className="memory-notice is-error" role="alert">
            Couldn't read it: {read.error}
          </p>
        ) : read.preview.image_data_url ? (
          <ImagePreview src={read.preview.image_data_url} name={name} />
        ) : read.preview.text === null ? (
          <p className="memory-hint">
            World can't show this file here. Open it in Files.
          </p>
        ) : shape === "markdown" ? (
          <MarkdownPreview text={read.preview.text} />
        ) : (
          <pre className="library-artefact-text">{read.preview.text}</pre>
        )}
        {read.status === "ready" && read.preview.truncated ? (
          <p className="memory-hint">Only the start is shown.</p>
        ) : null}
      </div>
    </div>
  );
}
