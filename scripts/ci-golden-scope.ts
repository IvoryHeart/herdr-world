import { appendFileSync } from "node:fs";
import { buildGraph, gitChanges, type Graph } from "./affected";
import { contentInputs } from "./ci-content-key";

const roots = [
  "scripts/town-golden.ts",
  "web/src/world/testing/town-golden/TownGolden.browser.tsx",
];
export function goldenInputsChanged(graph: Graph, paths: readonly string[]) {
  const inputs = new Set(contentInputs(graph, roots));
  return paths.some(
    (path) =>
      inputs.has(path) ||
      /^(?:web\/src\/world\/testing\/town-golden\/|web\/public\/|tools\/chrome\/|scripts\/(?:test-chrome|chrome-)|scripts\/(?:ci-golden-scope|ci-content-key|affected)\.ts$|(?:web\/|server\/)?package\.json$|bun\.lock$|.*tsconfig[^/]*\.json$|\.github\/workflows\/town-golden\.yml$)/.test(
        path,
      ),
  );
}

if (import.meta.main) {
  let run = true;
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    try {
      const diff = gitChanges(
        process.cwd(),
        process.env.PR_BASE_SHA!,
        process.env.PR_HEAD_SHA!,
      );
      run = goldenInputsChanged(
        buildGraph(process.cwd(), diff.tracked, diff.deleted),
        diff.changed,
      );
    } catch {
      /* Incomplete scope evidence runs the golden comparison. */
    }
  }
  appendFileSync(process.env.GITHUB_OUTPUT!, `run=${run}\n`);
  console.info(`Golden images applicable: ${run}`);
}
