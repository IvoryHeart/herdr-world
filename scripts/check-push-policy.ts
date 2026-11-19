import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkPrBodyText } from "./check-pr-body";

/** A first push has no remote PR description. Its fragment and knowledge map
 * must stand alone, or the author supplies the intended body before pushing.
 */
export function pushPolicyBody(
  file: string | undefined,
  existing: () => string,
): string {
  if (file) return readFileSync(file, "utf8");
  try {
    return existing();
  } catch {
    return "";
  }
}

/** Resolve the existing PR once, even with an intended replacement body.
 * Immutable base identity makes stacked policy checks agree with CI. */
export function pushPolicyContext(
  file: string | undefined,
  existing: () => { body: string; baseRefOid: string },
) {
  let pull: ReturnType<typeof existing> | undefined;
  try {
    pull = existing();
  } catch {}
  if (pull && !/^[0-9a-f]{40}$/.test(pull.baseRefOid))
    throw new Error("Existing PR has no valid immutable base");
  return {
    body: pushPolicyBody(file, () => pull?.body ?? ""),
    base: pull?.baseRefOid ?? "origin/main",
  };
}

if (import.meta.main) {
  const policy = pushPolicyContext(process.env.HERDR_WORLD_PR_BODY, () =>
    JSON.parse(
      execFileSync("gh", ["pr", "view", "--json", "body,baseRefOid"], {
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ),
  );
  const problems = checkPrBodyText(policy.body, process.cwd(), policy.base);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(
      "Before pushing, save the intended description and set HERDR_WORLD_PR_BODY=<file>, or add the required fragment/knowledge-map update. Existing PR descriptions are read automatically.",
    );
    process.exitCode = 1;
  } else console.info("Pre-push PR policy passed.");
}
