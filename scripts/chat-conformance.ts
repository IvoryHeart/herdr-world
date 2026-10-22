// Local-only conformance check for Chat's transcript readers.
//
//   bun scripts/chat-conformance.ts [--limit N] [--json]
//
// Runs every harness reader over the real transcripts on this machine and
// prints pass/fail counts per harness and harness version. It never prints
// transcript content, file paths or session IDs: only counts, harness names,
// check names and version strings that match ^[\w.+-]{1,32}$ (others are
// counted as "other"). Reader errors are counted, not printed. It writes
// nothing, except that the Antigravity reader copies each database into a
// private (0700) temporary directory while reading it; a killed run can
// leave one behind as $TMPDIR/herdr-world-agy-*. Results describe this
// machine; do not commit them as fixtures.
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  antigravityConversationsRoot,
  describeAntigravitySessionPath,
} from "../server/src/agent/antigravity-session";
import {
  conversationMessages,
  type ConversationMessage,
} from "../server/src/agent/conversation";
import {
  describeGrokSessionPath,
  grokSessionsRoot,
} from "../server/src/agent/grok-session";
import { museSessionsRoot } from "../server/src/agent/muse-session";
import {
  codexHome,
  localAgentSessionFiles,
} from "../server/src/agent/session-file-access";
import { readSessionProjection } from "../server/src/agent/session-projection-cache";
import { piAgentDirectory } from "../server/src/agent/session-resolver";
import type { SessionFile } from "../server/src/agent/session-types";

type Harness = {
  agent: string;
  roots: () => string[];
  match: (path: string) => boolean;
  describe?: (path: string) => Promise<SessionFile | null>;
  /** A thread no person talks to, such as one a parent agent spawned. */
  isSubagent?: (path: string) => Promise<boolean>;
};

async function firstRecord(path: string) {
  const prefix = await localAgentSessionFiles.readPrefix(path, 64 * 1024);
  const line = new TextDecoder().decode(prefix).split("\n")[0] ?? "";
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const HARNESSES: Harness[] = [
  {
    agent: "codex",
    roots: () => [
      join(codexHome(), "sessions"),
      join(codexHome(), "archived_sessions"),
    ],
    match: (path) => /\/rollout-[^/]+\.jsonl$/.test(path),
    isSubagent: async (path) => {
      const meta = await firstRecord(path);
      const payload = meta?.payload as { source?: unknown } | undefined;
      return (
        typeof payload?.source === "object" &&
        payload.source !== null &&
        "subagent" in payload.source
      );
    },
  },
  {
    agent: "claude",
    roots: () => [join(homedir(), ".claude", "projects")],
    // Subagent transcripts live beside their parent and are not chats.
    match: (path) => path.endsWith(".jsonl") && !path.includes("/subagents/"),
  },
  {
    agent: "kimi",
    roots: () => [join(homedir(), ".kimi-code", "sessions")],
    match: (path) => path.endsWith("/agents/main/wire.jsonl"),
  },
  {
    agent: "grok",
    roots: () => [grokSessionsRoot()],
    match: (path) => path.endsWith("/chat_history.jsonl"),
    describe: async (path) =>
      (await describeGrokSessionPath(path))?.file ?? null,
  },
  {
    agent: "pi",
    roots: () => [join(piAgentDirectory(), "sessions")],
    match: (path) => path.endsWith(".jsonl"),
  },
  {
    agent: "muse",
    roots: () => [museSessionsRoot()],
    match: (path) => path.endsWith(".jsonl"),
  },
  {
    agent: "agy",
    roots: () => [antigravityConversationsRoot()],
    match: (path) => path.endsWith(".db"),
    describe: async (path) =>
      (await describeAntigravitySessionPath(path))?.file ?? null,
  },
];

/** Text the user did not write, which must never be shown as their message. */
const INJECTED_USER_TEXT =
  /^(?:# AGENTS\.md instructions\b|<[a-z_ -]+>|Caveat: The messages below\b|This session is being continued from a previous conversation\b)/;

/**
 * A version string comes from inside the transcript, so it is printed only
 * when it looks like a version; anything else is counted as `other`.
 */
export function versionToken(value: string | undefined) {
  if (!value || value === "unknown") return "unknown";
  return /^[\w.+-]{1,32}$/.test(value) ? value : "other";
}

/** Failures are reader bugs; notes describe the transcript, not the reader. */
export type ConformanceCheck = "read" | "injected_user_text";
export type ConformanceNote = "no_exchange" | "timestamps_out_of_order";

/** Checks one projected conversation; no failures means it passed. */
export function conformance(messages: readonly ConversationMessage[]) {
  const failures: ConformanceCheck[] = [];
  const notes: ConformanceNote[] = [];
  const said = messages.filter((message) => message.kind === "message");
  if (
    said.some(
      (message) =>
        message.role === "user" && INJECTED_USER_TEXT.test(message.text),
    )
  )
    failures.push("injected_user_text");
  // An interrupted turn or a session of local commands has no exchange.
  if (
    !said.some((message) => message.role === "user") ||
    !said.some((message) => message.role === "assistant")
  )
    notes.push("no_exchange");
  // A prompt queued while the agent was writing is recorded after it.
  const times = said.map((message) => Date.parse(message.sent_at));
  if (times.some((time, index) => index > 0 && time < times[index - 1]!))
    notes.push("timestamps_out_of_order");
  return { failures, notes };
}

async function newestFiles(harness: Harness, limit: number) {
  const found: { path: string; mtimeMs: number }[] = [];
  const visit = async (dir: string, depth: number) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && harness.match(path))
        found.push({ path, mtimeMs: Bun.file(path).lastModified });
    }
  };
  for (const root of harness.roots()) await visit(root, 0);
  return found.toSorted((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

type Tally = {
  files: number;
  pass: number;
  subagent: number;
  failures: Partial<Record<ConformanceCheck, number>>;
  notes: Partial<Record<ConformanceNote, number>>;
};

async function run() {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) || 50 : 50;
  const results: Record<string, Record<string, Tally>> = {};
  for (const harness of HARNESSES) {
    const byVersion: Record<string, Tally> = {};
    for (const { path } of await newestFiles(harness, limit)) {
      let version = "unknown";
      let result: ReturnType<typeof conformance>;
      let subagent = false;
      try {
        const file = harness.describe
          ? await harness.describe(path)
          : await localAgentSessionFiles.statFile(path);
        if (!file) throw new Error("unreadable");
        const projection = await readSessionProjection(
          harness.agent,
          file,
          localAgentSessionFiles,
        );
        version = versionToken(projection.trajectory.agent.version);
        subagent = (await harness.isSubagent?.(path)) ?? false;
        result = conformance(conversationMessages(projection.entries));
      } catch {
        result = { failures: ["read"], notes: [] };
      }
      const tally = (byVersion[version] ??= {
        files: 0,
        pass: 0,
        subagent: 0,
        failures: {},
        notes: {},
      });
      tally.files += 1;
      if (subagent) tally.subagent += 1;
      if (result.failures.length === 0) tally.pass += 1;
      for (const failure of result.failures)
        tally.failures[failure] = (tally.failures[failure] ?? 0) + 1;
      // A subagent thread has no person in it, so no exchange is expected.
      for (const note of result.notes)
        if (!(subagent && note === "no_exchange"))
          tally.notes[note] = (tally.notes[note] ?? 0) + 1;
    }
    results[harness.agent] = byVersion;
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify({ limit, results }, null, 2));
    return;
  }
  console.log(`Chat conformance, newest ${limit} transcripts per harness`);
  for (const [agent, byVersion] of Object.entries(results)) {
    const versions = Object.entries(byVersion);
    if (versions.length === 0) {
      console.log(`${agent}: no transcripts on this machine`);
      continue;
    }
    for (const [version, tally] of versions.toSorted(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const list = (counts: Record<string, number | undefined>) =>
        Object.entries(counts)
          .map(([name, count]) => `${name} ${count}`)
          .join(", ");
      const failed = list(tally.failures);
      const noted = list({
        ...(tally.subagent ? { subagent_threads: tally.subagent } : {}),
        ...tally.notes,
      });
      console.log(
        `${agent} ${version}: ${tally.pass}/${tally.files} pass` +
          (failed ? `; failed: ${failed}` : "") +
          (noted ? `; noted: ${noted}` : ""),
      );
    }
  }
}

if (import.meta.main) await run();
