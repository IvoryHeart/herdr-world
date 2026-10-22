import type {
  WorkItem,
  WorkLink,
  WorldSourceId,
  WorldSourceState,
  WorldSourceStatus,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";
import { refreshGitHub, type RunProcess, type SourceRefresh } from "./github";
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

/**
 * World's built-in sources. Each is on by default and can be switched off;
 * one without its prerequisites reports `not_connected` with what to do.
 * Refreshes run only while a browser asks, at most once per interval, one at
 * a time per source; a failed refresh keeps the last items.
 */

export type StoredSourceSettings = {
  github?: { enabled?: boolean };
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
};

/** Settings the user can correct; the message names the field. */
export class SourceSettingsError extends Error {}

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_LINK_MS = 15_000;
/** Even a forced refresh waits this long after the last one. */
const MIN_FORCED_MS = 5_000;

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
  #sources: Record<WorldSourceId, SourceRuntime>;
  #links: WorkLink[] = [];
  #linkedAt = 0;
  #linking: Promise<void> | null = null;

  constructor(options: SourcesServiceOptions) {
    this.#options = options;
    this.#settings = options.settings;
    this.#now = options.now ?? Date.now;
    this.#refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
    this.#linkMs = options.linkMs ?? DEFAULT_LINK_MS;
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

  jiraConfig(): JiraConfig {
    const jira = this.#settings.jira ?? {};
    // Saved values were validated on the way in; drop any that no longer are.
    const safe = <T>(read: () => T, fallback: T) => {
      try {
        return read();
      } catch {
        return fallback;
      }
    };
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
            ? { kind: "github" }
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
    await Promise.all([
      this.#refresh("github", force),
      this.#refresh("jira", force),
    ]);
    const items = (["github", "jira"] as const).flatMap((id) =>
      this.enabled(id) ? this.#sources[id].items : [],
    );
    await this.#link(items, force);
    const keys = new Set(items.map((item) => item.key));
    return {
      observedAt: this.#now(),
      sources: this.statuses(),
      items,
      links: this.#links.filter((link) => keys.has(link.itemKey)),
    };
  }

  async configureGitHub(patch: { enabled?: boolean }) {
    await this.#save({
      ...this.#settings,
      github: { ...this.#settings.github, ...patch },
    });
    this.#reset("github");
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

  #reset(id: WorldSourceId) {
    const source = this.#sources[id];
    source.generation += 1;
    source.refreshing = null;
    source.items = [];
    source.state = "not_connected";
    source.detail = "Checking…";
    source.checkedAt = 0;
    source.lastSuccessAt = null;
    this.#linkedAt = 0;
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
    if (id === "github") return refreshGitHub(this.#options.run, now);
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

  async #link(items: WorkItem[], force: boolean) {
    if (this.#linking) return this.#linking;
    if (!force && this.#linkedAt && this.#now() - this.#linkedAt < this.#linkMs)
      return;
    const task = (async () => {
      const topology = await this.#options.topology().catch(() => []);
      this.#links = items.length
        ? await linkWorkItems(topology, items, this.#options.resolver)
        : [];
      this.#linkedAt = this.#now();
    })();
    this.#linking = task;
    try {
      await task;
    } finally {
      this.#linking = null;
    }
  }
}

function connectedDetail(label: string, count: number) {
  return `${label} is connected: ${count} item${count === 1 ? "" : "s"}.`;
}
