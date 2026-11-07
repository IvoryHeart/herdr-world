import {
  GIT_DIFF_TIMEOUT_MS,
  GIT_UNTRACKED_NUMSTAT_BATCH_SIZE,
  GIT_UNTRACKED_NUMSTAT_CONCURRENCY,
  GIT_UNTRACKED_NUMSTAT_MAX_FILES,
} from "./file-constants";
import { gitShellCommandArgv } from "./git-shell";
import type { GitDiffEntry, RunProcessWithCodeTimeout } from "./file-types";

type Counts = Map<string, { additions: number; deletions: number }>;
export async function collectUntrackedStats({
  root,
  entries,
  host,
  shQuote,
  runProcessWithCodeTimeout,
  parseNumstat,
}: {
  root: string;
  entries: GitDiffEntry[];
  host?: string;
  shQuote: (value: string) => string;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
  parseNumstat: (output: string) => Counts;
}): Promise<Counts> {
  const stats: Counts = new Map();
  const untrackedEntries = entries.filter(
    (entry) => entry.kind === "untracked",
  );
  // A remote command per untracked file is a fresh SSH login per untracked
  // file, so one workspace holding an ignored build tree turns a single
  // refresh into tens of thousands of logins. Count a whole batch per command,
  // and past the cap list the files with no line counts rather than paying for
  // them: a tree that large is noise in the panel either way.
  const countedEntries =
    untrackedEntries.length > GIT_UNTRACKED_NUMSTAT_MAX_FILES
      ? []
      : untrackedEntries;
  const batches: GitDiffEntry[][] = [];
  for (
    let index = 0;
    index < countedEntries.length;
    index += GIT_UNTRACKED_NUMSTAT_BATCH_SIZE
  ) {
    batches.push(
      countedEntries.slice(index, index + GIT_UNTRACKED_NUMSTAT_BATCH_SIZE),
    );
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor];
      cursor += 1;
      if (!batch) continue;
      const command = `
set -- ${batch.map((entry) => shQuote(entry.path)).join(" ")}
for p in "$@"; do
  git -C ${shQuote(root)} -c core.quotepath=false diff --no-ext-diff --no-index --numstat -- /dev/null "$p"
done
# The loop's status is only its last file's; keep the batch's other counts.
exit 0
`;
      const result = await runProcessWithCodeTimeout(
        gitShellCommandArgv(command, host),
        GIT_DIFF_TIMEOUT_MS,
      );
      if (result.code !== 0 && result.code !== 1) continue;
      const values = parseNumstat(result.stdout);
      for (const entry of batch) {
        const value = values.get(entry.path);
        if (value) stats.set(entry.path, value);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(GIT_UNTRACKED_NUMSTAT_CONCURRENCY, batches.length) },
      () => worker(),
    ),
  );

  return stats;
}
