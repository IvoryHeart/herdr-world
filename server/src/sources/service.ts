import type { PullRequestAction } from "../../../shared/pullRequests";
import type {
  WorkItem,
  WorkLink,
  WorldSourceId,
  WorldSourceState,
  WorldSourceStatus,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";
import {
  DEFAULT_MERGED_DAYS,
  normalizeMergedDays,
  refreshGitHub,
  type RunProcess,
  type SourceRefresh,
} from "./github";
import {
  DEFAULT_JIRA_JQL,
  normalizeJiraEmail,
  normalizeJiraJql,
  normalizeJiraSite,
  normalizeJiraToken,
  refreshJira,
  type JiraConfig,
} from "./jira";
import {
  CheckoutResolver,
  linkWorkItems,
  type TopologyConnection,
} from "./links";
import type { SourceSecrets } from "./secrets";
import { runPullRequestVerb, type PullRequestVerbRequest } from "./actions";
import type { CachedDetail } from "./pullRequestDetail";

/**
 * World's built-in sources. Each is on by default and can be switched off;
 * one without its prerequisites reports `not_connected` with what to do.
 * Refreshes run only while a browser asks, at most once per interval, one at
 * a time per source; a failed refresh keeps the last items. A request waits
 * briefly for a refresh, then answers with what World has and `refreshing`,
 * so a slow `gh`, Jira or SSH host never holds a request open.
 */

/** Saved values were validated on the way in; drop any that no longer are. */
function safe<T>(read: () => T, fallback: T) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export type StoredSourceSettings = {
  github?: { enabled?: boolean; mergedDays?: number };
  jira?: {
    enabled?: boolean;
    site?: string | null;
    email?: string | null;
    jql?: string | null;
  };
};

type SourceRuntime = {
  id: WorldSourceId;
  label: string;
  items: WorkItem[];
  state: WorldSourceState;
  detail: string;
  checkedAt: number;
  lastSuccessAt: number | null;
  generation: number;
  refreshing: Promise<void> | null;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SourcesServiceOptions = {
  settings: StoredSourceSettings;
  persistSettings(settings: StoredSourceSettings): Promise<void>;
  secrets: { read(): SourceSecrets; write(secrets: SourceSecrets): void };
  run: RunProcess;
  fetchImpl?: FetchLike;
  topology(): Promise<TopologyConnection[]>;
  resolver: CheckoutResolver;
  now?: () => number;
  refreshMs?: number;
  linkMs?: number;
  /** How long a request waits for a refresh before answering. */
  waitMs?: number;
};

/** Settings the user can correct; the message names the field. */
export class SourceSettingsError extends Error {}

/** A pull request verb World won't start; the message says why. */
export class PullRequestVerbError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

/** Verbs kept for "since you were away"; the oldest go first. */
const MAX_ACTIONS = 50;

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_LINK_MS = 15_000;
/** Even a forced refresh waits this long after the last one. */
const MIN_FORCED_MS = 5_000;
const DEFAULT_WAIT_MS = 2_000;

export type JiraSettingsPatch = {
  enabled?: boolean;
  site?: string | null;
  email?: string | null;
  jql?: string | null;
  /** A new token; null removes it; absent keeps the saved one. */
  token?: string | null;
};

export class SourcesService {
  #settings: StoredSourceSettings;
  #options: SourcesServiceOptions;
  #now: () => number;
  #refreshMs: number;
  #linkMs: number;
  #waitMs: number;
  #sources: Record<WorldSourceId, SourceRuntime>;
  #links: WorkLink[] = [];
  #linkedAt = 0;
  /** Bumped by a settings change; older refresh cycles then write nothing. */
  #epoch = 0;
  #cycling: Promise<void> | null = null;
  #details = new Map<string, CachedDetail>();
  #actions: PullRequestAction[] = [];
  /** Pull requests with a verb running. */
  #acting = new Set<string>();

  constructor(options: SourcesServiceOptions) {
    this.#options = options;
    this.#settings = options.settings;
    this.#now = options.now ?? Date.now;
    this.#refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
    this.#linkMs = options.linkMs ?? DEFAULT_LINK_MS;
    this.#waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    const runtime = (id: WorldSourceId, label: string): SourceRuntime => ({
      id,
      label,
      items: [],
      state: "not_connected",
      detail: "Checking…",
      checkedAt: 0,
      lastSuccessAt: null,
      generation: 0,
      refreshing: null,
    });
    this.#sources = {
      github: runtime("github", "GitHub"),
      jira: runtime("jira", "Jira"),
    };
  }

  enabled(id: WorldSourceId) {
    return this.#settings[id]?.enabled !== false;
  }

  /** Days of merged pull requests to show. */
  mergedDays() {
    return safe(
      () => normalizeMergedDays(this.#settings.github?.mergedDays),
      DEFAULT_MERGED_DAYS,
    );
  }

  jiraConfig(): JiraConfig {
    const jira = this.#settings.jira ?? {};
    return {
      site: safe(() => normalizeJiraSite(jira.site), null),
      email: safe(() => normalizeJiraEmail(jira.email), null),
      jql: safe(() => normalizeJiraJql(jira.jql), DEFAULT_JIRA_JQL),
    };
  }

  statuses(): WorldSourceStatus[] {
    return (["github", "jira"] as const).map((id) => {
      const source = this.#sources[id];
      const enabled = this.enabled(id);
      const jira = this.jiraConfig();
      return {
        id,
        label: source.label,
        enabled,
        state: enabled ? source.state : "disabled",
        detail: enabled ? source.detail : `${source.label} is switched off.`,
        checkedAt: source.checkedAt,
        lastSuccessAt: source.lastSuccessAt,
        itemCount: enabled ? source.items.length : 0,
        config:
          id === "github"
            ? { kind: "github", mergedDays: this.mergedDays() }
            : {
                kind: "jira",
                site: jira.site,
                email: jira.email,
                jql: jira.jql,
                tokenSet: Boolean(this.#jiraToken()),
              },
      };
    });
  }

  async snapshot(force = false): Promise<WorldSourcesSnapshot> {
    const cycle = this.#cycle(force);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      cycle,
      new Promise((resolve) => {
        timer = setTimeout(resolve, this.#waitMs);
      }),
    ]);
    clearTimeout(timer);
    return this.current();
  }

  /** What World has now, without refreshing. */
  current(): WorldSourcesSnapshot {
    const items = this.#items();
    const keys = new Set(items.map((item) => item.key));
    return {
      observedAt: this.#now(),
      refreshing: this.#cycling !== null,
      sources: this.statuses(),
      items,
      links: this.#links.filter((link) => keys.has(link.itemKey)),
      actions: [...this.#actions],
    };
  }

  /**
   * Run a verb the viewer confirmed on one of their open pull requests, then
   * refresh so the card shows what GitHub now says. Each run is recorded
   * with who asked: the viewer, as their browser session reported it.
   */
  async pullRequestVerb(key: string, request: PullRequestVerbRequest) {
    const item = this.enabled("github")
      ? this.#sources.github.items.find((entry) => entry.key === key)
      : undefined;
    if (!item || item.kind !== "pull_request")
      throw new PullRequestVerbError(
        "World doesn't know that pull request",
        404,
      );
    if (this.#acting.has(key))
      throw new PullRequestVerbError(
        `An action on #${item.number} is still running`,
        409,
      );
    this.#acting.add(key);
    let outcome;
    try {
      outcome = await runPullRequestVerb(this.#options.run, item, request);
    } finally {
      this.#acting.delete(key);
    }
    const action: PullRequestAction = {
      verb: request.verb,
      itemKey: key,
      ref: item.ref,
      at: this.#now(),
      outcome: outcome.ok ? "done" : "failed",
      ...(outcome.ok ? {} : { detail: outcome.detail }),
      sender: { basis: "reported", via: "browser" },
    };
    this.#actions = [action, ...this.#actions].slice(0, MAX_ACTIONS);
    if (outcome.ok) {
      this.#details.delete(key);
      this.#sources.github.checkedAt = 0;
    }
    return { action, snapshot: await this.snapshot(true) };
  }

  #items() {
    return (["github", "jira"] as const).flatMap((id) =>
      this.enabled(id) ? this.#sources[id].items : [],
    );
  }

  /** One refresh cycle at a time: the sources, then their links. */
  #cycle(force: boolean): Promise<void> {
    if (this.#cycling) return this.#cycling;
    const epoch = this.#epoch;
    const task = (async () => {
      await Promise.all([
        this.#refresh("github", force),
        this.#refresh("jira", force),
      ]);
      await this.#link(epoch, force);
    })().catch(() => {
      // Each source records its own failure; links keep their last value.
    });
    this.#cycling = task;
    void task.finally(() => {
      if (this.#cycling === task) this.#cycling = null;
    });
    return task;
  }

  async configureGitHub(patch: { enabled?: boolean; mergedDays?: number }) {
    if (patch.mergedDays !== undefined)
      try {
        normalizeMergedDays(patch.mergedDays);
      } catch (cause) {
        throw new SourceSettingsError((cause as Error).message);
      }
    const wasEnabled = this.enabled("github");
    await this.#save({
      ...this.#settings,
      github: { ...this.#settings.github, ...patch },
    });
    // While it stays on, a new merged window is the same account: keep the
    // current items until the new read completes, and keep them if it fails.
    this.#reset("github", wasEnabled && this.enabled("github"));
    return this.snapshot(true);
  }

  async configureJira(patch: JiraSettingsPatch) {
    const next = { ...this.#settings.jira };
    let token: string | null | undefined;
    // Validate everything before saving anything.
    try {
      if (patch.enabled !== undefined) next.enabled = patch.enabled;
      if (patch.site !== undefined) next.site = normalizeJiraSite(patch.site);
      if (patch.email !== undefined)
        next.email = normalizeJiraEmail(patch.email);
      if (patch.jql !== undefined)
        next.jql =
          patch.jql === null || !patch.jql.trim()
            ? null
            : normalizeJiraJql(patch.jql);
      if (patch.token !== undefined) token = normalizeJiraToken(patch.token);
    } catch (cause) {
      throw new SourceSettingsError(
        cause instanceof Error ? cause.message : "Invalid Jira settings",
      );
    }
    // The saved token belongs to its site and account: a new site or email
    // must bring a new token, so the token can never be sent elsewhere.
    const current = this.jiraConfig();
    if (
      token === undefined &&
      ((next.site ?? null) !== current.site ||
        (next.email ?? null) !== current.email) &&
      this.#jiraToken()
    )
      token = null;
    if (token !== undefined) {
      const secrets = this.#options.secrets.read();
      this.#options.secrets.write({
        ...secrets,
        jiraToken: token ?? undefined,
      });
    }
    await this.#save({ ...this.#settings, jira: next });
    this.#reset("jira");
    return this.snapshot(true);
  }

  async #save(settings: StoredSourceSettings) {
    await this.#options.persistSettings(settings);
    this.#settings = settings;
  }

  /** Invalidate in-flight reads; unless `keepItems`, forget what was read. */
  #reset(id: WorldSourceId, keepItems = false) {
    this.#epoch += 1;
    this.#cycling = null;
    const source = this.#sources[id];
    source.generation += 1;
    source.refreshing = null;
    source.checkedAt = 0;
    this.#linkedAt = 0;
    if (keepItems) return;
    if (id === "github") this.#details.clear();
    source.items = [];
    source.state = "not_connected";
    source.detail = "Checking…";
    source.lastSuccessAt = null;
  }

  async #refresh(id: WorldSourceId, force: boolean) {
    if (!this.enabled(id)) return;
    const source = this.#sources[id];
    if (source.refreshing) return source.refreshing;
    const now = this.#now();
    if (
      source.checkedAt &&
      now - source.checkedAt < (force ? MIN_FORCED_MS : this.#refreshMs)
    )
      return;
    const generation = source.generation;
    const task = this.#fetch(id, now).then((result) => {
      if (generation !== source.generation) return;
      source.checkedAt = now;
      if (result.ok) {
        source.items = result.items;
        source.state = "connected";
        source.detail = connectedDetail(source.label, result.items.length);
        source.lastSuccessAt = now;
      } else {
        // A missing prerequisite clears what it showed; a failed request
        // keeps the last items until the next refresh.
        if (result.state === "not_connected") source.items = [];
        source.state = result.state;
        source.detail = result.detail;
      }
      this.#linkedAt = 0;
    });
    source.refreshing = task;
    void task.finally(() => {
      if (source.refreshing === task) source.refreshing = null;
    });
    return task;
  }

  #fetch(id: WorldSourceId, now: number): Promise<SourceRefresh> {
    if (id === "github")
      return refreshGitHub(
        this.#options.run,
        now,
        this.mergedDays(),
        Date.now,
        this.#details,
      );
    return refreshJira(
      this.jiraConfig(),
      this.#jiraToken(),
      this.#options.fetchImpl,
    );
  }

  #jiraToken() {
    try {
      return this.#options.secrets.read().jiraToken ?? null;
    } catch {
      return null;
    }
  }

  async #link(epoch: number, force: boolean) {
    if (epoch !== this.#epoch) return;
    if (!force && this.#linkedAt && this.#now() - this.#linkedAt < this.#linkMs)
      return;
    const items = this.#items();
    const topology = await this.#options.topology().catch(() => []);
    const links = items.length
      ? await linkWorkItems(topology, items, this.#options.resolver)
      : [];
    if (epoch !== this.#epoch) return;
    this.#links = links;
    this.#linkedAt = this.#now();
  }
}

function connectedDetail(label: string, count: number) {
  return `${label} is connected: ${count} item${count === 1 ? "" : "s"}.`;
}
