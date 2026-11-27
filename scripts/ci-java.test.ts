import { expect, test } from "bun:test";

test("verification shards install one exact Java build; aggregation needs no Java", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL(
        "../.github/workflows/behavioral-verification.yml",
        import.meta.url,
      ),
    ).text(),
  ) as {
    env: { VERIFICATION_JAVA_VERSION: string };
    jobs: Record<
      string,
      {
        steps: Array<{
          uses?: string;
          run?: string;
          with?: Record<string, unknown>;
        }>;
      }
    >;
  };
  expect(workflow.env?.VERIFICATION_JAVA_VERSION).toMatch(
    /^21\.\d+\.\d+\+\d+$/,
  );
  const installations = ["shards"].map((name) => {
    const steps = workflow.jobs[name]!.steps;
    const java = steps.filter((step) =>
      step.uses?.startsWith("actions/setup-java@"),
    );
    expect(java).toHaveLength(1);
    expect(java[0]!.uses).toMatch(/^actions\/setup-java@[a-f0-9]{40}$/);
    expect(java[0]!.with).toMatchObject({
      distribution: "temurin",
      "java-version": "${{ env.VERIFICATION_JAVA_VERSION }}",
      architecture: "x64",
    });
    expect(
      steps.findIndex((step) => step.run?.includes("verification")),
    ).toBeGreaterThan(steps.indexOf(java[0]!));
    expect(steps.some((step) => step.run?.includes("JAVA_HOME_21_X64"))).toBe(
      false,
    );
    return java[0];
  });
  expect(installations).toHaveLength(1);
  expect(
    workflow.jobs.candidate.steps.some((step) =>
      step.uses?.startsWith("actions/setup-java@"),
    ),
  ).toBe(false);
});
