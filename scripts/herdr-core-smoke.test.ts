import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { smokeLatestCore } from "./herdr-core-smoke";

const roots: string[] = [];
const linux = process.platform === "linux" ? test : test.skip;
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// A synthetic release shaped like the official latest.json, with an inert binary.
// Tests exercise download, verification, extraction and suite admission offline.
function release() {
  const root = mkdtempSync(join(tmpdir(), "hcw-smoke-test-"));
  roots.push(root);
  writeFileSync(join(root, "herdr-core"), "#!/bin/sh\nexit 0\n", {
    mode: 0o700,
  });
  const archive = join(root, "release.tar.gz");
  expect(
    Bun.spawnSync(["tar", "-czf", archive, "-C", root, "herdr-core"]).exitCode,
  ).toBe(0);
  const bytes = readFileSync(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const url = "https://releases.herdr.dev/core/9.9.9/herdr-core-linux.tar.gz";
  const manifest = {
    version: "9.9.9",
    targets: Object.fromEntries(
      ["linux-x86_64", "linux-aarch64"].map((target) => [
        target,
        { url, sha256 },
      ]),
    ),
  };
  const requests: string[] = [];
  const download = async (requested: string) => {
    requests.push(requested);
    if (requested.endsWith("/latest.json")) return Response.json(manifest);
    expect(requested).toBe(url);
    return new Response(bytes);
  };
  return { root, bytes, sha256, manifest, requests, download };
}

linux.each([0, 7])(
  "newest verified release runs every live suite, returns %i and cleans up",
  async (expectedCode) => {
    const fixture = release();
    const reportPath = join(fixture.root, "report.json");
    let extracted = "";
    const exitCode = await smokeLatestCore({
      download: fixture.download,
      reportPath,
      runTests: (binary, suites) => {
        extracted = binary;
        expect(readFileSync(binary, "utf8")).toContain("exit 0");
        expect(suites.map((path) => basename(path))).toEqual([
          "core.live.test.ts",
          "delivery.live.test.ts",
          "operations.live.test.ts",
          "windows.live.test.ts",
          "worktrees.live.test.ts",
        ]);
        return expectedCode;
      },
    });
    expect(exitCode).toBe(expectedCode);
    expect(fixture.requests[0]).toBe(
      "https://releases.herdr.dev/core/latest.json",
    );
    expect(fixture.requests).toHaveLength(2);
    expect(existsSync(extracted)).toBe(false);
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({
      version: "9.9.9",
      sha256: fixture.sha256,
      result: expectedCode === 0 ? "passed" : "failed",
      exitCode: expectedCode,
    });
  },
);

linux("checksum mismatch never extracts or runs a release", async () => {
  const fixture = release();
  for (const asset of Object.values(fixture.manifest.targets))
    asset.sha256 = "0".repeat(64);
  await expect(
    smokeLatestCore({
      download: fixture.download,
      runTests: () => {
        throw new Error("must not run");
      },
    }),
  ).rejects.toThrow("checksum mismatch");
});

linux(
  "HTTP errors and missing target fail without a cached-release fallback",
  async () => {
    const fixture = release();
    for (const download of [
      async () => new Response("offline", { status: 503 }),
      async (url: string) =>
        url.endsWith("latest.json")
          ? Response.json(fixture.manifest)
          : new Response("missing", { status: 404 }),
      async () => Response.json({ version: "9.9.9", targets: {} }),
    ]) {
      await expect(
        smokeLatestCore({
          download,
          runTests: () => {
            throw new Error("must not run");
          },
        }),
      ).rejects.toThrow(/HTTP|no linux-/);
    }
  },
);

linux(
  "runner exceptions leave failed evidence and remove the downloaded binary",
  async () => {
    const fixture = release();
    const reportPath = join(fixture.root, "report.json");
    let binary = "";
    await expect(
      smokeLatestCore({
        download: fixture.download,
        reportPath,
        runTests: (path) => {
          binary = path;
          throw new Error("runner failed");
        },
      }),
    ).rejects.toThrow("runner failed");
    expect(existsSync(binary)).toBe(false);
    expect(JSON.parse(readFileSync(reportPath, "utf8")).result).toBe("failed");
  },
);

test("manual and daily smoke is an unpinned signal with retained evidence", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/herdr-core-smoke.yml", import.meta.url),
    ).text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        "continue-on-error"?: boolean;
        steps: Array<{ run?: string; uses?: string; if?: string }>;
      }
    >;
  };
  expect(workflow.on).toHaveProperty("workflow_dispatch");
  expect(workflow.on).toHaveProperty("schedule");
  expect(workflow.on).not.toHaveProperty("pull_request");
  expect(workflow.permissions).toEqual({ contents: "read" });
  const job = workflow.jobs.smoke!;
  expect(job["continue-on-error"]).toBeUndefined();
  expect(
    job.steps.some((step) =>
      step.run?.includes("bun scripts/herdr-core-smoke.ts"),
    ),
  ).toBe(true);
  expect(
    job.steps.some(
      (step) =>
        step.uses?.startsWith("actions/upload-artifact@") &&
        step.if === "always()",
    ),
  ).toBe(true);
});
