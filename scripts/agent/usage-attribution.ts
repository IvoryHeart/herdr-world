import type { Seat, Tokens, Turn, UsageEvent } from "./usage-records";

export type Role = "builder" | "fixer" | "coordinator" | `reviewer:${string}`;
export type Window = {
  pr: number;
  session: string;
  seat: string;
  role: Role;
  from: string;
  until: string;
  source: "assignment" | "review" | "estimate";
};
export type Row = Tokens & {
  pr: number | null;
  seat: string;
  role: Role | "unattributed";
  family: string;
  model: string;
  effort: string;
  session: string;
  from: string;
  until: string;
  estimate: boolean;
};
export type Review = { body: string; submittedAt: string };
export const emptyTokens = (): Tokens => ({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  responses: 0,
});
export const tokenTotal = (t: Tokens) =>
  t.input + t.cacheRead + t.cacheWrite + t.output;
export function addTokens(target: Tokens, value: Tokens) {
  for (const field of [
    "input",
    "cacheRead",
    "cacheWrite",
    "output",
    "responses",
  ] as const)
    target[field] += value[field];
}
export function validateWindow(window: Window) {
  if (
    !Number.isSafeInteger(window.pr) ||
    window.pr < 1 ||
    !["assignment", "review", "estimate"].includes(window.source) ||
    !/^(builder|fixer|coordinator|reviewer:[a-zA-Z0-9_-]+)$/.test(
      window.role,
    ) ||
    !Number.isFinite(Date.parse(window.from)) ||
    !Number.isFinite(Date.parse(window.until)) ||
    Date.parse(window.from) >= Date.parse(window.until)
  )
    throw new Error("Invalid attribution window");
}

/** Each response has exactly one owner, or remains explicitly unattributed. */
export function attribute(events: UsageEvent[], windows: Window[]): Row[] {
  windows.forEach(validateWindow);
  const rows = new Map<string, Row>();
  const seen = new Set<string>();
  for (const event of events) {
    const identity = JSON.stringify([event.family, event.session, event.id]);
    if (seen.has(identity))
      throw new Error("Duplicate session response in ledger");
    seen.add(identity);
    const at = Date.parse(event.at);
    const candidates = windows.filter(
      (w) =>
        w.session === event.session &&
        w.seat === event.seat &&
        at >= Date.parse(w.from) &&
        at < Date.parse(w.until),
    );
    // Explicit assignment/review evidence takes precedence over coordinator estimates.
    const precise = candidates.filter((w) => w.source !== "estimate");
    const owners = precise.length ? precise : candidates;
    const claims = new Map(
      owners.map((w) => [JSON.stringify([w.pr, w.role, w.seat]), w]),
    );
    const owner = claims.size === 1 ? [...claims.values()][0] : undefined;
    const base = {
      pr: owner?.pr ?? null,
      seat: event.seat,
      role: owner?.role ?? ("unattributed" as const),
      family: event.family,
      model: event.model,
      effort: event.effort,
      session: event.session,
      from: owner?.from ?? event.at,
      until: owner?.until ?? new Date(Date.parse(event.at) + 1).toISOString(),
      estimate: owner?.source === "estimate",
    };
    const key = JSON.stringify(owner ? base : { ...base, from: "", until: "" });
    const row = rows.get(key) ?? { ...base, ...emptyTokens() };
    if (!owner) {
      row.from = row.from < base.from ? row.from : base.from;
      row.until = row.until > base.until ? row.until : base.until;
    }
    addTokens(row, event);
    rows.set(key, row);
  }
  return [...rows.values()];
}

function mentionedPrs(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/(?:^|[^\w])#([1-9]\d*)\b/g)].map((m) => Number(m[1])),
    ),
  ];
}

export function canonicalReviewer(body: string, pr: number): string | null {
  const header =
    /^Reviewer: ([a-zA-Z0-9_-]+)\r?\nReviewed commit: ([a-f0-9]{40})\r?\nRESULT #([1-9]\d*):/i.exec(
      body,
    );
  if (!header || Number(header[3]) !== pr) return null;
  let fence: string | null = null;
  const text = body
    .split(/\r?\n/)
    .filter((line) => {
      if (/^\s*>/.test(line)) return false;
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = null;
        return false;
      }
      return !fence;
    })
    .join("\n")
    .replace(/[*`]/g, "");
  const reviewers = new Set(
    [...text.matchAll(/^Reviewer:\s*([a-zA-Z0-9_-]+)\s*$/gim)].map((m) =>
      m[1]!.toLowerCase(),
    ),
  );
  const targets = new Set(
    [...text.matchAll(/^RESULT #([1-9]\d*):/gim)].map((m) => Number(m[1])),
  );
  const commits = new Set(
    [...text.matchAll(/^Reviewed commit:\s*([a-f0-9]{40})\s*$/gim)].map((m) =>
      m[1]!.toLowerCase(),
    ),
  );
  return reviewers.size === 1 &&
    reviewers.has(header[1]!.toLowerCase()) &&
    targets.size === 1 &&
    targets.has(pr) &&
    commits.size === 1
    ? header[1]!
    : null;
}

/** Local prompts establish starts; GitHub RESULT timestamps establish review ends. */
export function inferredWindows(
  seat: Seat,
  turns: Turn[],
  pr: number,
  reviews: Review[],
  now: string,
): Window[] {
  const windows: Window[] = [];
  for (const review of [...reviews].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  )) {
    if (canonicalReviewer(review.body, pr) !== seat.seat) continue;
    const previous = windows
      .filter((w) => w.role === `reviewer:${seat.seat}`)
      .at(-1)?.until;
    const until = new Date(review.submittedAt).toISOString();
    const requests = turns.filter(
      (turn) =>
        turn.at < until &&
        (!previous || turn.at >= previous) &&
        mentionedPrs(turn.text).length === 1 &&
        mentionedPrs(turn.text)[0] === pr &&
        /\breview\b|\bconfirm\b/i.test(turn.text),
    );
    if (!requests.length) continue;
    windows.push({
      pr,
      session: seat.session,
      seat: seat.seat,
      role: `reviewer:${seat.seat}`,
      from: requests[0]!.at,
      until,
      source: "review",
    });
  }
  if (!/^(firstmate|fm-night|clerk)(?:[-_].*)?$/.test(seat.seat))
    return windows;
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index]!;
    const prs = mentionedPrs(turn.text);
    if (prs.length !== 1 || prs[0] !== pr) continue;
    const end = Math.min(
      Date.parse(turns[index + 1]?.at ?? now),
      Date.parse(now),
      Date.parse(turn.at) + 30 * 60_000,
    );
    if (end > Date.parse(turn.at))
      windows.push({
        pr,
        session: seat.session,
        seat: seat.seat,
        role: "coordinator",
        from: turn.at,
        until: new Date(end).toISOString(),
        source: "estimate",
      });
  }
  return windows;
}

export function renderTable(pr: number, rows: Row[]): string {
  const selected = rows.filter((r) => r.pr === pr || r.pr === null);
  const header =
    "role\tseat\tmodel (effort)\toutput\tcache-read\tcache-write\tinput\tresponses\twindow [from, until)";
  return [
    `PR #${pr}; input excludes cache-read/write. Unattributed is the shared local pool, excluded from PR total.`,
    header,
    ...selected.map((r) =>
      [
        r.role,
        r.seat,
        `${r.model} (${r.effort})`,
        r.output,
        r.cacheRead,
        r.cacheWrite,
        r.input,
        r.responses,
        `${r.from} / ${r.until}${r.estimate ? " estimate" : ""}`,
      ].join("\t"),
    ),
  ].join("\n");
}

// Public output deliberately has no free-form fields sourced from local seats/logs.
function publicModel(model: string, family: string) {
  if (
    family === "codex" &&
    /^gpt-[0-9]+(?:\.[0-9]+)?(?:-(?:sol|astra|luna|codex|mini|nano|pro|turbo|preview|latest))*$/.test(
      model,
    )
  )
    return model;
  if (
    family === "claude" &&
    /^claude-(?:opus|sonnet|haiku)(?:-[0-9]+)+(?:-thinking)?$/.test(model)
  )
    return model;
  return "unknown";
}
function publicRole(role: Row["role"]) {
  if (/^reviewer:rev(?:[0-9]+|-(?:astra|opus|sol|luna))$/.test(role))
    return role;
  if (role.startsWith("reviewer:")) return "reviewer";
  return ["builder", "fixer", "coordinator"].includes(role)
    ? role
    : "unattributed";
}
const MARKER = "<!-- crew-usage -->";
export { MARKER };
export function renderComment(
  pr: number,
  rows: Row[],
  missingSessions = 0,
): string {
  const selected = rows.filter((r) => r.pr === pr);
  const groups = new Map<string, Tokens>();
  const total = emptyTokens();
  for (const row of selected) {
    const key = `${publicRole(row.role)}${row.estimate ? " (estimate)" : ""} | ${publicModel(row.model, row.family)}`;
    const tokens = groups.get(key) ?? emptyTokens();
    addTokens(tokens, row);
    groups.set(key, tokens);
    addTokens(total, row);
  }
  const cells = (t: Tokens) =>
    `${t.output} | ${t.cacheRead} | ${t.cacheWrite} | ${t.input} | ${t.responses} | ${tokenTotal(t)}`;
  return [
    MARKER,
    `### Recorded usage for PR #${pr}`,
    "",
    "| Role | Model | Output | Cache read | Cache write | Input | Responses | Total |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...[...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, t]) => `| ${key} | ${cells(t)} |`),
    `| **PR total** | | ${cells(total)} |`,
    "",
    "Unattributed usage remains in the private local ledger and is excluded from this PR total.",
    "",
    "Recorded tokens are not billed cost. Input excludes cache reads/writes; reasoning is included in output. Claude streamed chunks use per-message field maxima and include child transcripts. Codex snapshot mirrors are reconciled with dedicated response records.",
    "Assignment windows end at the recorded last push. Reviews use local request prompts and GitHub RESULT timestamps. Coordinator usage is a bounded mention heuristic (estimate, at most 30 minutes per turn). Ambiguous overlaps and usage outside windows remain unattributed. Missing logs, unrecorded compactions and work outside discovered/registered sessions are not measured.",
    `Unavailable or incomplete PR session logs: ${missingSessions} (previously measured rows are retained). Refresh this same comment at merge; later work is absent until refreshed.`,
  ].join("\n");
}
