import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkPrBodyText } from "./check-pr-body";

/** A first push has no remote PR description. Non-documentation changes
 * require the intended impact assessment body before pushing.
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

/** GitHub records a PR's baseRefOid at its last push, while CI judges each
 * push against the base branch's current tip. When the recorded base is an
 * ancestor of origin/<baseRefName>, the branch only moved forward, so judge
 * against that newer commit; otherwise (a rewritten stacked parent, an
 * unknown or stale local ref) keep the recorded immutable base. */
export function currentPullBase(
  cwd: string,
  baseRefOid: string,
  baseRefName: string | undefined,
): string {
  if (!baseRefName) return baseRefOid;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    const tip = git(
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${baseRefName}^{commit}`,
    );
    if (!/^[0-9a-f]{40}$/.test(tip) || tip === baseRefOid) return baseRefOid;
    git("merge-base", "--is-ancestor", baseRefOid, tip);
    return tip;
  } catch {
    return baseRefOid;
  }
}

/** Resolve the existing PR once, even with an intended replacement body.
 * Immutable base identity makes stacked policy checks agree with CI. */
export function pushPolicyContext(
  file: string | undefined,
  existing: () => { body: string; baseRefOid: string; baseRefName?: string },
  cwd = process.cwd(),
) {
  let pull: ReturnType<typeof existing> | undefined;
  try {
    pull = existing();
  } catch {}
  if (pull && !/^[0-9a-f]{40}$/.test(pull.baseRefOid))
    throw new Error("Existing PR has no valid immutable base");
  return {
    body: pushPolicyBody(file, () => pull?.body ?? ""),
    base: pull
      ? currentPullBase(cwd, pull.baseRefOid, pull.baseRefName)
      : "origin/main",
  };
}

if (import.meta.main) {
  const policy = pushPolicyContext(process.env.HERDR_WORLD_PR_BODY, () =>
    JSON.parse(
      execFileSync(
        "gh",
        ["pr", "view", "--json", "body,baseRefOid,baseRefName"],
        {
          encoding: "utf8",
          timeout: 15_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    ),
  );
  const problems = checkPrBodyText(policy.body, process.cwd(), policy.base);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(
      "Before pushing, save the intended description with its required impact lines and set HERDR_WORLD_PR_BODY=<file>. Existing PR descriptions are read automatically.",
    );
    process.exitCode = 1;
  } else console.info("Pre-push PR policy passed.");
}
