import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const workflow = (name: string): any =>
  Bun.YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
function ancestors(jobs: any, name: string): string[] {
  return [jobs[name].needs ?? []]
    .flat()
    .flatMap((dependency: string) => [
      dependency,
      ...ancestors(jobs, dependency),
    ]);
}

test("only tags and nightly build native bytes; every channel contract precedes the seal", () => {
  const ci = workflow("ci");
  expect(ci.jobs["release-candidate"]).toBeUndefined();
  expect(ci.jobs["installer-upgrade"]).toBeUndefined();
  expect(workflow("release").jobs.candidate.uses).toBe(
    "./.github/workflows/release-candidate.yml",
  );
  const candidate = workflow("release-candidate");
  const all = JSON.stringify(candidate);
  expect(all).not.toContain("check:source");
  expect(all).not.toContain("world-browser.yml");
  expect(
    candidate.jobs.package.strategy.matrix.include.map(
      (row: any) => row.platform,
    ),
  ).toEqual([
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "windows-x64",
    "windows-arm64",
  ]);
  const steps = candidate.jobs.package.steps;
  expect(
    steps.filter((step: any) =>
      step.run?.includes("bash scripts/package-release.sh"),
    ),
  ).toHaveLength(1);
  expect(
    steps.some(
      (step: any) => step.run === "bun scripts/installer-upgrade.ts verify",
    ),
  ).toBe(true);
  expect(candidate.jobs["release-walk"].with.package_artifacts).toBe(true);
  for (const required of [
    "package",
    "archives",
    "npm-stage",
    "npm-smoke",
    "homebrew-formula",
    "homebrew-smoke",
    "release-walk",
    "validate",
  ])
    expect(ancestors(candidate.jobs, "verify")).toContain(required);
  expect(
    candidate.jobs.validate.steps.some(
      (step: any) => step.run === "bun run security:check",
    ),
  ).toBe(true);
  expect(candidate.jobs["npm-smoke"].strategy.matrix.runner).toHaveLength(6);
  expect(candidate.jobs["homebrew-smoke"].strategy.matrix.runner).toHaveLength(
    4,
  );
});

test("standard publishers consume the tested artifact and serialize channels", () => {
  const release = workflow("release");
  expect(release.on).toEqual({ push: { tags: ["v*"] } });
  expect(release.jobs.candidate.needs).toBe("validate");
  for (const name of ["publish", "npm-publish", "homebrew-pr"]) {
    expect(ancestors(release.jobs, name)).toContain("candidate");
    expect(JSON.stringify(release.jobs[name])).not.toContain("npm pack ");
  }
  expect(JSON.stringify(release.jobs.publish)).toContain(
    "softprops/action-gh-release@",
  );
  expect(JSON.stringify(release.jobs["npm-publish"])).toContain("npm publish");
  expect(JSON.stringify(release.jobs["npm-publish"])).toContain("--provenance");
  expect(release.jobs["npm-publish"].permissions["id-token"]).toBe("write");
  expect(release.jobs["npm-publish"].needs).toContain("publish");
  expect(release.jobs["homebrew-pr"].needs).toContain("npm-publish");
  expect(release.jobs["homebrew-pr"].environment).toBe("release");
  for (const [name, job] of Object.entries(release.jobs) as [string, any][]) {
    if (name !== "homebrew-pr") expect(job.environment).not.toBe("release");
    if (JSON.stringify(job).includes("secrets.HOMEBREW_TAP_TOKEN"))
      expect(name).toBe("homebrew-pr");
  }
  expect(release.jobs["npm-publish"].environment).toBeUndefined();
  const brew = release.jobs["homebrew-pr"].steps.find((s: any) =>
    s.uses?.includes("mislav/bump-homebrew-formula-action@"),
  );
  expect(brew.with["create-pullrequest"]).toBe(true);
  expect(brew.env.COMMITTER_TOKEN).toBe("${{ secrets.HOMEBREW_TAP_TOKEN }}");
  expect(JSON.stringify(release)).not.toMatch(
    /publish-(?:github|npm)-release|open-homebrew-pr|release-walk-gate|release-bundle/,
  );
  expect(release.jobs["deploy-pages"].needs).not.toContain("homebrew-pr");
});

test("release-please owns version/changelog preparation and never creates a tag", () => {
  const steps = workflow("release-pr").jobs.prepare.steps;
  const prepare = steps.find((s: any) => s.name === "Prepare the release PR");
  expect(prepare.run).toContain("release-please@17.3.0 release-pr");
  expect(prepare.run).not.toContain("github-release");
  const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
  expect(config.packages["."]["release-type"]).toBe("simple");
  expect(config.packages["."]["extra-files"]).toContainEqual({
    type: "generic",
    path: "herdr-plugin.toml",
  });
  expect(readFileSync("herdr-plugin.toml", "utf8")).toMatch(
    /^# x-release-please-start-version\nversion = "[^"]+"\n# x-release-please-end$/m,
  );
  expect(JSON.stringify(steps)).toContain("workflow run ci.yml");
  for (const removed of [
    "scripts/prepare-release.ts",
    "scripts/changelog-fragments.ts",
    "scripts/open-homebrew-pr.sh",
  ])
    expect(existsSync(removed)).toBe(false);
});

test("retained-artifact reruns continue every publisher despite the skipped candidate", () => {
  const jobs = workflow("release").jobs;
  for (const candidate of ["success", "skipped"]) {
    const results: Record<string, any> = {
      validate: {
        result: "success",
        outputs: { retained: candidate === "skipped" ? "true" : "false" },
      },
      candidate: { result: candidate },
      publish: { result: "success" },
      "npm-publish": { result: "success" },
      "homebrew-pr": { result: "success" },
    };
    for (const name of [
      "publish",
      "npm-publish",
      "homebrew-pr",
      "release-label",
    ]) {
      expect(jobs[name]).toBeDefined();
      const condition =
        jobs[name]?.if?.replace(/^\$\{\{\s*|\s*\}\}$/g, "") ?? "success()";
      const success = () =>
        ancestors(jobs, name).every(
          (parent) => results[parent]?.result === "success",
        );
      const evaluate = new Function(
        "needs",
        "cancelled",
        "success",
        `return (${condition.replace(/needs\.([\w-]+)/g, 'needs["$1"]')});`,
      );
      expect(evaluate(results, () => false, success)).toBe(true);
      // Each publisher must stop when its direct predecessor failed or skipped.
      const parent = [jobs[name].needs].flat().at(-1);
      for (const result of ["failure", "cancelled", "skipped"]) {
        const prior = results[parent];
        results[parent] = { result };
        if (
          parent !== "candidate" ||
          result !== "skipped" ||
          candidate !== "skipped"
        )
          expect(evaluate(results, () => false, success)).toBe(false);
        results[parent] = prior;
      }
    }
  }
});

test("Linux test jobs delegate scoped recovery; models never retry and main runs no heavy jobs", () => {
  const ci = workflow("ci");
  expect(ci.jobs["unit-tests"].if).toContain("'hold'");
  expect(ci.jobs.static.if).toBe(
    "needs.validation-scope.outputs.mode == 'docs'",
  );
  for (const [file, name, needle] of [
    ["ci", "unit-tests", "ci-tests.ts unit"],
    ["world-browser", "world-browser", "ci-tests.ts world"],
    ["ci", "unit-tests", "ci-tests.ts web"],
    ["behavioral-verification", "shards", "ci-model-groups.ts run"],
  ]) {
    const job = workflow(file).jobs[name];
    expect(job["runs-on"]).toMatch(/^ubuntu-/);
    const steps = job.steps.filter(
      (s: any) => s.run?.includes(needle) && !s.run.includes("--plan"),
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]["continue-on-error"]).toBeUndefined();
    expect(
      job.steps.some((step: any) => step.name === "Retry failed test once"),
    ).toBe(false);
  }
  const unit = ci.jobs["unit-tests"];
  expect(
    unit.steps.filter((step: any) => step.run?.includes("--plan")),
  ).toHaveLength(1);
  const comparisons = unit.steps.filter((step: any) =>
    step.run?.includes("ci-unit-comparison.ts run"),
  );
  expect(comparisons).toHaveLength(1);
  expect(comparisons[0]["continue-on-error"]).toBeUndefined();
});

test("channel upgrades exercise a running previous release and verify persisted stable path", () => {
  const script = readFileSync("scripts/release-channel-upgrade.py", "utf8");
  for (const boundary of [
    "'service', 'install'",
    "'brew', 'upgrade'",
    "'brew', 'cleanup'",
    "health(base, version)",
    "marker.read_text()",
    "'/Cellar/' not in definition.read_text()",
  ])
    expect(script).toContain(boundary);
  expect(
    JSON.stringify(workflow("release-candidate").jobs["homebrew-smoke"]),
  ).toContain("release-channel-upgrade.py");
  const tap = workflow("homebrew-runtime");
  expect(tap.jobs.ownership.strategy.matrix.runner).toEqual([
    "macos-15",
    "macos-15-intel",
  ]);
  expect(readFileSync("scripts/homebrew-tap-workflow.yml", "utf8")).toContain(
    "check-homebrew-runtime.rb",
  );
});

test("nightly alerts serialize to one issue even when dispatch overlaps the schedule", () => {
  const nightly = workflow("nightly-native");
  expect(nightly.concurrency.group).toBe("nightly-native");
  expect(nightly.concurrency["cancel-in-progress"]).toBe(false);
});
