type GitHubIdentity = { login?: string; type?: string };
export type PullRequestEvent = {
  sender?: GitHubIdentity;
  pull_request?: {
    user?: GitHubIdentity;
    base?: { sha?: string };
    head?: { sha?: string };
    body?: string | null;
    title?: string;
  };
};

/** Only GitHub's event identities confer this exception; PR text never does.
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 */
export function isDependabotPullRequest(event: PullRequestEvent): boolean {
  const bot = (identity?: GitHubIdentity) =>
    identity?.login === "dependabot[bot]" && identity.type === "Bot";
  return bot(event.sender) && bot(event.pull_request?.user);
}
