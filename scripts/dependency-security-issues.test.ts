import { expect, test } from "bun:test";
import {
  issueForFinding,
  missingSecurityIssues,
} from "./dependency-security-issues";
import type { Finding } from "./dependency-security";

const finding: Finding = {
  name: "synthetic",
  version: "1.0.0",
  shipped: true,
  severity: "critical",
  title: "Synthetic advisory",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  vulnerable_versions: "<2.0.0",
  fix: "2.0.0",
};
test("new shipped high/critical advisories enter the crew queue, including no-fix alerts", () => {
  const result = missingSecurityIssues(
    [
      finding,
      finding,
      { ...finding, name: "dev", shipped: false },
      { ...finding, name: "moderate", severity: "moderate" },
    ],
    [],
  );
  expect(result).toHaveLength(1);
  expect(result[0]!.labels).toContain("crew:ready");
  expect(result[0]!.body).toContain("Priority: high");
  expect(result[0]!.body).toContain(finding.url);
  expect(missingSecurityIssues([{ ...finding, fix: null }], [])).toHaveLength(
    1,
  );
});
test("daily audits deduplicate existing issues, but queue a new affected version", () => {
  const body = issueForFinding(finding).body;
  expect(
    missingSecurityIssues([finding], [{ number: 1, state: "open", body }]),
  ).toEqual([]);
  expect(
    missingSecurityIssues([finding], [{ number: 1, state: "closed", body }]),
  ).toEqual([]);
  expect(
    missingSecurityIssues(
      [{ ...finding, version: "1.0.1" }],
      [{ number: 1, state: "closed", body }],
    ),
  ).toHaveLength(1);
});
