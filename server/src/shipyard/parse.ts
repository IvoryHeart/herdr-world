import {
  SHIPYARD_LIMITS as L,
  type ShipyardRelease,
  type ShipyardTag,
  type ShipyardWindow,
  type ShipyardWorkflow,
} from "../../../shared/shipyard";

export const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const sha = (v: unknown): string | null =>
  typeof v === "string" && /^[a-f0-9]{40}$/u.test(v) ? v : null;
export const text = (v: unknown, max = 300): string | null =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(v)
    ? v
    : null;
export const integer = (v: unknown): number | null =>
  Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null;
export const date = (v: unknown): number | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v))
    ? Date.parse(v)
    : null;
export const window = <T>(
  items: T[],
  complete: boolean,
  detail: string | null = null,
): ShipyardWindow<T> => ({ items, complete, detail });

export function parseReleases(
  value: unknown,
  repo: string,
): ShipyardWindow<ShipyardRelease> {
  if (!Array.isArray(value) || value.length > L.releases)
    throw new Error("invalid releases");
  const items: ShipyardRelease[] = [];
  for (const v of value) {
    const row = record(v);
    if (row.draft === true) continue;
    const id = integer(row.id),
      tag = text(row.tag_name, 200),
      publishedAt = date(row.published_at);
    if (
      !id ||
      !tag ||
      publishedAt === null ||
      row.draft !== false ||
      typeof row.prerelease !== "boolean"
    )
      throw new Error("invalid release");
    items.push({
      id,
      tag,
      version: tag.replace(/^v(?=\d)/u, ""),
      name: text(row.name) ?? tag,
      publishedAt,
      channel: row.prerelease ? "prerelease" : "stable",
      url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
    });
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt || b.id - a.id);
  const complete = value.length < L.releases;
  return window(
    items,
    complete,
    complete
      ? null
      : "Release display window is limited; latest stable is read separately.",
  );
}

export function parseTags(
  value: unknown,
  repo: string,
): ShipyardWindow<ShipyardTag> {
  if (!Array.isArray(value) || value.length > L.tags)
    throw new Error("invalid tags");
  const items = value.map((v) => {
    const row = record(v),
      name = text(row.name, 200),
      commit = sha(record(row.commit).sha);
    if (!name || !commit) throw new Error("invalid tag");
    return {
      name,
      sha: commit,
      url: `https://github.com/${repo}/tree/${encodeURIComponent(name)}`,
    };
  });
  const complete = value.length < L.tags;
  return window(
    items,
    complete,
    complete ? null : "Tag display window is limited.",
  );
}

export function parseWorkflows(
  value: unknown,
  repo: string,
  mainSha: string,
): ShipyardWindow<ShipyardWorkflow> {
  const response = record(value);
  if (
    !Array.isArray(response.workflow_runs) ||
    !Number.isSafeInteger(response.total_count) ||
    (response.total_count as number) < 0 ||
    response.workflow_runs.length > L.workflows
  )
    throw new Error("invalid workflows");
  const latest = new Map<
    number,
    { run: ShipyardWorkflow; number: number; attempt: number }
  >();
  for (const v of response.workflow_runs) {
    const row = record(v);
    if (
      row.head_branch !== "main" ||
      row.head_sha !== mainSha ||
      ![
        "push",
        "workflow_dispatch",
        "schedule",
        "workflow_call",
        "repository_dispatch",
      ].includes(String(row.event))
    )
      continue;
    const id = integer(row.id),
      workflowId = integer(row.workflow_id),
      name = text(row.name),
      updatedAt = date(row.updated_at),
      status = text(row.status, 40),
      number = integer(row.run_number),
      attempt = integer(row.run_attempt);
    if (
      !id ||
      !workflowId ||
      !name ||
      updatedAt === null ||
      !status ||
      !number ||
      !attempt
    )
      throw new Error("invalid run");
    const conclusion =
      row.conclusion === null ? null : text(row.conclusion, 40);
    const prior = latest.get(workflowId);
    if (
      !prior ||
      number > prior.number ||
      (number === prior.number && attempt > prior.attempt)
    )
      latest.set(workflowId, {
        number,
        attempt,
        run: {
          id,
          workflowId,
          name,
          sha: mainSha,
          status,
          conclusion,
          updatedAt,
          url: `https://github.com/${repo}/actions/runs/${id}`,
        },
      });
  }
  const complete = response.total_count === response.workflow_runs.length;
  return window(
    [...latest.values()]
      .map((v) => v.run)
      .sort((a, b) => a.workflowId - b.workflowId),
    complete,
    complete
      ? null
      : "Workflow window is limited; passing runs cannot prove main green.",
  );
}
