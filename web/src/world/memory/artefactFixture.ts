import type {
  ArtefactShelf,
  ShelvedArtefact,
} from "../../../../shared/agentArtefacts";
import type { MemoryTarget } from "../../../../shared/memory";
import type { FilePreview } from "../../types";
import { MEMORY_FIXTURE_AGENT_NAMES } from "./memoryFixture";

/**
 * The `?memoryFixture` host's "Made by agents" shelf (#1327): synthetic
 * artefacts covering the rare states (a deleted file, a maker that has gone,
 * a link that is only a guess), so the wing can be tried without real agents.
 * `gone` is the same shelf after every agent on the host stopped (#1342).
 */
const ROOMS: Record<string, string> = { w1: "web-app", w2: "docs-site" };

const at = (now: number, minutes: number) =>
  new Date(now - minutes * 60_000).toISOString();

const maker = (pane: string, room: string, agent = "claude") => ({
  connection_id: "memory-fixture",
  pane_id: pane,
  agent,
  workspace_id: room,
  session: null,
});

export function artefactFixtureShelf(
  target: MemoryTarget,
  now: number,
  gone = false,
): ArtefactShelf {
  const artefacts: ShelvedArtefact[] = [
    {
      id: "artefact-fixture-report",
      title: "release-report.md",
      kind: "report",
      where: { type: "file", path: "/workspace/web-app/release-report.md" },
      made_at: at(now, 4),
      evidence: "file_write",
      exists: true,
      made_by: maker("p1", "w1"),
      gone_maker: null,
      gone_room: null,
    },
    {
      id: "artefact-fixture-pr",
      title: "example/web-app#12",
      kind: "page",
      where: {
        type: "link",
        url: "https://github.com/example/web-app/pull/12",
        link_kind: "pull_request",
      },
      made_at: at(now, 9),
      evidence: "publish_command",
      exists: null,
      made_by: maker("p1", "w1"),
      gone_maker: null,
      gone_room: null,
    },
    {
      id: "artefact-fixture-guess",
      title: "docs.example.com/guide",
      kind: "page",
      where: {
        type: "link",
        url: "https://docs.example.com/guide",
        link_kind: "url",
      },
      made_at: at(now, 30),
      evidence: "agent_message",
      exists: null,
      made_by: maker("p3", "w2", "codex"),
      gone_maker: null,
      gone_room: null,
    },
    {
      id: "artefact-fixture-deleted",
      title: "draft-plan.md",
      kind: "report",
      where: { type: "file", path: "/workspace/docs-site/draft-plan.md" },
      made_at: at(now, 55),
      evidence: "file_write",
      exists: false,
      made_by: maker("p3", "w2", "codex"),
      gone_maker: null,
      gone_room: null,
    },
    {
      id: "artefact-fixture-gone",
      title: "architecture.png",
      kind: "image",
      where: { type: "file", path: "/workspace/web-app/architecture.png" },
      made_at: at(now, 180),
      evidence: "file_write",
      exists: true,
      made_by: maker("p9", "w1"),
      gone_maker: "old-designer",
      gone_room: "web-app",
    },
  ];
  return {
    connection_id: target.connection_id,
    connection_generation: target.connection_generation,
    observed_at: now,
    artefacts: gone
      ? artefacts.map((artefact) => ({
          ...artefact,
          gone_maker:
            artefact.gone_maker ??
            MEMORY_FIXTURE_AGENT_NAMES[artefact.made_by.pane_id] ??
            null,
          gone_room:
            artefact.gone_room ??
            ROOMS[artefact.made_by.workspace_id ?? ""] ??
            null,
        }))
      : artefacts,
    truncated: false,
  };
}

const PIXEL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#3b6ea8"/><text x="80" y="50" fill="#fff" font-size="14" text-anchor="middle">diagram</text></svg>',
  );

export function artefactFixtureRead(path: string): FilePreview {
  const image = path.endsWith(".png");
  return {
    workspace_id: "w1",
    checkout_path: "/workspace/web-app",
    root: "/workspace/web-app",
    path,
    size: 120,
    mtime_ms: 0,
    text: image
      ? null
      : "# Release report\n\nAll checks passed. Two follow-ups:\n\n- Tidy the changelog\n- Retire the old flag\n",
    binary: image,
    ...(image ? { mime_type: "image/png", image_data_url: PIXEL } : {}),
    truncated: false,
  };
}
