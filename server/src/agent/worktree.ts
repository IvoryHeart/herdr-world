import { createHash } from "node:crypto";
import type {
  AgentWorktreeCandidate,
  AgentWorktreeObservation,
  AgentWorktreeSource,
  AgentWorktreeSubject,
  AgentWorktreeTarget,
} from "../../../shared/agentWorktree";
import { agentCheckoutSessionFingerprint } from "../herdr/agent-checkout";
import { checkoutPath } from "../workspace/utils";
import { agentSessionOf, parseAgentCheckoutTokens } from "./checkout-context";
import type { ListedWorktree, WorktreeGitRoot } from "./worktree-git";

type Metadata = { cwd?: string; branch?: string | null; sourceRef: string };
type Herdr = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rank: Record<AgentWorktreeSource, number> = {
  foreground_cwd: 0,
  session_cwd: 1,
  agent_report: 1,
  branch_match: 2,
  worktree_list: 3,
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const paneOf = (value: unknown) => record(record(value)?.pane) ?? record(value);

export function createAgentWorktree(args: {
  connectionId: string;
  generation: number;
  herdr: Herdr;
  inspect(path: string): Promise<WorktreeGitRoot | null>;
  list(root: string): Promise<ListedWorktree[]>;
  readSessionMetadata(
    paneId: string,
    fingerprint: string,
  ): Promise<Metadata | null>;
}) {
  type Cached = {
    observation: AgentWorktreeObservation;
    binding: string;
    workspaceId: string;
    seed: string | null;
  };
  const cache = new Map<string, Cached>();
  const requests = new Map<string, number>();
  let sequence = 0;
  function subjectOf(value: unknown): AgentWorktreeSubject {
    const valueRecord = record(value);
    if (
      !valueRecord ||
      valueRecord.connectionId !== args.connectionId ||
      valueRecord.generation !== args.generation ||
      !text(valueRecord.paneId) ||
      !(
        valueRecord.sessionFingerprint === null ||
        /^[a-f0-9]{64}$/u.test(text(valueRecord.sessionFingerprint))
      )
    )
      throw new Error(
        "Worktree target does not belong to this connection and generation.",
      );
    return valueRecord as AgentWorktreeSubject;
  }
  async function context(subject: AgentWorktreeSubject) {
    const pane = paneOf(
      await args.herdr.call("pane.get", { pane_id: subject.paneId }),
    );
    const session = agentSessionOf(pane?.agent_session);
    const fingerprint = session
      ? agentCheckoutSessionFingerprint(session)
      : null;
    if (
      !pane ||
      pane.pane_id !== subject.paneId ||
      (subject.terminalId && pane.terminal_id !== subject.terminalId) ||
      subject.sessionFingerprint !== fingerprint
    )
      throw new Error(
        "The agent session changed. Refresh its worktree before reading.",
      );
    let metadata: Metadata | null = null;
    if (fingerprint) {
      try {
        metadata = await args.readSessionMetadata(subject.paneId, fingerprint);
      } catch {
        // Transcript evidence is optional; the pane/session checks remain authoritative.
      }
    }
    const report = session
      ? parseAgentCheckoutTokens(pane.tokens, session)
      : null;
    const binding = digest([
      subject,
      pane.agent,
      pane.foreground_cwd ?? null,
      session ?? pane.terminal_title ?? null,
      metadata,
      report,
    ]);
    return {
      pane,
      metadata,
      report,
      binding,
      workspaceId: text(pane.workspace_id),
    };
  }
  const tryInspect = async (path: string) => {
    try {
      return path ? await args.inspect(path) : null;
    } catch {
      return null;
    }
  };
  async function get(
    value: unknown,
    options: { refresh?: boolean } = {},
  ): Promise<AgentWorktreeObservation> {
    const subject = subjectOf(value);
    if (requests.size >= 128 && !requests.has(subject.paneId))
      throw new Error("Too many worktree observations are running.");
    const request = ++sequence;
    requests.set(subject.paneId, request);
    const observedAt = new Date().toISOString();
    const empty = (
      state: "unavailable" | "stale",
      reason: string,
    ): AgentWorktreeObservation => ({
      subject,
      revision: "",
      observedAt,
      state,
      candidates: [],
      selectedCandidateId: null,
      reason,
    });
    try {
      const current = await context(subject);
      const saved = cache.get(subject.paneId);
      if (!options.refresh && saved?.binding === current.binding) {
        if (
          (await context(subject)).binding !== current.binding ||
          requests.get(subject.paneId) !== request
        )
          return empty("stale", "Worktree evidence changed during the read.");
        return saved.observation;
      }
      const candidates = new Map<string, AgentWorktreeCandidate>();
      const unavailableEvidence: NonNullable<
        AgentWorktreeObservation["unavailableEvidence"]
      > = [];
      const inspections = new Map<string, Promise<WorktreeGitRoot | null>>();
      const inspect = (path: string) => {
        if (!inspections.has(path)) inspections.set(path, tryInspect(path));
        return inspections.get(path)!;
      };
      function add(
        root: WorktreeGitRoot,
        source: AgentWorktreeSource,
        sourceRef: string,
      ) {
        const candidate: AgentWorktreeCandidate = {
          ...root,
          candidateId: digest([
            root.canonicalRoot,
            root.gitCommonDir,
            root.gitIdentity,
          ]),
          source,
          evidence: {
            sourceRef,
            observedAt,
            basis:
              source === "branch_match" || source === "worktree_list"
                ? "inferred"
                : "reported",
          },
        };
        const prior = candidates.get(candidate.candidateId);
        if (!prior || rank[source] < rank[prior.source])
          candidates.set(candidate.candidateId, candidate);
      }
      const sources: {
        path: string;
        source: AgentWorktreeSource;
        sourceRef: string;
      }[] = [
        {
          path: text(current.pane.foreground_cwd),
          source: "foreground_cwd",
          sourceRef: "Herdr pane foreground_cwd",
        },
        {
          path: current.metadata?.cwd ?? "",
          source: "session_cwd",
          sourceRef: current.metadata?.sourceRef ?? "Bound session cwd",
        },
        {
          path: current.report?.path ?? "",
          source: "agent_report",
          sourceRef: "Session-bound checkout report",
        },
      ];
      for (const source of sources) {
        const root = await inspect(source.path);
        if (root) add(root, source.source, source.sourceRef);
        else if (source.path)
          unavailableEvidence.push({
            path: source.path,
            source: source.source,
            reason: "Could not confirm a reachable Git worktree.",
          });
      }
      let seed: string | null =
        [...candidates.values()].sort(
          (a, b) => rank[a.source] - rank[b.source],
        )[0]?.canonicalRoot ?? null;
      if (!seed && current.workspaceId) {
        // A known workspace scopes discovery; it is never an agent-worktree fallback.
        const result = await args.herdr.call("workspace.get", {
          workspace_id: current.workspaceId,
        });
        const workspace = record(record(result)?.workspace) ?? record(result);
        const known = await inspect(
          workspace ? checkoutPath(workspace) || text(workspace.cwd) : "",
        );
        seed = known?.canonicalRoot ?? null;
      }
      const branch =
        current.metadata?.branch !== undefined
          ? current.metadata.branch
          : text(current.pane.git_branch) || null;
      let listed: ListedWorktree[] = [];
      if (seed) {
        try {
          listed = (await args.list(seed)).filter(
            (tree) => !tree.bare && !tree.prunable,
          );
        } catch {
          /* Keep direct evidence when Git discovery fails. */
        }
      }
      listed.sort(
        (a, b) =>
          Number(b.branch === branch && branch !== null) -
          Number(a.branch === branch && branch !== null),
      );
      const limited = listed.slice(0, 32);
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, limited.length) }, async () => {
          while (index < limited.length) {
            const tree = limited[index++]!;
            const root = await inspect(tree.path);
            if (
              root &&
              (await inspect(seed!))?.gitCommonDir === root.gitCommonDir
            )
              add(
                root,
                branch && root.branch === branch
                  ? "branch_match"
                  : "worktree_list",
                branch && root.branch === branch
                  ? "Own session branch matched in git worktree list"
                  : "Listed in this repository; viewer choice only",
              );
          }
        }),
      );
      const latest = await context(subject);
      if (
        latest.binding !== current.binding ||
        requests.get(subject.paneId) !== request
      )
        return empty(
          "stale",
          "Worktree evidence changed during the read. Refresh before choosing.",
        );
      const ordered = [...candidates.values()].sort(
        (a, b) =>
          rank[a.source] - rank[b.source] ||
          a.canonicalRoot.localeCompare(b.canonicalRoot),
      );
      const best = ordered.length
        ? ordered.filter(
            (candidate) =>
              rank[candidate.source] === rank[ordered[0]!.source] &&
              candidate.source !== "worktree_list",
          )
        : [];
      const state =
        best.length === 1
          ? "resolved"
          : ordered.length
            ? "ambiguous"
            : "unavailable";
      const revision = digest([
        subject,
        current.binding,
        ordered.map((candidate) => ({ ...candidate, evidence: undefined })),
      ]);
      const observation: AgentWorktreeObservation = {
        subject,
        revision,
        observedAt,
        state,
        candidates: ordered,
        selectedCandidateId: best.length === 1 ? best[0]!.candidateId : null,
        ...(current.report?.reportedPr
          ? { reportedPr: current.report.reportedPr }
          : {}),
        ...(unavailableEvidence.length ? { unavailableEvidence } : {}),
        ...(listed.length > limited.length ? { truncated: true } : {}),
        ...(state === "unavailable"
          ? { reason: "No current agent worktree evidence is available." }
          : {}),
      };
      if (cache.size >= 128 && !cache.has(subject.paneId)) {
        const first = cache.keys().next().value;
        if (first !== undefined) {
          cache.delete(first);
          requests.delete(first);
        }
      }
      cache.set(subject.paneId, {
        observation,
        binding: current.binding,
        workspaceId: current.workspaceId,
        seed,
      });
      return observation;
    } catch {
      if (requests.get(subject.paneId) === request)
        cache.delete(subject.paneId);
      return empty(
        "unavailable",
        "Worktree evidence is unavailable or the agent session changed.",
      );
    } finally {
      if (requests.get(subject.paneId) === request)
        requests.delete(subject.paneId);
    }
  }
  async function resolve(value: unknown) {
    const decoded =
      typeof value === "string" && value.length <= 8192
        ? JSON.parse(value)
        : value;
    const target = record(decoded) as AgentWorktreeTarget | null;
    const subject = subjectOf(target?.subject);
    const saved = cache.get(subject.paneId);
    const candidate = saved?.observation.candidates.find(
      (entry) => entry.candidateId === target?.candidateId,
    );
    if (!saved || !candidate || saved.observation.revision !== target?.revision)
      throw new Error(
        "Worktree selection expired. Refresh and choose a worktree.",
      );
    if (candidate.source === "branch_match") {
      const refreshed = await get(subject, { refresh: true });
      if (refreshed.revision !== target!.revision)
        throw new Error(
          "Worktree branch matches changed. Refresh and choose a worktree.",
        );
    }
    const before = await context(subject);
    if (before.binding !== saved.binding)
      throw new Error(
        "Worktree binding changed. Refresh and choose a worktree.",
      );
    const sourcePath =
      candidate.source === "foreground_cwd"
        ? text(before.pane.foreground_cwd)
        : candidate.source === "session_cwd"
          ? before.metadata?.cwd
          : candidate.source === "agent_report"
            ? before.report?.path
            : candidate.canonicalRoot;
    const root = sourcePath ? await args.inspect(sourcePath) : null;
    if (
      !root ||
      root.canonicalRoot !== candidate.canonicalRoot ||
      root.gitCommonDir !== candidate.gitCommonDir ||
      root.gitIdentity !== candidate.gitIdentity ||
      root.branch !== candidate.branch
    )
      throw new Error(
        "Selected worktree moved or changed. Refresh before reading.",
      );
    if (
      candidate.source === "worktree_list" ||
      candidate.source === "branch_match"
    ) {
      if (
        !saved.seed ||
        !(await args.list(saved.seed)).some(
          (entry) =>
            entry.path === candidate.canonicalRoot &&
            !entry.bare &&
            !entry.prunable,
        )
      )
        throw new Error(
          "Selected worktree is no longer listed in this repository.",
        );
    }
    if ((await context(subject)).binding !== before.binding)
      throw new Error("The agent changed while its worktree was checked.");
    return {
      root: root.canonicalRoot,
      workspaceId: before.workspaceId,
      candidate,
    };
  }
  return { get, resolve };
}
