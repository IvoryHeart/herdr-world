import { expect, test } from "bun:test";
import { isToolingOnlyChange, isToolingPath } from "./validation-scope";

test("only the explicit agent tooling paths qualify", () => {
  const allowed = [
    "scripts/agent/crew.ts",
    "scripts/agent/crew.test.ts",
    "scripts/agent/gate/rules.test.ts",
    "docs/agent-development.md",
    "docs/crew-runbook.md",
    "docs/dispatch-runbook.md",
    "changes/482.md",
  ];
  expect(isToolingOnlyChange(allowed)).toBe(true);
  for (const path of [
    "server/src/index.ts",
    "web/src/world/TownView.tsx",
    "shared/pullRequest.ts",
    "scripts/check-delivery.ts",
    "scripts/agent.ts",
    "scripts/validation-scope.ts",
    "scripts/ci-workflow.test.ts",
    ".github/workflows/ci.yml",
    ".githooks/pre-push",
    "package.json",
    "bun.lock",
    "verification/coverage.json",
    "quint/runtime.qnt",
    "tools/quint/execution.json",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".agents/dispatch/config.json",
    ".agents/skills/candidate-delivery/SKILL.md",
    "docs/other.md",
    "changes/README.md",
    "changes/nested/x.md",
    "scripts/agent/../../server/index.ts",
  ]) {
    expect(isToolingPath(path)).toBe(false);
    expect(isToolingOnlyChange([...allowed, path])).toBe(false);
  }
  expect(isToolingOnlyChange([])).toBe(false);
});
