import type { Database } from "bun:sqlite";
import { loadConfig } from "../gate";
import type { GateInput, Verdict } from "../gate/predicate";
import type { Deps } from "./deps";
import { type CrewSettings, type Mark, marks } from "./plan";
import { getMeta, setMeta } from "./store";

/**
 * Sets each open PR's crew marks, the commit statuses on its head (see
 * `marks`), when they change. What was last posted per PR is kept in the
 * crew store, so a repeated pass posts nothing.
 */
export function markHeads(
  crew: Database,
  context: { configPath: string; deps: Deps },
  settings: CrewSettings,
  verdicts: Verdict[],
  inputs: GateInput[],
  causes: Map<number, string[]>,
  say: (text: string) => void,
) {
  const { deps } = context;
  const repo = loadConfig(context.configPath).repo;
  for (const verdict of verdicts) {
    const input = inputs.find((entry) => entry.number === verdict.number);
    if (!input || !verdict.head) continue;
    for (const mark of marks(
      verdict,
      input,
      settings,
      causes.get(verdict.number) ?? [],
    )) {
      if (!markDue(crew, verdict.number, verdict.head, mark)) continue;
      const result = deps.run([
        "gh",
        "api",
        "-X",
        "POST",
        `repos/${repo}/statuses/${verdict.head}`,
        "-f",
        `state=${mark.state}`,
        "-f",
        `context=${mark.context}`,
        "-f",
        `description=${mark.description}`,
      ]);
      if (result.code === 0) {
        setMeta(
          crew,
          markKey(verdict.number, verdict.head, mark),
          JSON.stringify({ state: mark.state, description: mark.description }),
        );
        say(
          `#${verdict.number} marked ${mark.context} ${mark.state}: ${mark.description}`,
        );
      } else
        say(
          `#${verdict.number} couldn't mark ${mark.context}: ${(result.stderr || result.stdout).trim().slice(0, 200)}`,
        );
    }
  }
}

/** Marks are kept per head: a PR can go back to a head it marked before. */
const markKey = (pr: number, head: string, mark: Mark) =>
  `mark:${pr}:${head}:${mark.context}`;

/**
 * Whether a mark should be posted: it differs from the last one posted on
 * this head, and a mark that takes one back only goes on a head that was
 * marked before.
 */
export function markDue(crew: Database, pr: number, head: string, mark: Mark) {
  const raw = getMeta(crew, markKey(pr, head, mark));
  const last = raw
    ? (JSON.parse(raw) as { state: string; description: string })
    : null;
  if (mark.revokes) return last !== null && last.state !== mark.state;
  return last?.state !== mark.state || last.description !== mark.description;
}
