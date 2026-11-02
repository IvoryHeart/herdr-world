import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { createUsageProjection } from "./projection";
import {
  collectHarnessUsage,
  type CollectorOptions,
  type HostUsage,
} from "./collector";
import { sshCommandArgv } from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";
import { runProcessWithInputTimeout } from "../workspace/process";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import {
  createAgentSessionResolverContext,
  codexIdsFromTitle,
  resolveAgentSessionInfo,
} from "../agent/session-resolver";
import { normalizeAgentName } from "../agent/chat-harnesses";
import type { HerdrCall } from "../agent/session-types";

export const usageDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Stop streaming decompression at the same per-file output budget as plain logs. */
export async function boundedUsageDecompress(
  value: Uint8Array,
): Promise<Uint8Array> {
  const Decoder = DecompressionStream as unknown as new (
    format: string,
  ) => ReadableWritablePair<Uint8Array, Uint8Array>;
  const reader = new Response(Uint8Array.from(value))
    .body!.pipeThrough(new Decoder("zstd"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, size);
      size += next.value.length;
      if (size > 64 * 1024 * 1024) throw new Error("Usage decompression limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
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

/** Generated from the actual production functions; no second parser to drift.
 * stdin carries trusted code; stdout contains only the bounded numeric projection. */
export function usageHostProgram(options: CollectorOptions) {
  return `const fs = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
const crypto = await import('node:crypto');
const zlib = await import('node:zlib');
const project = ${createUsageProjection.toString()};
const collect = ${collectHarnessUsage.toString()};
const boundedDecompress = ${boundedUsageDecompress.toString()};
const result = await collect(${JSON.stringify(options)}, project, {
fs, home: os.homedir(), env: process.env, join: path.join,
hash: value => crypto.createHash('sha256').update(value).digest('hex'),
decompress: typeof Bun !== 'undefined' ? boundedDecompress :
typeof zlib.zstdDecompressSync === 'function' ? value => zlib.zstdDecompressSync(value, { maxOutputLength: 67108864 }) : undefined,
});
process.stdout.write(JSON.stringify(result));`;
}

export async function readHostUsage(
  options: CollectorOptions,
  sshHost?: string,
): Promise<HostUsage> {
  if (!sshHost)
    return collectHarnessUsage(options, createUsageProjection, {
      fs,
      home: homedir(),
      env: process.env,
      join,
      hash: usageDigest,
      decompress: boundedUsageDecompress,
    });
  const command =
    "if command -v bun >/dev/null 2>&1; then exec bun run -; elif command -v node >/dev/null 2>&1; then exec node --input-type=module; else exit 69; fi";
  const result = await runProcessWithInputTimeout(
    sshCommandArgv(sshHost, `bash -lc ${shQuote(command)}`),
    usageHostProgram(options),
    20_000,
  );
  if (result.code !== 0 || Buffer.byteLength(result.stdout) > 768 * 1024)
    throw new Error("Usage source unavailable");
  return validateHostUsage(JSON.parse(result.stdout));
}

/** Never let a remote projection smuggle text, paths, invalid counts or unbounded rows. */
export function validateHostUsage(raw: any): HostUsage {
  const harnesses = ["claude", "codex", "pi", "gemini"];
  const states = ["available", "partial", "missing", "stale", "unavailable"];
  const digest = (v: unknown) =>
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const count = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e16;
  if (
    !raw ||
    !Array.isArray(raw.rows) ||
    raw.rows.length > 1024 ||
    !Array.isArray(raw.sources) ||
    raw.sources.length !== 4 ||
    typeof raw.truncated !== "boolean"
  )
    throw new Error("Invalid numeric usage projection");
  const seenSources = new Set<string>();
  const sources = raw.sources.map((s: any) => {
    if (
      !harnesses.includes(s?.harness) ||
      !states.includes(s?.state) ||
      seenSources.has(s.harness)
    )
      throw new Error("Invalid usage source");
    seenSources.add(s.harness);
    return {
      harness: s.harness as string,
      state: s.state as HostUsage["sources"][number]["state"],
    };
  });
  const rows = raw.rows.map((r: any) => {
    if (
      !harnesses.includes(r?.harness) ||
      !digest(r.session_key) ||
      !Array.isArray(r.file_keys) ||
      r.file_keys.length > 16 ||
      !r.file_keys.every(digest) ||
      typeof r.model !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,159}$/.test(r.model) ||
      typeof r.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
      !Number.isFinite(Date.parse(r.day)) ||
      new Date(Date.parse(r.day)).toISOString().slice(0, 10) !== r.day ||
      !count(r.responses) ||
      !count(r.first_at) ||
      !count(r.last_at) ||
      r.last_at < r.first_at ||
      typeof r.partial !== "boolean" ||
      !r.tokens
    )
      throw new Error("Invalid usage row");
    const tokens = {
      input: r.tokens.input,
      cache_read: r.tokens.cache_read,
      cache_write: r.tokens.cache_write,
      output: r.tokens.output,
      reasoning: r.tokens.reasoning,
    };
    if (!Object.values(tokens).every(count) || tokens.reasoning > tokens.output)
      throw new Error("Invalid usage counters");
    if (
      new Date(r.first_at).toISOString().slice(0, 10) !== r.day ||
      new Date(r.last_at).toISOString().slice(0, 10) !== r.day
    )
      throw new Error("Invalid usage day");
    return {
      harness: r.harness as string,
      session_key: r.session_key as string,
      file_keys: r.file_keys as string[],
      model: r.model as string,
      day: r.day as string,
      responses: r.responses as number,
      first_at: r.first_at as number,
      last_at: r.last_at as number,
      partial: r.partial as boolean,
      tokens,
    };
  });
  return { rows, sources, truncated: raw.truncated };
}

function witness(agent: Record<string, unknown>) {
  return JSON.stringify([
    agent.agent,
    agent.agent_session,
    agent.terminal_id,
    agent.terminal_title,
    agent.pane_id,
    agent.tab_id,
    agent.workspace_id,
  ]);
}

export function createRuntimeUsage(args: {
  herdrCall: HerdrCall;
  files: AgentSessionFileAccess;
  sshHost?: string;
  collect?: typeof readHostUsage;
}) {
  const context = createAgentSessionResolverContext();
  return async (
    agents: Record<string, unknown>[],
    now: number,
    isCurrent = () => true,
  ): Promise<RuntimeUsage> => {
    const bindings: (UsageBinding & { witness: string })[] = [];
    const files: NonNullable<CollectorOptions["files"]> = [];
    const unsupported = new Set<string>();
    for (const agent of agents.slice(0, 128)) {
      if (!isCurrent()) throw new Error("Usage lease retired");
      const harness = normalizeAgentName(String(agent.agent ?? ""));
      if (!["claude", "codex", "pi", "gemini"].includes(harness)) {
        if (/^[a-z0-9_-]{1,40}$/.test(harness)) unsupported.add(harness);
        continue;
      }
      const raw = agent.agent_session as
        | { kind?: string; value?: string }
        | undefined;
      let session = raw,
        path: string | null = null;
      if (
        harness === "codex" &&
        (raw?.value ||
          codexIdsFromTitle(String(agent.terminal_title ?? "")).length)
      ) {
        try {
          const resolved = await resolveAgentSessionInfo(
            { pane_id: agent.pane_id },
            agent,
            args.files,
            context,
            { herdrCall: args.herdrCall, listedCodexPanes: agents },
          );
          session = resolved.session ?? undefined;
          path = resolved.file?.path ?? null;
        } catch {
          session = undefined;
        }
      }
      if (
        session?.kind === "path" &&
        session.value &&
        isAbsolute(session.value)
      )
        path = session.value;
      if (path) files.push({ harness, path });
      if (
        !session?.value ||
        ![
          agent.pane_id,
          agent.tab_id,
          agent.workspace_id,
          agent.terminal_id,
        ].every((v) => typeof v === "string" && v.length > 0 && v.length <= 160)
      )
        continue;
      bindings.push({
        harness,
        session_key:
          session.kind === "id"
            ? usageDigest(`${harness}\0${session.value}`)
            : null,
        file_key: path ? usageDigest(path.replace(/\.zst$/, "")) : null,
        pane_id: agent.pane_id as string,
        tab_id: agent.tab_id as string,
        workspace_id: agent.workspace_id as string,
        witness: witness(agent),
      });
    }
    if (!isCurrent()) throw new Error("Usage lease retired");
    const result = await (args.collect ?? readHostUsage)(
      { now, files },
      args.sshHost,
    );
    const current: UsageBinding[] = [];
    for (const binding of bindings) {
      if (!isCurrent()) throw new Error("Usage lease retired");
      try {
        const result = (await args.herdrCall("agent.get", {
          target: binding.pane_id,
        })) as { agent?: Record<string, unknown> };
        if (result.agent && witness(result.agent) === binding.witness) {
          current.push({
            harness: binding.harness,
            session_key: binding.session_key,
            file_key: binding.file_key,
            pane_id: binding.pane_id,
            tab_id: binding.tab_id,
            workspace_id: binding.workspace_id,
          });
        }
      } catch {
        /* Missing or changed bindings stay unattributed at the host. */
      }
    }
    return { ...result, bindings: current, unsupported: [...unsupported] };
  };
}
