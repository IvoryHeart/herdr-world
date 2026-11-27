import { expect, test } from "bun:test";

const yaml = async (path: string): Promise<any> =>
  Bun.YAML.parse(await Bun.file(new URL(`../${path}`, import.meta.url)).text());

test("live audit blocks the protected delivery result, release publication and Pages deployment", async () => {
  const ci = await yaml(".github/workflows/ci.yml");
  expect(
    ci.jobs["dependency-security"].steps.some(
      (step: any) => step.run === "bun run security:check",
    ),
  ).toBe(true);
  // Only a reused Delivery result, which already required the audit, skips it.
  expect(ci.jobs["dependency-security"].if).toBe(
    "needs.validation-scope.outputs.mode != 'reuse' && needs.validation-scope.outputs.mode != 'hold'",
  );
  expect(ci.jobs.delivery.needs).toContain("dependency-security");
  const required = ci.jobs.delivery.steps.find(
    (step: any) => step.name === "Run full repository check",
  );
  expect(required.env).toMatchObject({
    SECURITY_RESULT: "${{ needs.dependency-security.result }}",
  });
  expect(required.run).toBe("bun scripts/ci-delivery-result.ts");
  for (const [path, job] of [
    [".github/workflows/release-candidate.yml", "validate"],
    [".github/workflows/pages.yml", "build"],
  ]) {
    const workflow = await yaml(path!);
    expect(
      workflow.jobs[job!].steps.some(
        (step: any) =>
          step.run === "bun run security:check" && !step["continue-on-error"],
      ),
    ).toBe(true);
  }
});

test("daily main audit queues issues even on advisory failure, with no write token in audit", async () => {
  const workflow = await yaml(".github/workflows/dependency-security.yml");
  expect(workflow.on.schedule).toHaveLength(1);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.queue.if).toContain("always()");
  expect(workflow.jobs.queue.if).toContain("refs/heads/main");
  expect(workflow.jobs.queue.if).toContain("!inputs.demo_vulnerable");
  expect(workflow.jobs.queue.permissions.issues).toBe("write");
});

test("bot candidate data and write credentials live in separate jobs using trusted base code", async () => {
  const workflow = await yaml(".github/workflows/dependency-maintenance.yml");
  expect(workflow.on.pull_request_target.types).toContain("synchronize");
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.prepare.permissions).toBeUndefined();
  expect(workflow.jobs.prepare.if).toContain("dependabot[bot]");
  const checkout = workflow.jobs.publish.steps.find((step: any) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout.with.ref).toBe("${{ github.event.pull_request.base.sha }}");
  expect(checkout.with["persist-credentials"]).toBe(false);
  expect(
    workflow.jobs.publish.steps.some((step: any) =>
      step.run?.includes("install"),
    ),
  ).toBe(false);
});

test("Dependabot covers the complete manifest/lock inventory with separate security groups", async () => {
  const config = await yaml(".github/dependabot.yml");
  expect(
    config.updates.map((update: any) => [
      update["package-ecosystem"],
      update.directory,
    ]),
  ).toEqual([
    ["github-actions", "/"],
    ["bun", "/"],
    ["npm", "/tools/quint"],
  ]);
  for (const update of config.updates)
    expect(
      Object.values(update.groups).some(
        (group: any) => group["applies-to"] === "security-updates",
      ),
    ).toBe(true);
});
