/**
 * Artefacts: the things an agent made besides code (reports, documents,
 * pages, images, published links), derived by World from the agent's own
 * transcript. A record is a reference only; World never copies the content.
 */

const ARTEFACT_KINDS = ["document", "report", "page", "image", "file"] as const;
export type ArtefactKind = (typeof ARTEFACT_KINDS)[number];

/**
 * How the transcript shows the agent made it. `file_write` and `patch_add`
 * are the harness's own record of creating a file; `publish_command` is a
 * link printed by a publishing command (`gh pr create`, `gh gist create` …);
 * `agent_message` is a link the agent wrote in its reply, which is a guess.
 */
export type ArtefactEvidence =
  | "file_write"
  | "patch_add"
  | "publish_command"
  | "agent_message";

export type ArtefactLinkKind = "url" | "pull_request" | "issue";

type ArtefactWhere =
  | {
      type: "file";
      /** Absolute path on the agent's host, as its transcript names it. */
      path: string;
    }
  | { type: "link"; url: string; link_kind: ArtefactLinkKind };

/**
 * Who made it, as World derived it once: the agent's pane on its immutable
 * source connection, its harness, and the room (Herdr workspace) it was in
 * when World first saw the artefact. Views display these; none rebuilds them
 * from where the agent is now.
 */
export type ArtefactMaker = {
  connection_id: string;
  pane_id: string;
  /** The harness, e.g. `claude` or `codex`. */
  agent: string;
  /** Null when the agent's room was unknown when World first saw it. */
  workspace_id: string | null;
  /**
   * The maker's agent session as Herdr reported it, fingerprinted the same
   * way as World's agent leaf (`agentSessionFingerprint`): continuity
   * evidence, so a later agent in the same pane is never credited. Null when
   * the harness reported no session.
   */
  session: string | null;
};

export type AgentArtefact = {
  /**
   * Stable for the same place on the same source connection:
   * `artefact-<hash of connection and where>`. The same path on two hosts is
   * two artefacts.
   */
  id: string;
  title: string;
  kind: ArtefactKind;
  where: ArtefactWhere;
  /** When the agent made it (its latest write or mention), ISO time. */
  made_at: string | null;
  evidence: ArtefactEvidence;
  /**
   * Whether the file is still there: false once it is deleted. Null when
   * World did not check (links are never fetched; remote hosts are not
   * probed on every read).
   */
  exists: boolean | null;
  made_by: ArtefactMaker;
};

/** The most artefacts one agent session reports, newest first. */
export const ARTEFACT_LIMIT = 24;
export const ARTEFACT_TITLE_LIMIT = 120;

export const ARTEFACT_KIND_LABELS: Record<ArtefactKind, string> = {
  document: "Document",
  report: "Report",
  page: "Page",
  image: "Image",
  file: "File",
};

const DOCUMENT = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "rst",
  "adoc",
  "org",
  "pdf",
  "docx",
  "odt",
  "rtf",
]);
const PAGE = new Set(["html", "htm"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);
const FILE = new Set([
  "csv",
  "tsv",
  "xlsx",
  "ods",
  "pptx",
  "odp",
  "mmd",
  "mermaid",
  "drawio",
  "dot",
  "excalidraw",
  "ipynb",
]);
const REPORT_NAME =
  /report|review|plan|proposal|summary|findings|research|analysis|audit|notes|retro|postmortem|rfc|adr/i;

/**
 * The kind of a file by its name, or null when it is not an artefact (code,
 * configuration and data files are tracked by git, not here).
 */
export function artefactKindForPath(path: string): ArtefactKind | null {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  if (DOCUMENT.has(extension))
    return REPORT_NAME.test(name.slice(0, dot)) ? "report" : "document";
  if (PAGE.has(extension)) return "page";
  if (IMAGE.has(extension)) return "image";
  if (FILE.has(extension)) return "file";
  return null;
}

/** GitHub pull requests and issues are named by their ref; nothing is fetched. */
export function artefactLinkKind(url: URL): ArtefactLinkKind {
  if (url.hostname !== "github.com") return "url";
  if (/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname))
    return "pull_request";
  if (/^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname)) return "issue";
  return "url";
}

/** A short title for a link: `owner/repo#12`, else host and path. */
export function artefactLinkTitle(url: URL): string {
  const match = /^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)\/?$/.exec(
    url.pathname,
  );
  if (url.hostname === "github.com" && match)
    return `${match[1]}/${match[2]}#${match[3]}`;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const title = `${url.hostname}${path}`;
  return title.length > ARTEFACT_TITLE_LIMIT
    ? `${title.slice(0, ARTEFACT_TITLE_LIMIT - 1)}…`
    : title;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Validates one wire record; the browser drops anything else. */
export function parseAgentArtefact(value: unknown): AgentArtefact | null {
  if (!isRecord(value) || !isRecord(value.where)) return null;
  const { id, title, kind, made_at, evidence, exists, where, made_by } = value;
  if (
    !isRecord(made_by) ||
    typeof made_by.connection_id !== "string" ||
    typeof made_by.pane_id !== "string" ||
    typeof made_by.agent !== "string" ||
    !(
      made_by.workspace_id === null || typeof made_by.workspace_id === "string"
    ) ||
    !(
      made_by.session === undefined ||
      made_by.session === null ||
      (typeof made_by.session === "string" &&
        /^[a-f0-9]{64}$/u.test(made_by.session))
    )
  )
    return null;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    !ARTEFACT_KINDS.includes(kind as ArtefactKind) ||
    !(made_at === null || typeof made_at === "string") ||
    !["file_write", "patch_add", "publish_command", "agent_message"].includes(
      evidence as string,
    ) ||
    !(exists === null || typeof exists === "boolean")
  )
    return null;
  let place: ArtefactWhere;
  if (where.type === "file" && typeof where.path === "string")
    place = { type: "file", path: where.path };
  else if (
    where.type === "link" &&
    typeof where.url === "string" &&
    /^https?:\/\//.test(where.url) &&
    ["url", "pull_request", "issue"].includes(where.link_kind as string)
  )
    place = {
      type: "link",
      url: where.url,
      link_kind: where.link_kind as ArtefactLinkKind,
    };
  else return null;
  return {
    id,
    title,
    kind: kind as ArtefactKind,
    where: place,
    made_at: made_at as string | null,
    evidence: evidence as ArtefactEvidence,
    exists: exists as boolean | null,
    made_by: {
      connection_id: made_by.connection_id,
      pane_id: made_by.pane_id,
      agent: made_by.agent,
      workspace_id: made_by.workspace_id as string | null,
      // A service without session evidence sends none.
      session: (made_by.session as string | undefined) ?? null,
    },
  };
}

/**
 * An artefact on the Library's "Made by agents" shelf: World's record plus
 * whether its maker still runs. A live maker is named by World now; a
 * maker that has gone is named as Apartments recorded it (`gone_maker`).
 */
export type ShelvedArtefact = AgentArtefact & {
  /** The maker's name as it was, once it has gone; null while it runs. */
  gone_maker: string | null;
  /**
   * The gone maker's room by the label it had (Apartments' record), for
   * when no room on the host has that label now; null while it runs.
   */
  gone_room: string | null;
};

/** One host's "Made by agents" shelf (`world.artefacts.list`). */
export type ArtefactShelf = {
  connection_id: string;
  connection_generation: number;
  observed_at: number;
  /** Newest first; one record per place on this host. */
  artefacts: ShelvedArtefact[];
  /** More were found than the shelf holds (ARTEFACT_SHELF_LIMIT). */
  truncated: boolean;
};

/** The most artefacts one host's shelf holds, newest first. */
export const ARTEFACT_SHELF_LIMIT = 400;

/** Validates a shelf reply; records that do not parse are dropped. */
export function parseArtefactShelf(value: unknown): ArtefactShelf | null {
  if (
    !isRecord(value) ||
    typeof value.connection_id !== "string" ||
    typeof value.connection_generation !== "number" ||
    typeof value.observed_at !== "number" ||
    !Array.isArray(value.artefacts)
  )
    return null;
  const artefacts: ShelvedArtefact[] = [];
  for (const raw of value.artefacts) {
    const artefact = parseAgentArtefact(raw);
    if (!artefact || !isRecord(raw)) continue;
    const gone = raw.gone_maker;
    const room = raw.gone_room;
    artefacts.push({
      ...artefact,
      gone_maker: typeof gone === "string" ? gone.slice(0, 200) : null,
      gone_room: typeof room === "string" ? room.slice(0, 200) : null,
    });
  }
  return {
    connection_id: value.connection_id,
    connection_generation: value.connection_generation,
    observed_at: value.observed_at,
    artefacts,
    truncated: value.truncated === true,
  };
}
