import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { loadConfig } from "../gate";
import type { Seat } from "../crew";
import type { Deps } from "./deps";
import { nudgeItems } from "./inbox";
import {
  listItems,
  openOwnerStore,
  putItem,
  resolveItem,
  type OwnerCause,
} from "./owner-items";
import { digest, type Action, type CrewSettings } from "./plan";
import { actionsIn, getAction, latestRun, setAction } from "./store";

/** Reconcile all live causes, including notices whose toast was already sent. */
export function syncOwnerItems(
  crew: Database,
  context: {
    dir: string;
    configPath: string;
    now: number;
    prs: number[];
    deps: Deps;
  },
  settings: CrewSettings,
  planned: Action[],
  live: Seat[],
  authors: Map<number, { author: string | null }>,
  say: (text: string) => void,
) {
  const { now, deps } = context;
  const db = openOwnerStore(join(context.dir, "owner-items.sqlite"));
  try {
    const keys = new Set(planned.map((entry) => entry.key));
    const causes: OwnerCause[] = [];
    const repo = loadConfig(context.configPath).repo;
    const url = (pr: number) => ({
      kind: "url" as const,
      value: `https://github.com/${repo}/pull/${pr}`,
    });
    for (const entry of actionsIn(crew, ["pending", "sent"])) {
      if (entry.target !== "owner") continue;
      const [parentKey, suffix] = entry.key.split("|");
      if (!keys.has(parentKey!)) continue;
      const parent = suffix ? getAction(crew, parentKey!) : null;
      let holds = true;
      if (suffix?.startsWith("waits") || suffix === "unreachable") {
        const cause = parent?.detail ?? "";
        holds =
          parent?.state === "pending" &&
          (suffix === "unreachable"
            ? parent.attempts >= 3
            : suffix === `waits-${digest(cause)}` ||
              (suffix === "waits" &&
                ["no live seat", "never prompted"].includes(cause)));
      } else if (suffix === "overdue") {
        holds = parent?.state === "running";
      } else if (suffix === "stuck") {
        holds = parent?.state === "done" || parent?.state === "failed";
      }
      if (!holds) {
        setAction(crew, entry.key, "superseded", now);
        continue;
      }
      const run = parent ? latestRun(crew, parent.key) : null;
      const seat =
        parent && ["fix", "ci", "conflict", "screenshots"].includes(parent.kind)
          ? parent.target
          : undefined;
      causes.push({
        source: "crew",
        key: entry.key,
        reason: entry.text,
        pr: entry.pr,
        ...(seat ? { seat } : {}),
        target: seat
          ? { kind: "seat", value: seat }
          : run?.tab
            ? { kind: "tab", value: run.tab, fallbackUrl: url(entry.pr).value }
            : url(entry.pr),
      });
    }
    const knownSeats = new Set([
      ...Object.keys(settings.roster),
      ...Object.values(settings.leads),
      ...Object.values(settings.authors),
      ...[...authors.values()].flatMap((entry) =>
        entry.author ? [entry.author] : [],
      ),
    ]);
    for (const seat of live) {
      if (!knownSeats.has(seat.name) || seat.status !== "blocked") continue;
      const pr = [...authors].find(
        ([, entry]) => entry.author === seat.name,
      )?.[0];
      causes.push({
        source: "crew",
        key: `blocked:${seat.name}`,
        seat: seat.name,
        ...(pr ? { pr } : {}),
        reason: `${seat.name} is blocked and needs your answer`,
        target: { kind: "seat", value: seat.name },
      });
    }
    const current = new Set(causes.map((cause) => cause.key));
    db.transaction(() => {
      for (const existing of listItems(db, true)) {
        if (
          existing.source !== "crew" ||
          existing.resolvedAt !== null ||
          current.has(existing.key)
        )
          continue;
        // Seat observations are complete even during PR-scoped passes. A failed
        // or missing seat read supplies no evidence that a question cleared.
        if (existing.key.startsWith("blocked:")) {
          if (
            !live.some(
              (seat) =>
                seat.name === existing.seat &&
                seat.status !== "blocked" &&
                seat.status !== "unknown",
            )
          )
            continue;
        } else if (context.prs.length && !context.prs.includes(existing.pr!))
          continue;
        resolveItem(db, "crew", existing.key, now);
      }
      for (const cause of causes) putItem(db, cause, now);
    })();
    nudgeItems(db, context.dir, deps, now);
    const history = listItems(db, true);
    for (const cause of causes) {
      const action = getAction(crew, cause.key);
      if (!action || action.state !== "pending") continue;
      const entry = history.find(
        (item) => item.source === "crew" && item.key === cause.key,
      )!;
      if (entry.notifiedAt !== null || entry.dismissedAt !== null) {
        setAction(crew, action.key, "sent", now, null, true);
        say(`#${action.pr} told owner: ${action.text}`);
      }
    }
  } finally {
    db.close();
  }
}
