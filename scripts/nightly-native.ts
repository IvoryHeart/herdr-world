import { execFileSync } from "node:child_process";
const gh = (...args: string[]) =>
  execFileSync("gh", args, { encoding: "utf8" }).trim();
const marker = "<!-- nightly-native -->";
const issues = JSON.parse(
  gh(
    "issue",
    "list",
    "--state",
    "open",
    "--search",
    '"Nightly native" in:title',
    "--json",
    "number,body",
  ),
);
const issue = issues.find((item: { body: string }) =>
  item.body.includes(marker),
);
if (
  process.env.NATIVE_RESULT === "success" &&
  process.env.CHANNEL_RESULT === "success"
) {
  if (issue)
    gh(
      "issue",
      "close",
      String(issue.number),
      "--comment",
      "Nightly native and channel upgrades are green again.",
    );
} else {
  const body = `${marker}\nNative or running-service channel upgrade failed: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}. This is an advisory signal; inspect the failed contract and fix main.`;
  if (issue) gh("issue", "edit", String(issue.number), "--body", body);
  else
    gh(
      "issue",
      "create",
      "--title",
      "Nightly native checks need attention",
      "--body",
      body,
    );
  process.exitCode = 1;
}
