/** Bind pre-tag approval and publication to native CI and optional local receipts. */
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

async function output(argv: string[]) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [code, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code) throw new Error(`${argv[0]} evidence command failed`);
  return stdout.trim();
}

export async function releaseWalkGate(args: string[]) {
  const [mode, sha, version, runId, prNumber] = args;
  if (
    !sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !version ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version) ||
    !runId ||
    !/^[1-9]\d*$/.test(runId)
  )
    throw new Error(
      "Require mode, immutable release SHA, version and evidence run ID",
    );
  if (mode !== "authorize" && mode !== "publication")
    throw new Error("Unknown release walk gate mode");
  const repository = "IvoryHeart/herdr-world";
  const run = JSON.parse(
    await output(["gh", "api", `repos/${repository}/actions/runs/${runId}`]),
  );
  const root = mkdtempSync("/tmp/world-walk-gate-");
  try {
    let signed: unknown;
    let ciRunId = runId;
    let releasePr = prNumber || undefined;
    if (mode === "publication") {
      if (
        run.path !== ".github/workflows/publish-release.yml" ||
        run.event !== "workflow_dispatch"
      )
        throw new Error(
          "Publication requires authorization from Publish Release before tagging",
        );
      await output([
        "gh",
        "run",
        "download",
        runId,
        "--repo",
        repository,
        "--name",
        "release-walk-authorization",
        "--dir",
        root,
      ]);
      const authorization = JSON.parse(
        readFileSync(join(root, "authorization.json"), "utf8"),
      );
      if (
        authorization.commit !== sha ||
        authorization.version !== version ||
        authorization.before_tag !== true
      )
        throw new Error(
          "Tag differs from its pre-tag release walk authorization",
        );
      signed = authorization.signed ?? null;
      ciRunId = authorization.ci_run_id;
      releasePr = authorization.release_pr || undefined;
    } else {
      signed = JSON.parse(
        process.env.RELEASE_WALK_SIGNED_RECEIPT?.trim() || "null",
      );
    }
    if (
      (releasePr !== undefined && !/^[1-9]\d*$/.test(releasePr)) ||
      !/^[1-9]\d*$/.test(ciRunId)
    )
      throw new Error(
        "Require a native walk CI run and a valid release PR number if supplied",
      );
    const ci =
      mode === "authorize"
        ? run
        : JSON.parse(
            await output([
              "gh",
              "api",
              `repos/${repository}/actions/runs/${ciRunId}`,
            ]),
          );
    const mainEvidence =
      (ci.event === "push" && ci.head_branch === "main") ||
      ci.event === "workflow_dispatch";
    if (
      ci.path !== ".github/workflows/ci.yml" ||
      !mainEvidence ||
      ci.head_sha !== sha ||
      ci.conclusion !== "success"
    )
      throw new Error(
        "Require successful main CI for the exact release commit",
      );
    // Release no longer reruns the repository check or World browser tests:
    // main's Delivery checks for this commit, fresh or reused from the PR run
    // of the identical tree, are its test evidence.
    const delivery = JSON.parse(
      await output([
        "gh",
        "api",
        `repos/${repository}/actions/runs/${ciRunId}/jobs?per_page=100`,
      ]),
    ).jobs.filter((job: { name: string }) => job.name === "Delivery checks");
    if (
      delivery.length !== 1 ||
      delivery[0].conclusion !== "success" ||
      (ci.run_attempt !== undefined &&
        delivery[0].run_attempt !== ci.run_attempt)
    )
      throw new Error(
        "Require main's Delivery checks to pass for the exact release commit",
      );
    const reports = join(root, "reports");
    await output([
      "gh",
      "run",
      "download",
      ciRunId,
      "--repo",
      repository,
      "--pattern",
      "release-walk-report-*",
      "--dir",
      reports,
    ]);
    const signedFile = join(root, "signed.json");
    writeFileSync(signedFile, JSON.stringify(signed));
    const digest = await output([
      "python3",
      "scripts/release-walk/validate.py",
      reports,
      signedFile,
      sha,
      version,
    ]);
    if (releasePr) {
      const pr = JSON.parse(
        await output([
          "gh",
          "pr",
          "view",
          releasePr,
          "--repo",
          repository,
          "--json",
          "mergedAt,mergeCommit,body,baseRefName",
        ]),
      );
      if (
        !pr.mergedAt ||
        pr.baseRefName !== "main" ||
        pr.mergeCommit?.oid !== sha
      )
        throw new Error(
          "The release PR must be merged to main at the exact release commit",
        );
      if (signed !== null) {
        const recorded = pr.body.matchAll(
          /^Release walk signed-in receipt:[ \t]*(.*)$/gm,
        );
        for (const [, value] of recorded)
          if (value.trim() !== digest)
            throw new Error(
              "The release PR records a different signed-in local receipt",
            );
      }
    }
    if (mode === "authorize") {
      const authorization = {
        before_tag: true,
        commit: sha,
        version,
        ci_run_id: ciRunId,
        release_pr: releasePr,
        signed,
      };
      const file = process.env.RELEASE_WALK_AUTHORIZATION;
      if (!file) throw new Error("Require authorization artifact destination");
      writeFileSync(file, JSON.stringify(authorization));
    }
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `walk_run_id=${ciRunId}\n`);
    console.info(
      "Release walk gate passed for the exact release commit and package bytes",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await releaseWalkGate(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
