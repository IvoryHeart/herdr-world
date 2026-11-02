import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { UsageReader } from "./reader";
export { validateHostUsage } from "./validation";
export { usageHostProgram, boundedUsageDecompress } from "./program";
import { type CollectorOptions, type HostUsage } from "./collector";
import { usageScope } from "./lifetime";
import { codexIdsFromTitle } from "../agent/session-resolver";
import { normalizeAgentName } from "../agent/chat-harnesses";

export const usageDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export type UsageBinding = {
  harness: string;
  session_key: string | null;
  file_key: string | null;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
};
export type RuntimeUsage = HostUsage & {
  bindings: UsageBinding[];
  unsupported: string[];
};

/** A one-shot diagnostic; managed runtimes retain their own reader/cache. */
export async function readHostUsage(
  options: CollectorOptions,
  sshHost?: string,
  signal?: AbortSignal,
): Promise<HostUsage> {
  const reader = new UsageReader(sshHost),
    owner = usageScope(signal);
  try {
    return await reader.read(options, owner.signal);
  } finally {
    await reader.close();
    owner.dispose();
  }
}

/** A runtime owns all of its readers, sockets and child execution. */
export function createRuntimeUsage(args: {
  sshHost?: string;
  collect?: typeof readHostUsage;
}) {
  const lifetime = new AbortController();
  const reader = args.collect ? null : new UsageReader(args.sshHost);
  const active = new Set<Promise<RuntimeUsage>>();
  const read = (
    agents: Record<string, unknown>[],
    now: number,
    isCurrent = () => true,
    signal?: AbortSignal,
  ): Promise<RuntimeUsage> => {
    const parent = signal
      ? AbortSignal.any([signal, lifetime.signal])
      : lifetime.signal;
    const owner = usageScope(parent);
    const task = (async () => {
      const check = () => {
        owner.signal.throwIfAborted();
        if (!isCurrent()) throw new Error("Usage lease retired");
      };
      check();
      const files: NonNullable<CollectorOptions["files"]> = [];
      const prefixes = new Set<string>(),
        unsupported = new Set<string>();
      const bindings: UsageBinding[] = [];
      // The inexpensive inventory is complete. If expensive attribution capacity
      // is exceeded, keep every number host-level rather than invent uniqueness.
      const truncated = agents.length > 128;
      const titleBindings = new Map<string, UsageBinding>();
      for (const agent of agents.slice(0, 128)) {
        const harness = normalizeAgentName(String(agent.agent ?? ""));
        if (!["claude", "codex", "pi", "gemini"].includes(harness)) {
          if (/^[a-z0-9_-]{1,40}$/.test(harness)) unsupported.add(harness);
          continue;
        }
        const raw = agent.agent_session as
          | { kind?: string; value?: string }
          | undefined;
        let session =
          raw?.kind === "id" && typeof raw.value === "string"
            ? usageDigest(`${harness}\0${raw.value}`)
            : null;
        let path =
          raw?.kind === "path" &&
          typeof raw.value === "string" &&
          isAbsolute(raw.value)
            ? raw.value
            : null;
        let prefix: string | null = null;
        if (harness === "codex") {
          const ids = codexIdsFromTitle(String(agent.terminal_title ?? ""));
          const candidates = ids.some((id) => id.truncated)
            ? ids.filter((id) => id.truncated)
            : ids;
          if (candidates.length) {
            // Title evidence replaces a possibly stale hook; no cwd inference
            // or uncancellable transcript discovery is used by this connector.
            session = null;
            path = null;
            const unique = [...new Set(candidates.map((id) => id.prefix))];
            if (unique.length === 1) {
              if (candidates[0]!.truncated) {
                prefix = unique[0]!;
                prefixes.add(prefix);
              } else session = usageDigest(`codex\0${unique[0]}`);
            }
          }
        }
        if (path) files.push({ harness, path });
        if (
          truncated ||
          ![
            agent.pane_id,
            agent.tab_id,
            agent.workspace_id,
            agent.terminal_id,
          ].every(
            (v) => typeof v === "string" && v.length > 0 && v.length <= 160,
          )
        )
          continue;
        const binding: UsageBinding = {
          harness,
          session_key: session,
          file_key: path ? usageDigest(path.replace(/\.zst$/, "")) : null,
          pane_id: agent.pane_id as string,
          tab_id: agent.tab_id as string,
          workspace_id: agent.workspace_id as string,
        };
        if (prefix)
          titleBindings.set(
            `${usageDigest(prefix)}:${binding.pane_id}`,
            binding,
          );
        else if (session || path) bindings.push(binding);
      }
      const options = { now, files, codex_prefixes: [...prefixes] };
      const result = args.collect
        ? await args.collect(options, args.sshHost, owner.signal)
        : await reader!.read(options, owner.signal);
      check();
      for (const match of result.title_matches ?? [])
        for (const [key, binding] of titleBindings)
          if (key.startsWith(`${match.prefix_key}:`))
            bindings.push({ ...binding, session_key: match.session_key });
      const complete =
        agents.every((agent) =>
          [
            agent.pane_id,
            agent.tab_id,
            agent.workspace_id,
            agent.terminal_id,
          ].every(
            (value) =>
              typeof value === "string" &&
              value.length > 0 &&
              value.length <= 160,
          ),
        ) &&
        new Set(agents.map((agent) => agent.pane_id)).size === agents.length;
      check();
      return {
        ...result,
        truncated: truncated || result.truncated,
        bindings: !truncated && complete ? bindings : [],
        unsupported: [...unsupported],
      };
    })();
    active.add(task);
    void task.then(
      () => {
        active.delete(task);
        owner.dispose();
      },
      () => {
        active.delete(task);
        owner.dispose();
      },
    );
    return task;
  };
  return Object.assign(read, {
    async close() {
      lifetime.abort();
      await reader?.close();
      await Promise.allSettled(active);
    },
  });
}
