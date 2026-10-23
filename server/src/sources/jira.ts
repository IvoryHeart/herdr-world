import type { TicketLane, WorkItem } from "../../../shared/worldSources";
import { record, type SourceRefresh } from "./github";

/**
 * Jira Cloud through its REST API, with a site, an account email and an API
 * token from the service's private storage. The configured JQL picks the
 * tickets; assigned and watched ones by default.
 */

export const DEFAULT_JIRA_JQL =
  "(assignee = currentUser() OR watcher = currentUser()) AND (statusCategory != Done OR updated >= -7d) ORDER BY updated DESC";

export type JiraConfig = {
  site: string | null;
  email: string | null;
  jql: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_JQL = 2_000;
const MAX_EMAIL = 320;
const MAX_TOKEN = 1_024;
const MAX_TITLE = 300;
const MAX_STATUS = 80;

export const JIRA_NOT_CONFIGURED =
  "Add your Jira Cloud site, account email and an API token in Sources settings.";
const JIRA_REJECTED =
  "Jira rejected the email or API token. Create a new token and save it in Sources settings.";
const JIRA_BAD_QUERY =
  "Jira rejected the JQL filter. Check it in Jira's issue search, then save it here.";
const JIRA_FAILED =
  "Jira did not answer. World keeps the last tickets and tries again shortly.";

/** `https://example.atlassian.net`, from a bare host or an https:// URL. */
export function normalizeJiraSite(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Jira site must be text");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 255) throw new Error("Jira site is too long");
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Jira site must be a host such as example.atlassian.net");
  }
  if (url.protocol !== "https:") throw new Error("Jira site must use https://");
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("Jira site must be a host only, without a path or login");
  return url.origin;
}

export function normalizeJiraEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Jira email must be text");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+$/u.test(trimmed))
    throw new Error("Jira email must be an email address");
  return trimmed;
}

export function normalizeJiraJql(value: unknown): string {
  if (value === null || value === undefined) return DEFAULT_JIRA_JQL;
  if (typeof value !== "string") throw new Error("JQL must be text");
  const trimmed = value.trim();
  if (trimmed.length > MAX_JQL) throw new Error("JQL is too long");
  return trimmed || DEFAULT_JIRA_JQL;
}

export function normalizeJiraToken(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Jira API token must be text");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_TOKEN || /\s/u.test(trimmed))
    throw new Error("Jira API token is not valid");
  return trimmed;
}

export async function refreshJira(
  config: JiraConfig,
  token: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<SourceRefresh> {
  if (!config.site || !config.email || !token)
    return { ok: false, state: "not_connected", detail: JIRA_NOT_CONFIGURED };
  const headers = {
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString("base64")}`,
  };
  const request = (path: string, init: RequestInit = {}) =>
    fetchImpl(new URL(path, config.site!), {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  try {
    const me = await request("/rest/api/3/myself");
    if (me.status === 401 || me.status === 403)
      return { ok: false, state: "not_connected", detail: JIRA_REJECTED };
    if (!me.ok) return { ok: false, state: "error", detail: JIRA_FAILED };
    const accountId = record(JSON.parse(await boundedText(me))).accountId;
    const search = await request("/rest/api/3/search/jql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jql: config.jql,
        maxResults: MAX_RESULTS,
        fields: [
          "summary",
          "status",
          "assignee",
          "watches",
          "updated",
          "resolutiondate",
          "statuscategorychangedate",
        ],
      }),
    });
    if (search.status === 401 || search.status === 403)
      return { ok: false, state: "not_connected", detail: JIRA_REJECTED };
    if (search.status === 400)
      return { ok: false, state: "error", detail: JIRA_BAD_QUERY };
    if (!search.ok) return { ok: false, state: "error", detail: JIRA_FAILED };
    return {
      ok: true,
      items: parseJiraIssues(
        JSON.parse(await boundedText(search)),
        config.site,
        typeof accountId === "string" ? accountId : null,
      ),
    };
  } catch {
    return { ok: false, state: "error", detail: JIRA_FAILED };
  }
}

const LANE_OF: Record<string, TicketLane> = {
  new: "todo",
  indeterminate: "doing",
  done: "done",
};

export function parseJiraIssues(
  value: unknown,
  site: string,
  accountId: string | null,
): WorkItem[] {
  const issues = record(value).issues;
  if (!Array.isArray(issues)) throw new Error("Jira response has no issues");
  const items: WorkItem[] = [];
  for (const raw of issues.slice(0, MAX_RESULTS)) {
    const issue = record(raw);
    const key = issue.key;
    if (typeof key !== "string" || !/^[A-Z][A-Z0-9_]+-\d+$/u.test(key))
      continue;
    const fields = record(issue.fields);
    const status = record(fields.status);
    const category = record(status.statusCategory).key;
    const assignee = record(fields.assignee).accountId;
    const updated =
      typeof fields.updated === "string" ? Date.parse(fields.updated) : NaN;
    const lane = (typeof category === "string" && LANE_OF[category]) || "todo";
    // A Done ticket finished when it was resolved, or else when it entered
    // Done; a later comment moves `updated`, not that day.
    const finished = [fields.resolutiondate, fields.statuscategorychangedate]
      .map((value) => (typeof value === "string" ? Date.parse(value) : NaN))
      .find(Number.isFinite);
    items.push({
      key: `jira:${key}`,
      source: "jira",
      kind: "ticket",
      ref: key,
      title: bounded(fields.summary, MAX_TITLE),
      url: new URL(`/browse/${key}`, site).toString(),
      lane,
      status: bounded(status.name, MAX_STATUS) || "Unknown",
      // Only what Jira confirms: a broad filter returns tickets that are
      // neither assigned to nor watched by the user.
      roles: [
        ...(accountId && assignee === accountId ? ["assignee" as const] : []),
        ...(record(fields.watches).isWatching === true
          ? ["watcher" as const]
          : []),
      ],
      updatedAt: Number.isFinite(updated) ? updated : 0,
      ...(lane === "done" && finished ? { finishedAt: finished } : {}),
    });
  }
  return items;
}

function bounded(value: unknown, max: number) {
  return typeof value === "string"
    ? [...value.trim()].slice(0, max).join("")
    : "";
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new Error("Jira response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Jira response is too large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}
