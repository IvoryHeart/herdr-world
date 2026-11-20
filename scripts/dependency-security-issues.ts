import { readFile } from "node:fs/promises";
import type { Finding } from "./dependency-security";

export type SecurityIssue = {
  number: number;
  state: string;
  body: string | null;
};
export function issueForFinding(finding: Finding) {
  const ghsa = finding.url.split("/").at(-1)!;
  const marker = `<!-- dependency-security:${finding.name}:${ghsa} -->`;
  return {
    marker,
    title: `Security: ${finding.severity} vulnerability in shipped ${finding.name} (${ghsa})`,
    body: `${marker}\nBuilder: codex\nBase: main\nPriority: high\n\nA daily dependency audit found a ${finding.severity} advisory in a potentially shipped dependency. Fix or record a reasoned, expiring exception before the next release.\n\n- Package: ${finding.name}@${finding.version}\n- Advisory: ${finding.url}\n- Impact: ${finding.title}\n- First available newer unaffected version: ${finding.fix ?? "none available; investigate mitigation"}\n- Exception: ${finding.exception ?? "none"}\n\nRun \`bun run security:check\`, update the affected dependency and notices, and verify the release gate. See SECURITY.md for ownership and response times.\n`,
    labels: ["crew:ready", "dependency-security"],
  };
}

export function missingSecurityIssues(
  findings: Finding[],
  issues: SecurityIssue[],
) {
  const unique = new Map<string, ReturnType<typeof issueForFinding>>();
  for (const finding of findings) {
    if (!finding.shipped || !["high", "critical"].includes(finding.severity))
      continue;
    const issue = issueForFinding(finding);
    // Keep a closed issue closed while the same version remains reported; a new
    // vulnerable version after resolution creates a new queue item.
    if (
      !issues.some(
        (existing) =>
          existing.body?.includes(issue.marker) &&
          (existing.state === "open" ||
            existing.body.includes(
              `Package: ${finding.name}@${finding.version}\n`,
            )),
      )
    )
      unique.set(issue.marker, issue);
  }
  return [...unique.values()];
}

export async function githubJson(path: string, init?: RequestInit) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required");
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`GitHub request failed (${response.status}): ${path}`);
  return response.status === 204 ? null : response.json();
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("GITHUB_REPOSITORY is required");
  const report = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
    findings: Finding[];
  };
  const issues: SecurityIssue[] = [];
  for (let page = 1; ; page++) {
    if (page > 100)
      throw new Error("Security issue inventory exceeds pagination limit");
    const batch = (await githubJson(
      `/repos/${repository}/issues?state=all&labels=dependency-security&per_page=100&page=${page}`,
    )) as SecurityIssue[];
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  for (const issue of missingSecurityIssues(report.findings, issues)) {
    const body = { title: issue.title, body: issue.body, labels: issue.labels };
    await githubJson(`/repos/${repository}/issues`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(`Queued ${issue.title}`);
  }
}
