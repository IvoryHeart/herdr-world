import {
  ARTEFACT_KIND_LABELS,
  type AgentArtefact,
  type ShelvedArtefact,
} from "../../../../shared/agentArtefacts";
import { harnessLabel, type MemoryReader } from "./memoryModel";

/**
 * What the Library's "Made by agents" wing (#1327) shows from one host's
 * shelf: the artefacts a reader made, who made them, where they live and
 * the search over them. Pure, so the wing, the views' "Made" summaries and
 * the tests share it; nothing here keeps a list of its own.
 */

/** Where an artefact is: its file path or link. */
export function artefactPlace(artefact: Pick<AgentArtefact, "where">) {
  return artefact.where.type === "file"
    ? artefact.where.path
    : artefact.where.url;
}

/**
 * The maker as World names it: a gone agent by the name it had, a running
 * one by World's name for its pane.
 */
export function artefactMaker(
  artefact: Pick<ShelvedArtefact, "gone_maker" | "made_by">,
  names: Readonly<Record<string, string>> = {},
) {
  if (artefact.gone_maker) return artefact.gone_maker;
  const { pane_id, agent } = artefact.made_by;
  return names[pane_id] ?? `${harnessLabel(agent)} ${pane_id}`;
}

/** The artefacts `reader` made: by agent (pane) or by the room it was in. */
export function readerArtefacts<T extends Pick<AgentArtefact, "made_by">>(
  artefacts: readonly T[],
  reader: MemoryReader,
): T[] {
  if (reader.kind === "all") return [...artefacts];
  return artefacts.filter((artefact) =>
    reader.kind === "agent"
      ? artefact.made_by.pane_id === reader.id
      : artefact.made_by.workspace_id === reader.id,
  );
}

/**
 * Search: every word of `query` appears in the title, kind, maker, project
 * or path/link, case-insensitive.
 */
export function searchArtefacts<T extends ShelvedArtefact>(
  artefacts: readonly T[],
  query: string,
  names: Readonly<Record<string, string>> = {},
  project: (id: string | null) => string | null = () => null,
): T[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  return artefacts.filter((artefact) => {
    const text = [
      artefact.title,
      ARTEFACT_KIND_LABELS[artefact.kind],
      artefactMaker(artefact, names),
      project(artefact.made_by.workspace_id) ?? "",
      artefactPlace(artefact),
    ]
      .join("\n")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** How many to name in a "Made" summary. */
const MADE_NAMED = 2;

/**
 * A view's short "Made" summary for one agent: how many it made and the
 * latest one or two titles (the list arrives newest first).
 */
export function madeSummary(
  artefacts: readonly Pick<AgentArtefact, "title">[] | null | undefined,
) {
  if (!artefacts?.length) return null;
  return {
    count: artefacts.length,
    latest: artefacts.slice(0, MADE_NAMED).map((artefact) => artefact.title),
  };
}

/** Whether the reader can show a file's contents, by its kind of file. */
export function artefactReadable(artefact: Pick<AgentArtefact, "where">) {
  if (artefact.where.type !== "file") return null;
  const name = artefact.where.path.toLowerCase();
  if (/\.(md|markdown|mdx)$/u.test(name)) return "markdown" as const;
  if (/\.pdf$/u.test(name)) return "pdf" as const;
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/u.test(name)) return "image" as const;
  if (/\.(txt|rst|adoc|org|csv|tsv|mmd|mermaid|dot|html?)$/u.test(name))
    return "text" as const;
  return null;
}
