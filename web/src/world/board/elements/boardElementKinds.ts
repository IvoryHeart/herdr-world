import {
  AppWindow,
  Brain,
  FileText,
  GitPullRequest,
  LayoutGrid,
  Link2,
  type LucideIcon,
  PackageOpen,
  ScrollText,
  Server,
  Spline,
  SquareTerminal,
  StickyNote,
} from "lucide-react";
import {
  BOARD_ELEMENT_TYPES,
  type BoardElement,
  type BoardElementKind,
  type BoardRegistryKind,
} from "../../../../../shared/boardElements";

/**
 * How Board presents each kind in the one registry (shared/boardElements.ts).
 * The registry says what a kind is, where it reads from and what it can do;
 * this says what a person sees: its name, its art and how they add one.
 * `satisfies Record<BoardRegistryKind, …>` keeps the two in step: a kind the
 * registry gains without a presentation fails the type check.
 */
export type BoardKindAdd =
  /** A new element: the Add dialog's form, then world.board.patch element.put. */
  | "form"
  /** Board's existing note seam: a note at the middle of the view. */
  | "note"
  /** The existing New workspace dialog, on a chosen host. */
  | "workspace"
  /** The Work lens: pull requests and tickets. */
  | "work"
  /** Comes from Herdr itself; the hint says where. */
  | "topology"
  /** Drawn by dragging a card's handle. */
  | "string"
  /** Made by an agent: Add to Board on the agent's card. */
  | "agent";

export type BoardKindPresentation = {
  label: string;
  /** One line for the Add dialog. */
  blurb: string;
  icon: LucideIcon;
  add: BoardKindAdd;
};

export const BOARD_KIND_PRESENTATION = {
  host: {
    label: "Host",
    blurb: "A computer running Herdr. Add one from Spaces.",
    icon: Server,
    add: "topology",
  },
  workspace: {
    label: "Workspace",
    blurb: "A project folder on a host, with its tabs around it.",
    icon: LayoutGrid,
    add: "workspace",
  },
  tab: {
    label: "Tab",
    blurb: "Agents and terminals. Use New on a workspace card.",
    icon: AppWindow,
    add: "topology",
  },
  pane: {
    label: "Pane",
    blurb: "One agent or terminal, shown as a row on its tab.",
    icon: SquareTerminal,
    add: "topology",
  },
  note: {
    label: "Note",
    blurb: "A sticky note to think with, string and send to an agent.",
    icon: StickyNote,
    add: "note",
  },
  string: {
    label: "String",
    blurb: "Drag the dot on a card's edge to another card.",
    icon: Spline,
    add: "string",
  },
  work: {
    label: "Work",
    blurb: "Pull requests and tickets, in the Work lens.",
    icon: GitPullRequest,
    add: "work",
  },
  memory: {
    label: "Memory",
    blurb: "A project's memory file or folder, read on demand.",
    icon: Brain,
    add: "form",
  },
  log: {
    label: "Agent log",
    blurb: "A finished agent's saved log or transcript.",
    icon: ScrollText,
    add: "form",
  },
  document: {
    label: "Doc",
    blurb: "A page you write here, or a project file to read.",
    icon: FileText,
    add: "form",
  },
  link: {
    label: "Link",
    blurb: "A web address, pull request or issue. Never fetched.",
    icon: Link2,
    add: "form",
  },
  artefact: {
    label: "Made by an agent",
    blurb:
      "A report, page or link an agent made. Use Add to Board on the agent's card.",
    icon: PackageOpen,
    add: "agent",
  },
} as const satisfies Record<BoardRegistryKind, BoardKindPresentation>;

/** Every registered kind, in registry order, with its presentation. */
export const BOARD_KINDS = BOARD_ELEMENT_TYPES.map((type) => ({
  ...type,
  ...(BOARD_KIND_PRESENTATION[type.kind] as BoardKindPresentation),
}));

/** Kinds a person places on Board themselves (new elements and notes). */
export const PLACED_KINDS = BOARD_KINDS.filter(
  (kind) =>
    (kind.placement === "element" && kind.add === "form") ||
    kind.add === "note",
);
/** Kinds that arrive from hosts and sources; the dialog says how. */
export const ARRIVING_KINDS = BOARD_KINDS.filter(
  (kind) => !PLACED_KINDS.includes(kind),
);

export const ELEMENT_PREFIX = "element:";
export const isElementKey = (key: string) => key.startsWith(ELEMENT_PREFIX);
export const elementKey = (id: string) => ELEMENT_PREFIX + id;

export const DEFAULT_TITLES: Record<BoardElementKind, string> = {
  memory: "Memory",
  log: "Agent log",
  document: "Doc",
  link: "Link",
  artefact: "Made by an agent",
};

export type LinkKind = "url" | "pull_request" | "issue";
/**
 * What a link points at, for its tag: the same GitHub pull request and issue
 * shapes the service classifies (it is the authority on a read). Never fetched.
 */
export function classifyLink(url: string): {
  kind: LinkKind;
  site: string;
  ref?: string;
} {
  try {
    const parsed = new URL(url);
    const site = parsed.host.replace(/^www\./, "");
    const match =
      parsed.hostname === "github.com" &&
      /^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)\/?$/.exec(parsed.pathname);
    if (match)
      return {
        kind: match[3] === "pull" ? "pull_request" : "issue",
        site,
        ref: `${match[1]}/${match[2]}#${match[4]}`,
      };
    return { kind: "url", site };
  } catch {
    return { kind: "url", site: url };
  }
}

/** The last part of a project path, for a card's small line. */
export const baseName = (path: string) => path.split("/").pop() || path;

/** Whether an element reads from a project on a host (not inline or a URL). */
export function projectSource(element: BoardElement) {
  if (element.kind === "link") return null;
  if (element.kind === "artefact")
    return "file" in element.source
      ? {
          connection_id: element.source.connection_id,
          workspace_id: element.source.workspace_id,
          path: element.source.file,
          agent_ref: element.source.agent_ref,
        }
      : null;
  if (element.kind === "document" && "text" in element.source) return null;
  return element.source as {
    connection_id: string;
    workspace_id: string;
    path: string;
    agent_ref?: string;
  };
}
