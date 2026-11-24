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

test("main version CI builds once; only channel contracts can seal bytes", () => {
  const ci = workflow("ci");
  expect(ci.jobs["release-candidate"]).toMatchObject({
    if: "needs.validation-scope.outputs.release == 'true'",
    uses: "./.github/workflows/release-candidate.yml",
  });
  expect(ci.jobs.delivery.needs).toContain("release-candidate");
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
    steps.filter((step: any) => step.run?.includes("bun run package:")),
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

test("tag automatically waits, downloads the seal or fully retests expired bytes", () => {
  const release = workflow("release");
  expect(release.on).toEqual({ push: { tags: ["v*"] } });
  expect(
    release.jobs.validate.steps.some((step: any) =>
      step.run?.includes("release-walk-gate.ts"),
    ),
  ).toBe(true);
  expect(release.jobs.rebuild).toMatchObject({
    if: "needs.validate.outputs.rebuild == 'true'",
    uses: "./.github/workflows/release-candidate.yml",
  });
  expect(release.jobs.acquire.needs).toEqual(["validate", "rebuild"]);
  expect(release.jobs.acquire.if).toContain(
    "needs.rebuild.result == 'success'",
  );
  expect(release.jobs.acquire.if).toContain(
    "needs.validate.outputs.rebuild == 'false'",
  );
  for (const name of ["publish", "npm-publish", "homebrew-pr"]) {
    const job = release.jobs[name];
    expect(ancestors(release.jobs, name)).toContain("acquire");
    const check = job.steps.findIndex((step: any) =>
      step.run?.includes("release-bundle.mjs verify"),
    );
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(job.steps.length - 1);
    expect(
      job.steps.map((step: any) => step.run ?? "").join("\n"),
    ).not.toContain("npm pack ");
    expect(JSON.stringify(job)).not.toContain("package-release.sh");
  }
  expect(release.jobs["npm-publish"].needs).toContain("publish");
  expect(release.jobs["npm-publish"].permissions["id-token"]).toBe("write");
  expect(release.jobs["homebrew-pr"].needs).toContain("npm-publish");
  expect(release.jobs["homebrew-pr"].steps.at(-1).env.GH_TOKEN).toBe(
    "${{ secrets.HOMEBREW_TAP_TOKEN }}",
  );
  expect(release.jobs["deploy-pages"].needs).not.toContain("homebrew-pr");
  expect(release.jobs["publication-status"].if).toBe("always()");
});

test("release PR assembles changelog without retesting main or creating tags", () => {
  const prepare = workflow("release-pr");
  const steps = JSON.stringify(prepare.jobs.prepare.steps);
  expect(steps).toContain("prepare-release.ts");
  expect(steps).toContain("workflow run ci.yml");
  expect(steps).toContain("release/next");
  expect(steps).not.toContain("check:source");
  expect(steps).not.toContain("git tag");
  expect(steps).not.toContain("docs/releases/");
  for (const removed of ["prepare-release", "publish-release"])
    expect(existsSync(`.github/workflows/${removed}.yml`)).toBe(false);
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
