import { describe, expect, test } from "bun:test";
import { YAML } from "bun";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  releaseAssetNames,
  verifyReleaseAssetNames,
} from "./check-release-assets.mjs";

describe("Herdr World release boundary", () => {
  const names = releaseAssetNames("0.7.0");

  test("publishes exactly six Herdr World targets and no legacy discovery paths", () => {
    expect(names).toHaveLength(30);
    expect(names).toContain("herdr-world-linux-x64.update.json");
    expect(names).toContain("herdr-world-v0.7.0-windows-arm64.tar.xz.sha256");
    expect(() => verifyReleaseAssetNames(names, "0.7.0")).not.toThrow();
    for (const prefix of ["herdr-gui", "herdr-studio"]) {
      for (const suffix of [
        "linux-x64.update.json",
        "linux-x64.tar.xz",
        "linux-x64.tar.xz.sha256",
      ]) {
        expect(() =>
          verifyReleaseAssetNames([...names, `${prefix}-${suffix}`], "0.7.0"),
        ).toThrow("unexpected");
      }
      expect(() =>
        verifyReleaseAssetNames([...names, `install-${prefix}.sh`], "0.7.0"),
      ).toThrow("unexpected");
    }
  });

  test("rejects missing or wrong-version assets", () => {
    expect(() => verifyReleaseAssetNames(names.slice(1), "0.7.0")).toThrow(
      "missing",
    );
    expect(() => verifyReleaseAssetNames(names, "0.7.1")).toThrow("missing");
    expect(() => releaseAssetNames("../bad")).toThrow(
      "Invalid release version",
    );
  });

  test("accepts candidate assets under their exact prerelease version", () => {
    const candidate = releaseAssetNames("0.2.0-rc.1");
    expect(candidate).toContain("herdr-world-v0.2.0-rc.1-windows-arm64.tar.xz");
    expect(() =>
      verifyReleaseAssetNames(candidate, "0.2.0-rc.1"),
    ).not.toThrow();
    expect(() => releaseAssetNames("0.2.0-rc.0")).toThrow();
  });

  test("the publish workflow enforces the boundary and installs only Herdr World", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    const publish = workflow.slice(workflow.indexOf("  publish:"));
    expect(publish).toContain(
      'node scripts/check-release-assets.mjs "${GITHUB_REF_NAME#v}"',
    );
    expect(publish).toContain("scripts/install-herdr-world.sh");
    expect(publish).not.toContain("herdr-gui");
    expect(publish).toContain("--latest");
  });

  test("downstream channels consume the published release assets on retries", async () => {
    const workflow = YAML.parse(
      await readFile(
        new URL("../.github/workflows/release.yml", import.meta.url),
        "utf8",
      ),
    );
    const jobs = workflow.jobs;
    expect(jobs["published-archives"].needs).toBe("publish");
    expect(jobs["npm-stage"].needs).toBe("published-archives");
    expect(jobs["homebrew-formula"].needs).toBe("published-archives");
    const published = jobs["published-archives"].steps
      .map((step) => step.run ?? "")
      .join("\n");
    expect(published).toContain("gh release download");
    expect(published).toContain("sha256sum -c");
    expect(published).toContain('cmp "$versioned" "$latest"');
    for (const name of ["npm-stage", "homebrew-formula"]) {
      const download = jobs[name].steps.find((step) =>
        step.uses?.includes("actions/download-artifact"),
      );
      expect(download.with.name).toBe("published-archives");
    }
  });

  test("release packages carry World lineage and complete notice inputs", async () => {
    const packaging = await readFile(
      new URL("./package-release.sh", import.meta.url),
      "utf8",
    );
    for (const required of [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md",
      "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md",
      "LICENSES",
    ]) {
      expect(packaging).toContain(required);
    }
    expect(packaging).not.toContain("herdr-gui");
    expect(packaging).not.toContain("roamgate-");
  });
});
