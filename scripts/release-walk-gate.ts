/** Bind pre-tag approval and publication to completed native CI and local receipts. */
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
    let releasePr = prNumber;
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
      signed = authorization.signed;
      ciRunId = authorization.ci_run_id;
      releasePr = authorization.release_pr;
    } else {
      signed = JSON.parse(process.env.RELEASE_WALK_SIGNED_RECEIPT ?? "null");
    }
    if (
      !releasePr ||
      !/^[1-9]\d*$/.test(releasePr) ||
      !/^[1-9]\d*$/.test(ciRunId)
    )
      throw new Error(
        "Require the merged release PR and the native walk CI run",
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
      pr.mergeCommit?.oid !== sha ||
      !pr.body.includes(`Release walk signed-in receipt: ${digest}`)
    )
      throw new Error(
        "The merged release PR must record this exact signed-in local receipt",
      );
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
