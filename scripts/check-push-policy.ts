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

if (import.meta.main) {
  const body = pushPolicyBody(process.env.HERDR_WORLD_PR_BODY, () =>
    execFileSync("gh", ["pr", "view", "--json", "body", "--jq", ".body"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const problems = checkPrBodyText(body);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(
      "Before pushing, save the intended description and set HERDR_WORLD_PR_BODY=<file>, or add the required fragment/knowledge-map update. Existing PR descriptions are read automatically.",
    );
    process.exitCode = 1;
  } else console.info("Pre-push PR policy passed.");
}
